// Print-ready report layout matching the legacy "Rapport Analyse PFT" Excel
// export. Rendered into a hidden <div id="report-print"> and revealed only via
// @media print.
//
// All tables + data match the sample. Visual layout is corporate clean:
// subtle dividers, no heavy borders, consistent section numbering.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { formatInt, formatPercent, formatDate, branchLabel } from '../ui/format.js';
import { hBarChart, vBarChart, pieChart } from '../ui/charts.js';
import { buildRatiosSummary } from '../core/ratios_summary.js';

const PAGE_COUNT = 10;

function pageHeader(label) {
  return h('div', { class: 'rp-head' }, [
    h('span', { class: 'rp-head-title' }, t('report.title')),
    h('span', { class: 'rp-head-brand' }, label || 'Portfolio Analysis'),
  ]);
}

function pageFooter(snapshot, pageNumber) {
  return h('div', { class: 'rp-foot' }, [
    h('span', { class: 'rp-foot-left' }, snapshot.label || ''),
    h('span', { class: 'rp-foot-center' }, `${pageNumber}/${PAGE_COUNT}`),
    h('span', { class: 'rp-foot-right' },
      `${t('report.extracted')}: ${formatDate(snapshot.snapshot_date)}`),
  ]);
}

function page(n, snapshot, brand, children) {
  return h('section', { class: 'rp-page', 'data-page': n }, [
    pageHeader(brand),
    h('div', { class: 'rp-body' }, children),
    pageFooter(snapshot, n),
  ]);
}

function sectionTitle(num, title) {
  return h('h2', { class: 'rp-h2' }, [
    h('span', { class: 'rp-h2-num' }, `${num}.`),
    h('span', {}, title),
  ]);
}

function subTitle(text, note) {
  return h('h3', { class: 'rp-h3' }, [
    h('span', {}, text),
    note ? h('span', { class: 'rp-h3-note' }, note) : null,
  ]);
}

function infoText(text) {
  return h('p', { class: 'rp-info' }, text);
}

function table(rows, opts = {}) {
  const cls = 'rp-table' + (opts.tone ? ` tone-${opts.tone}` : '');
  // cellClass: joins alignment + "is-current" so the ratios-summary table can
  // tint the current-snapshot column (matches the yellow header on the 2022
  // reference rapport). Used for both th and td.
  const cellClass = (c) => {
    const parts = [];
    if (c && typeof c === 'object' && c.align) parts.push(`a-${c.align}`);
    if (c && typeof c === 'object' && c.isCurrent) parts.push('is-current');
    return parts.length ? parts.join(' ') : null;
  };
  return h('table', { class: cls }, [
    opts.head ? h('thead', {}, h('tr', {},
      opts.head.map((c) => h('th', {
        class: cellClass(c),
      }, c && typeof c === 'object' && 'text' in c ? c.text : c))
    )) : null,
    h('tbody', {}, rows.map((r) => {
      const cls = [];
      if (r.emphasize) cls.push('emphasize');
      else if (r.total) cls.push('row-total');
      else if (r.subtle) cls.push('row-subtle');
      return h('tr',
        {
          class: cls.length ? cls.join(' ') : null,
          style: r.style || null,
        },
        (r.cells || r).map((c) => h('td', {
          class: cellClass(c),
          style: c && typeof c === 'object' && c.style ? c.style : null,
        },
        c && typeof c === 'object' && 'text' in c ? c.text : c))
      );
    })),
  ]);
}

// --- Data derivations --------------------------------------------------------

// 5+ branches combined as "5 polices et plus"
function distributionRows(dist) {
  const get = (k) => (dist.find((d) => d.label === k) || { count: 0 }).count;
  // dist labels from analyzer: '0','1','2','3','4','5+'
  const active1 = get('1');
  const active2 = get('2');
  const active3 = get('3');
  const active4 = get('4');
  const active5plus = get('5+');
  const total = active1 + active2 + active3 + active4 + active5plus;
  const pct = (v) => total ? (v / total * 100) : 0;
  return {
    rows: [
      { label: t('report.1_policy'), count: active1, pct: pct(active1) },
      { label: t('report.2_policies'), count: active2, pct: pct(active2) },
      { label: t('report.3_policies'), count: active3, pct: pct(active3) },
      { label: t('report.4_policies'), count: active4, pct: pct(active4) },
      { label: t('report.5plus_policies'), count: active5plus, pct: pct(active5plus) },
    ],
    total,
  };
}

function ageBracketLabel(label) {
  if (label === '70-+') return '70 ans et +';
  const [lo, hi] = label.split('-');
  return `${lo} à ${hi} ans`;
}

// Render a count + its % share in the same right-aligned cell with clear
// visual separation between them. Used on the ratios page for the
// "Polices Particuliers / Entreprises" rows, where packing "12345 67,89 %"
// as plain text with two spaces made the two numbers read as one.
function ratioValueWithPct(count, pct) {
  return h('span', { class: 'rp-val-pct' }, [
    h('span', { class: 'rp-val' }, formatInt(count)),
    h('span', { class: 'rp-pct' }, formatPercent(pct, 2)),
  ]);
}

// --- Pages -------------------------------------------------------------------

function page1(s, ov) {
  const pie = pieChart([
    { label: t('report.particuliers'), value: ov.particuliers, color: '--indigo' },
    { label: t('report.entreprises'), value: ov.entreprises, color: '--pink' },
  ], { size: 200, stroke: 44, label: t('report.particuliers') });

  const legend = h('div', { class: 'rp-legend' }, [
    h('span', { class: 'legend-dot', style: { background: 'var(--indigo)' } }),
    h('span', {}, t('report.particuliers')),
    h('span', { class: 'legend-dot', style: { background: 'var(--pink)' } }),
    h('span', {}, t('report.entreprises')),
  ]);

  const mainTable = table([
    { cells: [t('report.particuliers'),
      { text: formatInt(ov.active_particuliers), align: 'right' },
      { text: formatPercent(ov.pct_active_particuliers, 2), align: 'right' }] },
    { cells: [t('report.entreprises'),
      { text: formatInt(ov.active_entreprises), align: 'right' },
      { text: formatPercent(ov.pct_active_entreprises, 2), align: 'right' }] },
    { total: true, cells: [t('common.total'),
      { text: formatInt(ov.active_clients), align: 'right' },
      { text: '100,00%', align: 'right' }] },
  ], { head: [t('report.in_portfolio'), t('report.count'), '%'] });

  const sansTable = table([
    { cells: [t('report.particuliers'),
      { text: formatInt(ov.sans_police_particuliers), align: 'right' }] },
    { cells: [t('report.entreprises'),
      { text: formatInt(ov.sans_police_entreprises), align: 'right' }] },
    { total: true, cells: [t('common.total'),
      { text: formatInt(ov.clients_sans_police), align: 'right' }] },
  ], { head: [t('report.sans_police') + ' ' + t('report.sans_police_note'), t('report.count')] });

  return [
    sectionTitle(1, t('report.s1_title')),
    h('p', { class: 'rp-intro' }, t('report.s1_intro')),
    h('div', { class: 'rp-grid-2' }, [
      h('div', {}, mainTable),
      h('div', {}, sansTable),
    ]),
    h('div', { class: 'rp-chart-wrap' }, [pie, legend]),
  ];
}

// Page 2: postal code breakdown. We show every postcode until cumul_pct reaches
// 70%, plus a progress bar (in-zone vs out-of-zone) and an horizontal bar chart
// with one bar per in-zone postcode + one final bar for "Hors zone".
function page2(s, geo) {
  const rows70 = [];
  for (const g of (geo.rows || [])) {
    rows70.push(g);
    if (g.cumul_pct >= 70) break;
  }
  const zoneCount = geo.zone_count || 0;
  const horsZoneCount = geo.hors_zone_count || 0;
  const zonePct = geo.zone_pct || 0;
  const horsZonePct = geo.hors_zone_pct || 0;
  const total = zoneCount + horsZoneCount;

  const progressBar = h('div', { class: 'rp-progress' }, [
    h('div', { class: 'rp-progress-track' }, [
      h('div', {
        class: 'rp-progress-fill rp-progress-zone',
        style: `width:${zonePct}%;background:var(--indigo);`,
      }, zonePct >= 12 ? formatPercent(zonePct, 1) : ''),
      h('div', {
        class: 'rp-progress-fill rp-progress-out',
        style: `width:${horsZonePct}%;background:var(--pink);`,
      }, horsZonePct >= 12 ? formatPercent(horsZonePct, 1) : ''),
    ]),
    h('div', { class: 'rp-progress-legend' }, [
      h('span', { class: 'rp-progress-legend-item' }, [
        h('span', { class: 'legend-dot', style: { background: 'var(--indigo)' } }),
        h('span', {}, `${t('report.s2_zone_influence')}: ${formatInt(zoneCount)} (${formatPercent(zonePct, 1)})`),
      ]),
      h('span', { class: 'rp-progress-legend-item' }, [
        h('span', { class: 'legend-dot', style: { background: 'var(--pink)' } }),
        h('span', {}, `${t('report.hors_zone')}: ${formatInt(horsZoneCount)} (${formatPercent(horsZonePct, 1)})`),
      ]),
    ]),
  ]);

  const dataRows = rows70.map((g) => ({ cells: [
    { text: g.code_postal, align: 'left' },
    { text: g.localite || '', align: 'left' },
    { text: formatInt(g.count), align: 'right' },
    { text: formatPercent(g.pct, 2), align: 'right' },
    { text: formatPercent(g.cumul_pct, 2), align: 'right' },
  ] }));
  const footer = [
    { emphasize: true, cells: [
      { text: t('report.dans_zone'), align: 'left' }, '',
      { text: formatInt(zoneCount), align: 'right' },
      { text: formatPercent(zonePct, 2), align: 'right' }, '',
    ] },
    { cells: [
      { text: t('report.hors_zone'), align: 'left' }, '',
      { text: formatInt(horsZoneCount), align: 'right' },
      { text: formatPercent(horsZonePct, 2), align: 'right' }, '',
    ] },
    { total: true, cells: [
      { text: t('report.total_observe'), align: 'left' }, '',
      { text: formatInt(total), align: 'right' }, '100,00%', '',
    ] },
  ];
  const tbl = table([...dataRows, ...footer], {
    head: [t('report.postal'), t('report.commune'), t('report.count'), '%', '% ' + t('report.cumul')],
    tone: 'green',
  });

  const chartItems = rows70.map((g) => ({
    label: g.code_postal,
    value: g.pct,
    valueLabel: formatPercent(g.pct, 1),
    color: '--indigo',
  }));
  chartItems.push({
    label: t('report.hors_zone'),
    value: horsZonePct,
    valueLabel: formatPercent(horsZonePct, 1),
    color: '--pink',
  });
  const chart = hBarChart(chartItems, {
    width: 360, rowHeight: 18, gap: 4, labelWidth: 70, valueWidth: 56,
    max: Math.max(...chartItems.map(x => x.value), 1),
  });

  return [
    sectionTitle(2, t('report.s2_title')),
    infoText(t('report.s2_postal_info')),
    subTitle(t('report.s2_postal'), t('report.s2_postal_note')),
    progressBar,
    h('div', { class: 'rp-grid-2' }, [
      h('div', {}, tbl),
      h('div', { class: 'rp-chart-wrap' }, chart),
    ]),
  ];
}

// Page 3: gender + age. Gender gets international ♂/♀ symbols, a donut pie
// and coherent known/unknown footer. Age mirrors the reference layout: 5
// columns [label, clients, %clients, policies, %policies] with green rows
// for 60-69 / 70+ and grey Connu / Non renseigné / Total rows.
function page3(s, demo, kpi) {
  const male = demo.gender.M || { count: 0, pct: 0 };
  const female = demo.gender.F || { count: 0, pct: 0 };
  const unknown = demo.gender.Inconnu || { count: 0, pct: 0 };
  const known = male.count + female.count;
  const totalP = demo.total || 0;
  const knownPct = totalP ? (known / totalP * 100) : 0;
  const unknownPct = totalP ? (unknown.count / totalP * 100) : 0;
  // M/F rows: % of known (matches the dashboard and the reference rapport).
  // Known / Inconnu / Total rows stay on total as a coverage indicator.
  const malePctKnown = known ? (male.count / known * 100) : 0;
  const femalePctKnown = known ? (female.count / known * 100) : 0;
  const maleSym = t('report.gender_male_symbol');
  const femaleSym = t('report.gender_female_symbol');

  const sexTable = table([
    { cells: [`${maleSym}  ${t('demo.male')}`,
      { text: formatInt(male.count), align: 'right' },
      { text: formatPercent(malePctKnown, 2), align: 'right' }] },
    { cells: [`${femaleSym}  ${t('demo.female')}`,
      { text: formatInt(female.count), align: 'right' },
      { text: formatPercent(femalePctKnown, 2), align: 'right' }] },
    { subtle: true, cells: [t('report.known'),
      { text: formatInt(known), align: 'right' },
      { text: formatPercent(knownPct, 2), align: 'right' }] },
    { subtle: true, cells: [t('report.unknown'),
      { text: formatInt(unknown.count), align: 'right' },
      { text: formatPercent(unknownPct, 2), align: 'right' }] },
    { total: true, cells: [t('common.total'),
      { text: formatInt(totalP), align: 'right' },
      { text: '100,00%', align: 'right' }] },
  ], { head: ['', t('report.clients_count'), '%'] });

  const sexPie = pieChart([
    { label: t('demo.male'), value: male.count, color: '--indigo' },
    { label: t('demo.female'), value: female.count, color: '--pink' },
    unknown.count > 0 ? { label: t('demo.unknown'), value: unknown.count, color: '--separator' } : null,
  ].filter(Boolean), { size: 170, stroke: 36 });

  const sexLegend = h('div', { class: 'rp-legend' }, [
    h('span', { class: 'legend-dot', style: { background: 'var(--indigo)' } }),
    h('span', {}, `${maleSym} ${t('demo.male')}`),
    h('span', { class: 'legend-dot', style: { background: 'var(--pink)' } }),
    h('span', {}, `${femaleSym} ${t('demo.female')}`),
    unknown.count > 0 ? h('span', { class: 'legend-dot', style: { background: 'var(--separator)' } }) : null,
    unknown.count > 0 ? h('span', {}, t('demo.unknown')) : null,
  ]);

  // Age table: pct denominators are total P clients / total P polices so the
  // known/unknown/total rows add to 100%.
  const knownAge = demo.known_age != null
    ? demo.known_age
    : (demo.age_brackets || []).reduce((a, b) => a + (b.client_count || 0), 0);
  const unknownAge = demo.unknown_age != null
    ? demo.unknown_age
    : Math.max(0, totalP - knownAge);
  const knownPolicies = (demo.age_brackets || []).reduce((a, b) => a + (b.policy_count || 0), 0);
  const totalPolicesP = (kpi && kpi.polices_particuliers) || knownPolicies;
  const unknownPolicies = Math.max(0, totalPolicesP - knownPolicies);

  const ageRows = (demo.age_brackets || []).map((b) => {
    const emphasize = (b.label === '60-69' || b.label === '70-+');
    // Bracket % = share of the *known* population (matches the dashboard and
    // the reference rapport). Coverage % lives in the Connu / Inconnu rows
    // below. Using totalP here would understate every bracket by the
    // proportion of clients without a date of birth.
    const pctClients = knownAge ? (b.client_count / knownAge * 100) : 0;
    const pctPol = knownPolicies ? (b.policy_count / knownPolicies * 100) : 0;
    return { emphasize, cells: [
      { text: ageBracketLabel(b.label), align: 'left' },
      { text: formatInt(b.client_count), align: 'right' },
      { text: formatPercent(pctClients, 2), align: 'right' },
      { text: formatInt(b.policy_count), align: 'right' },
      { text: formatPercent(pctPol, 2), align: 'right' },
    ] };
  });
  const ageTable = table([
    ...ageRows,
    { subtle: true, cells: [t('report.known'),
      { text: formatInt(knownAge), align: 'right' },
      { text: formatPercent(totalP ? (knownAge / totalP * 100) : 0, 2), align: 'right' },
      { text: formatInt(knownPolicies), align: 'right' },
      { text: formatPercent(totalPolicesP ? (knownPolicies / totalPolicesP * 100) : 0, 2), align: 'right' }] },
    { subtle: true, cells: [t('report.unknown'),
      { text: formatInt(unknownAge), align: 'right' },
      { text: formatPercent(totalP ? (unknownAge / totalP * 100) : 0, 2), align: 'right' },
      { text: formatInt(unknownPolicies), align: 'right' },
      { text: formatPercent(totalPolicesP ? (unknownPolicies / totalPolicesP * 100) : 0, 2), align: 'right' }] },
    { total: true, cells: [t('common.total'),
      { text: formatInt(totalP), align: 'right' },
      { text: '100,00%', align: 'right' },
      { text: formatInt(totalPolicesP), align: 'right' },
      { text: '100,00%', align: 'right' }] },
  ], { head: ['', t('report.nbre_clients'), t('report.percent_age'), t('report.nbre_polices'), t('report.percent_age')] });

  return [
    subTitle(t('report.s3_sex')),
    infoText(t('report.s3_sex_info')),
    h('div', { class: 'rp-grid-2' }, [
      h('div', {}, sexTable),
      h('div', { class: 'rp-chart-wrap' }, [sexPie, sexLegend]),
    ]),
    subTitle(t('report.s3_age'), t('report.s3_age_note')),
    infoText(t('report.s3_age_info')),
    ageTable,
  ];
}

function page4(s, civil) {
  const isUnknown = (r) => /inconnu|vide/i.test(r.label);
  const totalP = civil.total || 0;

  function renderBlock(rowsSrc, titleKey, infoKey, color) {
    const knownRows = rowsSrc.filter((r) => !isUnknown(r));
    const unknownRows = rowsSrc.filter(isUnknown);
    const knownCount = knownRows.reduce((a, b) => a + b.count, 0);
    const unknownCount = unknownRows.reduce((a, b) => a + b.count, 0);
    const pctKnown = totalP ? (knownCount / totalP * 100) : 0;
    const pctUnknown = totalP ? (unknownCount / totalP * 100) : 0;

    // Row % = share of known (same rule as the dashboard). Connu / Inconnu
    // summary rows still report % of total so readers see the coverage rate.
    const tableRows = knownRows.map((r) => {
      const pctOfKnown = knownCount ? (r.count / knownCount * 100) : 0;
      return { cells: [
        r.label,
        { text: formatInt(r.count), align: 'right' },
        { text: formatPercent(pctOfKnown, 2), align: 'right' },
      ] };
    });
    const tbl = table([
      ...tableRows,
      { subtle: true, cells: [t('report.known'),
        { text: formatInt(knownCount), align: 'right' },
        { text: formatPercent(pctKnown, 2), align: 'right' }] },
      { subtle: true, cells: [t('report.unknown'),
        { text: formatInt(unknownCount), align: 'right' },
        { text: formatPercent(pctUnknown, 2), align: 'right' }] },
      { total: true, cells: [t('common.total'),
        { text: formatInt(totalP), align: 'right' }, '100,00%'] },
    ], { head: ['', t('report.clients_count'), '%'] });

    const chart = hBarChart(
      knownRows.slice(0, 9).map((r) => ({
        label: r.label,
        value: r.count,
        valueLabel: formatPercent(knownCount ? (r.count / knownCount * 100) : 0, 1),
        color,
      })),
      { width: 360, rowHeight: 18, gap: 4, labelWidth: 140 }
    );

    return [
      subTitle(t(titleKey)),
      infoText(t(infoKey)),
      h('div', { class: 'rp-grid-2' }, [
        h('div', {}, tbl),
        h('div', { class: 'rp-chart-wrap' }, chart),
      ]),
    ];
  }

  return [
    ...renderBlock(civil.civil_status, 'report.s3_civil', 'report.s3_civil_info', '--indigo'),
    ...renderBlock(civil.social_status, 'report.s3_social', 'report.s3_social_info', '--purple'),
  ];
}

// Data-quality coloring mirrors the dashboard: binary red/orange so the PDF
// and the on-screen view read the same way. Red = critical (contact fields
// that block outreach, or any field with >50% missing); orange = everything
// else. The shared hex map below is still used to tint row backgrounds and
// label text in the print tree (where we can't resolve CSS vars).
const CRITICAL_CONTACT_KEYS = new Set(['email', 'telephone', 'phone']);

function hexFromVar(cssVar) {
  // We can't resolve CSS vars without the DOM. Instead, we rely on hard-coded
  // counterparts (taken from app.css) so the tinted row background works in
  // the detached print tree too.
  const map = {
    '--indigo': '#5e5ce6',
    '--pink': '#ff2d55',
    '--purple': '#5856d6',
    '--danger': '#ff3b30',
    '--warning': '#ff9500',
    '--teal': '#5ac8fa',
    '--accent': '#007aff',
  };
  return map[cssVar] || '#999';
}

function page5(s, dq) {
  const fields = (dq.fields || []).slice().sort((a, b) => b.pct_missing - a.pct_missing);

  // Same rule as the dashboard: contact fields (email/phone) are always
  // critical; everything else is only critical once it crosses the 50%
  // missing threshold already flagged by the analyzer.
  const rowsWithColor = fields.map((f) => {
    const isContact = CRITICAL_CONTACT_KEYS.has(f.key);
    const critical = f.critical || isContact;
    const color = critical ? '--danger' : '--warning';
    return { ...f, color, critical };
  });

  const tableRows = rowsWithColor.map((f) => {
    const tint = hexFromVar(f.color);
    return {
      // Soft row tint only on critical rows, so non-critical fields don't
      // turn the whole table orange. Matches the dashboard's visual weight.
      style: f.critical ? `background: ${tint}22;` : null,
      cells: [
        { text: f.label, align: 'left', style: `color: ${tint}; font-weight: 600;` },
        { text: formatPercent(f.pct_missing, 2), align: 'right', style: f.critical ? `color: ${tint}; font-weight: 700;` : null },
      ],
    };
  });

  const chart = hBarChart(
    rowsWithColor.map((f) => ({
      label: f.label,
      value: f.pct_missing,
      valueLabel: formatPercent(f.pct_missing, 1),
      color: f.color,
    })),
    { width: 380, rowHeight: 22, gap: 6, labelWidth: 140, max: 100 }
  );

  return [
    subTitle(t('report.s4_dq')),
    infoText(t('report.s4_dq_info')),
    h('div', { class: 'rp-grid-2' }, [
      h('div', {}, table(tableRows, {
        head: [t('report.field'), t('report.pct_unknown')],
        tone: 'red',
      })),
      h('div', { class: 'rp-chart-wrap' }, chart),
    ]),
  ];
}

// Reference groups branches as: all IARD lines (non-VIE/PLA/CRED), then VIE /
// PLA / CRED individually, plus a Total IARD aggregate row. The pie chart on
// this page visualises the 4-way aggregate split IARD / Vie / Placement / Crédit.
const NON_IARD = new Set(['VIE', 'PLA', 'CRED']);

function page6(s, branches) {
  const iardBranches = (branches.branches || []).filter((b) => !NON_IARD.has(b.code));
  const vieB = (branches.branches || []).find((b) => b.code === 'VIE');
  const plaB = (branches.branches || []).find((b) => b.code === 'PLA');
  const credB = (branches.branches || []).find((b) => b.code === 'CRED');
  const iardCount = iardBranches.reduce((a, b) => a + b.count, 0);
  const total = branches.total || 0;
  const iardPct = total ? (iardCount / total * 100) : 0;

  const branchRows = iardBranches.map((b) => ({ cells: [
    branchLabel(b.code),
    { text: formatInt(b.count), align: 'right' },
    { text: formatPercent(b.pct, 2), align: 'right' },
  ] }));

  const groupRows = [
    { emphasize: true, cells: [t('report.total_iard'),
      { text: formatInt(iardCount), align: 'right' },
      { text: formatPercent(iardPct, 2), align: 'right' }] },
  ];
  if (vieB) groupRows.push({ emphasize: true, cells: [branchLabel('VIE'),
    { text: formatInt(vieB.count), align: 'right' },
    { text: formatPercent(vieB.pct, 2), align: 'right' }] });
  if (plaB) groupRows.push({ emphasize: true, cells: [branchLabel('PLA'),
    { text: formatInt(plaB.count), align: 'right' },
    { text: formatPercent(plaB.pct, 2), align: 'right' }] });
  if (credB) groupRows.push({ emphasize: true, cells: [branchLabel('CRED'),
    { text: formatInt(credB.count), align: 'right' },
    { text: formatPercent(credB.pct, 2), align: 'right' }] });
  groupRows.push({ total: true, cells: [t('report.total_policies'),
    { text: formatInt(total), align: 'right' }, '100,00%'] });

  // Bar chart: all branches listed in original order, descending by share.
  const allBranches = (branches.branches || []).slice().sort((a, b) => b.count - a.count);
  const chart = hBarChart(
    allBranches.map((b) => ({
      label: branchLabel(b.code),
      value: b.pct,
      valueLabel: formatPercent(b.pct, 1),
      color: NON_IARD.has(b.code) ? (b.code === 'VIE' ? '--pink' : b.code === 'PLA' ? '--purple' : '--warning') : '--indigo',
    })),
    { width: 360, rowHeight: 14, gap: 3, labelWidth: 110, max: Math.max(...allBranches.map((x) => x.pct), 1) }
  );

  // Pie chart: IARD / Vie / Placement / Crédit aggregate.
  const pieSegments = [
    { label: t('report.iard_legend'), value: iardCount, color: '--indigo' },
    vieB ? { label: t('report.vie_legend'), value: vieB.count, color: '--pink' } : null,
    plaB ? { label: t('report.pla_legend'), value: plaB.count, color: '--purple' } : null,
    credB ? { label: t('report.cred_legend'), value: credB.count, color: '--warning' } : null,
  ].filter(Boolean);
  const pie = pieChart(pieSegments, { size: 160, stroke: 32 });
  const pieLegend = h('div', { class: 'rp-legend' }, pieSegments.flatMap((seg) => ([
    h('span', { class: 'legend-dot', style: { background: `var(${seg.color})` } }),
    h('span', {}, `${seg.label} (${formatPercent(total ? (seg.value / total * 100) : 0, 1)})`),
  ])));

  return [
    sectionTitle(3, t('report.s5_title')),
    subTitle(t('report.s5_branches')),
    infoText(t('report.s5_branches_info')),
    h('div', { class: 'rp-grid-2' }, [
      h('div', {}, table([...branchRows, ...groupRows], { head: [t('report.branch'), t('report.policies_count'), '%'] })),
      h('div', { class: 'rp-chart-wrap' }, [pie, pieLegend, chart]),
    ]),
  ];
}

function page7(s, sub, total_clients) {
  const allSub = (sub.branches || []).slice().sort((a, b) => b.penetration - a.penetration);
  const rows = allSub.map((b) => ({ cells: [
    branchLabel(b.code),
    { text: formatInt(b.client_count), align: 'right' },
    { text: formatPercent(b.penetration, 2), align: 'right' },
  ] }));
  const footer = [
    { total: true, cells: [t('report.total_clients'),
      { text: formatInt(sub.active_clients || 0), align: 'right' }, '100,00%'] },
  ];
  const chart = hBarChart(
    allSub.map((b) => ({
      label: branchLabel(b.code),
      value: b.penetration,
      valueLabel: formatPercent(b.penetration, 1),
      color: '--indigo',
    })),
    { width: 360, rowHeight: 14, gap: 3, labelWidth: 110, max: Math.max(...allSub.map((x) => x.penetration), 1) }
  );
  return [
    subTitle(t('report.s5_subscription'), t('report.s5_subscription_note')),
    infoText(t('report.s5_subscription_info')),
    h('div', { class: 'rp-grid-2' }, [
      h('div', {}, table([...rows, ...footer], { head: [t('report.branch_present'), t('report.clients_count'), '%'], tone: 'orange' })),
      h('div', { class: 'rp-chart-wrap' }, chart),
    ]),
  ];
}

function page8(s, ppc, monoByBranch) {
  const dist = distributionRows(ppc.distribution || []);
  const distRows = dist.rows.map((r) => ({ cells: [
    r.label,
    { text: formatInt(r.count), align: 'right' },
    { text: formatPercent(r.pct, 2), align: 'right' },
  ] }));
  distRows.push({ total: true, cells: [t('common.total'),
    { text: formatInt(dist.total), align: 'right' }, '100,00%'] });

  const distChart = vBarChart(
    dist.rows.map((r) => ({
      label: r.label.split(' ')[0],
      value: r.count,
      valueLabel: formatInt(r.count),
      color: '--indigo',
    })),
    { width: 280, height: 170 }
  );

  const monoTotal = (monoByBranch || []).reduce((a, b) => a + b.count, 0);
  const monoRows = (monoByBranch || []).map((m) => ({ cells: [
    branchLabel(m.branch),
    { text: formatInt(m.count), align: 'right' },
    { text: formatPercent(monoTotal ? (m.count / monoTotal * 100) : 0, 2), align: 'right' },
  ] }));
  monoRows.push({ total: true, cells: [t('report.total_mono'),
    { text: formatInt(monoTotal), align: 'right' }, '100,00%'] });

  return [
    subTitle(t('report.s5_distribution')),
    infoText(t('report.s5_distribution_info')),
    h('div', { class: 'rp-grid-2' }, [
      h('div', {}, table(distRows, { head: [t('common.total'), t('report.clients_count'), '%'] })),
      h('div', { class: 'rp-chart-wrap' }, distChart),
    ]),
    subTitle(t('report.s5_mono_detail')),
    infoText(t('report.s5_mono_detail_info')),
    table(monoRows, { head: [t('report.branch'), t('report.clients_count'), '%'] }),
  ];
}

function page9(s, companies) {
  const rows = (companies.companies || []).map((c) => ({ cells: [
    c.name,
    { text: formatInt(c.count), align: 'right' },
    { text: formatPercent(c.pct, 2), align: 'right' },
  ] }));
  rows.push({ total: true, cells: [t('common.total'),
    { text: formatInt(companies.total || 0), align: 'right' }, '100,00%'] });
  return [
    subTitle(t('report.s5_companies')),
    infoText(t('report.s5_companies_info')),
    table(rows, { head: [t('report.company'), t('report.policies_count'), '%'], tone: 'blue' }),
  ];
}

function page10(s, stats, ratioSeries, locale) {
  // Build the ratios block with one column per snapshot. ratioSeries is
  // [current, prior1, prior2] (fewer if not enough history). The single-stats
  // fallback keeps older callers (and unit tests) working.
  const series = ratioSeries && ratioSeries.length
    ? ratioSeries
    : [{ stats, snapshot: s }];
  const { rows, columns, boxes: ratiosBoxes } = buildRatiosSummary(series, { locale });

  // Head row: "Particuliers et entreprises" on the left, then one header per
  // column. The current column is tinted (yellow in the reference rapport).
  const head = [
    { text: t('report.ratio.column'), align: 'left' },
    ...columns.map((c) => ({ text: c.label, align: 'right', isCurrent: c.isCurrent })),
  ];

  const leftRows = rows.map((r) => ({
    cells: [
      r.label,
      ...r.values.map((v, i) => ({
        text: v.pct != null
          ? ratioValueWithPct(v.rawValue, v.rawPct)
          : v.value,
        align: 'right',
        isCurrent: columns[i]?.isCurrent,
      })),
    ],
  }));

  // Summary side boxes (households).
  const boxes = h('div', { class: 'rp-summary-boxes' }, [
    h('div', { class: 'rp-summary-box' }, [
      h('div', { class: 'rp-summary-box-head' }, ratiosBoxes.total_menages.label),
      h('div', { class: 'rp-summary-box-value' }, ratiosBoxes.total_menages.value),
    ]),
    h('div', { class: 'rp-summary-box' }, [
      h('div', { class: 'rp-summary-box-head' }, ratiosBoxes.menages_mono.label),
      h('div', { class: 'rp-summary-box-value' }, ratiosBoxes.menages_mono.value),
      h('div', { class: 'rp-summary-box-sub' }, ratiosBoxes.menages_mono.sub),
    ]),
  ]);

  return [
    sectionTitle(4, t('report.s6_title')),
    infoText(t('report.s6_info')),
    h('div', { class: 'rp-grid-summary' }, [
      h('div', {}, table(leftRows, { head, tone: 'blue' })),
      h('div', {}, boxes),
    ]),
  ];
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function renderReport(container, ctx, snapshot, stats, opts = {}) {
  const brand = snapshot.label || t('app.title');
  const ppcMono = stats.policies_per_client?.mono_policy || [];
  const ratioSeries = opts.ratioSeries || [{ stats, snapshot }];

  const pages = [
    page(1, snapshot, brand, page1(snapshot, stats.overview)),
    page(2, snapshot, brand, page2(snapshot, stats.geographic)),
    page(3, snapshot, brand, page3(snapshot, stats.demographics, stats.kpi_summary)),
    page(4, snapshot, brand, page4(snapshot, stats.civil_social)),
    page(5, snapshot, brand, page5(snapshot, stats.data_quality)),
    page(6, snapshot, brand, page6(snapshot, stats.branches)),
    page(7, snapshot, brand, page7(snapshot, stats.subscription, stats.overview.active_clients)),
    page(8, snapshot, brand, page8(snapshot, stats.policies_per_client, ppcMono)),
    page(9, snapshot, brand, page9(snapshot, stats.companies)),
    page(10, snapshot, brand, page10(snapshot, stats, ratioSeries, ctx?.locale)),
  ];

  mount(container, h('div', { class: 'rp-report' }, pages));
}

// Format a date as YYYY-MM-DD for filename use. Mirrors formatIsoDay in
// xlsx_export.js but kept local to avoid a circular import.
function isoDay(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  if (Number.isNaN(d.valueOf())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Trigger the browser print dialog with the report visible. Optionally takes
// the snapshot so we can override document.title — browsers use that as the
// default "Save as PDF" filename, which is the only portable handle we have
// into the print dialog. Title is restored after the print dialog settles.
export function printReport(snapshot) {
  const html = document.documentElement;
  const prevTitle = document.title;
  if (snapshot) {
    // Use only the snapshot date in the default save-as name. The label is a
    // broker-chosen string (e.g. "Dossche") that shouldn't leak into shared
    // PDF filenames.
    const iso = isoDay(snapshot.snapshot_date);
    const base = t('report.title') || 'Portfolio report';
    document.title = iso ? `${base} ${iso}` : base;
  }
  html.setAttribute('data-print-mode', 'report');
  requestAnimationFrame(() => {
    window.print();
    setTimeout(() => {
      html.removeAttribute('data-print-mode');
      if (snapshot) document.title = prevTitle;
    }, 500);
  });
}
