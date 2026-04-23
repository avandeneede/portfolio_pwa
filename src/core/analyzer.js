// Pure computation functions for portfolio analysis.
// Port of reference/analyzer.py. No I/O, no imports beyond branch_mapping.
// All functions take plain data (arrays of plain objects) and return plain data.
//
// Parity invariant: this file's output must match reference/analyzer.py
// byte-for-byte after JSON serialization with sorted keys. See
// tests/parity/run.mjs.

import { getBranchCode } from './branch_mapping.js';

// ---------------------------------------------------------------------------
// Helpers: Python-compat rounding, Counter, defaultdict
// ---------------------------------------------------------------------------

// Python 3's round() uses banker's rounding (round half to even).
// JS Math.round uses round half away from zero. They diverge on exact halves.
// Must match exactly for parity.
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

function counterInc(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

// Parse a date_naissance that may be null, an ISO string "YYYY-MM-DD",
// or an object with a .year field. Returns an integer year or null.
function yearOf(dn) {
  if (dn == null) return null;
  if (typeof dn === 'object' && typeof dn.year === 'number') return dn.year;
  if (typeof dn === 'string') {
    const m = /^(\d{4})-\d{2}-\d{2}/.exec(dn);
    if (m) return Number(m[1]);
  }
  if (dn instanceof Date && !Number.isNaN(dn.valueOf())) {
    return dn.getUTCFullYear();
  }
  return null;
}

function isBlank(s) {
  if (s == null) return true;
  const t = String(s).trim().toLowerCase();
  return t === '' || t === 'none';
}

// ---------------------------------------------------------------------------
// Section 1: Client Overview
// ---------------------------------------------------------------------------

export function computeClientOverview(clients, polices) {
  const total = clients.length;
  if (total === 0) {
    return {
      total: 0, particuliers: 0, entreprises: 0,
      pct_particuliers: 0, pct_entreprises: 0,
      active_clients: 0, clients_sans_police: 0,
    };
  }

  const isParticulier = (c) => {
    const v = String(c.physique_morale ?? '').trim().toLowerCase();
    return v === 'p' || v === 'physique' || v === 'personne physique' || v === '';
  };

  const particuliers = clients.reduce((n, c) => n + (isParticulier(c) ? 1 : 0), 0);
  const entreprises = total - particuliers;

  const clientKeysWithPolices = new Set();
  for (const p of polices) {
    if (p.dossier_key) clientKeysWithPolices.add(p.dossier_key);
  }

  let activeP = 0;
  let activeE = 0;
  for (const c of clients) {
    const hasPolice = clientKeysWithPolices.has(c.dossier_key);
    if (hasPolice) {
      if (isParticulier(c)) activeP += 1;
      else activeE += 1;
    }
  }
  const active = activeP + activeE;
  const sansPolice = total - active;
  const sansPoliceP = particuliers - activeP;
  const sansPoliceE = entreprises - activeE;

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
    sans_police_particuliers: sansPoliceP,
    sans_police_entreprises: sansPoliceE,
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
        const loc = String(c.localite ?? '').trim();
        if (loc && loc.toLowerCase() !== 'none') cpLocalite.set(cp, loc);
      }
    }
  }

  // Sort by count desc, then code asc (stable sort matches Python's sorted key=(-count, cp))
  const ranked = [...cpCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

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
  if (total === 0) {
    return { gender: {}, age_brackets: [], total: 0 };
  }

  // Gender
  const genderCounts = new Map();
  for (const c of clients) {
    const sexe = String(c.sexe ?? '').trim().toUpperCase();
    if (sexe === 'M' || sexe === 'MASCULIN') counterInc(genderCounts, 'M');
    else if (sexe === 'F' || sexe === 'FÉMININ' || sexe === 'FEMININ') counterInc(genderCounts, 'F');
    else counterInc(genderCounts, 'Inconnu');
  }
  const gender = {};
  for (const [k, v] of genderCounts) {
    gender[k] = { count: v, pct: pyRound(v / total * 100, 1) };
  }

  // Age brackets — order preserved via explicit list (mirrors Python dict insert order)
  const bracketsDef = [
    [0, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 69], [70, 999],
  ];
  const bracketLabel = (lo, hi) => `${lo}-${hi < 999 ? hi : '+'}`;
  const bracketLabels = bracketsDef.map(([lo, hi]) => bracketLabel(lo, hi));
  const bracketCounts = new Map(bracketLabels.map((l) => [l, 0]));
  const bracketPolicyCounts = new Map(bracketLabels.map((l) => [l, 0]));
  let unknownAge = 0;

  // Policies per client (Counter of dossier_key)
  const clientKeysPolices = new Map();
  for (const p of polices) {
    const dk = p.dossier_key;
    if (dk) counterInc(clientKeysPolices, dk);
  }

  for (const c of clients) {
    const year = yearOf(c.date_naissance);
    if (year == null) { unknownAge += 1; continue; }
    let age = snapshotYear - year;
    if (age < 0) age = 0;

    for (const [lo, hi] of bracketsDef) {
      if (age >= lo && age <= hi) {
        const label = bracketLabel(lo, hi);
        bracketCounts.set(label, bracketCounts.get(label) + 1);
        const dk = c.dossier_key;
        if (dk && clientKeysPolices.has(dk)) {
          bracketPolicyCounts.set(label, bracketPolicyCounts.get(label) + clientKeysPolices.get(dk));
        }
        break;
      }
    }
  }

  const ageBrackets = bracketLabels.map((label) => ({
    label,
    client_count: bracketCounts.get(label),
    policy_count: bracketPolicyCounts.get(label),
    pct: total ? pyRound(bracketCounts.get(label) / total * 100, 1) : 0,
  }));

  return {
    gender,
    age_brackets: ageBrackets,
    unknown_age: unknownAge,
    total,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for partial stats bundle
// ---------------------------------------------------------------------------

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
