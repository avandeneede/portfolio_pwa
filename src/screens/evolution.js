// Evolution screen: time-series view across all snapshots.
//
// Loads every snapshot, computes stats for each, then plots one line chart
// per tracked metric. X-axis is calendar-time: a gap of 2 months renders
// twice as wide as a gap of 1 month. Charts work for 1 snapshot too
// (single dot, centered).
//
// At the bottom we render the same "Synthèse des ratios" table as page 10
// of the print report, but spread across every snapshot — with delta
// indicators (arrow + Δ% / Δpp) coloured by whether the move was in the
// "good" or "bad" direction for that particular ratio. Brokers use this
// to spot drift early (e.g. data quality slipping, ageing client base,
// rising claim frequency) without having to eyeball the chart grid.

import { h, mount, togglePopover } from '../ui/dom.js';
import { renderInfoText, stripInfoMarkers } from '../ui/info_text.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { formatInt, formatCurrency, formatDate } from '../ui/format.js';
import { computeAllStats } from '../core/analyzer.js';
import { lineChart } from '../ui/charts.js';
import { icon, iconTile } from '../ui/icon.js';
import { buildRatiosSummary, ratioSectionTitle } from '../core/ratios_summary.js';

// Each metric: how to pull the value out of stats, how to format, what colour,
// plus a thematic icon and an `insightKey` pointing at the i18n string shown
// in the info popover (explains what reading the curve tells the broker).
//
// `direction` decides how the line-chart tooltip colours its delta arrows:
//   'up_good' → rising = green (aligned with broker objective)
//   'up_bad'  → rising = red (working against broker objective)
//   'neutral' → never colour-loaded; broker strategy decides
// Mirrors DIRECTION_GOODNESS below for the ratios table.
const METRICS = [
  { key: 'total_clients',       titleKey: 'kpi.total_clients',       tint: '--accent',
    iconName: 'person.2',            insightKey: 'evolution.insight.total_clients',
    direction: 'up_good',
    pick: (s) => s.kpi_summary.total_clients, fmt: formatInt },
  { key: 'active_clients',      titleKey: 'kpi.active_clients',      tint: '--indigo',
    iconName: 'person.crop.circle',  insightKey: 'evolution.insight.active_clients',
    direction: 'up_good',
    pick: (s) => s.kpi_summary.active_clients, fmt: formatInt },
  { key: 'total_polices',       titleKey: 'kpi.total_polices',       tint: '--purple',
    iconName: 'doc.text',            insightKey: 'evolution.insight.total_polices',
    direction: 'up_good',
    pick: (s) => s.kpi_summary.total_polices, fmt: formatInt },
  { key: 'avg_polices',         titleKey: 'kpi.avg_polices',         tint: '--teal',
    iconName: 'doc.on.doc',          insightKey: 'evolution.insight.avg_polices',
    direction: 'up_good',
    pick: (s) => s.kpi_summary.avg_polices_per_client,
    fmt: (v) => (v || 0).toFixed(2) },
  { key: 'total_premium',       titleKey: 'kpi.total_premium',       tint: '--success',
    iconName: 'briefcase',           insightKey: 'evolution.insight.total_premium',
    direction: 'up_good',
    pick: (s) => s.kpi_summary.total_premium,
    fmt: (v) => formatCurrency(v) },
  { key: 'avg_premium',         titleKey: 'evolution.avg_premium',   tint: '--teal',
    iconName: 'tag',                 insightKey: 'evolution.insight.avg_premium',
    direction: 'up_good',
    pick: (s) => s.kpi_summary.avg_premium_per_client,
    fmt: (v) => formatCurrency(v) },
  { key: 'total_sinistres',     titleKey: 'kpi.sinistres',           tint: '--warning',
    iconName: 'shield.checkmark',    insightKey: 'evolution.insight.total_sinistres',
    direction: 'up_bad',
    pick: (s) => s.kpi_summary.total_sinistres, fmt: formatInt },
  { key: 'mono_policy_clients', titleKey: 'evolution.mono_policy',   tint: '--pink',
    iconName: 'arrow.up.arrow.down', insightKey: 'evolution.insight.mono_policy_clients',
    direction: 'up_bad',
    pick: (s) => s.kpi_summary.mono_policy_clients, fmt: formatInt },
];

// Per-row "good direction" map. 'up_good' = bigger is better (color rising
// deltas green). 'up_bad' = smaller is better (color rising deltas red).
// 'neutral' = depends on broker strategy; show grey.
//
// Rationale row by row:
// - active_clients, policies, premium, commission: bigger book = better.
// - %P/%E/%auto: depends on positioning; left neutral.
// - 60+ shares: ageing book is a succession risk → up_bad.
// - data quality (%known): more known fields = better operational hygiene.
// - mono-police count and share: shrinking = cross-sell working → up_bad.
// - %5+ polices: fidélisation indicator → up_good.
// - %bi-police: ambiguous — better than mono, worse than 5+, so neutral.
// - %Vie / %Incendie+package: cross-sell handles, more is better.
// - sinistres: more claims = more leakage → up_bad.
const DIRECTION_GOODNESS = {
  total_with_police: 'up_good',
  pct_particuliers: 'neutral',
  pct_entreprises: 'neutral',
  pct_p_60plus: 'up_bad',
  pct_policies_60plus: 'up_bad',
  pct_sex_known: 'up_good',
  pct_age_known: 'up_good',
  pct_social_known: 'up_good',
  pct_civil_known: 'up_good',
  pct_phone_known: 'up_good',
  pct_email_known: 'up_good',
  mono_count: 'up_bad',
  pct_mono: 'up_bad',
  pct_bi: 'neutral',
  pct_5plus: 'up_good',
  total_policies: 'up_good',
  polices_p: 'up_good',
  polices_e: 'up_good',
  pct_polices_p: 'neutral',
  pct_polices_e: 'neutral',
  avg_policies_per_client: 'up_good',
  avg_polices_p: 'up_good',
  avg_polices_e: 'up_good',
  pct_vie: 'up_good',
  pct_auto: 'neutral',
  pct_incendie_pkg: 'up_good',
  total_prime: 'up_good',
  prime_per_client: 'up_good',
  prime_per_policy: 'up_good',
  total_commission: 'up_good',
  commission_per_client: 'up_good',
  commission_per_policy: 'up_good',
  nb_sinistres: 'up_bad',
  freq_sinistres: 'up_bad',
};

// Rows whose rawValue is already a percentage. For these, deltas are shown
// in percentage points ("+1.2 pp") rather than as relative %.
const PERCENT_ROWS = new Set([
  'pct_particuliers', 'pct_entreprises', 'pct_p_60plus', 'pct_policies_60plus',
  'pct_sex_known', 'pct_age_known', 'pct_social_known', 'pct_civil_known',
  'pct_phone_known', 'pct_email_known', 'pct_mono', 'pct_bi', 'pct_5plus',
  'pct_vie', 'pct_auto', 'pct_incendie_pkg', 'freq_sinistres',
  'pct_polices_p', 'pct_polices_e',
]);

export function renderEvolution(root, ctx) {
  const snapshots = ctx.db.listSnapshots();

  if (snapshots.length === 0) {
    // Zero snapshots: send the user to the upload screen with a clear CTA
     // instead of dead-ending them on a "no data" message.
    mount(root, h('div', { class: 'page' }, [
      h('h1', { class: 'page-title' }, t('evolution.title')),
      h('div', { class: 'empty' }, [
        h('div', { class: 'empty-icon' },
          iconTile('chart.bar', '--muted', { size: 56, iconSize: 28 })),
        h('div', { class: 'empty-title' }, t('evolution.empty')),
        h('div', { class: 'empty-desc' }, t('evolution.empty_desc')),
        h('button', {
          class: 'btn primary',
          type: 'button',
          onClick: () => ctx.navigate('/upload'),
        }, [
          icon('plus', { size: 16, color: '#fff' }),
          h('span', {}, t('home.empty.cta')),
        ]),
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
    // Per-chart CTA: same "Action corrective ?" button as the ratios table
    // rows. Reads as a clear job-to-be-done ("show me what to do about this
    // curve") instead of a generic (i) icon. Opens the same structured
    // popover (summary + up/down bullets + corrective action callout).
    const insight = t(metric.insightKey);
    const ctaLabel = t('evolution.ratio_insight.cta_label');
    const infoBtn = h('button', {
      class: 'ratio-action-cta',
      type: 'button',
      'aria-label': ctaLabel,
      title: stripInfoMarkers(insight),
      onclick: (e) => {
        e.stopPropagation();
        togglePopover(e.currentTarget);
      },
    }, ctaLabel);
    const infoPop = h('div',
      { class: 'card-info-popover card-info-popover-rich', role: 'tooltip' },
      renderInfoText(insight, { actionLabel: t('evolution.ratio_insight.action_label') }));
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
          direction: metric.direction || 'up_good',
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

  // Build the multi-snapshot ratios table. buildRatiosSummary expects the
  // current snapshot first (it tags column 0 with isCurrent for highlighting),
  // so we feed it newest→oldest. We then render columns in chronological order
  // (oldest left, newest right) to match the line charts above.
  const seriesNewestFirst = [...chronological].reverse();
  const ratiosCard = buildRatiosCard(seriesNewestFirst, ctx);

  mount(root, h('div', { class: 'page dash' }, [
    h('div', { class: 'dash-hero' }, [
      h('div', { class: 'dash-hero-main' }, [
        h('div', { class: 'dash-hero-eyebrow' },
          `${t('evolution.title')} · ${chronological.length} ${t('evolution.snapshots')}`),
        h('h1', { class: 'dash-hero-title' }, range),
      ]),
    ]),
    chronological.length < 2
      ? h('div', { class: 'evo-need-more' }, [
          h('p', { class: 'form-hint' }, t('evolution.need_more')),
          h('button', {
            class: 'btn primary',
            type: 'button',
            onClick: () => ctx.navigate('/upload'),
          }, [
            icon('plus', { size: 16, color: '#fff' }),
            h('span', {}, t('nav.new_snapshot')),
          ]),
        ])
      : null,
    h('div', { class: 'dash-grid dash-grid-evolution' }, METRICS.map(chartCard)),
    ratiosCard,
  ]));
}

// --- Ratios table with delta indicators -------------------------------------

function buildRatiosCard(seriesNewestFirst, ctx) {
  const { rows, columns } = buildRatiosSummary(seriesNewestFirst, { locale: ctx.locale });

  // Display order: oldest left → newest right. columns from buildRatiosSummary
  // are newest first (because we passed series newest first), so we reverse
  // for display while keeping the original index handy to look up row.values.
  const displayCols = columns.map((c, i) => ({ col: c, originalIdx: i })).reverse();

  const insightFor = (row) => {
    const k = `evolution.ratio_insight.${row.key}`;
    const txt = t(k);
    // Fall back to nothing if the key wasn't translated; avoids printing the
    // raw key as a tooltip.
    return txt && txt !== k ? txt : '';
  };

  // Per-row CTA: a small blue text button "Action corrective ?" that opens
  // the same coaching popover as before. Replaced the (i) icon because the
  // text reads more clearly to brokers — "click for the corrective action"
  // is the actual job-to-be-done.
  const renderInfoBtn = (text) => {
    if (!text) return null;
    const ctaLabel = t('evolution.ratio_insight.cta_label');
    const btn = h('button', {
      class: 'ratio-action-cta',
      type: 'button',
      'aria-label': ctaLabel,
      title: stripInfoMarkers(text),
      onclick: (e) => {
        e.stopPropagation();
        togglePopover(e.currentTarget);
      },
    }, ctaLabel);
    const pop = h('div',
      { class: 'card-info-popover card-info-popover-rich', role: 'tooltip' },
      renderInfoText(text, { actionLabel: t('evolution.ratio_insight.action_label') }));
    return h('span', { class: 'card-head-info ratio-row-info' }, [btn, pop]);
  };

  const headerRow = h('tr', {}, [
    h('th', {}, t('report.ratio.column')),
    ...displayCols.map(({ col }) =>
      h('th', {
        // is-current-col is the rightmost (most recent) snapshot column.
        // The orange tint is applied via CSS class so blue row-hover sync
        // (also a class) can override it by source order — without that,
        // an inline style would always win over hover.
        class: col.isCurrent ? 'a-right is-current-col' : 'a-right',
      }, col.label)),
  ]);

  // Total column count for section header colspan (label col + every snapshot col).
  const totalCols = 1 + displayCols.length;

  const bodyRows = [];
  let lastSection = null;
  for (const row of rows) {
    // Inject a section header row whenever the section changes. Header spans
    // the full width and reads as a small uppercase label so the long table
    // breaks into thematic groups (overview → demographics → ... → claims).
    if (row.section && row.section !== lastSection) {
      bodyRows.push(h('tr', { class: 'ratio-section-head-row' },
        h('td', { class: 'ratio-section-head', colspan: String(totalCols) },
          ratioSectionTitle(row.section))));
      lastSection = row.section;
    }

    const labelInfo = insightFor(row);
    // Note: we deliberately don't show row.year here. The Evolution table
    // already has dated columns (one per snapshot), so suffixing "· 2018" on
    // the sinistres row was redundant and confusing — each cell already lives
    // under its own year header. Dashboard + print report still show the year
    // because they only display a single snapshot's column.
    const labelCell = h('td', {}, h('div', { class: 'ratio-row-label' }, [
      h('span', { class: 'ratio-row-text' }, row.label),
      renderInfoBtn(labelInfo),
    ]));

    const direction = DIRECTION_GOODNESS[row.key] || 'neutral';
    const isPercentRow = PERCENT_ROWS.has(row.key);

    const valueCells = displayCols.map(({ col, originalIdx }, displayIdx) => {
      const v = row.values[originalIdx] || { value: '—' };
      // Previous snapshot in chronological display order = the column to the
      // left, which is one slot earlier in displayCols.
      const prev = displayIdx > 0
        ? row.values[displayCols[displayIdx - 1].originalIdx]
        : null;

      const delta = computeDelta(v, prev, direction, isPercentRow, ctx.locale);
      const vAny = /** @type {{value: any, pct?: any}} */ (v);
      const valueNode = (vAny.pct != null)
        ? h('span', { class: 'rp-val-pct' }, [
            h('span', { class: 'rp-val' }, vAny.value),
            h('span', { class: 'rp-pct' }, vAny.pct),
          ])
        : vAny.value;

      return h('td', {
        class: col.isCurrent ? 'a-right is-current-col' : 'a-right',
      }, h('div', { class: 'ratio-cell' }, [
        h('div', { class: 'ratio-cell-value' }, valueNode),
        delta ? deltaBadge(delta) : null,
      ]));
    });

    bodyRows.push(h('tr', { 'data-sync-key': `ratio:${row.key}` }, [labelCell, ...valueCells]));
  }

  const title = t('report.s6_title');
  const desc = t('evolution.ratios_intro');
  const head = (() => {
    const btn = h('button', {
      class: 'card-info-btn',
      type: 'button',
      'aria-label': t('common.show_info') || 'Info',
      title: stripInfoMarkers(desc),
      onclick: (e) => {
        e.stopPropagation();
        togglePopover(e.currentTarget);
      },
    }, icon('info.circle', { size: 16 }));
    const pop = h('div',
      { class: 'card-info-popover card-info-popover-rich', role: 'tooltip' },
      renderInfoText(desc, { actionLabel: t('evolution.ratio_insight.action_label') }));
    return h('div', { class: 'card-head' }, [
      h('h3', { class: 'card-h3' }, title),
      h('div', { class: 'card-head-info' }, [btn, pop]),
    ]);
  })();

  // Object-form `style` (CSP `style-src 'self'` blocks the string form).
  return h('div', { class: 'dash-card', style: { marginTop: '24px' } }, [
    head,
    h('div', { class: 'table-wrap' }, h('table', { class: 'dash-table evo-ratios-table' }, [
      h('thead', {}, headerRow),
      h('tbody', {}, bodyRows),
    ])),
    h('p', { class: 'form-hint', style: { marginTop: '10px' } },
      t('evolution.ratios_legend')),
  ]);
}

// Compute delta info between current and previous column for a ratio row.
// Returns { dir: 'up'|'down'|'flat', goodness: 'good'|'bad'|'neutral', label }
// or null if no comparison is possible.
function computeDelta(curr, prev, direction, isPercentRow, locale) {
  if (!prev) return null;
  if (curr.rawValue == null || prev.rawValue == null) return null;
  const d = curr.rawValue - prev.rawValue;
  // Treat tiny floating-point noise as flat.
  const epsilon = isPercentRow ? 0.005 : 0.5;
  if (Math.abs(d) < epsilon) {
    return { dir: 'flat', goodness: 'neutral', label: '±0' };
  }

  let goodness;
  if (direction === 'neutral') goodness = 'neutral';
  else if (direction === 'up_good') goodness = d > 0 ? 'good' : 'bad';
  else goodness = d > 0 ? 'bad' : 'good'; // up_bad

  let label;
  if (isPercentRow) {
    // Percentage-point delta. Format with 1 decimal, locale-aware separator.
    const ppText = formatSignedDecimal(d, 1, locale);
    label = `${ppText} pp`;
  } else if (prev.rawValue !== 0) {
    const pct = d / Math.abs(prev.rawValue) * 100;
    label = `${formatSignedDecimal(pct, 1, locale)}%`;
  } else {
    // Previous was zero, current is non-zero: relative pct undefined; show abs.
    label = formatSignedInt(d, locale);
  }

  return { dir: d > 0 ? 'up' : 'down', goodness, label };
}

function formatSignedDecimal(n, decimals, locale) {
  const sign = n > 0 ? '+' : '';
  const formatted = n.toLocaleString(locale || undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return sign + formatted;
}

function formatSignedInt(n, locale) {
  const sign = n > 0 ? '+' : '';
  const formatted = Math.round(n).toLocaleString(locale || undefined);
  return sign + formatted;
}

function deltaBadge(delta) {
  const arrow = delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '·';
  return h('span', {
    class: `ratio-delta ratio-delta-${delta.goodness} ratio-delta-${delta.dir}`,
  }, [
    h('span', { class: 'ratio-delta-arrow' }, arrow),
    h('span', { class: 'ratio-delta-label' }, delta.label),
  ]);
}
