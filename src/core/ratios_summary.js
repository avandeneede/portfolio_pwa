// Shared builder for the "Tableau résumé des principaux ratios" block.
// Used by the print report (page 10) and the dashboard (as a dedicated
// section) so both surfaces show the exact same numbers.
//
// Accepts an ordered list of snapshots (current first, then historical) and
// returns one column per snapshot so the broker can compare the current
// portfolio against prior years on the same row layout. This mirrors the
// 2022-onwards reference rapport, which added "2021" and "2019" side columns
// to the single-column table from the 2019 reference.
//
// The helper returns plain strings (already translated + formatted). Each
// consumer renders them into its own table idiom; the polices_p / polices_e
// rows carry both a raw count and raw pct so callers can display them with
// extra spacing between the two numbers if desired.

import { t } from '../i18n/index.js';
import { formatInt, formatDecimal, formatPercent, formatMonthYear } from '../ui/format.js';

// Compute the value set for one snapshot's stats. Keyed so the builder can
// stitch multiple snapshots into a row-aligned table.
function computeValuesFor(stats) {
  const kpi = stats.kpi_summary;
  const ov = stats.overview;
  const demo = stats.demographics;
  const ppc = stats.policies_per_client;

  const dq = {};
  for (const f of stats.data_quality.fields) dq[f.key] = f;

  const byBranch = {};
  for (const b of stats.branches.branches) byBranch[b.code] = b;

  const pctKnown = (k) => {
    const f = dq[k];
    if (!f) return 0;
    const tot = f.known + f.missing;
    return tot ? (f.known / tot * 100) : 0;
  };

  let clients60plus = 0;
  let policies60plus = 0;
  for (const b of demo.age_brackets || []) {
    if (b.label === '60-69' || b.label === '70-+') {
      clients60plus += b.client_count;
      policies60plus += b.policy_count;
    }
  }
  const totalPoliciesInBrackets = (demo.age_brackets || []).reduce((a, b) => a + b.policy_count, 0) || 1;
  const denom60 = demo.known_age || demo.total || 1;
  const pct_clients_60plus = clients60plus / denom60 * 100;
  const pct_policies_60plus = totalPoliciesInBrackets ? (policies60plus / totalPoliciesInBrackets * 100) : 0;

  const distCount = (label) => (ppc.distribution.find((d) => d.label === label) || { count: 0 }).count;
  const active = ov.active_clients || 1;
  const pct_mono = distCount('1') / active * 100;
  const pct_bi = distCount('2') / active * 100;
  const pct_5plus = distCount('5+') / active * 100;

  const freq_sinistres = kpi.total_polices
    ? (kpi.total_sinistres / kpi.total_polices * 100)
    : 0;

  const pct_polices_p = kpi.total_polices
    ? (kpi.polices_particuliers / kpi.total_polices * 100) : 0;
  const pct_polices_e = kpi.total_polices
    ? (kpi.polices_entreprises / kpi.total_polices * 100) : 0;

  const pct_menages_mono = kpi.total_menages
    ? (kpi.menages_mono_police / kpi.total_menages * 100) : 0;

  const hasPremium = (kpi.total_premium || 0) > 0;
  const hasCommissions = (kpi.total_commission || 0) > 0;
  const naLabel = t('common.not_available');
  const nSinistres = kpi.total_sinistres || 0;

  const totalPol = kpi.total_polices || 1;
  const countOf = (code) => (byBranch[code]?.count || 0);
  const pct_vie_all = (countOf('VIE') + countOf('PLA') + countOf('CRED')) / totalPol * 100;
  const pct_auto = countOf('AUT') / totalPol * 100;
  const incendiePackageP = (countOf('INC') + countOf('PACP')) / totalPol * 100;

  // Values keyed by row id. Kept flat so the row-descriptor array below can
  // zip label + values across multiple snapshots without re-doing math.
  return {
    total_with_police: { value: formatInt(ov.active_clients) },
    pct_particuliers: { value: formatPercent(ov.active_clients ? (ov.active_particuliers / ov.active_clients * 100) : 0, 2) },
    pct_entreprises: { value: formatPercent(ov.active_clients ? (ov.active_entreprises / ov.active_clients * 100) : 0, 2) },
    pct_p_60plus: { value: formatPercent(pct_clients_60plus, 2) },
    pct_policies_60plus: { value: formatPercent(pct_policies_60plus, 2) },
    pct_sex_known: { value: formatPercent(pctKnown('sexe'), 2) },
    pct_age_known: { value: formatPercent(pctKnown('date_naissance'), 2) },
    pct_social_known: { value: formatPercent(pctKnown('statut_social'), 2) },
    pct_civil_known: { value: formatPercent(pctKnown('etat_civil'), 2) },
    pct_phone_known: { value: formatPercent(pctKnown('telephone'), 2) },
    pct_email_known: { value: formatPercent(pctKnown('email'), 2) },
    mono_count: { value: formatInt(kpi.mono_policy_clients) },
    pct_mono: { value: formatPercent(pct_mono, 2) },
    pct_bi: { value: formatPercent(pct_bi, 2) },
    pct_5plus: { value: formatPercent(pct_5plus, 2) },
    total_policies: { value: formatInt(kpi.total_polices) },
    polices_p: {
      value: formatInt(kpi.polices_particuliers || 0),
      pct: formatPercent(pct_polices_p, 2),
      rawValue: kpi.polices_particuliers || 0,
      rawPct: pct_polices_p,
    },
    polices_e: {
      value: formatInt(kpi.polices_entreprises || 0),
      pct: formatPercent(pct_polices_e, 2),
      rawValue: kpi.polices_entreprises || 0,
      rawPct: pct_polices_e,
    },
    avg_policies_per_client: { value: formatDecimal(kpi.avg_polices_per_client || 0, 2) },
    avg_polices_p: { value: formatDecimal(kpi.avg_polices_per_client_p || 0, 2) },
    avg_polices_e: { value: formatDecimal(kpi.avg_polices_per_client_e || 0, 2) },
    pct_vie: { value: formatPercent(pct_vie_all, 2) },
    pct_auto: { value: formatPercent(pct_auto, 2) },
    pct_incendie_pkg: { value: formatPercent(incendiePackageP, 2) },
    total_prime: { value: hasPremium ? formatInt(kpi.total_premium) : naLabel },
    prime_per_client: { value: hasPremium ? formatInt(kpi.avg_premium_per_client) : naLabel },
    prime_per_policy: { value: hasPremium && kpi.total_polices ? formatInt(Math.round(kpi.total_premium / kpi.total_polices)) : naLabel },
    total_commission: { value: hasCommissions ? formatInt(kpi.total_commission) : naLabel },
    commission_per_client: { value: hasCommissions ? formatInt(kpi.avg_commission_per_client) : naLabel },
    commission_per_policy: { value: hasCommissions && kpi.total_polices ? formatInt(Math.round(kpi.total_commission / kpi.total_polices)) : naLabel },
    nb_sinistres: { value: formatInt(nSinistres), year: kpi.sinistre_year || null },
    freq_sinistres: { value: formatPercent(freq_sinistres, 2) },
    // Also surface boxes (household totals) per snapshot.
    _box_total_menages: { value: formatInt(kpi.total_menages || 0) },
    _box_menages_mono: {
      value: formatInt(kpi.menages_mono_police || 0),
      sub: formatPercent(pct_menages_mono, 2),
    },
  };
}

// Row descriptors — id + localised label. Order matches the reference rapport.
// Same layout that used to be inlined in the builder; lifted here so we can
// zip it against N columns of values.
function rowDescriptors() {
  return [
    { key: 'total_with_police', label: t('report.ratio.total_with_police') },
    { key: 'pct_particuliers', label: t('report.ratio.pct_particuliers') },
    { key: 'pct_entreprises', label: t('report.ratio.pct_entreprises') },
    { key: 'pct_p_60plus', label: t('report.ratio.pct_p_60plus') },
    { key: 'pct_policies_60plus', label: t('report.ratio.pct_policies_60plus') },
    { key: 'pct_sex_known', label: t('report.ratio.pct_sex_known') },
    { key: 'pct_age_known', label: t('report.ratio.pct_age_known') },
    { key: 'pct_social_known', label: t('report.ratio.pct_social_known') },
    { key: 'pct_civil_known', label: t('report.ratio.pct_civil_known') },
    { key: 'pct_phone_known', label: t('report.ratio.pct_phone_known') },
    { key: 'pct_email_known', label: t('report.ratio.pct_email_known') },
    { key: 'mono_count', label: t('report.ratio.mono_count') },
    { key: 'pct_mono', label: t('report.ratio.pct_mono') },
    { key: 'pct_bi', label: t('report.ratio.pct_bi') },
    { key: 'pct_5plus', label: t('report.ratio.pct_5plus') },
    { key: 'total_policies', label: t('report.ratio.total_policies') },
    { key: 'polices_p', label: t('report.ratio.polices_p'), isPoliciesSplit: true },
    { key: 'polices_e', label: t('report.ratio.polices_e'), isPoliciesSplit: true },
    { key: 'avg_policies_per_client', label: t('report.ratio.avg_policies_per_client') },
    { key: 'avg_polices_p', label: t('report.ratio.avg_polices_p') },
    { key: 'avg_polices_e', label: t('report.ratio.avg_polices_e') },
    { key: 'pct_vie', label: t('report.ratio.pct_vie') },
    { key: 'pct_auto', label: t('report.ratio.pct_auto') },
    { key: 'pct_incendie_pkg', label: t('report.ratio.pct_incendie_pkg') },
    { key: 'total_prime', label: t('report.ratio.total_prime') },
    { key: 'prime_per_client', label: t('report.ratio.prime_per_client') },
    { key: 'prime_per_policy', label: t('report.ratio.prime_per_policy') },
    { key: 'total_commission', label: t('report.ratio.total_commission') },
    { key: 'commission_per_client', label: t('report.ratio.commission_per_client') },
    { key: 'commission_per_policy', label: t('report.ratio.commission_per_policy') },
    { key: 'nb_sinistres', label: t('report.ratio.nb_sinistres'), isSinistreYear: true },
    { key: 'freq_sinistres', label: t('report.ratio.freq_sinistres') },
  ];
}

// Accepts either a single stats object (legacy single-column usage) or an
// ordered list of { stats, snapshot } where snapshot[0] is "current".
// Returns { columns, rows, boxes }:
//   - columns: [{label, key, isCurrent}] — one per snapshot
//   - rows: [{key, label, values: [{value, pct?, rawValue?, rawPct?}, ...]}]
//       The "single-column" shape is preserved by additionally exposing
//       row.value/row.pct/row.rawValue/row.rawPct on each row from column 0,
//       so older callers keep working without a branch.
//   - boxes: { total_menages, menages_mono } — from current snapshot only.
export function buildRatiosSummary(arg, opts = {}) {
  const series = normalizeSeries(arg);
  const locale = opts.locale;

  const columns = series.map((s, i) => {
    const snap = s.snapshot || {};
    const isCurrent = i === 0;
    const base = snap.snapshot_date
      ? formatMonthYear(snap.snapshot_date, locale)
      : (isCurrent ? t('report.ratio.global') : `#${i}`);
    // Match the 2022 reference rapport: the current column is prefixed with
    // "Portefeuille" so it reads as "today's portfolio" rather than just a
    // date. History columns keep the bare date so they don't distract.
    const label = isCurrent && snap.snapshot_date
      ? `${t('report.ratio.current_prefix')} ${base.toLowerCase()}`
      : base;
    return { key: `col-${i}`, label, isCurrent, snapshot_date: snap.snapshot_date || null };
  });

  const valuesByCol = series.map((s) => computeValuesFor(s.stats));
  const primary = valuesByCol[0];
  const descriptors = rowDescriptors();

  // For the sinistres row, the label carries the current snapshot's reference
  // year (analyzer exposes `sinistre_year`). Keeps parity with the reference
  // rapport, where the row reads "Nombre de sinistres 2020" under the 2022
  // column header.
  const sinYear = primary.nb_sinistres?.year;

  const rows = descriptors.map((d) => {
    const values = valuesByCol.map((vbc) => {
      const v = vbc[d.key] || { value: '—' };
      // Shape returned per-column.
      return {
        value: v.value,
        pct: v.pct || null,
        rawValue: v.rawValue ?? null,
        rawPct: v.rawPct ?? null,
      };
    });
    const label = d.isSinistreYear && sinYear
      ? `${d.label} ${sinYear}`
      : d.label;
    // Flatten column-0 onto the row so older single-column callers still work.
    const first = values[0] || { value: '—' };
    return {
      key: d.key,
      label,
      value: first.value,
      pct: first.pct,
      rawValue: first.rawValue,
      rawPct: first.rawPct,
      values,
    };
  });

  const boxes = {
    total_menages: {
      label: t('report.ratio.total_menages'),
      value: primary._box_total_menages?.value || '0',
    },
    menages_mono: {
      label: t('report.ratio.menages_mono'),
      value: primary._box_menages_mono?.value || '0',
      sub: (primary._box_menages_mono?.sub || '0%') + ' ' + t('report.ratio.pct_menages_mono').toLowerCase(),
    },
  };

  return { columns, rows, boxes };
}

// Accept either the old single-stats arg or the new [{stats, snapshot}, …]
// shape. Keeps upstream callers that pre-date the multi-column work working.
function normalizeSeries(arg) {
  if (Array.isArray(arg)) return arg.filter((s) => s && s.stats);
  if (arg && arg.kpi_summary) return [{ stats: arg, snapshot: null }];
  return [];
}
