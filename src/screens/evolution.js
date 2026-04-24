// Evolution screen: time-series view across all snapshots.
//
// Loads every snapshot, computes stats for each, then plots one line chart
// per tracked metric. X-axis is calendar-time: a gap of 2 months renders
// twice as wide as a gap of 1 month. Charts work for 1 snapshot too
// (single dot, centered).
//
// All metrics render unconditionally — the previous chip-filter was noise;
// the metrics are few enough that scrolling beats hiding.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { formatInt, formatCurrency, formatDate } from '../ui/format.js';
import { computeAllStats } from '../core/analyzer.js';
import { lineChart } from '../ui/charts.js';
import { icon, iconTile } from '../ui/icon.js';

// Each metric: how to pull the value out of stats, how to format, what colour,
// plus a thematic icon and an `insightKey` pointing at the i18n string shown
// in the info popover (explains what reading the curve tells the broker).
const METRICS = [
  { key: 'total_clients',       titleKey: 'kpi.total_clients',       tint: '--accent',
    iconName: 'person.2',            insightKey: 'evolution.insight.total_clients',
    pick: (s) => s.kpi_summary.total_clients, fmt: formatInt },
  { key: 'active_clients',      titleKey: 'kpi.active_clients',      tint: '--indigo',
    iconName: 'person.crop.circle',  insightKey: 'evolution.insight.active_clients',
    pick: (s) => s.kpi_summary.active_clients, fmt: formatInt },
  { key: 'total_polices',       titleKey: 'kpi.total_polices',       tint: '--purple',
    iconName: 'doc.text',            insightKey: 'evolution.insight.total_polices',
    pick: (s) => s.kpi_summary.total_polices, fmt: formatInt },
  { key: 'avg_polices',         titleKey: 'kpi.avg_polices',         tint: '--teal',
    iconName: 'doc.on.doc',          insightKey: 'evolution.insight.avg_polices',
    pick: (s) => s.kpi_summary.avg_polices_per_client,
    fmt: (v) => (v || 0).toFixed(2) },
  { key: 'total_premium',       titleKey: 'kpi.total_premium',       tint: '--success',
    iconName: 'briefcase',           insightKey: 'evolution.insight.total_premium',
    pick: (s) => s.kpi_summary.total_premium,
    fmt: (v) => formatCurrency(v) },
  { key: 'avg_premium',         titleKey: 'evolution.avg_premium',   tint: '--teal',
    iconName: 'tag',                 insightKey: 'evolution.insight.avg_premium',
    pick: (s) => s.kpi_summary.avg_premium_per_client,
    fmt: (v) => formatCurrency(v) },
  { key: 'total_sinistres',     titleKey: 'kpi.sinistres',           tint: '--warning',
    iconName: 'shield.checkmark',    insightKey: 'evolution.insight.total_sinistres',
    pick: (s) => s.kpi_summary.total_sinistres, fmt: formatInt },
  { key: 'mono_policy_clients', titleKey: 'evolution.mono_policy',   tint: '--pink',
    iconName: 'arrow.up.arrow.down', insightKey: 'evolution.insight.mono_policy_clients',
    pick: (s) => s.kpi_summary.mono_policy_clients, fmt: formatInt },
];

export function renderEvolution(root, ctx) {
  const snapshots = ctx.db.listSnapshots();

  if (snapshots.length === 0) {
    mount(root, h('div', { class: 'page' }, [
      h('h1', { class: 'page-title' }, t('evolution.title')),
      h('div', { class: 'empty' }, [
        h('div', { class: 'empty-icon' },
          iconTile('chart.bar', '--muted', { size: 56, iconSize: 28 })),
        h('div', { class: 'empty-title' }, t('evolution.empty')),
      ]),
    ]));
    return;
  }

  // Compute stats per snapshot. Done synchronously — typical broker portfolios
  // fit in a few MB of rows per snapshot; this runs well under a second for
  // a handful of snapshots.
  let perSnap;
  try {
    perSnap = snapshots.map((s) => {
      const clients = ctx.db.fetchRows('clients', s.id);
      const polices = ctx.db.fetchRows('polices', s.id);
      const compagnies = ctx.db.fetchRows('compagnies_polices', s.id);
      const sinistres = ctx.db.fetchRows('sinistres', s.id);
      const year = Number((s.snapshot_date || '').slice(0, 4)) || new Date().getFullYear();
      const stats = computeAllStats(clients, polices, compagnies, sinistres, year, ctx.branchIndex);
      return { snapshot: s, stats };
    });
  } catch (e) {
    console.error(e);
    toast(t('error.generic') + ' ' + e.message, 'danger');
    return;
  }

  // Oldest → newest so the line is drawn left-to-right.
  const chronological = [...perSnap].sort((a, b) =>
    String(a.snapshot.snapshot_date).localeCompare(String(b.snapshot.snapshot_date)));

  function chartCard(metric) {
    const points = chronological.map(({ snapshot, stats }) => ({
      date: snapshot.snapshot_date,
      value: metric.pick(stats) || 0,
    }));
    // Info button + popover: same pattern as dashboard.js cardHead. Click toggles
    // the sibling popover's `is-open`; it carries the human-language explanation
    // of what an up/down move on this particular curve means for the broker.
    const insight = t(metric.insightKey);
    const infoBtn = h('button', {
      class: 'card-info-btn',
      type: 'button',
      'aria-label': 'Info',
      title: insight,
      onclick: (e) => {
        e.stopPropagation();
        const pop = e.currentTarget.nextElementSibling;
        if (pop) pop.classList.toggle('is-open');
      },
    }, icon('info.circle', { size: 16 }));
    const infoPop = h('div', { class: 'card-info-popover', role: 'tooltip' }, insight);
    return h('div', { class: 'dash-card evo-card' }, [
      h('div', { class: 'evo-card-head' }, [
        iconTile(metric.iconName, metric.tint, { size: 32, iconSize: 16 }),
        h('h3', { class: 'card-h3' }, t(metric.titleKey)),
        h('div', { class: 'card-head-info' }, [infoBtn, infoPop]),
      ]),
      h('div', { class: 'chart-wrap' },
        lineChart(points, {
          width: 720, height: 260,
          color: metric.tint,
          valueFmt: metric.fmt,
          vsPrevLabel: t('evolution.vs_previous'),
          vsFirstLabel: t('evolution.since_start'),
          noDataLabel: t('evolution.no_data'),
        })),
    ]);
  }

  // Header with snapshot count + date range.
  const first = chronological[0].snapshot;
  const last = chronological[chronological.length - 1].snapshot;
  const range = chronological.length === 1
    ? formatDate(first.snapshot_date)
    : `${formatDate(first.snapshot_date)} → ${formatDate(last.snapshot_date)}`;

  mount(root, h('div', { class: 'page dash' }, [
    h('div', { class: 'dash-hero' }, [
      h('div', { class: 'dash-hero-main' }, [
        h('div', { class: 'dash-hero-eyebrow' },
          `${t('evolution.title')} · ${chronological.length} ${t('evolution.snapshots')}`),
        h('h1', { class: 'dash-hero-title' }, range),
      ]),
    ]),
    chronological.length < 2
      ? h('p', { class: 'form-hint' }, t('evolution.need_more'))
      : null,
    h('div', { class: 'dash-grid dash-grid-evolution' }, METRICS.map(chartCard)),
  ]));
}
