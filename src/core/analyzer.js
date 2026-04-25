// Pure computation functions for portfolio analysis.
// Port of reference/analyzer.py. No I/O, no imports beyond branch_mapping.
// All functions take plain data (arrays of plain objects) and return plain data.
//
// Parity invariant: this file's output must match reference/analyzer.py
// byte-for-byte after JSON serialization with sorted keys. See
// tests/parity/run.mjs.
//
// Branch index plumbing: Python uses module-level BRANCH_MAPPING/BRANCH_REVERSE
// loaded at import time. This JS port threads a `branchIndex` parameter through
// every function that needs it — cleaner, testable, works in any runtime.

import { getBranchCode } from './branch_mapping.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Python 3's round() uses banker's rounding (round half to even).
// JS Math.round uses round half away from zero. They diverge on exact halves.
export function pyRound(x, ndigits = 0) {
  if (!Number.isFinite(x)) return x;
  const factor = Math.pow(10, ndigits);
  const shifted = x * factor;
  const floor = Math.floor(shifted);
  const diff = shifted - floor;
  let rounded;
  if (diff > 0.5) rounded = floor + 1;
  else if (diff < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1;
  return rounded / factor;
}

function counterInc(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

// Parse a date_naissance into a 4-digit year. Tolerant of every shape a broker
// export (or an SQLite round-trip) has thrown at us so far:
//   - null / ""                                              → null
//   - Date instance                                          → UTC year
//   - { year: Number }                                       → that year
//   - ISO-ish strings "YYYY-MM-DD…", "YYYY/MM/DD"            → YYYY
//   - European "DD/MM/YYYY", "DD-MM-YYYY", "DD.MM.YYYY"     → YYYY
//   - US-style "M/D/YYYY" via Date fallback                  → YYYY
//   - Excel serial numbers (days since 1899-12-30)           → UTC year
//   - Bare 4-digit year ("1975" or number 1975)              → that year
// Kept intentionally forgiving because recompute runs against rows that were
// imported by older parser versions — we don't get to re-clean them.
function yearOf(dn) {
  if (dn == null || dn === '') return null;
  if (dn instanceof Date && !Number.isNaN(dn.valueOf())) {
    return dn.getUTCFullYear();
  }
  if (typeof dn === 'object') {
    if (typeof dn.year === 'number') return dn.year;
    return null;
  }
  if (typeof dn === 'number' && Number.isFinite(dn)) {
    // A bare year.
    if (dn >= 1900 && dn <= 2100) return Math.floor(dn);
    // Excel serial (days since 1899-12-30). Plausible birth-date range.
    if (dn > 1000 && dn < 80000) {
      const ms = Math.round((dn - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!Number.isNaN(d.valueOf())) {
        const y = d.getUTCFullYear();
        if (y >= 1900 && y <= 2100) return y;
      }
    }
    return null;
  }
  if (typeof dn !== 'string') return null;
  const s = dn.trim();
  if (!s) return null;
  // ISO / slash-ISO: YYYY-MM-DD, YYYY/MM/DD.
  const iso = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(s);
  if (iso) return Number(iso[1]);
  // European DD[sep]MM[sep]YYYY.
  const eu = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(s);
  if (eu) return Number(eu[3]);
  // Bare 4-digit year as text.
  const bare = /^(\d{4})$/.exec(s);
  if (bare) {
    const y = Number(bare[1]);
    if (y >= 1900 && y <= 2100) return y;
  }
  // Any 4-digit year embedded in the string (e.g. "1er janvier 1968").
  const embedded = /(?:^|\D)(19\d{2}|20\d{2})(?:\D|$)/.exec(s);
  if (embedded) return Number(embedded[1]);
  // Last-ditch: let the runtime try.
  const d = new Date(s);
  if (!Number.isNaN(d.valueOf())) {
    const y = d.getUTCFullYear();
    if (y >= 1900 && y <= 2100) return y;
  }
  return null;
}

// Broker exports sometimes prefix the locality with a country code:
// "B - BRUXELLES", "NL - AMSTERDAM", "LUX - LUXEMBOURG". Strip that so the
// commune column reads cleanly. Keeps casing otherwise untouched.
function cleanCommune(s) {
  if (s == null) return '';
  const str = String(s).trim();
  if (!str) return '';
  return str.replace(/^[A-Za-z]{1,3}\s*-\s*/, '').trim();
}

// Some rows were imported before the `date_de_naissance` header alias existed;
// for forward-compatible recomputes, read either key so the fallback shape
// continues to work.
function getDateNaissance(c) {
  return c.date_naissance ?? c.date_de_naissance ?? null;
}

// Parse a birth-date value to a {y,m,d} triple using the same forgiving rules
// as yearOf. Returns null when only a year can be recovered.
function parseDateParts(dn) {
  if (dn == null || dn === '') return null;
  if (dn instanceof Date && !Number.isNaN(dn.valueOf())) {
    return { y: dn.getUTCFullYear(), m: dn.getUTCMonth() + 1, d: dn.getUTCDate() };
  }
  if (typeof dn === 'number' && Number.isFinite(dn)) {
    if (dn > 1000 && dn < 80000) {
      const ms = Math.round((dn - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!Number.isNaN(d.valueOf())) {
        return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
      }
    }
    return null;
  }
  if (typeof dn !== 'string') return null;
  const s = dn.trim();
  if (!s) return null;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const eu = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(s);
  if (eu) return { y: Number(eu[3]), m: Number(eu[2]), d: Number(eu[1]) };
  const dt = new Date(s);
  if (!Number.isNaN(dt.valueOf())) {
    const y = dt.getUTCFullYear();
    if (y >= 1900 && y <= 2100) {
      return { y, m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }
  }
  return null;
}

// Format a birth date as DD/MM/YYYY, matching the reference xlsx output.
function formatDateFR(dn) {
  const p = parseDateParts(dn);
  if (!p) return null;
  const dd = String(p.d).padStart(2, '0');
  const mm = String(p.m).padStart(2, '0');
  return `${dd}/${mm}/${p.y}`;
}

// Reference xlsx uses French labels for gender ("Masculin" / "Féminin").
// Raw broker exports may provide 'M', 'F', 'Masculin', 'Féminin', 'Man',
// 'Vrouw', 'Male', 'Female' — normalize them all here.
function formatSexe(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === 'm' || s === 'masculin' || s === 'man' || s === 'male' || s === 'h' || s === 'homme') return 'Masculin';
  if (s === 'f' || s === 'feminin' || s === 'féminin' || s === 'vrouw' || s === 'female' || s === 'femme') return 'Féminin';
  return null;
}

// Broker Phenix stores a handful of synthetic "clients" to hang reinsurer /
// assistance-company policies off, plus a catch-all entry that groups orphan
// policies. They carry real polices but are NOT real clients, so they inflate
// active-client counts, Personne-morale breakdowns, and the CLIENT TOTAL
// export. We identify them by their canonical names (stable across snapshots
// from 2019 through 2025) rather than by dossier range, because the broker
// renumbered real clients into the 10000–113000 range starting in 2022 and the
// older "dossier >= 9990" heuristic was stripping ~2500 real clients.
const UTILITY_CLIENT_NAMES = new Set([
  'POLICE UNIQUE',
  'COMPAGNIE',
  'COMPAGNIES',
  'EUROP ASSISTANCE',
  'MONDIAL ASSISTANCE',
  'ALLIANZ GLOBAL ASSISTANCE',
  'TOUT LE MONDE',
]);

function isUtilityClient(c) {
  const nom = String(c?.nom ?? '').trim().toUpperCase();
  return UTILITY_CLIENT_NAMES.has(nom);
}

// Given the full set of clients, returns the dossier_keys to exclude so we
// can also prune the matching polices / compagnies / sinistres rows.
function utilityKeys(clients) {
  const out = new Set();
  for (const c of clients) {
    if (isUtilityClient(c) && c.dossier_key) out.add(c.dossier_key);
  }
  return out;
}

function excludeUtility(clients, polices, compagniePolices, sinistres) {
  const drop = utilityKeys(clients);
  if (drop.size === 0) return { clients, polices, compagniePolices, sinistres };
  return {
    clients: clients.filter((c) => !drop.has(c.dossier_key)),
    polices: (polices || []).filter((p) => !drop.has(p.dossier_key)),
    compagniePolices: (compagniePolices || []).filter((p) => !drop.has(p.dossier_key)),
    sinistres: (sinistres || []).filter((s) => !drop.has(s.dossier_key)),
  };
}

// The 02/2022 COMPAGNIE export contains ~7k rows whose (dossier_key, police)
// pair is not in the POLICE export — historical / terminated policies the
// broker left in the accounting extract. Other snapshots (2019, 2021, 2025)
// are already trimmed. Restrict compagnie rows to the active policy set so
// total_premium and per-client premium only reflect the current portfolio.
function restrictToActivePolices(polices, compagniePolices) {
  if (!compagniePolices || compagniePolices.length === 0) return compagniePolices || [];
  const activeKeys = new Set();
  for (const p of polices || []) {
    if (p && p.dossier_key && p.police != null) {
      activeKeys.add(`${p.dossier_key}|${String(p.police)}`);
    }
  }
  if (activeKeys.size === 0) return compagniePolices;
  return compagniePolices.filter((cp) => (
    cp && cp.dossier_key && cp.police != null &&
    activeKeys.has(`${cp.dossier_key}|${String(cp.police)}`)
  ));
}

// Periodicities that do NOT represent an annual recurring premium:
//   - "Libre" / "Libre non planifié": free-form deposits on Vie-placements
//     (Branche 21/23) products. Broker sometimes enters the capital amount in
//     the "Prime totale annuelle" column, which inflates totals by 3-5x.
//   - "Prime unique": single-shot premium paid once at subscription; no
//     annualized value.
// The 2025 export zero-fills these correctly; older exports (2019-2022) do not.
// Exclude them from recurring-premium sums so the metric is comparable across
// snapshots.
const NON_RECURRING_PERIODICITIES = new Set([
  'Libre',
  'Libre non planifié',
  'Prime unique',
]);

function isRecurringAnnualPremium(cp) {
  const per = String(cp?.periodicite ?? '').trim();
  return !NON_RECURRING_PERIODICITIES.has(per);
}

// "Vie et placements" (Branche 21/23) policies are life-insurance / investment
// contracts. Their "Prime totale annuelle" column is not commensurable across
// snapshots: brokers sometimes record lump-sum deposits as periodicity=Annuel
// (e.g. the 02/2022 export contains €300k+ rows tagged Annuel that are really
// one-shot investments), and per-snapshot Vie matching coverage swings wildly
// (22% in 2019, 99% in 2022, 38% in 2025) which alone moves the dashboard total
// by a factor of 2x. The reference rapport already separates IARD from Vie for
// this reason. Exclude Vie rows from the dashboard's recurring-premium sums so
// total_premium and avg_premium_per_client measure the IARD book consistently.
function isNonVieDomain(cp) {
  const dom = String(cp?.domaine ?? '').trim().toLowerCase();
  return dom !== 'vie et placements';
}

// Policy types that, by themselves, mark a client as Entreprise (E) in the
// reference rapport. Derived empirically from the 12/2019 snapshot by matching
// CLIENT TOTAL's Type PE column: every type below is 100% E-coded in the ref
// xlsx (never appears on a P-classified client). Combined with pm=morale and
// statut_social=Travailleur indépendant this reproduces 1983/1983 Type PE.
const ENTREPRISE_POLICY_TYPES = new Set([
  "RC Entreprise",
  "Incendie RSi - Maisons de commerce",
  "Accidents du travail (Loi)",
  "Groupe Indépendants",
  "Outils et Tracteurs",
  "RC Professions médicales",
  "Dirigeants d'entreprise",
  "Multi-branches (Commerce, Petite industrie, Métiers manuels)",
  "Polices regroupées AT, RC, ...",
  "Incendie RSi - Bureaux",
  "Revenu garanti",
  "RC Industrie, Commerce de gros",
  "Tous risques Electronique",
  "Responsabilité objective d'exploitants (loi du 30/7/1979)",
  "Vie Groupe salariés",
  "Responsabilité décennale",
  "Plaques marchands et Plaques essais",
  "Incendie RSi - Agriculture",
  "PJ Activités professionnelles (éventuellement avec Auto)",
  "Dommages à marchandises transportées",
  "Multi-branches (Particuliers)",
  "Flotte mixte",
  "TRC (Tous Risques Chantier)",
  "Bris de machines",
  "Accidents du travail Secteur public",
  "Police-package (commerce, petite industrie, métiers manuels)",
  "Tous risques (entreprises)",
  "Collective Accidents",
  "Accidents du travail non assujettis",
  "Transport routier (corps)",
  "Polices regroupées Incendie Commerce + autres (RC, ...)",
  "Accidents du travail excédent",
]);

// Build the set of dossier_keys that should be classified as Entreprise (E).
// A client is E when ANY of:
//   - physique_morale = "Personne morale"
//   - statut_social = "Travailleur indépendant"
//   - holds at least one policy whose type is in ENTREPRISE_POLICY_TYPES
// Everything else is Particulier (P). "Groupement de personnes..." is treated
// as P unless it also matches the policy-type rule, because the ref xlsx
// classifies the sole groupement (RESIDENCE "BERNHEIM 69") as P.
export function computeEntrepriseKeys(clients, polices) {
  const out = new Set();
  for (const c of clients) {
    const dk = c.dossier_key;
    if (!dk) continue;
    const pm = String(c.physique_morale ?? '').trim().toLowerCase();
    const ss = String(c.statut_social ?? '').trim().toLowerCase();
    if (pm === 'personne morale') { out.add(dk); continue; }
    if (ss === 'travailleur indépendant' || ss === 'travailleur independant') {
      out.add(dk);
    }
  }
  for (const p of polices || []) {
    if (!p.dossier_key) continue;
    const t = String(p.type_police ?? '').trim();
    if (ENTREPRISE_POLICY_TYPES.has(t)) out.add(p.dossier_key);
  }
  return out;
}

function isBlank(s) {
  if (s == null) return true;
  const t = String(s).trim().toLowerCase();
  return t === '' || t === 'none';
}

// Sort entries by [-count, key-ascending]. Matches Python sorted(key=(-count,k)).
function sortByCountDescKeyAsc(entries) {
  return [...entries].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
}

// Sort a list of {count} objects by -count, stable (JS sort is stable since ES2019,
// matching Python's stable sort).
function sortByCountDesc(items, key = 'count') {
  return [...items].sort((a, b) => b[key] - a[key]);
}

export function normalizeAddress(rue) {
  if (!rue) return '';
  let s = String(rue).trim().toLowerCase();
  // Strip parenthesized qualifiers ("Kasseide(Lie) 58" -> "Kasseide 58").
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ');
  s = s.replace(/[,./\-]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\brué?\b/g, 'rue');
  s = s.replace(/\bstr\b/g, 'straat');
  s = s.replace(/\bav\b/g, 'avenue');
  s = s.replace(/\bbd\b/g, 'boulevard');
  return s;
}

// A client is Particulier (P) unless they're in the entrepriseKeys set built
// by computeEntrepriseKeys. When called without the set (back-compat/legacy
// paths), falls back to the physique_morale-only heuristic.
function isParticulier(c, entrepriseKeys) {
  if (entrepriseKeys) return !entrepriseKeys.has(c.dossier_key);
  const v = String(c.physique_morale ?? '').trim().toLowerCase();
  return v === 'p' || v === 'physique' || v === 'personne physique' || v === '';
}

// ---------------------------------------------------------------------------
// Section 1: Client Overview
// ---------------------------------------------------------------------------

export function computeClientOverview(clients, polices, entrepriseKeys) {
  const total = clients.length;
  if (total === 0) {
    return {
      total: 0, particuliers: 0, entreprises: 0,
      pct_particuliers: 0, pct_entreprises: 0,
      active_clients: 0, clients_sans_police: 0,
    };
  }
  const eKeys = entrepriseKeys || computeEntrepriseKeys(clients, polices);

  const particuliers = clients.reduce((n, c) => n + (isParticulier(c, eKeys) ? 1 : 0), 0);
  const entreprises = total - particuliers;

  const clientKeysWithPolices = new Set();
  for (const p of polices) if (p.dossier_key) clientKeysWithPolices.add(p.dossier_key);

  let activeP = 0;
  let activeE = 0;
  for (const c of clients) {
    if (clientKeysWithPolices.has(c.dossier_key)) {
      if (isParticulier(c, eKeys)) activeP += 1;
      else activeE += 1;
    }
  }
  const active = activeP + activeE;
  const sansPolice = total - active;

  return {
    total,
    particuliers,
    entreprises,
    pct_particuliers: total ? pyRound(particuliers / total * 100, 1) : 0,
    pct_entreprises: total ? pyRound(entreprises / total * 100, 1) : 0,
    active_clients: active,
    active_particuliers: activeP,
    active_entreprises: activeE,
    pct_active_particuliers: active ? pyRound(activeP / active * 100, 1) : 0,
    pct_active_entreprises: active ? pyRound(activeE / active * 100, 1) : 0,
    clients_sans_police: sansPolice,
    sans_police_particuliers: particuliers - activeP,
    sans_police_entreprises: entreprises - activeE,
  };
}

// ---------------------------------------------------------------------------
// Section 2: Geographic Profile
// ---------------------------------------------------------------------------

export function computeGeographicProfile(clients, cumulThreshold = 70.0) {
  const total = clients.length;
  if (total === 0) {
    return { rows: [], zone_count: 0, zone_pct: 0, hors_zone_count: 0, hors_zone_pct: 0 };
  }

  const cpCounts = new Map();
  const cpLocalite = new Map();
  for (const c of clients) {
    const cp = String(c.code_postal ?? '').trim();
    if (cp && cp.toLowerCase() !== 'none') {
      counterInc(cpCounts, cp);
      if (!cpLocalite.has(cp)) {
        const loc = cleanCommune(c.localite);
        if (loc && loc.toLowerCase() !== 'none') cpLocalite.set(cp, loc);
      }
    }
  }

  const ranked = sortByCountDescKeyAsc(cpCounts.entries());
  const rows = [];
  let cumul = 0;
  let zoneCount = 0;
  let zoneThresholdReached = false;

  for (const [cp, count] of ranked) {
    const pct = pyRound(count / total * 100, 1);
    cumul += pct;
    rows.push({
      code_postal: cp,
      localite: cpLocalite.get(cp) ?? '',
      count,
      pct,
      cumul_pct: pyRound(cumul, 1),
    });
    if (!zoneThresholdReached) {
      zoneCount += count;
      if (cumul >= cumulThreshold) zoneThresholdReached = true;
    }
  }
  if (!zoneThresholdReached) zoneCount = total;

  return {
    rows,
    zone_count: zoneCount,
    zone_pct: pyRound(zoneCount / total * 100, 1),
    hors_zone_count: total - zoneCount,
    hors_zone_pct: pyRound((total - zoneCount) / total * 100, 1),
  };
}

// ---------------------------------------------------------------------------
// Section 3: Demographics
// ---------------------------------------------------------------------------

export function computeDemographics(clients, polices, snapshotYear) {
  const total = clients.length;
  if (total === 0) return { gender: {}, age_brackets: [], total: 0, known_sexe: 0, known_age: 0 };

  // Gender — Python iterates in insertion order. We insert M, then F, then Inconnu
  // in the first order encountered, but the Python version uses a Counter that
  // preserves insertion order of first-seen keys. We mirror by tracking order.
  const genderOrder = [];
  const genderCounts = new Map();
  const bumpGender = (k) => {
    if (!genderCounts.has(k)) { genderCounts.set(k, 0); genderOrder.push(k); }
    genderCounts.set(k, genderCounts.get(k) + 1);
  };
  for (const c of clients) {
    const sexe = String(c.sexe ?? '').trim().toUpperCase();
    if (sexe === 'M' || sexe === 'MASCULIN') bumpGender('M');
    else if (sexe === 'F' || sexe === 'FÉMININ' || sexe === 'FEMININ') bumpGender('F');
    else bumpGender('Inconnu');
  }
  const knownSexe = (genderCounts.get('M') || 0) + (genderCounts.get('F') || 0);
  const gender = {};
  for (const k of genderOrder) {
    const v = genderCounts.get(k);
    // Percent of known for M/F (matches ref rapport); percent of total for Inconnu.
    const denom = (k === 'Inconnu') ? total : (knownSexe || 1);
    gender[k] = { count: v, pct: pyRound(v / denom * 100, 1) };
  }

  // Age brackets
  const bracketsDef = [[0, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 69], [70, 999]];
  const bracketLabel = (lo, hi) => `${lo}-${hi < 999 ? hi : '+'}`;
  const bracketLabels = bracketsDef.map(([lo, hi]) => bracketLabel(lo, hi));
  const bracketCounts = new Map(bracketLabels.map((l) => [l, 0]));
  const bracketPolicyCounts = new Map(bracketLabels.map((l) => [l, 0]));
  let unknownAge = 0;

  const clientKeysPolices = new Map();
  for (const p of polices) if (p.dossier_key) counterInc(clientKeysPolices, p.dossier_key);

  for (const c of clients) {
    const year = yearOf(getDateNaissance(c));
    if (year == null) { unknownAge += 1; continue; }
    let age = snapshotYear - year;
    if (age < 0) age = 0;
    for (const [lo, hi] of bracketsDef) {
      if (age >= lo && age <= hi) {
        const label = bracketLabel(lo, hi);
        bracketCounts.set(label, bracketCounts.get(label) + 1);
        if (c.dossier_key && clientKeysPolices.has(c.dossier_key)) {
          bracketPolicyCounts.set(label, bracketPolicyCounts.get(label) + clientKeysPolices.get(c.dossier_key));
        }
        break;
      }
    }
  }

  // Percent of known age (matches ref rapport). Keep pct_total for callers that
  // want share-of-all (page 10 ratios use this for "60+" share of the universe).
  const knownAge = total - unknownAge;
  const age_brackets = bracketLabels.map((label) => ({
    label,
    client_count: bracketCounts.get(label),
    policy_count: bracketPolicyCounts.get(label),
    pct: knownAge ? pyRound(bracketCounts.get(label) / knownAge * 100, 1) : 0,
    pct_total: total ? pyRound(bracketCounts.get(label) / total * 100, 1) : 0,
  }));

  return { gender, age_brackets, unknown_age: unknownAge, total, known_sexe: knownSexe, known_age: knownAge };
}

// ---------------------------------------------------------------------------
// Section 4: Civil & Social Status
// ---------------------------------------------------------------------------

export function computeCivilSocialStatus(clients) {
  const total = clients.length;
  if (total === 0) return { civil_status: [], social_status: [], total: 0, known_civil: 0, known_social: 0 };

  const mkOrdered = () => ({ order: [], counts: new Map() });
  const bump = (o, k) => {
    if (!o.counts.has(k)) { o.counts.set(k, 0); o.order.push(k); }
    o.counts.set(k, o.counts.get(k) + 1);
  };

  const civil = mkOrdered();
  const social = mkOrdered();

  for (const c of clients) {
    const ec = String(c.etat_civil ?? '').trim();
    bump(civil, ec && ec.toLowerCase() !== 'none' ? ec : 'Inconnu');
    const ss = String(c.statut_social ?? '').trim();
    bump(social, ss && ss.toLowerCase() !== 'none' ? ss : 'Inconnu');
  }

  const knownCount = (o) =>
    [...o.counts.entries()]
      .filter(([k]) => !/^inconnu$/i.test(k))
      .reduce((a, [, v]) => a + v, 0);

  const knownCivil = knownCount(civil);
  const knownSocial = knownCount(social);

  // Percent of known (matches ref rapport). "Inconnu" uses total as denominator.
  const toList = (o, known) => o.order.map((k) => {
    const count = o.counts.get(k);
    const isUnknown = /^inconnu$/i.test(k);
    const denom = isUnknown ? total : (known || 1);
    return { label: k, count, pct: pyRound(count / denom * 100, 1) };
  });

  return {
    civil_status: sortByCountDesc(toList(civil, knownCivil)),
    social_status: sortByCountDesc(toList(social, knownSocial)),
    total,
    known_civil: knownCivil,
    known_social: knownSocial,
  };
}

// ---------------------------------------------------------------------------
// Section 5: Data Quality
// ---------------------------------------------------------------------------

export function computeDataQuality(particuliers, allActives) {
  // Two scopes per the ref rapport:
  //   Particuliers only:   Sexe, Âge, Statut social, État civil
  //   Particuliers + Ent.: Téléphone, E-mail
  // `allActives` falls back to `particuliers` when callers don't supply a
  // separate list (tests, legacy parity harness).
  const pList = particuliers || [];
  const pTotal = pList.length;
  const aList = allActives || pList;
  const aTotal = aList.length;
  if (pTotal === 0 && aTotal === 0) return { fields: [], total: 0, total_p: 0, total_all: 0 };

  const fieldsToCheck = [
    { key: 'sexe',            label: 'Sexe (P)',                  scope: 'p'   },
    { key: 'date_naissance',  label: 'Âge (P)',                    scope: 'p'   },
    { key: 'statut_social',   label: 'Statut social (P)',          scope: 'p'   },
    { key: 'etat_civil',      label: 'État Civil (P)',             scope: 'p'   },
    { key: 'telephone',       label: 'Téléphone (P et E)',         scope: 'all' },
    { key: 'email',           label: 'E-mail (P et E)',            scope: 'all' },
  ];

  // "Known" means a non-empty, non-sentinel value. Broker exports sometimes
  // store the literal string "Inconnu" in etat_civil/statut_social/sexe —
  // treat those as unknown so data-quality % matches the civil/social tables.
  const UNKNOWN_SENTINELS = new Set(['', 'none', 'inconnu', 'onbekend', 'unknown', 'n/a', 'na']);
  const countKnown = (list, key) => {
    let known = 0;
    for (const c of list) {
      const val = c[key];
      if (val == null) continue;
      const s = String(val).trim().toLowerCase();
      if (!UNKNOWN_SENTINELS.has(s)) known += 1;
    }
    return known;
  };

  const fields = [];
  for (const { key, label, scope } of fieldsToCheck) {
    const list = scope === 'p' ? pList : aList;
    const total = list.length;
    const known = countKnown(list, key);
    const missing = total - known;
    fields.push({
      key,
      label,
      scope,
      known,
      missing,
      pct_missing: total ? pyRound(missing / total * 100, 1) : 0,
      critical: total ? missing / total > 0.5 : false,
    });
  }

  // `total` kept for back-compat. For P-only display, treat as P count.
  return { fields, total: pTotal, total_p: pTotal, total_all: aTotal };
}

// ---------------------------------------------------------------------------
// Section 6: Insurance Branches
// ---------------------------------------------------------------------------

export function computeBranches(polices, branchIndex) {
  const total = polices.length;
  if (total === 0) return { domains: [], branches: [], total: 0 };

  const domainOrder = [];
  const domainCounts = new Map();
  const branchCounts = new Map();
  const bumpDomain = (k) => {
    if (!domainCounts.has(k)) { domainCounts.set(k, 0); domainOrder.push(k); }
    domainCounts.set(k, domainCounts.get(k) + 1);
  };

  for (const p of polices) {
    const domaine = String(p.domaine ?? '').trim();
    if (domaine) bumpDomain(domaine);
    const branch = getBranchCode(p.type_police ?? '', branchIndex.reverse);
    counterInc(branchCounts, branch);
  }

  const domains = sortByCountDesc(
    domainOrder.map((k) => ({
      label: k,
      count: domainCounts.get(k),
      pct: pyRound(domainCounts.get(k) / total * 100, 1),
    }))
  );
  // Python iterates Counter in insertion order; replicate by tracking insertion order
  // via counterInc (Map preserves insertion order).
  const branches = sortByCountDesc(
    [...branchCounts.entries()].map(([code, v]) => ({
      code,
      count: v,
      pct: pyRound(v / total * 100, 1),
    }))
  );

  return { domains, branches, total };
}

// ---------------------------------------------------------------------------
// Section 7: Subscription Index
// ---------------------------------------------------------------------------

export function computeSubscriptionIndex(clients, polices, branchIndex) {
  if (clients.length === 0 || polices.length === 0) {
    return { branches: [], active_clients: 0 };
  }

  const clientKeysWithPolices = new Set();
  for (const p of polices) if (p.dossier_key) clientKeysWithPolices.add(p.dossier_key);
  const activeClients = clients.reduce(
    (n, c) => n + (clientKeysWithPolices.has(c.dossier_key) ? 1 : 0), 0);

  const clientBranches = new Map();
  for (const p of polices) {
    const dk = p.dossier_key;
    if (!dk) continue;
    const branch = getBranchCode(p.type_police ?? '', branchIndex.reverse);
    if (!clientBranches.has(dk)) clientBranches.set(dk, new Set());
    clientBranches.get(dk).add(branch);
  }

  const branchClientCounts = new Map();
  for (const [, branches] of clientBranches) {
    for (const b of branches) counterInc(branchClientCounts, b);
  }

  const branches = [...branchClientCounts.entries()]
    .map(([code, count]) => ({
      code,
      client_count: count,
      penetration: activeClients ? pyRound(count / activeClients * 100, 1) : 0,
    }))
    .sort((a, b) => b.client_count - a.client_count);

  return { branches, active_clients: activeClients };
}

// ---------------------------------------------------------------------------
// Section 8: Policies Per Client
// ---------------------------------------------------------------------------

export function computePoliciesPerClient(clients, polices, branchIndex) {
  if (clients.length === 0) return { distribution: [], mono_policy: [], total_clients: 0 };

  const policesPerClient = new Map();
  for (const p of polices) if (p.dossier_key) counterInc(policesPerClient, p.dossier_key);

  const countDist = new Map();
  for (const c of clients) {
    const n = policesPerClient.get(c.dossier_key) || 0;
    let bucket;
    if (n === 0) bucket = '0';
    else if (n >= 5) bucket = '5+';
    else bucket = String(n);
    counterInc(countDist, bucket);
  }
  const distribution = ['0', '1', '2', '3', '4', '5+'].map((label) => ({
    label,
    count: countDist.get(label) || 0,
  }));

  // Mono-policy breakdown by branch
  const policesByDk = new Map();
  for (const p of polices) {
    if (!p.dossier_key) continue;
    if (!policesByDk.has(p.dossier_key)) policesByDk.set(p.dossier_key, []);
    policesByDk.get(p.dossier_key).push(p);
  }

  const monoOrder = [];
  const monoCounts = new Map();
  const bumpMono = (k) => {
    if (!monoCounts.has(k)) { monoCounts.set(k, 0); monoOrder.push(k); }
    monoCounts.set(k, monoCounts.get(k) + 1);
  };

  for (const c of clients) {
    const dk = c.dossier_key;
    if ((policesPerClient.get(dk) || 0) === 1) {
      const cp = policesByDk.get(dk) || [];
      if (cp.length > 0) {
        const branch = getBranchCode(cp[0].type_police ?? '', branchIndex.reverse);
        bumpMono(branch);
      }
    }
  }

  const mono_policy = sortByCountDesc(
    monoOrder.map((k) => ({ branch: k, count: monoCounts.get(k) }))
  );

  return { distribution, mono_policy, total_clients: clients.length };
}

// ---------------------------------------------------------------------------
// Section 9: Company Penetration
// ---------------------------------------------------------------------------

// Canonicalize broker-export compagnie names so variants collapse into a single
// display bucket (matches the reference "Pénétration des compagnies" table).
// Each key matches a case-insensitive regex; first match wins. Unmatched names
// pass through unchanged (uppercased) so new compagnies still show up.
const COMPAGNIE_ALIASES = [
  [/^axa\s+(belgium|ass?urance)/i,         'AXA'],
  [/^axa\s+assist/i,                        'AXA ASSISTANCE'],
  [/^allianz\s+assist/i,                    'ALLIANZ ASSISTANCE'],
  [/^allianz/i,                             'ALLIANZ'],
  [/^(aedes|x\s+aedes|arces)/i,             'AEDES'],
  [/^ag\s+insurance/i,                      'AG'],
  [/^baloise/i,                              'BALOISE'],
  [/^das\b/i,                                'DAS'],
  [/^foyer/i,                                'FOYER'],
  [/^europ\s+ass/i,                          'EUROP ASSISTANCE'],
  [/^dkv/i,                                  'DKV'],
  [/^vivium/i,                               'VIVIUM'],
  [/^cardif/i,                               'CARDIF'],
  [/^generali/i,                             'GENERALI'],
  [/^dela/i,                                 'DELA'],
  [/^ibis/i,                                 'IBIS'],
  [/^arag/i,                                 'ARAG'],
  [/^delta\s+lloyd/i,                        'DELTA LLOYD'],
  [/^(jean\s+)?verheyen/i,                   'VERHEYEN'],
  [/^vander\s+haeghen/i,                     'VANDER HAEGHEN'],
  [/^(catherine\s+)?de\s+buyl/i,             'DE BUYL'],
  [/^bdm\b/i,                                'BDM'],
  [/^euromaf/i,                              'EUROMAF'],
  [/^euromex/i,                              'EUROMEX'],
  [/^ancoras/i,                              'ANCORAS'],
  [/^belfius/i,                              'BELFIUS'],
  [/^cbc/i,                                  'CBC'],
  [/^lar\b/i,                                'LAR'],
  [/^securex/i,                              'SECUREX'],
  [/^anglo[-\s]?belge/i,                     'ANGLO-BELGE'],
  [/^bureau\s+de\s+tarif/i,                  'BDT'],
];

function canonicalizeCompagnie(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'none') return null;
  for (const [re, alias] of COMPAGNIE_ALIASES) {
    if (re.test(s)) return alias;
  }
  return s.toUpperCase();
}

export function computeCompanyPenetration(polices) {
  const total = polices.length;
  if (total === 0) return { companies: [], total: 0 };

  const order = [];
  const counts = new Map();
  for (const p of polices) {
    const comp = canonicalizeCompagnie(p.compagnie);
    if (!comp) continue;
    if (!counts.has(comp)) { counts.set(comp, 0); order.push(comp); }
    counts.set(comp, counts.get(comp) + 1);
  }
  const companies = sortByCountDesc(
    order.map((k) => ({
      name: k,
      count: counts.get(k),
      pct: pyRound(counts.get(k) / total * 100, 1),
    }))
  );
  return { companies, total };
}

// ---------------------------------------------------------------------------
// Section 10: KPI Summary
// ---------------------------------------------------------------------------

export function computeKpiSummary(clients, polices, compagniePolices, sinistres, snapshotYear, entrepriseKeys) {
  const total_clients = clients.length;
  const total_polices = polices.length;

  const clientKeysWithPolices = new Set();
  for (const p of polices) if (p.dossier_key) clientKeysWithPolices.add(p.dossier_key);
  const active_clients = clients.reduce(
    (n, c) => n + (clientKeysWithPolices.has(c.dossier_key) ? 1 : 0), 0);

  const policesPerClient = new Map();
  for (const p of polices) if (p.dossier_key) counterInc(policesPerClient, p.dossier_key);

  const avg_polices_per_client = active_clients
    ? pyRound(total_polices / active_clients, 2) : 0;

  // P/E policy split (ref rapport shows "Polices Particuliers" / "Polices Entreprises").
  const eKeys = entrepriseKeys || computeEntrepriseKeys(clients, polices);
  let polices_entreprises = 0;
  for (const p of polices) if (p.dossier_key && eKeys.has(p.dossier_key)) polices_entreprises += 1;
  const polices_particuliers = total_polices - polices_entreprises;

  // Average policies per client split by P/E.
  const activeP_keys = new Set();
  const activeE_keys = new Set();
  for (const c of clients) {
    if (!clientKeysWithPolices.has(c.dossier_key)) continue;
    if (eKeys.has(c.dossier_key)) activeE_keys.add(c.dossier_key);
    else activeP_keys.add(c.dossier_key);
  }
  const avg_polices_per_client_p = activeP_keys.size
    ? pyRound(polices_particuliers / activeP_keys.size, 2) : 0;
  const avg_polices_per_client_e = activeE_keys.size
    ? pyRound(polices_entreprises / activeE_keys.size, 2) : 0;

  let total_premium = 0;
  let total_commission = 0;
  for (const cp of compagniePolices) {
    // Premium: exclude Vie et placements (life/investment) and non-recurring
    // periodicities. The Vie filter is what keeps cross-snapshot comparisons
    // sane — see isNonVieDomain comment for the 2022 €300k smoking-gun row.
    if (isNonVieDomain(cp) && isRecurringAnnualPremium(cp)) {
      total_premium += Number(cp.prime_totale_annuelle) || 0;
    }
    total_commission += Number(cp.commission_annuelle) || 0;
  }
  const avg_premium_per_client = active_clients
    ? pyRound(total_premium / active_clients, 2) : 0;
  const avg_commission_per_client = active_clients
    ? pyRound(total_commission / active_clients, 2) : 0;

  let mono_policy_clients = 0;
  for (const [, count] of policesPerClient) if (count === 1) mono_policy_clients += 1;

  // Sinistre count: ref rapport reports "Nombre de sinistres <year>" for the
  // most recent full year before the snapshot, and freq = that count / total
  // policies. For a Dec 2019 snapshot this is 2018 sinistres.
  const sinistreYear = (snapshotYear && Number.isFinite(snapshotYear))
    ? snapshotYear - 1 : null;
  let sinistresOfYear = 0;
  const sinistreKeys = new Set();
  const sinistreKeysOfYear = new Set();
  for (const s of sinistres) {
    if (s.dossier_key) sinistreKeys.add(s.dossier_key);
    const y = yearOf(s.date_evenement ?? s['date_événement'] ?? s.date);
    if (sinistreYear != null && y === sinistreYear) {
      sinistresOfYear += 1;
      if (s.dossier_key) sinistreKeysOfYear.add(s.dossier_key);
    }
  }

  // Households: distinct addresses among active clients.
  const activeSet = clientKeysWithPolices;
  const householdAddrs = new Map(); // addrKey -> Set<dossier_key>
  const clientToAddr = new Map();
  for (const c of clients) {
    if (!activeSet.has(c.dossier_key)) continue;
    const cp = String(c.code_postal ?? '').trim();
    const rue = normalizeAddress(c.rue);
    const addrKey = cp && rue ? `${cp}|${rue}` : `__nokey__:${c.dossier_key}`;
    clientToAddr.set(c.dossier_key, addrKey);
    if (!householdAddrs.has(addrKey)) householdAddrs.set(addrKey, new Set());
    householdAddrs.get(addrKey).add(c.dossier_key);
  }
  const total_menages = householdAddrs.size;
  // Mono-police household: all its members combined hold exactly 1 policy.
  let menages_mono_police = 0;
  for (const [, members] of householdAddrs) {
    let policyCount = 0;
    for (const dk of members) policyCount += (policesPerClient.get(dk) || 0);
    if (policyCount === 1) menages_mono_police += 1;
  }

  return {
    total_clients,
    active_clients,
    clients_sans_police: total_clients - active_clients,
    total_polices,
    polices_particuliers,
    polices_entreprises,
    avg_polices_per_client,
    avg_polices_per_client_p,
    avg_polices_per_client_e,
    mono_policy_clients,
    total_premium: pyRound(total_premium, 2),
    total_commission: pyRound(total_commission, 2),
    avg_premium_per_client,
    avg_commission_per_client,
    total_sinistres: sinistresOfYear || sinistres.length,
    total_sinistres_all: sinistres.length,
    sinistre_year: sinistreYear,
    clients_with_sinistres: (sinistreKeysOfYear.size || sinistreKeys.size),
    total_menages,
    menages_mono_police,
    snapshot_year: snapshotYear,
  };
}

// ---------------------------------------------------------------------------
// Section 11: Opportunities
// ---------------------------------------------------------------------------

export function computeOpportunities(clients, polices, compagniePolices, snapshotYear, branchIndex) {
  if (clients.length === 0) {
    return { cross_sell: [], data_quality_cleanup: [], succession: [],
             young_families: [], high_value: [] };
  }

  const policesPerClient = new Map();
  const clientBranches = new Map();
  const clientDomains = new Map();
  for (const p of polices) {
    const dk = p.dossier_key;
    if (!dk) continue;
    counterInc(policesPerClient, dk);
    const branch = getBranchCode(p.type_police ?? '', branchIndex.reverse);
    if (!clientBranches.has(dk)) clientBranches.set(dk, new Set());
    clientBranches.get(dk).add(branch);
    const domaine = String(p.domaine ?? '').trim();
    if (domaine) {
      if (!clientDomains.has(dk)) clientDomains.set(dk, new Set());
      clientDomains.get(dk).add(domaine.toLowerCase());
    }
  }

  const clientPremium = new Map();
  for (const cp of compagniePolices) {
    const dk = cp.dossier_key;
    if (!dk) continue;
    // Match the dashboard total_premium definition: IARD only, recurring only.
    if (!isNonVieDomain(cp)) continue;
    if (!isRecurringAnnualPremium(cp)) continue;
    clientPremium.set(dk, (clientPremium.get(dk) || 0) + (Number(cp.prime_totale_annuelle) || 0));
  }

  const clientKeysWithPolices = new Set();
  for (const p of polices) if (p.dossier_key) clientKeysWithPolices.add(p.dossier_key);

  // 1. Cross-sell: mono-policy clients
  const cross_sell = [];
  for (const c of clients) {
    const dk = c.dossier_key;
    if ((policesPerClient.get(dk) || 0) === 1) {
      const branches = clientBranches.get(dk) || new Set();
      cross_sell.push({
        dossier_key: dk,
        nom: c.nom ?? '',
        telephone: c.telephone ?? '',
        email: c.email ?? '',
        current_branch: branches.size > 0 ? [...branches][0] : '',
        code_postal: c.code_postal ?? '',
      });
    }
  }

  // 2. Data quality cleanup
  const data_quality_cleanup = [];
  const keyFields = ['sexe', 'date_naissance', 'telephone', 'email', 'etat_civil', 'statut_social'];
  for (const c of clients) {
    const missing = [];
    for (const f of keyFields) {
      const val = c[f];
      if (val == null || ['', 'None', 'none'].includes(String(val).trim())) missing.push(f);
    }
    if (missing.length > 0) {
      data_quality_cleanup.push({
        dossier_key: c.dossier_key ?? '',
        nom: c.nom ?? '',
        missing_fields: missing,
        missing_count: missing.length,
      });
    }
  }
  data_quality_cleanup.sort((a, b) => b.missing_count - a.missing_count);

  // 3. Succession: clients 60+ without Vie or Placement
  const succession = [];
  for (const c of clients) {
    const year = yearOf(getDateNaissance(c));
    if (year == null) continue;
    const age = snapshotYear - year;
    if (age >= 60) {
      const dk = c.dossier_key;
      const branches = clientBranches.get(dk) || new Set();
      if (!branches.has('VIE') && !branches.has('PLA')) {
        succession.push({
          dossier_key: dk,
          nom: c.nom ?? '',
          age,
          telephone: c.telephone ?? '',
          email: c.email ?? '',
          current_branches: [...branches],
        });
      }
    }
  }

  // 4. Young families: 25-45 with IARD but no Vie
  const young_families = [];
  for (const c of clients) {
    const year = yearOf(getDateNaissance(c));
    if (year == null) continue;
    const age = snapshotYear - year;
    if (age >= 25 && age <= 45) {
      const dk = c.dossier_key;
      if (!clientKeysWithPolices.has(dk)) continue;
      const branches = clientBranches.get(dk) || new Set();
      const domains = clientDomains.get(dk) || new Set();
      const hasIard = [...domains].some((d) => d === 'iard' || d === 'incendie, accidents et risques divers');
      const hasVie = branches.has('VIE');
      if (hasIard && !hasVie) {
        young_families.push({
          dossier_key: dk,
          nom: c.nom ?? '',
          age,
          telephone: c.telephone ?? '',
          email: c.email ?? '',
          current_branches: [...branches],
        });
      }
    }
  }

  // 5. High-value clients with low coverage
  const high_value = [];
  if (clientPremium.size > 0) {
    let sum = 0;
    for (const v of clientPremium.values()) sum += v;
    const avg = sum / clientPremium.size;
    const threshold = avg * 1.5;
    for (const c of clients) {
      const dk = c.dossier_key;
      const premium = clientPremium.get(dk) || 0;
      const nPol = policesPerClient.get(dk) || 0;
      if (premium >= threshold && nPol >= 1 && nPol <= 2) {
        const branches = clientBranches.get(dk) || new Set();
        high_value.push({
          dossier_key: dk,
          nom: c.nom ?? '',
          premium: pyRound(premium, 2),
          n_policies: nPol,
          telephone: c.telephone ?? '',
          email: c.email ?? '',
          current_branches: [...branches],
        });
      }
    }
    high_value.sort((a, b) => b.premium - a.premium);
  }

  return { cross_sell, data_quality_cleanup, succession, young_families, high_value };
}

// ---------------------------------------------------------------------------
// CLIENT TOTAL
// ---------------------------------------------------------------------------

export function computeClientTotal(clients, polices, compagniePolices, snapshotYear, branchIndex) {
  if (clients.length === 0) return [];

  // Drop utility/reinsurer clients (dossiers 9990+) and their attached rows.
  ({ clients, polices, compagniePolices } = excludeUtility(clients, polices, compagniePolices, []));
  // Drop historical compagnie rows that no longer map to an active police.
  compagniePolices = restrictToActivePolices(polices, compagniePolices);

  // Full P/E classification (pm=morale | ss=TI | has prof-only policy type).
  const entrepriseKeys = computeEntrepriseKeys(clients, polices);

  const policesByDk = new Map();
  for (const p of polices) {
    if (!p.dossier_key) continue;
    if (!policesByDk.has(p.dossier_key)) policesByDk.set(p.dossier_key, []);
    policesByDk.get(p.dossier_key).push(p);
  }

  const compByDk = new Map();
  for (const cp of compagniePolices) {
    if (!cp.dossier_key) continue;
    if (!compByDk.has(cp.dossier_key)) compByDk.set(cp.dossier_key, []);
    compByDk.get(cp.dossier_key).push(cp);
  }

  // Client address index
  const clientAddress = new Map();
  const addressGroups = new Map();
  for (const c of clients) {
    const dk = c.dossier_key;
    const cp = String(c.code_postal ?? '').trim();
    const rue = normalizeAddress(c.rue);
    const addrKey = cp && rue ? `${cp}|${rue}` : null;
    clientAddress.set(dk, addrKey);
    if (addrKey) {
      if (!addressGroups.has(addrKey)) addressGroups.set(addrKey, new Set());
      addressGroups.get(addrKey).add(dk);
    }
  }

  const activeKeys = new Set(policesByDk.keys());
  const codes = branchIndex.codes;
  const result = [];

  for (const c of clients) {
    const dk = c.dossier_key;
    if (!activeKeys.has(dk)) continue;

    // Nclient
    const dossier = String(c.dossier ?? '0').trim();
    const sousDossier = String(c.sous_dossier ?? '00').trim();
    let nclient = 0;
    const dNum = Number(dossier);
    const sNum = Number(sousDossier);
    if (Number.isInteger(dNum) && Number.isInteger(sNum)) {
      nclient = dNum * 100 + sNum;
    }

    // Age / date of birth (formatted DD/MM/YYYY for xlsx output)
    const dnRaw = getDateNaissance(c);
    const year = yearOf(dnRaw);
    const age = year != null ? snapshotYear - year : null;
    const date_naissance = formatDateFR(dnRaw);
    const sexe = formatSexe(c.sexe);

    // Type PE (full rule: pm=morale | ss=TI | has prof-only policy type).
    const type_pe = entrepriseKeys.has(dk) ? 'E' : 'P';

    // #POL
    const clientPolices = policesByDk.get(dk) || [];
    const n_pol = clientPolices.length;

    // #POL Adres
    const addrKey = clientAddress.get(dk);
    let pol_adres;
    if (addrKey) {
      const sameAddr = addressGroups.get(addrKey) || new Set();
      let sum = 0;
      for (const other of sameAddr) sum += (policesByDk.get(other) || []).length;
      pol_adres = sum;
    } else {
      pol_adres = n_pol;
    }

    // COM IARD
    const clientComps = compByDk.get(dk) || [];
    let com_iard = null;
    if (clientComps.length > 0) {
      let s = 0;
      for (const cp of clientComps) {
        if (String(cp.domaine ?? '').trim().toLowerCase() !== 'vie et placements') {
          s += Number(cp.commission_annuelle) || 0;
        }
      }
      com_iard = s;
    }

    // Branch flags
    const branchFlags = {};
    for (const code of codes) branchFlags[code] = '';
    for (const p of clientPolices) {
      const branch = getBranchCode(p.type_police ?? '', branchIndex.reverse);
      branchFlags[branch] = 'x';
    }

    const row = {
      dossier_key: dk,
      nclient,
      dossier: c.dossier ?? '',
      sous_dossier: c.sous_dossier ?? '',
      titre: c.titre ?? '',
      nom: c.nom ?? '',
      nom_conjoint: c.nom_conjoint ?? '',
      rue: c.rue ?? '',
      pays: c.pays ?? '',
      code_postal: c.code_postal ?? '',
      localite: c.localite ?? '',
      langue: c.langue ?? '',
      date_naissance,
      age,
      telephone: c.telephone ?? '',
      description_telephone: c.description_telephone ?? '',
      fax: c.fax ?? '',
      email: c.email ?? '',
      profession: c.profession ?? '',
      physique_morale: c.physique_morale ?? '',
      etat_civil: c.etat_civil ?? '',
      sexe,
      type_pe,
      n_pol,
      pol_adres,
      // Preserve 0 (client has Compagnie rows but all are Vie et placements)
      // vs null (no Compagnie rows) — the reference xlsx writes 0 through.
      com_iard: com_iard == null ? null : pyRound(com_iard, 2),
    };
    for (const code of codes) row[code] = branchFlags[code];
    result.push(row);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Full stats bundle
// ---------------------------------------------------------------------------

export function computeAllStats(clients, polices, compagniePolices, sinistres, snapshotYear, branchIndex) {
  // Drop utility/reinsurer clients (dossiers 9990+) across every section.
  ({ clients, polices, compagniePolices, sinistres } =
    excludeUtility(clients, polices, compagniePolices, sinistres));
  // Drop historical compagnie rows that no longer map to an active police.
  compagniePolices = restrictToActivePolices(polices, compagniePolices);

  const entrepriseKeys = computeEntrepriseKeys(clients, polices);

  const activeKeys = new Set();
  for (const p of polices) if (p.dossier_key) activeKeys.add(p.dossier_key);
  const activeClients = clients.filter((c) => activeKeys.has(c.dossier_key));

  // Sections 3 (demographics) and 4 (civil/social) are "Clients Particuliers"
  // only in the reference rapport. Section 5 (data quality) splits its fields:
  //   P only for Sexe/Âge/Statut social/État civil, P+E for Téléphone/E-mail.
  const activeParticuliers = activeClients.filter((c) => isParticulier(c, entrepriseKeys));

  return {
    overview: computeClientOverview(clients, polices, entrepriseKeys),
    kpi_summary: computeKpiSummary(clients, polices, compagniePolices, sinistres, snapshotYear, entrepriseKeys),
    geographic: computeGeographicProfile(activeClients),
    demographics: computeDemographics(activeParticuliers, polices, snapshotYear),
    civil_social: computeCivilSocialStatus(activeParticuliers),
    data_quality: computeDataQuality(activeParticuliers, activeClients),
    branches: computeBranches(polices, branchIndex),
    subscription: computeSubscriptionIndex(activeClients, polices, branchIndex),
    policies_per_client: computePoliciesPerClient(activeClients, polices, branchIndex),
    companies: computeCompanyPenetration(polices),
    opportunities: computeOpportunities(activeClients, polices, compagniePolices, snapshotYear, branchIndex),
  };
}

// Kept for the first-slice parity harness (still referenced by older run.mjs builds)
export function computePartialStats(clients, polices, snapshotYear) {
  const activeKeys = new Set();
  for (const p of polices) if (p.dossier_key) activeKeys.add(p.dossier_key);
  const activeClients = clients.filter((c) => activeKeys.has(c.dossier_key));
  return {
    overview: computeClientOverview(clients, polices),
    geographic: computeGeographicProfile(activeClients),
    demographics: computeDemographics(activeClients, polices, snapshotYear),
  };
}

// ---------------------------------------------------------------------------
// Metric extraction (for evolution/comparator)
// ---------------------------------------------------------------------------

export function extractMetricsFlat(stats) {
  const m = {};

  const ov = stats.overview || {};
  m['overview.total'] = ov.total ?? 0;
  m['overview.particuliers'] = ov.particuliers ?? 0;
  m['overview.entreprises'] = ov.entreprises ?? 0;
  m['overview.active_clients'] = ov.active_clients ?? 0;
  m['overview.clients_sans_police'] = ov.clients_sans_police ?? 0;

  const kpi = stats.kpi_summary || {};
  m['kpi.total_polices'] = kpi.total_polices ?? 0;
  m['kpi.avg_polices_per_client'] = kpi.avg_polices_per_client ?? 0;
  m['kpi.mono_policy_clients'] = kpi.mono_policy_clients ?? 0;
  m['kpi.total_premium'] = kpi.total_premium ?? 0;
  m['kpi.total_commission'] = kpi.total_commission ?? 0;
  m['kpi.avg_premium_per_client'] = kpi.avg_premium_per_client ?? 0;
  m['kpi.avg_commission_per_client'] = kpi.avg_commission_per_client ?? 0;
  m['kpi.total_sinistres'] = kpi.total_sinistres ?? 0;
  m['kpi.clients_with_sinistres'] = kpi.clients_with_sinistres ?? 0;

  const geo = stats.geographic || {};
  m['geographic.zone_count'] = geo.zone_count ?? 0;
  m['geographic.hors_zone_count'] = geo.hors_zone_count ?? 0;

  const demo = stats.demographics || {};
  for (const [gk, gv] of Object.entries(demo.gender || {})) {
    const count = (gv && typeof gv === 'object') ? (gv.count ?? 0) : gv;
    m[`demographics.gender.${gk}`] = count;
  }
  for (const b of demo.age_brackets || []) {
    const label = b.label ?? '';
    m[`demographics.age.${label}.clients`] = b.client_count ?? 0;
    m[`demographics.age.${label}.policies`] = b.policy_count ?? 0;
  }

  const br = stats.branches || {};
  for (const b of br.branches || []) m[`branches.${b.code ?? ''}`] = b.count ?? 0;
  for (const d of br.domains || []) m[`branches.domain.${d.label ?? ''}`] = d.count ?? 0;

  const sub = stats.subscription || {};
  for (const b of sub.branches || []) m[`subscription.${b.code ?? ''}`] = b.penetration ?? 0;

  const comp = stats.companies || {};
  for (const c of comp.companies || []) m[`companies.${c.name ?? ''}`] = c.count ?? 0;

  const dq = stats.data_quality || {};
  for (const f of dq.fields || []) m[`data_quality.${f.key ?? ''}`] = f.pct_missing ?? 0;

  const ppc = stats.policies_per_client || {};
  for (const d of ppc.distribution || []) m[`policies.distribution.${d.label ?? ''}`] = d.count ?? 0;

  return m;
}

// ---------------------------------------------------------------------------
// Metric tree (for comparator UI)
// ---------------------------------------------------------------------------

export function buildMetricTree(allMetricsKeys) {
  const keys = [...allMetricsKeys].sort();
  const tree = [
    {
      id: 'overview', label: 'Overview', icon: 'bi-pie-chart',
      children: [
        { id: 'overview.total', label: 'Total Clients' },
        { id: 'overview.particuliers', label: 'Particuliers' },
        { id: 'overview.entreprises', label: 'Entreprises' },
        { id: 'overview.active_clients', label: 'Active Clients' },
        { id: 'overview.clients_sans_police', label: 'Clients sans Police' },
      ],
    },
    {
      id: 'kpi', label: 'KPI', icon: 'bi-speedometer2',
      children: [
        { id: 'kpi.total_polices', label: 'Total Policies' },
        { id: 'kpi.avg_polices_per_client', label: 'Avg Policies/Client' },
        { id: 'kpi.mono_policy_clients', label: 'Mono-policy Clients' },
        { id: 'kpi.total_premium', label: 'Total Premium' },
        { id: 'kpi.total_commission', label: 'Total Commission' },
        { id: 'kpi.avg_premium_per_client', label: 'Avg Premium/Client' },
        { id: 'kpi.avg_commission_per_client', label: 'Avg Commission/Client' },
        { id: 'kpi.total_sinistres', label: 'Total Claims' },
        { id: 'kpi.clients_with_sinistres', label: 'Clients with Claims' },
      ],
    },
    {
      id: 'geographic', label: 'Geographic', icon: 'bi-geo-alt',
      children: [
        { id: 'geographic.zone_count', label: 'Zone Count' },
        { id: 'geographic.hors_zone_count', label: 'Hors Zone Count' },
      ],
    },
  ];

  const genderChildren = [];
  const ageChildren = [];
  for (const k of keys) {
    if (k.startsWith('demographics.gender.')) {
      const label = k.split('.').pop();
      genderChildren.push({ id: k, label });
    } else if (k.startsWith('demographics.age.')) {
      const parts = k.split('.');
      const ageLabel = parts[2];
      const suffix = parts[3] || 'clients';
      ageChildren.push({ id: k, label: `${ageLabel} (${suffix})` });
    }
  }
  const demoChildren = [...genderChildren, ...ageChildren];
  if (demoChildren.length) {
    tree.push({ id: 'demographics', label: 'Demographics', icon: 'bi-people', children: demoChildren });
  }

  const branchChildren = [];
  const domainChildren = [];
  for (const k of keys) {
    if (k.startsWith('branches.domain.')) {
      domainChildren.push({ id: k, label: k.slice('branches.domain.'.length) });
    } else if (k.startsWith('branches.')) {
      branchChildren.push({ id: k, label: k.slice('branches.'.length) });
    }
  }
  if (branchChildren.length || domainChildren.length) {
    tree.push({ id: 'branches', label: 'Branches', icon: 'bi-diagram-3', children: [...domainChildren, ...branchChildren] });
  }

  const subChildren = [];
  for (const k of keys) {
    if (k.startsWith('subscription.')) {
      const code = k.slice('subscription.'.length);
      subChildren.push({ id: k, label: `${code} (%)` });
    }
  }
  if (subChildren.length) {
    tree.push({ id: 'subscription', label: 'Subscription Index', icon: 'bi-bar-chart-steps', children: subChildren });
  }

  const companyChildren = [];
  for (const k of keys) {
    if (k.startsWith('companies.')) {
      companyChildren.push({ id: k, label: k.slice('companies.'.length) });
    }
  }
  if (companyChildren.length) {
    tree.push({ id: 'companies', label: 'Companies', icon: 'bi-building', children: companyChildren });
  }

  const dqChildren = [];
  for (const k of keys) {
    if (k.startsWith('data_quality.')) {
      const field = k.slice('data_quality.'.length);
      dqChildren.push({ id: k, label: `${field} (% missing)` });
    }
  }
  if (dqChildren.length) {
    tree.push({ id: 'data_quality', label: 'Data Quality', icon: 'bi-clipboard-check', children: dqChildren });
  }

  const polChildren = [];
  for (const k of keys) {
    if (k.startsWith('policies.distribution.')) {
      const label = k.slice('policies.distribution.'.length);
      polChildren.push({ id: k, label: `${label} policies` });
    }
  }
  if (polChildren.length) {
    tree.push({ id: 'policies', label: 'Policies per Client', icon: 'bi-file-earmark-text', children: polChildren });
  }

  return tree;
}
