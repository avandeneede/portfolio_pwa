// Shared builder for the "Tableau résumé des principaux ratios" block.
// Used by the print report (page 10) and the dashboard (as a dedicated
// section) so both surfaces show the exact same numbers.
//
// The helper returns plain strings (already translated + formatted). Each
// consumer renders them into its own table idiom; the polices_p / polices_e
// rows carry both a raw count and raw pct so callers can display them with
// extra spacing between the two numbers if desired.

import { t } from '../i18n/index.js';
import { formatInt, formatDecimal, formatPercent } from '../ui/format.js';

export function buildRatiosSummary(stats) {
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
  const sinistreYearLabel = kpi.sinistre_year
    ? `${t('report.ratio.nb_sinistres')} ${kpi.sinistre_year}`
    : t('report.ratio.nb_sinistres');

  const totalPol = kpi.total_polices || 1;
  const countOf = (code) => (byBranch[code]?.count || 0);
  const pct_vie_all = (countOf('VIE') + countOf('PLA') + countOf('CRED')) / totalPol * 100;
  const pct_auto = countOf('AUT') / totalPol * 100;
  const incendiePackageP = (countOf('INC') + countOf('PACP')) / totalPol * 100;

  const rows = [
    { key: 'total_with_police', label: t('report.ratio.total_with_police'), value: formatInt(ov.active_clients) },
    { key: 'pct_particuliers', label: t('report.ratio.pct_particuliers'), value: formatPercent(ov.active_clients ? (ov.active_particuliers / ov.active_clients * 100) : 0, 2) },
    { key: 'pct_entreprises', label: t('report.ratio.pct_entreprises'), value: formatPercent(ov.active_clients ? (ov.active_entreprises / ov.active_clients * 100) : 0, 2) },
    { key: 'pct_p_60plus', label: t('report.ratio.pct_p_60plus'), value: formatPercent(pct_clients_60plus, 2) },
    { key: 'pct_policies_60plus', label: t('report.ratio.pct_policies_60plus'), value: formatPercent(pct_policies_60plus, 2) },
    { key: 'pct_sex_known', label: t('report.ratio.pct_sex_known'), value: formatPercent(pctKnown('sexe'), 2) },
    { key: 'pct_age_known', label: t('report.ratio.pct_age_known'), value: formatPercent(pctKnown('date_naissance'), 2) },
    { key: 'pct_social_known', label: t('report.ratio.pct_social_known'), value: formatPercent(pctKnown('statut_social'), 2) },
    { key: 'pct_civil_known', label: t('report.ratio.pct_civil_known'), value: formatPercent(pctKnown('etat_civil'), 2) },
    { key: 'pct_phone_known', label: t('report.ratio.pct_phone_known'), value: formatPercent(pctKnown('telephone'), 2) },
    { key: 'pct_email_known', label: t('report.ratio.pct_email_known'), value: formatPercent(pctKnown('email'), 2) },
    { key: 'mono_count', label: t('report.ratio.mono_count'), value: formatInt(kpi.mono_policy_clients) },
    { key: 'pct_mono', label: t('report.ratio.pct_mono'), value: formatPercent(pct_mono, 2) },
    { key: 'pct_bi', label: t('report.ratio.pct_bi'), value: formatPercent(pct_bi, 2) },
    { key: 'pct_5plus', label: t('report.ratio.pct_5plus'), value: formatPercent(pct_5plus, 2) },
    { key: 'total_policies', label: t('report.ratio.total_policies'), value: formatInt(kpi.total_polices) },
    {
      key: 'polices_p',
      label: t('report.ratio.polices_p'),
      value: formatInt(kpi.polices_particuliers || 0),
      pct: formatPercent(pct_polices_p, 2),
      rawValue: kpi.polices_particuliers || 0,
      rawPct: pct_polices_p,
    },
    {
      key: 'polices_e',
      label: t('report.ratio.polices_e'),
      value: formatInt(kpi.polices_entreprises || 0),
      pct: formatPercent(pct_polices_e, 2),
      rawValue: kpi.polices_entreprises || 0,
      rawPct: pct_polices_e,
    },
    { key: 'avg_policies_per_client', label: t('report.ratio.avg_policies_per_client'), value: formatDecimal(kpi.avg_polices_per_client || 0, 2) },
    { key: 'avg_polices_p', label: t('report.ratio.avg_polices_p'), value: formatDecimal(kpi.avg_polices_per_client_p || 0, 2) },
    { key: 'avg_polices_e', label: t('report.ratio.avg_polices_e'), value: formatDecimal(kpi.avg_polices_per_client_e || 0, 2) },
    { key: 'pct_vie', label: t('report.ratio.pct_vie'), value: formatPercent(pct_vie_all, 2) },
    { key: 'pct_auto', label: t('report.ratio.pct_auto'), value: formatPercent(pct_auto, 2) },
    { key: 'pct_incendie_pkg', label: t('report.ratio.pct_incendie_pkg'), value: formatPercent(incendiePackageP, 2) },
    { key: 'total_prime', label: t('report.ratio.total_prime'), value: hasPremium ? formatInt(kpi.total_premium) : naLabel },
    { key: 'prime_per_client', label: t('report.ratio.prime_per_client'), value: hasPremium ? formatInt(kpi.avg_premium_per_client) : naLabel },
    { key: 'prime_per_policy', label: t('report.ratio.prime_per_policy'), value: hasPremium && kpi.total_polices ? formatInt(Math.round(kpi.total_premium / kpi.total_polices)) : naLabel },
    { key: 'total_commission', label: t('report.ratio.total_commission'), value: hasCommissions ? formatInt(kpi.total_commission) : naLabel },
    { key: 'commission_per_client', label: t('report.ratio.commission_per_client'), value: hasCommissions ? formatInt(kpi.avg_commission_per_client) : naLabel },
    { key: 'commission_per_policy', label: t('report.ratio.commission_per_policy'), value: hasCommissions && kpi.total_polices ? formatInt(Math.round(kpi.total_commission / kpi.total_polices)) : naLabel },
    { key: 'nb_sinistres', label: sinistreYearLabel, value: formatInt(nSinistres) },
    { key: 'freq_sinistres', label: t('report.ratio.freq_sinistres'), value: formatPercent(freq_sinistres, 2) },
  ];

  const boxes = {
    total_menages: {
      label: t('report.ratio.total_menages'),
      value: formatInt(kpi.total_menages || 0),
    },
    menages_mono: {
      label: t('report.ratio.menages_mono'),
      value: formatInt(kpi.menages_mono_police || 0),
      sub: formatPercent(pct_menages_mono, 2) + ' ' + t('report.ratio.pct_menages_mono').toLowerCase(),
    },
  };

  return { rows, boxes };
}
