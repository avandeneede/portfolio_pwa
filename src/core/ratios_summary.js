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
  // Each row also carries `rawValue` (and `rawPct` where applicable) so the
  // Evolution screen can compute snapshot-to-snapshot deltas without parsing
  // the formatted strings back to numbers.
  const pctP = ov.active_clients ? (ov.active_particuliers / ov.active_clients * 100) : 0;
  const pctE = ov.active_clients ? (ov.active_entreprises / ov.active_clients * 100) : 0;
  const sexKnown = pctKnown('sexe');
  const ageKnown = pctKnown('date_naissance');
  const socKnown = pctKnown('statut_social');
  const civKnown = pctKnown('etat_civil');
  const telKnown = pctKnown('telephone');
  const emlKnown = pctKnown('email');
  const totalPrime = hasPremium ? (kpi.total_premium || 0) : null;
  const primePerClient = hasPremium ? (kpi.avg_premium_per_client || 0) : null;
  const primePerPolicy = hasPremium && kpi.total_polices
    ? Math.round((kpi.total_premium || 0) / kpi.total_polices) : null;
  const totalCommission = hasCommissions ? (kpi.total_commission || 0) : null;
  const commissionPerClient = hasCommissions ? (kpi.avg_commission_per_client || 0) : null;
  const commissionPerPolicy = hasCommissions && kpi.total_polices
    ? Math.round((kpi.total_commission || 0) / kpi.total_polices) : null;

  return {
    total_with_police: { value: formatInt(ov.active_clients), rawValue: ov.active_clients || 0 },
    pct_particuliers: { value: formatPercent(pctP, 2), rawValue: pctP },
    pct_entreprises: { value: formatPercent(pctE, 2), rawValue: pctE },
    pct_p_60plus: { value: formatPercent(pct_clients_60plus, 2), rawValue: pct_clients_60plus },
    pct_policies_60plus: { value: formatPercent(pct_policies_60plus, 2), rawValue: pct_policies_60plus },
    pct_sex_known: { value: formatPercent(sexKnown, 2), rawValue: sexKnown },
    pct_age_known: { value: formatPercent(ageKnown, 2), rawValue: ageKnown },
    pct_social_known: { value: formatPercent(socKnown, 2), rawValue: socKnown },
    pct_civil_known: { value: formatPercent(civKnown, 2), rawValue: civKnown },
    pct_phone_known: { value: formatPercent(telKnown, 2), rawValue: telKnown },
    pct_email_known: { value: formatPercent(emlKnown, 2), rawValue: emlKnown },
    mono_count: { value: formatInt(kpi.mono_policy_clients), rawValue: kpi.mono_policy_clients || 0 },
    pct_mono: { value: formatPercent(pct_mono, 2), rawValue: pct_mono },
    pct_bi: { value: formatPercent(pct_bi, 2), rawValue: pct_bi },
    pct_5plus: { value: formatPercent(pct_5plus, 2), rawValue: pct_5plus },
    total_policies: { value: formatInt(kpi.total_polices), rawValue: kpi.total_polices || 0 },
    // Split into count + pct rows: showing both numbers in a single cell read
    // as "two values" and confused brokers. Each metric now has its own row,
    // matching the layout used for the rest of the table.
    polices_p: {
      value: formatInt(kpi.polices_particuliers || 0),
      rawValue: kpi.polices_particuliers || 0,
    },
    polices_e: {
      value: formatInt(kpi.polices_entreprises || 0),
      rawValue: kpi.polices_entreprises || 0,
    },
    pct_polices_p: { value: formatPercent(pct_polices_p, 2), rawValue: pct_polices_p },
    pct_polices_e: { value: formatPercent(pct_polices_e, 2), rawValue: pct_polices_e },
    avg_policies_per_client: { value: formatDecimal(kpi.avg_polices_per_client || 0, 2), rawValue: kpi.avg_polices_per_client || 0 },
    avg_polices_p: { value: formatDecimal(kpi.avg_polices_per_client_p || 0, 2), rawValue: kpi.avg_polices_per_client_p || 0 },
    avg_polices_e: { value: formatDecimal(kpi.avg_polices_per_client_e || 0, 2), rawValue: kpi.avg_polices_per_client_e || 0 },
    pct_vie: { value: formatPercent(pct_vie_all, 2), rawValue: pct_vie_all },
    pct_auto: { value: formatPercent(pct_auto, 2), rawValue: pct_auto },
    pct_incendie_pkg: { value: formatPercent(incendiePackageP, 2), rawValue: incendiePackageP },
    total_prime: { value: hasPremium ? formatInt(totalPrime) : naLabel, rawValue: totalPrime },
    prime_per_client: { value: hasPremium ? formatInt(primePerClient) : naLabel, rawValue: primePerClient },
    prime_per_policy: { value: primePerPolicy != null ? formatInt(primePerPolicy) : naLabel, rawValue: primePerPolicy },
    total_commission: { value: hasCommissions ? formatInt(totalCommission) : naLabel, rawValue: totalCommission },
    commission_per_client: { value: hasCommissions ? formatInt(commissionPerClient) : naLabel, rawValue: commissionPerClient },
    commission_per_policy: { value: commissionPerPolicy != null ? formatInt(commissionPerPolicy) : naLabel, rawValue: commissionPerPolicy },
    nb_sinistres: { value: formatInt(nSinistres), rawValue: nSinistres, year: kpi.sinistre_year || null },
    freq_sinistres: { value: formatPercent(freq_sinistres, 2), rawValue: freq_sinistres },
    // Also surface boxes (household totals) per snapshot.
    _box_total_menages: { value: formatInt(kpi.total_menages || 0) },
    _box_menages_mono: {
      value: formatInt(kpi.menages_mono_police || 0),
      sub: formatPercent(pct_menages_mono, 2),
    },
  };
}

// Row descriptors — id + localised label + section group. Order matches the
// reference rapport, but rows are now grouped into 9 thematic sections so the
// table reads top-to-bottom as a story (overview → demographics → data
// quality → multi-equipment → policies → product mix → premiums →
// commissions → claims). Renderers use the `section` field to inject section
// header rows between groups.
function rowDescriptors() {
  return [
    { key: 'total_with_police', section: 'overview', label: t('report.ratio.total_with_police') },
    { key: 'pct_particuliers', section: 'overview', label: t('report.ratio.pct_particuliers') },
    { key: 'pct_entreprises', section: 'overview', label: t('report.ratio.pct_entreprises') },
    { key: 'pct_p_60plus', section: 'demographics', label: t('report.ratio.pct_p_60plus') },
    { key: 'pct_policies_60plus', section: 'demographics', label: t('report.ratio.pct_policies_60plus') },
    { key: 'pct_sex_known', section: 'data_quality', label: t('report.ratio.pct_sex_known') },
    { key: 'pct_age_known', section: 'data_quality', label: t('report.ratio.pct_age_known') },
    { key: 'pct_social_known', section: 'data_quality', label: t('report.ratio.pct_social_known') },
    { key: 'pct_civil_known', section: 'data_quality', label: t('report.ratio.pct_civil_known') },
    { key: 'pct_phone_known', section: 'data_quality', label: t('report.ratio.pct_phone_known') },
    { key: 'pct_email_known', section: 'data_quality', label: t('report.ratio.pct_email_known') },
    { key: 'mono_count', section: 'multi_equipment', label: t('report.ratio.mono_count') },
    { key: 'pct_mono', section: 'multi_equipment', label: t('report.ratio.pct_mono') },
    { key: 'pct_bi', section: 'multi_equipment', label: t('report.ratio.pct_bi') },
    { key: 'pct_5plus', section: 'multi_equipment', label: t('report.ratio.pct_5plus') },
    { key: 'total_policies', section: 'policies', label: t('report.ratio.total_policies') },
    { key: 'polices_p', section: 'policies', label: t('report.ratio.polices_p') },
    { key: 'pct_polices_p', section: 'policies', label: t('report.ratio.pct_polices_p') },
    { key: 'polices_e', section: 'policies', label: t('report.ratio.polices_e') },
    { key: 'pct_polices_e', section: 'policies', label: t('report.ratio.pct_polices_e') },
    { key: 'avg_policies_per_client', section: 'policies', label: t('report.ratio.avg_policies_per_client') },
    { key: 'avg_polices_p', section: 'policies', label: t('report.ratio.avg_polices_p') },
    { key: 'avg_polices_e', section: 'policies', label: t('report.ratio.avg_polices_e') },
    { key: 'pct_vie', section: 'product_mix', label: t('report.ratio.pct_vie') },
    { key: 'pct_auto', section: 'product_mix', label: t('report.ratio.pct_auto') },
    { key: 'pct_incendie_pkg', section: 'product_mix', label: t('report.ratio.pct_incendie_pkg') },
    { key: 'total_prime', section: 'premiums', label: t('report.ratio.total_prime') },
    { key: 'prime_per_client', section: 'premiums', label: t('report.ratio.prime_per_client') },
    { key: 'prime_per_policy', section: 'premiums', label: t('report.ratio.prime_per_policy') },
    { key: 'total_commission', section: 'commissions', label: t('report.ratio.total_commission') },
    { key: 'commission_per_client', section: 'commissions', label: t('report.ratio.commission_per_client') },
    { key: 'commission_per_policy', section: 'commissions', label: t('report.ratio.commission_per_policy') },
    { key: 'nb_sinistres', section: 'claims', label: t('report.ratio.nb_sinistres'), isSinistreYear: true },
    { key: 'freq_sinistres', section: 'claims', label: t('report.ratio.freq_sinistres') },
  ];
}

// Localised section title for the renderer to inject between row groups.
export function ratioSectionTitle(key) {
  return t(`report.ratio.section.${key}`);
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

  // For the sinistres row, expose the current snapshot's reference year as a
  // separate property so renderers can show it as a small subtitle (e.g.
  // "Nombre de sinistres année précédente · 2018"). Previously we suffixed
  // the year onto the label which made the row feel like "sinistres 2018"
  // rather than "previous year (2018)".
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
    // Flatten column-0 onto the row so older single-column callers still work.
    const first = values[0] || { value: '—' };
    const row = {
      key: d.key,
      section: d.section,
      label: d.label,
      value: first.value,
      pct: first.pct,
      rawValue: first.rawValue,
      rawPct: first.rawPct,
      values,
    };
    if (d.isSinistreYear && sinYear) row.year = sinYear;
    return row;
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
