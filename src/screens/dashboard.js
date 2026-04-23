// Dashboard screen: full portfolio analysis for a single snapshot.
// Fetches rows from sql.js, runs computeAllStats, renders KPI hero + sections.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { formatInt, formatCurrency, formatPercent, formatDate } from '../ui/format.js';
import { computeAllStats } from '../core/analyzer.js';

function kpiTile(label, value, sub) {
  return h('div', { class: 'kpi-tile' }, [
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: 'kpi-value' }, value),
    sub ? h('div', { class: 'kpi-sub' }, sub) : null,
  ]);
}

function sectionHead(title, rightEl) {
  return h('div', { class: 'section-head' }, [
    h('span', {}, title),
    rightEl || null,
  ]);
}

function simpleRow(title, value) {
  return h('div', { class: 'row' }, [
    h('div', { class: 'row-main' }, [
      h('div', { class: 'row-title' }, title),
    ]),
    h('div', { class: 'row-value' }, value),
  ]);
}

function barRow(label, count, pct, total) {
  const width = total > 0 ? Math.max(2, (count / total) * 100) : 0;
  return h('div', { class: 'row bar-row' }, [
    h('div', { class: 'row-main' }, [
      h('div', { class: 'row-title' }, label),
      h('div', { class: 'bar-track' }, h('div', {
        class: 'bar-fill',
        style: { width: `${width}%` },
      })),
    ]),
    h('div', { class: 'row-value' }, `${formatInt(count)} · ${formatPercent(pct / 100, 1)}`),
  ]);
}

export function renderDashboard(root, ctx, args) {
  const { snapshotId } = args;
  const snapshot = ctx.db.getSnapshot(snapshotId);
  if (!snapshot) {
    toast('Snapshot introuvable', 'danger');
    ctx.navigate('/');
    return;
  }

  let stats;
  try {
    const clients = ctx.db.fetchRows('clients', snapshotId);
    const polices = ctx.db.fetchRows('polices', snapshotId);
    const compagnies = ctx.db.fetchRows('compagnies_polices', snapshotId);
    const sinistres = ctx.db.fetchRows('sinistres', snapshotId);
    const snapshotYear = Number((snapshot.snapshot_date || '').slice(0, 4)) || new Date().getFullYear();
    stats = computeAllStats(clients, polices, compagnies, sinistres, snapshotYear, ctx.branchIndex);
  } catch (e) {
    console.error(e);
    toast(t('error.generic') + ' ' + e.message, 'danger');
    return;
  }

  const kpi = stats.kpi_summary;
  const overview = stats.overview;

  function handleDelete() {
    if (!confirm(`Supprimer le snapshot "${snapshot.label}" ?`)) return;
    try {
      ctx.db.deleteSnapshot(snapshotId);
      ctx.persistDb();
      toast('Snapshot supprimé', 'success');
      ctx.navigate('/');
    } catch (e) {
      toast(t('error.generic') + ' ' + e.message, 'danger');
    }
  }

  // ---- KPI hero ----
  const heroKpis = h('div', { class: 'kpi-grid' }, [
    kpiTile(t('kpi.total_clients'), formatInt(kpi.total_clients),
      `${formatInt(kpi.active_clients)} ${t('kpi.active_clients').toLowerCase()}`),
    kpiTile(t('kpi.total_polices'), formatInt(kpi.total_polices),
      `${kpi.avg_polices_per_client} ${t('kpi.avg_polices').toLowerCase()}`),
    kpiTile(t('kpi.total_premium'), formatCurrency(kpi.total_premium),
      formatCurrency(kpi.avg_premium_per_client) + ' / client'),
    kpiTile(t('kpi.sinistres'), formatInt(kpi.total_sinistres),
      `${formatInt(kpi.clients_with_sinistres)} clients`),
  ]);

  // ---- Overview ----
  const overviewGroup = h('div', { class: 'group' }, [
    simpleRow('Particuliers',
      `${formatInt(overview.particuliers)} · ${formatPercent(overview.pct_particuliers / 100, 1)}`),
    simpleRow('Entreprises',
      `${formatInt(overview.entreprises)} · ${formatPercent(overview.pct_entreprises / 100, 1)}`),
    simpleRow('Sans police', formatInt(overview.clients_sans_police)),
    simpleRow('Mono-police', formatInt(kpi.mono_policy_clients)),
  ]);

  // ---- Branches ----
  const branchesTop = (stats.branches.branches || []).slice(0, 8);
  const branchesGroup = h('div', { class: 'group' },
    branchesTop.length === 0
      ? [h('div', { class: 'row' }, h('div', { class: 'row-main' }, 'Aucune donnée'))]
      : branchesTop.map((b) => barRow(b.code, b.count, b.pct, stats.branches.total))
  );

  // ---- Companies ----
  const companiesTop = (stats.companies.companies || []).slice(0, 8);
  const companiesGroup = h('div', { class: 'group' },
    companiesTop.length === 0
      ? [h('div', { class: 'row' }, h('div', { class: 'row-main' }, 'Aucune donnée'))]
      : companiesTop.map((c) => barRow(c.name, c.count, c.pct, stats.companies.total))
  );

  // ---- Geographic ----
  const geoRows = (stats.geographic.rows || []).slice(0, 5);
  const geographicGroup = h('div', { class: 'group' }, [
    ...geoRows.map((g) => h('div', { class: 'row' }, [
      h('div', { class: 'row-main' }, [
        h('div', { class: 'row-title' }, `${g.code_postal} ${g.localite || ''}`.trim()),
        h('div', { class: 'row-sub' }, `Cumul ${formatPercent(g.cumul_pct / 100, 1)}`),
      ]),
      h('div', { class: 'row-value' },
        `${formatInt(g.count)} · ${formatPercent(g.pct / 100, 1)}`),
    ])),
    geoRows.length > 0 ? h('div', { class: 'row' }, [
      h('div', { class: 'row-main' }, [
        h('div', { class: 'row-title' }, 'Zone principale'),
        h('div', { class: 'row-sub' },
          `${formatInt(stats.geographic.zone_count)} clients · ${formatInt(stats.geographic.hors_zone_count)} hors zone`),
      ]),
      h('div', { class: 'row-value' }, formatPercent(stats.geographic.zone_pct / 100, 1)),
    ]) : null,
  ]);

  // ---- Demographics (age brackets) ----
  const demoTotal = stats.demographics.total || 0;
  const ageGroup = h('div', { class: 'group' },
    (stats.demographics.age_brackets || []).map((b) =>
      barRow(b.label, b.client_count, b.pct, demoTotal))
  );
  const genderEntries = Object.entries(stats.demographics.gender || {});
  const genderGroup = genderEntries.length > 0 ? h('div', { class: 'group' },
    genderEntries.map(([k, v]) => simpleRow(k,
      `${formatInt(v.count)} · ${formatPercent(v.pct / 100, 1)}`))) : null;

  // ---- Data quality ----
  const dqGroup = h('div', { class: 'group' },
    (stats.data_quality.fields || []).map((f) => h('div', {
      class: 'row' + (f.critical ? ' critical' : ''),
    }, [
      h('div', { class: 'row-main' }, [
        h('div', { class: 'row-title' }, f.label),
        h('div', { class: 'row-sub' },
          `${formatInt(f.known)} renseignés · ${formatInt(f.missing)} manquants`),
      ]),
      h('div', { class: 'row-value' }, formatPercent(f.pct_missing / 100, 1)),
    ]))
  );

  // ---- Opportunities ----
  const opps = stats.opportunities;
  const oppsGroup = h('div', { class: 'group' }, [
    simpleRow('Cross-sell (mono-police)', formatInt(opps.cross_sell.length)),
    simpleRow('Succession (60+ sans Vie/Placement)', formatInt(opps.succession.length)),
    simpleRow('Jeunes familles (IARD sans Vie)', formatInt(opps.young_families.length)),
    simpleRow('Clients à forte valeur', formatInt(opps.high_value.length)),
    simpleRow('Qualité à nettoyer', formatInt(opps.data_quality_cleanup.length)),
  ]);

  // ---- Assembly ----
  mount(root, h('div', { class: 'wrap' }, [
    h('div', { class: 'nav' }, [
      h('button', { class: 'back', onClick: () => ctx.navigate('/') }, '‹ ' + t('nav.back')),
      h('div', { class: 'title' }, snapshot.label),
      h('div', { class: 'actions' }, [
        h('button', {
          class: 'action-btn danger',
          onClick: handleDelete,
          'aria-label': t('common.delete'),
        }, '🗑'),
      ]),
    ]),

    h('div', { class: 'hero' }, [
      h('div', { class: 'hero-subtitle' },
        `${t('app.subtitle')} · ${formatDate(snapshot.snapshot_date)}`),
      heroKpis,
    ]),

    sectionHead(t('dashboard.overview')),
    overviewGroup,

    sectionHead(t('dashboard.branches')),
    branchesGroup,

    sectionHead(t('dashboard.companies')),
    companiesGroup,

    sectionHead(t('dashboard.geographic')),
    geographicGroup,

    sectionHead(t('dashboard.demographics')),
    ageGroup,
    genderGroup,

    sectionHead(t('dashboard.data_quality')),
    dqGroup,

    sectionHead(t('dashboard.opportunities')),
    oppsGroup,
  ]));
}
