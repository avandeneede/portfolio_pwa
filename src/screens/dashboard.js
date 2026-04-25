// Dashboard screen: corporate-clean analytics dashboard for a single snapshot.
// Reads computed stats from analyzer, renders KPI hero + 5 colored sections,
// SVG charts, and export actions (PDF report + CLIENT TOTAL xlsx).

import { h, mount, togglePopover } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { formatInt, formatCurrency, formatPercent, formatDate, formatMonthYear, branchLabel } from '../ui/format.js';
import { computeAllStats, computeClientTotal } from '../core/analyzer.js';
import { buildRatiosSummary, ratioSectionTitle } from '../core/ratios_summary.js';
import { icon, iconTile } from '../ui/icon.js';
import { pieChart, hBarChart, vBarChart } from '../ui/charts.js';
import { renderReport, printReport } from './report.js';
import { exportClientTotalXlsx, downloadBlob, buildClientTotalFilename } from '../store/xlsx_export.js';
import { reparseSnapshot } from '../core/reparse.js';
import { oppTile, OPP_RENDERERS, showOppDetail } from './dashboard_opp.js';

// -----------------------------------------------------------------------------
// UI primitives
// -----------------------------------------------------------------------------

function kpi(label, value, sub, tint, info) {
  // The optional `info` string adds a small popover beside the label so we can
  // disclose definitions that don't fit on the tile (e.g. which premium types
  // are excluded from the total). Reuses the .card-info-* primitives.
  const labelEl = info
    ? h('div', { class: 'kpi-label-row' }, [
        h('div', { class: 'kpi-label' }, label),
        infoPopover(info),
      ])
    : h('div', { class: 'kpi-label' }, label);
  return h('div', { class: 'kpi', style: tint ? { borderTopColor: `var(${tint})` } : null }, [
    labelEl,
    h('div', { class: 'kpi-value' }, value),
    sub ? h('div', { class: 'kpi-sub' }, sub) : null,
  ]);
}

function infoPopover(text) {
  const btn = h('button', {
    class: 'card-info-btn',
    type: 'button',
    'aria-label': t('common.show_info') || 'Info',
    title: text,
    onclick: (e) => {
      e.stopPropagation();
      togglePopover(e.currentTarget);
    },
  }, icon('info.circle', { size: 14 }));
  const pop = h('div', { class: 'card-info-popover', role: 'tooltip' }, text);
  return h('div', { class: 'card-head-info' }, [btn, pop]);
}

function section(opts, body) {
  const { number, title, subtitle, tint, iconName, description } = opts;
  // Title reads "5. Opportunités" inline: the number is a subdued lead-in to
  // the title text rather than a separate chip between icon and title (which
  // looked disconnected). Colored left-rule on the header gives the section
  // its identity without fighting the tile for attention.
  return h('section', { class: 'dash-section' }, [
    h('div', { class: 'dash-section-head', style: { '--tint': `var(${tint})` } }, [
      iconTile(iconName, tint, { size: 36, iconSize: 20 }),
      h('div', { class: 'dash-section-titles' }, [
        h('h2', { class: 'dash-section-title' }, [
          number ? h('span', { class: 'dash-section-num' }, `${number}.`) : null,
          h('span', {}, ` ${title}`),
        ]),
        subtitle ? h('div', { class: 'dash-section-sub' }, subtitle) : null,
      ]),
    ]),
    description ? h('p', { class: 'dash-section-desc' }, description) : null,
    h('div', { class: 'dash-section-body' }, body),
  ]);
}

function card(children, opts = {}) {
  const cls = 'dash-card' + (opts.class ? ' ' + opts.class : '');
  return h('div', { class: cls }, children);
}

// Builds a row-leading label with a small colored glyph. Used in category
// tables (sex/civil/social/data-quality) so rows read at a glance.
function rowIcon(iconName, tint, label) {
  return h('span', { class: 'cell-with-icon' }, [
    h('span', { class: 'cell-icon-dot', style: { '--tint': `var(${tint})` } },
      icon(iconName, { size: 14, color: tint })),
    h('span', {}, label),
  ]);
}

const DQ_ICONS = {
  sexe: 'person.crop.circle',
  date_naissance: 'calendar',
  statut_social: 'briefcase',
  etat_civil: 'heart',
  telephone: 'phone',
  email: 'envelope',
};
function dqFieldIcon(key) { return DQ_ICONS[key] || 'tag'; }

// Normalise a civil/social label for matching: lowercase, strip accents and
// parenthetical qualifiers like "(e)" / "(ve)".
function normLabel(s) {
  return String(s ?? '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
}

// Civil status → (icon, tint). Matches on substrings so "Marié(e)" and
// "Mariée" both hit the 'marie' rule.
function civilIconTint(label) {
  const n = normLabel(label);
  if (!n || n === 'inconnu' || n === 'none') return ['questionmark.circle', '--muted'];
  if (n.includes('celibataire')) return ['person.crop.circle', '--accent'];
  if (n.includes('marie')) return ['heart', '--pink'];
  if (n.includes('divorc')) return ['heart', '--muted'];
  if (n.includes('veu')) return ['heart', '--purple'];
  if (n.includes('separ')) return ['heart', '--warning'];
  if (n.includes('cohab')) return ['person.2', '--teal'];
  return ['heart', '--pink'];
}

// Social status → (icon, tint). Same substring strategy as civil.
function socialIconTint(label) {
  const n = normLabel(label);
  if (!n || n === 'inconnu' || n === 'none') return ['questionmark.circle', '--muted'];
  if (n.includes('independ') || n.includes('indep')) return ['wand.and.stars', '--purple'];
  if (n.includes('salari') || n.includes('employe')) return ['briefcase', '--teal'];
  if (n.includes('ouvrier')) return ['briefcase', '--warning'];
  if (n.includes('fonction')) return ['building.2', '--indigo'];
  if (n.includes('retrait') || n.includes('pension')) return ['clock', '--warning'];
  if (n.includes('etudiant') || n.includes('eleve')) return ['doc.text', '--accent'];
  if (n.includes('chomeur') || n.includes('sans')) return ['questionmark.circle', '--muted'];
  return ['briefcase', '--teal'];
}

function simpleTable(columns, rows) {
  // Wrap the <table> in a .table-wrap so horizontal overflow scrolls the
  // table itself (not the whole card). Keeps card headers/titles anchored
  // on narrow viewports where the table is wider than the card.
  return h('div', { class: 'table-wrap' }, h('table', { class: 'dash-table' }, [
    h('thead', {}, h('tr', {}, columns.map((c) =>
      h('th', {
        class: c.align ? `a-${c.align}` : null,
        style: c.style || null,
      }, c.label)))),
    h('tbody', {}, rows.map((r) => {
      // Section header rows span all columns and read as a small
      // capitalised label. Rendered as a single <td colspan=N>.
      if (r && r.sectionHeader) {
        return h('tr', { class: 'ratio-section-head-row' },
          h('td', { class: 'ratio-section-head', colspan: String(columns.length) }, r.label));
      }
      const cls = [];
      if (r.emphasize) cls.push('emphasize');
      else if (r.total) cls.push('row-total');
      else if (r.subtle) cls.push('row-subtle');
      return h('tr', {
        class: cls.length ? cls.join(' ') : null,
        style: r.style || null,
        'data-sync-key': r.key || null,
      },
      (r.cells || r).map((c, i) => {
        const col = columns[i];
        const align = (c && c.align) || (col && col.align);
        const val = c && typeof c === 'object' && 'text' in c ? c.text : c;
        const style = c && typeof c === 'object' && c.style ? c.style : null;
        return h('td', {
          class: align ? `a-${align}` : null,
          style,
        }, val);
      }));
    })),
  ]));
}

// Card head: title + info-icon popover (click/hover). The info text now lives
// in a popover so it doesn't eat vertical space in the card body.
function cardHead(title, infoText) {
  const btn = h('button', {
    class: 'card-info-btn',
    type: 'button',
    'aria-label': t('common.show_info') || 'Info',
    title: infoText || '',
    onclick: (e) => {
      e.stopPropagation();
      togglePopover(e.currentTarget);
    },
  }, icon('info.circle', { size: 16 }));
  const pop = h('div', { class: 'card-info-popover', role: 'tooltip' }, infoText || '');
  return h('div', { class: 'card-head' }, [
    h('h3', { class: 'card-h3' }, title),
    infoText ? h('div', { class: 'card-head-info' }, [btn, pop]) : null,
  ]);
}

// After a card is mounted, wire hover sync between chart elements and table
// rows that share the same data-sync-key. Call from a requestAnimationFrame
// or after mount; silently no-ops when the card has no keyed elements.
function wireCardSync(cardEl) {
  if (!cardEl) return;
  const els = cardEl.querySelectorAll('[data-sync-key]');
  if (els.length === 0) return;
  const byKey = new Map();
  els.forEach((el) => {
    const k = el.getAttribute('data-sync-key');
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(el);
  });
  const setHover = (key, on) => {
    const group = byKey.get(key);
    if (!group) return;
    for (const el of group) el.classList.toggle('is-hover', on);
  };
  els.forEach((el) => {
    const k = el.getAttribute('data-sync-key');
    if (!k) return;
    el.addEventListener('pointerenter', () => setHover(k, true));
    el.addEventListener('pointerleave', () => setHover(k, false));
  });
}

// Horizontal stacked progress bar: two coloured segments, auto-labelled when
// each segment is wide enough to fit its own percentage.
function dashProgressBar(inPct, outPct, inLabel, outLabel) {
  // Object-form `style` is required: index.html ships `style-src 'self'` (no
  // 'unsafe-inline'), so a string `style="..."` attribute would be silently
  // dropped by the browser. The previous string-form left both segments
  // unbacked → white text on white track → invisible labels and zero width.
  return h('div', { class: 'dash-progress' }, [
    h('div', { class: 'dash-progress-track' }, [
      h('div', {
        class: 'dash-progress-fill',
        style: { width: `${inPct}%`, background: 'var(--indigo)' },
      }, inPct >= 12 ? formatPercent(inPct, 1) : ''),
      h('div', {
        class: 'dash-progress-fill',
        style: { width: `${outPct}%`, background: 'var(--pink)' },
      }, outPct >= 12 ? formatPercent(outPct, 1) : ''),
    ]),
    h('div', { class: 'dash-progress-legend' }, [
      h('span', { class: 'dash-progress-legend-item' }, [
        h('span', { class: 'legend-dot', style: { background: 'var(--indigo)' } }),
        h('span', {}, inLabel),
      ]),
      h('span', { class: 'dash-progress-legend-item' }, [
        h('span', { class: 'legend-dot', style: { background: 'var(--pink)' } }),
        h('span', {}, outLabel),
      ]),
    ]),
  ]);
}

// Big-number summary card with a tinted header (like the print report boxes).
function summaryBox(title, value, sub, tint, info) {
  // Same CSP gotcha as dashProgressBar — object-form `style` so the tinted
  // header actually paints. With the string form the browser drops the
  // `style="background:var(--warning)"` attribute and we end up with the
  // default white background under white text.
  const headStyle = { background: `var(${tint})` };
  const head = info
    ? h('div', { class: 'summary-box-head summary-box-head-row', style: headStyle }, [
        h('span', { class: 'summary-box-head-title' }, title),
        infoPopover(info),
      ])
    : h('div', { class: 'summary-box-head', style: headStyle }, title);
  return h('div', { class: 'summary-box' }, [
    head,
    h('div', { class: 'summary-box-value' }, value),
    sub ? h('div', { class: 'summary-box-sub' }, sub) : null,
  ]);
}

// Tri-state colour for a data-quality field. Phone & email are stricter
// (they directly gate outreach campaigns), so anything ≥5% missing is no
// longer green; everything else gets a 10% green band.
//   - <green threshold        → --success
//   - non-contact >50%         → --danger
//   - everything in between    → --warning
// Note: contact fields no longer get a "critical" badge — the tinted bar
// already communicates urgency, the badge was visual noise.
function dqColorVar(field) {
  const isContact = field.key === 'email' || field.key === 'telephone';
  const greenCap = isContact ? 5 : 10;
  if ((field.pct_missing || 0) < greenCap) return '--success';
  if (!isContact && (field.pct_missing || 0) > 50) return '--danger';
  return '--warning';
}

// IARD = every branch except these three "non-IARD" codes. The pie on the
// insurance section aggregates them as Total IARD / Vie / Placement / Crédit.
const NON_IARD = new Set(['VIE', 'PLA', 'CRED']);

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

export async function renderDashboard(root, ctx, args) {
  const { snapshotId } = args;

  // Loading placeholder first. Two reasons:
  //   1. Visual feedback the click registered, so the user doesn't double-tap.
  //   2. Buys a paint before the synchronous analyzer pipeline blocks the
  //      main thread for 50–500ms on larger portfolios. Without the rAF
  //      yield below, the browser would never paint this placeholder.
  mount(root, h('div', { class: 'page dash' }, [
    h('div', { class: 'dash-loading', role: 'status', 'aria-live': 'polite' }, [
      h('div', { class: 'spinner' }),
      h('div', { class: 'dash-loading-label' }, t('common.loading') || 'Chargement…'),
    ]),
  ]));

  // Yield two rAFs so the browser commits the placeholder paint before we
  // start the synchronous compute. One rAF schedules the render; two
  // guarantees we're past the layout/paint cycle.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));

  const snapshot = ctx.db.getSnapshot(snapshotId);
  if (!snapshot) {
    mount(root, h('div', { class: 'page dash' }, [
      h('div', { class: 'empty' }, [
        h('div', { class: 'empty-icon' },
          iconTile('exclamationmark.triangle', '--warning', { size: 56, iconSize: 28 })),
        h('div', { class: 'empty-title' }, t('dashboard.not_found')),
        h('button', { class: 'btn primary', onClick: () => ctx.navigate('/') },
          t('nav.back')),
      ]),
    ]));
    toast(t('dashboard.not_found'), 'warning');
    return;
  }

  let stats;
  try {
    const clients = ctx.db.fetchRows('clients', snapshotId);
    const polices = ctx.db.fetchRows('polices', snapshotId);
    const compagnies = ctx.db.fetchRows('compagnies_polices', snapshotId);
    const sinistres = ctx.db.fetchRows('sinistres', snapshotId);
    const year = Number((snapshot.snapshot_date || '').slice(0, 4)) || new Date().getFullYear();
    stats = computeAllStats(clients, polices, compagnies, sinistres, year, ctx.branchIndex);
    // Stash for xlsx export; avoids recomputing on click.
    root.__dashData = { clients, polices, compagnies, sinistres, year };
  } catch (e) {
    console.error(e);
    mount(root, h('div', { class: 'page dash' }, [
      h('div', { class: 'empty' }, [
        h('div', { class: 'empty-icon' },
          iconTile('exclamationmark.triangle', '--danger', { size: 56, iconSize: 28 })),
        h('div', { class: 'empty-title' }, t('error.generic')),
        h('div', { class: 'empty-desc' }, e.message),
      ]),
    ]));
    toast(t('error.generic') + ' ' + e.message, 'danger');
    return;
  }

  const kpiS = stats.kpi_summary;
  const ov = stats.overview;

  // ---- Historical snapshots for the ratios comparison column --------------
  //
  // The 2022-onwards reference rapport adds two prior-year columns to the
  // ratios summary (page 10). We mirror that by picking the two most recent
  // snapshots dated strictly before the current one and computing their
  // ratio stats. Ordered current → oldest so the broker reads left to right
  // from "today" into history.
  const ratioSeries = [{ stats, snapshot }];
  try {
    const allSnaps = ctx.db.listSnapshots() || [];
    const priors = allSnaps
      .filter((s) => s.id !== snapshotId && (s.snapshot_date || '') < (snapshot.snapshot_date || ''))
      .sort((a, b) => (b.snapshot_date || '').localeCompare(a.snapshot_date || ''))
      .slice(0, 2);
    for (const p of priors) {
      try {
        const pc = ctx.db.fetchRows('clients', p.id);
        const pp = ctx.db.fetchRows('polices', p.id);
        const pcp = ctx.db.fetchRows('compagnies_polices', p.id);
        const ps = ctx.db.fetchRows('sinistres', p.id);
        const py = Number((p.snapshot_date || '').slice(0, 4)) || new Date().getFullYear();
        const pStats = computeAllStats(pc, pp, pcp, ps, py, ctx.branchIndex);
        ratioSeries.push({ stats: pStats, snapshot: p });
      } catch (err) {
        // One broken prior snapshot shouldn't hide the current dashboard —
        // silently drop it from the comparison and keep going.
        console.warn('[dashboard] skipping prior snapshot', p.id, err);
      }
    }
  } catch (err) {
    console.warn('[dashboard] could not load prior snapshots', err);
  }

  // ---- Export handlers -----------------------------------------------------

  async function handleExportXlsx() {
    try {
      const d = root.__dashData;
      const rows = computeClientTotal(d.clients, d.polices, d.compagnies, d.year, ctx.branchIndex);
      const blob = await exportClientTotalXlsx(ctx, rows, {
        locale: ctx.locale,
        year: d.year,
        branchCodes: ctx.branchIndex?.codes || [],
      });
      const filename = buildClientTotalFilename(snapshot.snapshot_date);
      downloadBlob(blob, filename);
      toast(t('dashboard.export_xlsx_done'), 'success');
    } catch (e) {
      console.error(e);
      toast(t('error.generic') + ' ' + e.message, {
        kind: 'danger',
        duration: 8000,
        action: { label: t('common.retry') || 'Retry', onClick: handleExportXlsx },
      });
    }
  }

  function handleExportPdf() {
    try {
      let host = document.getElementById('report-print');
      if (!host) {
        host = document.createElement('div');
        host.id = 'report-print';
        document.body.appendChild(host);
      }
      renderReport(host, ctx, snapshot, stats, { ratioSeries });
      printReport(snapshot);
    } catch (e) {
      console.error(e);
      toast(t('error.generic') + ' ' + e.message, 'danger');
    }
  }

  function handleDelete() {
    const msg = t('dashboard.delete_confirm').replace('{label}', snapshot.label);
    if (!confirm(msg)) return;
    try {
      ctx.db.deleteSnapshot(snapshotId);
      ctx.persistDb();
      toast(t('dashboard.deleted'), 'success');
      ctx.navigate('/');
    } catch (e) {
      toast(t('error.generic') + ' ' + e.message, 'danger');
    }
  }

  // Full re-parse from the stored XLSX bytes: useful when the parser, the
  // detect heuristics, or the schema changed and the persisted rows are stale.
  // Recompute (below) only re-runs analyzer.js on already-parsed rows.
  async function handleReparse() {
    if (!ctx.db.hasSnapshotFiles(snapshotId)) {
      toast(t('dashboard.reparse_no_files'), 'warning');
      return;
    }
    if (!confirm(t('dashboard.reparse_confirm'))) return;
    try {
      await reparseSnapshot(ctx, snapshotId);
      toast(t('dashboard.reparsed'), 'success');
      if (typeof ctx.render === 'function') {
        ctx.render(renderDashboard, { snapshotId });
      }
    } catch (e) {
      console.error(e);
      const msg = e.message === 'NO_SOURCE_FILES'
        ? t('dashboard.reparse_no_files')
        : t('error.generic') + ' ' + e.message;
      toast(msg, 'danger');
    }
  }

  function handleEditDate() {
    const current = snapshot.snapshot_date || '';
    const next = prompt(t('dashboard.date_prompt'), current);
    if (!next) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) {
      toast(t('error.generic'), 'danger');
      return;
    }
    try {
      // Rewrite both the date and its derived label so exports / legacy
      // consumers stay in sync with what the sidebar now displays.
      const newLabel = formatMonthYear(next);
      ctx.db.updateSnapshot(snapshotId, { snapshot_date: next, label: newLabel });
      ctx.persistDb();
      toast(t('dashboard.date_updated'), 'success');
      // Re-render screen + sidebar so the new date + label appear immediately.
      if (typeof ctx.render === 'function') ctx.render(renderDashboard, { snapshotId });
      // main.js wires a hashchange listener to refreshSidebar; nudge it.
      window.dispatchEvent(new Event('hashchange'));
    } catch (e) {
      toast(t('error.generic') + ' ' + e.message, 'danger');
    }
  }

  // ---- Hero ----------------------------------------------------------------

  // Localized title tracks the current UI locale — stored snapshot.label is a
  // legacy fallback for snapshots created before locale-aware derivation.
  const heroTitle = formatMonthYear(snapshot.snapshot_date) || snapshot.label;

  const hero = h('div', { class: 'dash-hero' }, [
    h('div', { class: 'dash-hero-main' }, [
      h('div', { class: 'dash-hero-eyebrow' },
        `${t('dashboard.title')} · ${formatDate(snapshot.snapshot_date)}`),
      h('h1', { class: 'dash-hero-title' }, heroTitle),
    ]),
    h('div', { class: 'dash-hero-actions' }, [
      h('button', {
        class: 'btn ghost',
        type: 'button',
        onClick: handleEditDate,
        title: t('dashboard.edit_date'),
      }, [
        icon('calendar', { size: 16 }),
        h('span', {}, t('dashboard.edit_date')),
      ]),
      // "Reparse" re-runs the parser on the original XLSX bytes (saved at
      // upload time) so snapshots stay in sync after parser/code changes.
      // Auto-runs on app update from main.js; this button is the manual
      // override. Hidden when no source files are available (legacy snapshots
      // imported before this feature shipped, or older .ptf backups).
      ctx.db.hasSnapshotFiles(snapshotId) ? h('button', {
        class: 'btn ghost',
        type: 'button',
        onClick: handleReparse,
        title: t('dashboard.reparse_hint'),
      }, [
        icon('arrow.clockwise', { size: 16 }),
        h('span', {}, t('dashboard.reparse')),
      ]) : null,
      h('button', {
        class: 'btn primary',
        type: 'button',
        onClick: handleExportPdf,
      }, [
        icon('doc.text', { size: 16, color: '#fff' }),
        h('span', {}, t('dashboard.export_pdf')),
      ]),
      h('button', {
        class: 'btn ghost',
        type: 'button',
        onClick: handleExportXlsx,
      }, [
        icon('doc.table', { size: 16 }),
        h('span', {}, t('dashboard.export_xlsx')),
      ]),
      h('button', {
        class: 'btn ghost danger',
        type: 'button',
        onClick: handleDelete,
        'aria-label': t('common.delete'),
      }, [
        icon('trash', { size: 16, color: '--danger' }),
        h('span', {}, t('common.delete')),
      ]),
    ]),
  ]);

  const hasCommission = (kpiS.total_commission || 0) > 0;
  const kpiGrid = h('div', { class: 'kpi-grid' }, [
    kpi(t('kpi.total_clients'), formatInt(kpiS.total_clients),
      `${formatInt(kpiS.active_clients)} ${t('kpi.active_clients')}`, '--accent'),
    kpi(t('kpi.total_polices'), formatInt(kpiS.total_polices),
      `${kpiS.avg_polices_per_client} ${t('kpi.avg_polices')}`, '--indigo'),
    kpi(t('kpi.total_premium'), formatCurrency(kpiS.total_premium),
      `${formatCurrency(kpiS.avg_premium_per_client)} / client`, '--teal',
      t('kpi.total_premium_info')),
    kpi(t('kpi.total_commission'),
      hasCommission ? formatCurrency(kpiS.total_commission) : t('common.not_available'),
      hasCommission ? `${formatCurrency(kpiS.avg_commission_per_client)} / client` : null,
      '--success'),
    kpi(t('kpi.sinistres'), formatInt(kpiS.total_sinistres),
      `${formatInt(kpiS.clients_with_sinistres)} ${t('kpi.clients_with_sinistres')}`, '--warning'),
  ]);

  // Ménages summary row — two orange-headed cards with the key household ratios.
  const pctMonoMenage = kpiS.total_menages
    ? formatPercent(kpiS.menages_mono_police / kpiS.total_menages * 100, 1)
    : '0%';
  const summaryGrid = h('div', { class: 'summary-grid' }, [
    summaryBox(
      t('report.ratio.total_menages'),
      formatInt(kpiS.total_menages || 0),
      `${formatInt(kpiS.active_clients)} ${t('kpi.active_clients')}`,
      '--warning',
      t('report.ratio.total_menages_info')),
    summaryBox(
      t('report.ratio.menages_mono'),
      formatInt(kpiS.menages_mono_police || 0),
      `${pctMonoMenage}`,
      '--warning'),
  ]);

  // ---- Section 1: Particuliers / Entreprises -------------------------------

  const segments = [
    { label: t('report.particuliers'), value: ov.active_particuliers, color: '--indigo', key: 'seg:part' },
    { label: t('report.entreprises'), value: ov.active_entreprises, color: '--pink', key: 'seg:ent' },
  ];
  const sec1 = section({
    number: 1, title: t('report.s1_title'),
    tint: '--indigo', iconName: 'person.2',
    description: t('dash.s1_desc'),
  }, [
    card([
      h('div', { class: 'card-split' }, [
        h('div', { class: 'card-split-tables' }, [
          simpleTable(
            [{ label: t('report.in_portfolio') },
             { label: t('report.count'), align: 'right' },
             { label: '%', align: 'right' }],
            [
              { key: 'seg:part', cells: [t('report.particuliers'), formatInt(ov.active_particuliers), formatPercent(ov.pct_active_particuliers, 1)] },
              { key: 'seg:ent', cells: [t('report.entreprises'), formatInt(ov.active_entreprises), formatPercent(ov.pct_active_entreprises, 1)] },
              { total: true, cells: [t('common.total'), formatInt(ov.active_clients), '100%'] },
            ]
          ),
          // Sans-police table: standalone (no `key:` on rows). Brokers used
          // to see these rows highlight in sync with the active-clients pie
          // chart, which was misleading since "sans police" clients aren't
          // represented in that pie at all. Same 3-column shape as the
          // active table above (label / count / %), with % computed against
          // the inactive total so the row reads "X% of inactive clients".
          simpleTable(
            [{ label: t('report.sans_police') },
             { label: t('report.count'), align: 'right' },
             { label: '%', align: 'right' }],
            (() => {
              const tot = ov.clients_sans_police || 0;
              const pct = (n) => tot ? formatPercent(n / tot * 100, 1) : '0%';
              return [
                { cells: [t('report.particuliers'), formatInt(ov.sans_police_particuliers), pct(ov.sans_police_particuliers)] },
                { cells: [t('report.entreprises'), formatInt(ov.sans_police_entreprises), pct(ov.sans_police_entreprises)] },
                { total: true, cells: [t('common.total'), formatInt(ov.clients_sans_police), '100%'] },
              ];
            })()
          ),
        ]),
        h('div', { class: 'card-split-chart chart-wrap' }, [
          pieChart(segments, { size: 200, stroke: 40 }),
          h('div', { class: 'chart-legend' }, segments.map((sg) => h('div', { class: 'legend-item' }, [
            h('span', { class: 'legend-dot', style: { background: `var(${sg.color})` } }),
            h('span', { class: 'legend-label' }, sg.label),
            h('span', { class: 'legend-value' }, formatInt(sg.value)),
          ]))),
        ]),
      ]),
    ]),
  ]);

  // ---- Section 2: Socio-demo ----------------------------------------------

  const geo = stats.geographic;
  const demo = stats.demographics;
  const civilSocial = stats.civil_social;

  // Postcodes up to 70% of clientele, plus a final "Hors zone" row.
  const geoRowsTo70 = (() => {
    const out = [];
    for (const g of geo.rows) {
      out.push(g);
      if (g.cumul_pct >= 70) break;
    }
    return out;
  })();
  const postalBarItems = geoRowsTo70.map((g) => ({
    label: g.code_postal,
    value: g.pct,
    valueLabel: formatPercent(g.pct, 1),
    color: '--indigo',
    key: `cp:${g.code_postal}`,
  }));
  postalBarItems.push({
    label: t('report.hors_zone'),
    value: geo.hors_zone_pct,
    valueLabel: formatPercent(geo.hors_zone_pct, 1),
    color: '--pink',
    key: 'cp:hors',
  });

  // Gender segments for pie + table (known = M+F, unknown separate).
  const M = demo.gender.M || { count: 0, pct: 0 };
  const F = demo.gender.F || { count: 0, pct: 0 };
  const Uk = demo.gender.Inconnu || { count: 0, pct: 0 };
  const knownSexe = (M.count || 0) + (F.count || 0);
  const totalSexe = knownSexe + (Uk.count || 0);
  const genderSegments = [
    { label: t('demo.male'), value: M.count, color: '--indigo' },
    { label: t('demo.female'), value: F.count, color: '--pink' },
  ];

  // Age table totals + rows.
  const ageTotalClients = demo.age_brackets.reduce((a, b) => a + b.client_count, 0);
  const ageTotalPolicies = demo.age_brackets.reduce((a, b) => a + b.policy_count, 0);
  const ageRows = demo.age_brackets.map((b) => {
    const isSenior = b.label === '60-69' || b.label === '70-+';
    const pClient = formatPercent(b.pct, 1);
    const pPolicy = ageTotalPolicies
      ? formatPercent(b.policy_count / ageTotalPolicies * 100, 1) : '0%';
    return {
      key: `age:${b.label}`,
      cells: [b.label, formatInt(b.client_count), pClient, formatInt(b.policy_count), pPolicy],
      emphasize: isSenior,
    };
  });
  ageRows.push({
    subtle: true,
    cells: [t('report.known'), formatInt(demo.known_age),
      ageTotalClients ? formatPercent(demo.known_age / demo.total * 100, 1) : '0%',
      formatInt(ageTotalPolicies), '100%'],
  });
  ageRows.push({
    subtle: true,
    cells: [t('report.unknown'), formatInt(demo.unknown_age || 0),
      demo.total ? formatPercent((demo.unknown_age || 0) / demo.total * 100, 1) : '0%',
      '—', '—'],
  });
  ageRows.push({
    total: true,
    cells: [t('report.total_observe'), formatInt(demo.total), '100%', formatInt(ageTotalPolicies), '100%'],
  });

  // Civil/social helpers — chart + known/unknown/total footer.
  const csTable = (rows, known, total, kind) => {
    const knownRows = rows.filter((r) => !/^inconnu$/i.test(r.label));
    const unknownRow = rows.find((r) => /^inconnu$/i.test(r.label));
    const out = knownRows.slice(0, 8).map((r) => {
      const [ic, ti] = kind === 'civil' ? civilIconTint(r.label) : socialIconTint(r.label);
      return {
        key: `${kind}:${normLabel(r.label)}`,
        cells: [rowIcon(ic, ti, r.label), formatInt(r.count), formatPercent(r.pct, 1)],
      };
    });
    out.push({
      subtle: true,
      cells: [t('report.known'), formatInt(known),
        total ? formatPercent(known / total * 100, 1) : '0%'],
    });
    out.push({
      subtle: true,
      cells: [t('report.unknown'), formatInt(unknownRow?.count || 0),
        total ? formatPercent((unknownRow?.count || 0) / total * 100, 1) : '0%'],
    });
    out.push({
      total: true,
      cells: [t('report.total_observe'), formatInt(total), '100%'],
    });
    return out;
  };
  const civilBarItems = civilSocial.civil_status
    .filter((r) => !/^inconnu$/i.test(r.label))
    .slice(0, 8)
    .map((r) => {
      const [, ti] = civilIconTint(r.label);
      return { label: r.label, value: r.pct, valueLabel: formatPercent(r.pct, 1), color: ti, key: `civil:${normLabel(r.label)}` };
    });
  const socialBarItems = civilSocial.social_status
    .filter((r) => !/^inconnu$/i.test(r.label))
    .slice(0, 8)
    .map((r) => {
      const [, ti] = socialIconTint(r.label);
      return { label: r.label, value: r.pct, valueLabel: formatPercent(r.pct, 1), color: ti, key: `social:${normLabel(r.label)}` };
    });

  const sec2 = section({
    number: 2, title: t('report.s2_title'),
    tint: '--teal', iconName: 'map.pin',
    description: t('dash.s2_desc'),
  }, [
    // Postal card — progress bar, full table to 70%, horizontal bar chart.
    card([
      cardHead(t('report.s2_postal'), t('report.s2_postal_info')),
      dashProgressBar(geo.zone_pct, geo.hors_zone_pct,
        `${t('report.dans_zone')} · ${formatInt(geo.zone_count)}`,
        `${t('report.hors_zone')} · ${formatInt(geo.hors_zone_count)}`),
      h('div', { class: 'dash-grid dash-grid-2' }, [
        simpleTable(
          [{ label: t('report.postal') }, { label: t('report.commune') },
           { label: t('report.count'), align: 'right' },
           { label: '%', align: 'right' },
           { label: t('report.cumul'), align: 'right' }],
          [
            ...geoRowsTo70.map((g) => ({
              key: `cp:${g.code_postal}`,
              cells: [
                g.code_postal, g.localite || '',
                formatInt(g.count),
                formatPercent(g.pct, 1),
                formatPercent(g.cumul_pct, 1),
              ],
            })),
            {
              key: 'cp:hors',
              subtle: true,
              cells: [t('report.hors_zone'), '',
                formatInt(geo.hors_zone_count),
                formatPercent(geo.hors_zone_pct, 1),
                '100%'],
            },
            {
              total: true,
              cells: [t('report.total_observe'), '',
                formatInt(geo.zone_count + geo.hors_zone_count),
                '100%', ''],
            },
          ]
        ),
        h('div', { class: 'chart-wrap' },
          hBarChart(postalBarItems, {
            width: 440, rowHeight: 22, gap: 5, labelWidth: 100, valueWidth: 56,
            max: Math.max(...postalBarItems.map((i) => i.value), 1),
          })),
      ]),
    ]),

    h('div', { class: 'dash-grid dash-grid-2' }, [
      // Gender card — symbols, pie, table with known/unknown/total.
      card([
        cardHead(t('report.s3_sex'), t('report.s3_sex_info')),
        h('div', { class: 'chart-wrap' }, [
          knownSexe > 0
            ? pieChart([
                { ...genderSegments[0], key: 'sex:M' },
                { ...genderSegments[1], key: 'sex:F' },
              ], { size: 180, stroke: 36 })
            : h('div', { class: 'card-empty' }, t('dashboard.no_data')),
          simpleTable(
            [{ label: '' }, { label: t('report.count'), align: 'right' }, { label: '%', align: 'right' }],
            [
              {
                key: 'sex:M',
                cells: [rowIcon('person.crop.circle', '--indigo', t('demo.male')),
                  formatInt(M.count), formatPercent(M.pct, 1)],
              },
              {
                key: 'sex:F',
                cells: [rowIcon('person.crop.circle', '--pink', t('demo.female')),
                  formatInt(F.count), formatPercent(F.pct, 1)],
              },
              {
                subtle: true,
                cells: [t('report.known'), formatInt(knownSexe),
                  totalSexe ? formatPercent(knownSexe / totalSexe * 100, 1) : '0%'],
              },
              {
                subtle: true,
                cells: [t('report.unknown'), formatInt(Uk.count || 0),
                  totalSexe ? formatPercent((Uk.count || 0) / totalSexe * 100, 1) : '0%'],
              },
              {
                total: true,
                cells: [t('report.total_observe'), formatInt(totalSexe), '100%'],
              },
            ]
          ),
        ]),
      ], { class: 'card-chart' }),

      // Age card — table with client + policy columns, plus a vertical
      // bar chart so the shape of the age pyramid reads at a glance.
      card([
        cardHead(
          `${t('report.s3_age')} (${t('dashboard.ref_year')} ${kpiS.snapshot_year})`,
          t('report.s3_age_info')),
        demo.age_brackets.length === 0
          ? h('div', { class: 'card-empty' }, t('dashboard.no_data'))
          : h('div', {}, [
              h('div', { class: 'chart-wrap' },
                vBarChart(demo.age_brackets.map((b) => ({
                  label: b.label,
                  value: b.client_count,
                  valueLabel: formatInt(b.client_count),
                  color: (b.label === '60-69' || b.label === '70-+') ? '--warning' : '--indigo',
                  key: `age:${b.label}`,
                })), { width: 420, height: 180 })),
              simpleTable(
                [
                  { label: t('report.s3_age') },
                  { label: t('report.nbre_clients'), align: 'right' },
                  { label: t('report.percent_age'), align: 'right' },
                  { label: t('report.nbre_polices'), align: 'right' },
                  { label: t('report.percent_age'), align: 'right' },
                ],
                ageRows
              ),
            ]),
      ]),
    ]),

    h('div', { class: 'dash-grid dash-grid-2' }, [
      // Civil status card — chart + table with footer.
      card([
        cardHead(t('report.s3_civil'), t('report.s3_civil_info')),
        h('div', { class: 'dash-grid dash-grid-2' }, [
          simpleTable(
            [{ label: '' }, { label: t('report.count'), align: 'right' }, { label: '%', align: 'right' }],
            csTable(civilSocial.civil_status, civilSocial.known_civil, civilSocial.total, 'civil')
          ),
          civilBarItems.length
            ? h('div', { class: 'chart-wrap' },
                hBarChart(civilBarItems, { width: 320, rowHeight: 20, gap: 5, labelWidth: 130, valueWidth: 50, max: 100 }))
            : h('div', { class: 'card-empty' }, t('dashboard.no_data')),
        ]),
      ]),

      // Social status card — chart + table with footer.
      card([
        cardHead(t('report.s3_social'), t('report.s3_social_info')),
        civilSocial.social_status.length === 0
          ? h('div', { class: 'card-empty' }, t('dashboard.no_data'))
          : h('div', { class: 'dash-grid dash-grid-2' }, [
              simpleTable(
                [{ label: '' }, { label: t('report.count'), align: 'right' }, { label: '%', align: 'right' }],
                csTable(civilSocial.social_status, civilSocial.known_social, civilSocial.total, 'social')
              ),
              socialBarItems.length
                ? h('div', { class: 'chart-wrap' },
                    hBarChart(socialBarItems, { width: 320, rowHeight: 20, gap: 5, labelWidth: 130, valueWidth: 50, max: 100 }))
                : null,
            ]),
      ]),
    ]),
  ]);

  // ---- Section 3: Data quality --------------------------------------------

  const dqFields = stats.data_quality.fields;
  // Three-state colouring per field: green (low missing), warning, or danger.
  // Phone & email use a 5% green cap; everything else 10%. No more "critical"
  // badge — the bar tint is the signal.
  const dqDisplay = dqFields.map((f) => ({
    ...f,
    colorVar: dqColorVar(f),
  }));
  const dqLabelCell = (f) => h('span', { class: 'dq-label-cell' }, [
    h('span', { class: 'cell-with-icon' }, [
      h('span', { class: 'cell-icon-dot', style: { '--tint': `var(${f.colorVar})` } },
        icon(dqFieldIcon(f.key), { size: 14, color: f.colorVar })),
      h('span', {}, f.label),
    ]),
  ]);
  const sec3 = section({
    number: 3, title: t('report.s4_dq'),
    tint: '--warning', iconName: 'shield.checkmark',
    description: t('dash.s3_desc'),
  }, [
    card([
      cardHead(t('report.s4_dq'), t('report.s4_dq_info')),
      h('div', { class: 'dash-grid dash-grid-2' }, [
        simpleTable(
          [{ label: t('report.field') }, { label: t('report.pct_unknown'), align: 'right' }],
          dqDisplay.map((f) => ({
            key: `dq:${f.key}`,
            cells: [
              dqLabelCell(f),
              {
                text: formatPercent(f.pct_missing, 1),
                align: 'right',
                // Object-form style (CSP). Tint matches the bar so a glance
                // across the row reads consistently.
                style: f.colorVar === '--danger'
                  ? { color: 'var(--danger)', fontWeight: '600' }
                  : null,
              },
            ],
          }))
        ),
        h('div', { class: 'chart-wrap' },
          hBarChart(dqDisplay.map((f) => ({
            label: f.label,
            value: f.pct_missing,
            valueLabel: formatPercent(f.pct_missing, 1),
            color: f.colorVar,
            key: `dq:${f.key}`,
          })), { width: 400, rowHeight: 24, gap: 6, labelWidth: 130, valueWidth: 50, max: 100 })
        ),
      ]),
    ]),
  ]);

  // ---- Section 4: Contrats d'assurance -----------------------------------

  const branches = stats.branches;
  const sub = stats.subscription;
  const ppc = stats.policies_per_client;
  const companies = stats.companies;
  const topCompanies = companies.companies.slice(0, 12);

  // Aggregate branches into IARD / Vie / Placement / Crédit for the pie.
  const branchAggCount = { IARD: 0, VIE: 0, PLA: 0, CRED: 0 };
  for (const b of branches.branches) {
    if (NON_IARD.has(b.code)) branchAggCount[b.code] += b.count;
    else branchAggCount.IARD += b.count;
  }
  const totalPoliciesAll = branches.total || 0;
  const aggSegments = [
    { code: 'IARD', label: t('report.total_iard'), value: branchAggCount.IARD, color: '--indigo' },
    { code: 'VIE', label: t('report.vie_legend'), value: branchAggCount.VIE, color: '--pink' },
    { code: 'PLA', label: t('report.pla_legend'), value: branchAggCount.PLA, color: '--teal' },
    { code: 'CRED', label: t('report.cred_legend'), value: branchAggCount.CRED, color: '--warning' },
  ];

  // Full branch list with bar chart; colour non-IARD branches distinctly.
  const branchColor = (code) => {
    if (code === 'VIE') return '--pink';
    if (code === 'PLA') return '--teal';
    if (code === 'CRED') return '--warning';
    return '--indigo';
  };
  const branchBarItems = branches.branches.map((b) => ({
    label: branchLabel(b.code),
    value: b.pct,
    valueLabel: formatPercent(b.pct, 1),
    color: branchColor(b.code),
    key: `branch:${b.code}`,
  }));
  const subBarItems = sub.branches.map((b) => ({
    label: branchLabel(b.code),
    value: b.penetration,
    valueLabel: formatPercent(b.penetration, 1),
    color: branchColor(b.code),
    key: `sub:${b.code}`,
  }));

  // Distribution table rows — exclude 0-policy bucket, add total.
  const distRows = ppc.distribution.filter((d) => d.label !== '0');
  const distTotal = distRows.reduce((a, d) => a + d.count, 0);

  const sec4 = section({
    number: 4, title: t('dash.s4_title'),
    tint: '--purple', iconName: 'doc.text',
    description: t('dash.s4_desc'),
  }, [
    // Branches — table on the left; bar chart + aggregate pie stacked on the
    // right so both visualisations read against the same column.
    card([
      cardHead(t('report.s5_branches'), t('report.s5_branches_info')),
      h('div', { class: 'dash-grid dash-grid-2' }, [
        simpleTable(
          [{ label: t('report.branch') },
           { label: t('report.policies_count'), align: 'right' },
           { label: '%', align: 'right' }],
          [
            ...branches.branches.map((b) => ({
              key: `branch:${b.code}`,
              cells: [
                rowIcon('doc.text', branchColor(b.code), branchLabel(b.code)),
                formatInt(b.count),
                formatPercent(b.pct, 1),
              ],
            })),
            ...aggSegments.map((s) => ({
              key: `branch-agg:${s.code}`,
              subtle: true,
              cells: [
                rowIcon('doc.text', s.color, s.label),
                formatInt(s.value),
                totalPoliciesAll ? formatPercent(s.value / totalPoliciesAll * 100, 1) : '0%',
              ],
            })),
            {
              total: true,
              cells: [t('report.total_observe'), formatInt(totalPoliciesAll), '100%'],
            },
          ]
        ),
        h('div', { class: 'card-charts-stack' }, [
          branchBarItems.length
            ? h('div', { class: 'chart-wrap' },
                hBarChart(branchBarItems, { width: 380, rowHeight: 20, gap: 4, labelWidth: 130, valueWidth: 50, max: 100 }))
            : h('div', { class: 'card-empty' }, t('dashboard.no_data')),
          aggSegments.some((s) => s.value > 0)
            ? h('div', { class: 'chart-wrap' }, [
                pieChart(aggSegments.filter((s) => s.value > 0).map((s) => ({
                  ...s, key: `branch-agg:${s.code}`,
                })), { size: 200, stroke: 40 }),
                h('div', { class: 'chart-legend' }, aggSegments.filter((s) => s.value > 0).map((sg) =>
                  h('div', { class: 'legend-item' }, [
                    h('span', { class: 'legend-dot', style: { background: `var(${sg.color})` } }),
                    h('span', { class: 'legend-label' }, sg.label),
                    h('span', { class: 'legend-value' },
                      `${formatInt(sg.value)} · ${totalPoliciesAll ? formatPercent(sg.value / totalPoliciesAll * 100, 1) : '0%'}`),
                  ]))),
              ])
            : null,
        ]),
      ]),
    ]),

    // Subscription — all branches, table + chart.
    card([
      cardHead(t('report.s5_subscription'), t('report.s5_subscription_info')),
      h('div', { class: 'dash-grid dash-grid-2' }, [
        simpleTable(
          [{ label: t('report.branch') },
           { label: t('report.clients_count'), align: 'right' },
           { label: '%', align: 'right' }],
          sub.branches.map((b) => ({
            key: `sub:${b.code}`,
            cells: [
              rowIcon('person.2', branchColor(b.code), branchLabel(b.code)),
              formatInt(b.client_count),
              formatPercent(b.penetration, 1),
            ],
          }))
        ),
        subBarItems.length
          ? h('div', { class: 'chart-wrap' },
              hBarChart(subBarItems, { width: 380, rowHeight: 20, gap: 4, labelWidth: 130, valueWidth: 50, max: 100 }))
          : h('div', { class: 'card-empty' }, t('dashboard.no_data')),
      ]),
    ]),

    // Distribution — table + bar chart.
    card([
      cardHead(t('report.s5_distribution'), t('report.s5_distribution_info')),
      h('div', { class: 'dash-grid dash-grid-2' }, [
        simpleTable(
          [{ label: t('report.s5_distribution') },
           { label: t('report.clients_count'), align: 'right' },
           { label: '%', align: 'right' }],
          [
            ...distRows.map((d) => ({
              key: `dist:${d.label}`,
              cells: [
                d.label === '5+' ? t('report.5plus_policies') :
                  d.label === '1' ? t('report.1_policy') :
                  d.label === '2' ? t('report.2_policies') :
                  d.label === '3' ? t('report.3_policies') :
                  d.label === '4' ? t('report.4_policies') : d.label,
                formatInt(d.count),
                distTotal ? formatPercent(d.count / distTotal * 100, 1) : '0%',
              ],
            })),
            {
              total: true,
              cells: [t('report.total_observe'), formatInt(distTotal), '100%'],
            },
          ]
        ),
        h('div', { class: 'chart-wrap' },
          vBarChart(distRows.map((d) => ({
            label: d.label,
            value: d.count,
            valueLabel: formatInt(d.count),
            color: '--indigo',
            key: `dist:${d.label}`,
          })), { width: 360, height: 180 })
        ),
      ]),
    ]),

    // Companies — highlight the smallest set of insurers that together carry
    // 50% or more of the policies. Concentration risk at a glance: if only
    // two or three insurers make up half the book, a tariff hike or a broken
    // partnership hits hard.
    card([
      cardHead(t('report.s5_companies'), t('report.s5_companies_info')),
      simpleTable(
        [{ label: t('report.company') },
         { label: t('report.policies_count'), align: 'right' },
         { label: '%', align: 'right' }],
        (() => {
          let cumulative = 0;
          let crossed = false;
          return topCompanies.map((c) => {
            const before = cumulative;
            cumulative += c.pct || 0;
            // Emphasize every row up to and including the one whose cumulative
            // share first reaches 50%. Stop emphasizing after that — the rest
            // is the long tail.
            const emphasize = !crossed;
            if (!crossed && cumulative >= 50 && before < 50) crossed = true;
            return {
              cells: [c.name, formatInt(c.count), formatPercent(c.pct, 2)],
              emphasize,
            };
          });
        })()
      ),
    ]),
  ]);

  // ---- Section 5: Ratios summary ------------------------------------------
  //
  // Mirrors page 10 of the print report (Tableau résumé des principaux
  // ratios) so the broker sees the exact same numbers on screen as in the
  // PDF. Built from the shared buildRatiosSummary() helper so both surfaces
  // stay in lockstep.

  // Single snapshot view: one column only. The multi-snapshot evolution lives
  // on the Evolution screen (with deltas) and on page 10 of the print report.
  // Here the broker just wants today's numbers without the comparison clutter.
  const { rows: ratioRows, columns: ratioColumns } = buildRatiosSummary(
    [{ stats, snapshot }],
    { locale: ctx.locale },
  );
  // Ménages summary boxes are already shown in the hero summaryGrid at the
  // top of the dashboard, so we skip them here and surface only the long
  // ratios table. For the polices-p / polices-e rows we want the count and
  // the % visually separated (same treatment as the print report, .rp-val-pct
  // is a shared inline-flex helper).
  //
  // No orange "current column" highlight here — there's only one snapshot
  // column on the dashboard, so tinting it "current" is redundant noise.
  // The orange tint stays on the Evolution screen, where it actually
  // disambiguates the most recent column from older ones.
  const ratioValueCell = (v) => {
    const inner = (v.pct != null)
      ? h('span', { class: 'rp-val-pct' }, [
          h('span', { class: 'rp-val' }, v.value),
          h('span', { class: 'rp-pct' }, v.pct),
        ])
      : v.value;
    return { text: inner, align: 'right' };
  };
  const ratioColumnsConfig = [
    { label: t('report.ratio.column') },
    ...ratioColumns.map((c) => ({ label: c.label, align: 'right' })),
  ];
  const sec5 = section({
    number: 5, title: t('report.s6_title'),
    tint: '--teal', iconName: 'chart.bar',
    description: t('report.s6_info'),
  }, [
    card([
      cardHead(t('report.s6_title'), t('report.s6_info')),
      simpleTable(
        ratioColumnsConfig,
        (() => {
          // Inject a section header row whenever the section changes. The
          // header spans every column and reads as a small uppercase label.
          const out = [];
          let lastSection = null;
          for (const r of ratioRows) {
            if (r.section && r.section !== lastSection) {
              out.push({
                key: `ratio-section:${r.section}`,
                sectionHeader: true,
                label: ratioSectionTitle(r.section),
              });
              lastSection = r.section;
            }
            out.push({
              key: `ratio:${r.key}`,
              cells: [
                r.year
                  ? h('span', { class: 'ratio-row-text' }, [
                      r.label,
                      h('span', { class: 'ratio-row-year' }, ` · ${r.year}`),
                    ])
                  : r.label,
                ...r.values.map((v) => ratioValueCell(v)),
              ],
            });
          }
          return out;
        })()
      ),
    ]),
  ]);

  // ---- Section 6: Opportunities -------------------------------------------

  const opps = stats.opportunities;
  const sec6 = section({
    number: 6, title: t('dashboard.opportunities'),
    tint: '--success', iconName: 'wand.and.stars',
    description: t('dash.s5_desc'),
  }, [
    h('div', { class: 'dash-grid dash-grid-3' }, [
      oppTile('arrow.up.arrow.down', '--accent', t('dashboard.cross_sell'), opps.cross_sell.length, t('dash.s5_cross_sell'),
        () => showOppDetail(t('dashboard.cross_sell'), opps.cross_sell, OPP_RENDERERS.cross_sell, { ctx, snapshot })),
      oppTile('clock.arrow.circlepath', '--warning', t('dashboard.succession'), opps.succession.length, t('dash.s5_succession'),
        () => showOppDetail(t('dashboard.succession'), opps.succession, OPP_RENDERERS.succession, { ctx, snapshot })),
      oppTile('figure.2', '--pink', t('dashboard.young_families'), opps.young_families.length, t('dash.s5_young_families'),
        () => showOppDetail(t('dashboard.young_families'), opps.young_families, OPP_RENDERERS.young_families, { ctx, snapshot })),
      oppTile('star', '--purple', t('dashboard.high_value'), opps.high_value.length, t('dash.s5_high_value'),
        () => showOppDetail(t('dashboard.high_value'), opps.high_value, OPP_RENDERERS.high_value, { ctx, snapshot })),
      oppTile('shield.checkmark', '--danger', t('dashboard.dq_cleanup'), opps.data_quality_cleanup.length, t('dash.s5_dq_cleanup'),
        () => showOppDetail(t('dashboard.dq_cleanup'), opps.data_quality_cleanup, OPP_RENDERERS.data_quality_cleanup, { ctx, snapshot })),
    ]),
  ]);

  // ---- Assembly ------------------------------------------------------------

  mount(root, h('div', { class: 'page dash' }, [
    hero,
    kpiGrid,
    summaryGrid,
    sec1,
    sec2,
    sec3,
    sec4,
    sec5,
    sec6,
  ]));

  // Wire chart ↔ table hover sync per section. Scoping at the section level
  // lets tables and charts in *separate* cards (sec1 particuliers/entreprises:
  // table-card + pie-card) still sync. Our keys are prefixed ('cp:', 'sex:',
  // 'branch:', etc.) so cards inside the same section don't collide.
  root.querySelectorAll('.dash-section').forEach((secEl) => wireCardSync(secEl));
}

// Opportunity tiles + detail modal live in `./dashboard_opp.js`. We re-import
// `oppTile`, `OPP_RENDERERS`, and `showOppDetail` at the top of this file.
