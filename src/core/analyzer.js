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

// Parse a date_naissance that may be null, ISO "YYYY-MM-DD", Date, or {year}.
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
  s = s.replace(/[,./\-]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\brué?\b/g, 'rue');
  s = s.replace(/\bstr\b/g, 'straat');
  s = s.replace(/\bav\b/g, 'avenue');
  s = s.replace(/\bbd\b/g, 'boulevard');
  return s;
}

function isParticulier(c) {
  const v = String(c.physique_morale ?? '').trim().toLowerCase();
  return v === 'p' || v === 'physique' || v === 'personne physique' || v === '';
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

  const particuliers = clients.reduce((n, c) => n + (isParticulier(c) ? 1 : 0), 0);
  const entreprises = total - particuliers;

  const clientKeysWithPolices = new Set();
  for (const p of polices) if (p.dossier_key) clientKeysWithPolices.add(p.dossier_key);

  let activeP = 0;
  let activeE = 0;
  for (const c of clients) {
    if (clientKeysWithPolices.has(c.dossier_key)) {
      if (isParticulier(c)) activeP += 1;
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
        const loc = String(c.localite ?? '').trim();
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
  if (total === 0) return { gender: {}, age_brackets: [], total: 0 };

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
  const gender = {};
  for (const k of genderOrder) {
    const v = genderCounts.get(k);
    gender[k] = { count: v, pct: pyRound(v / total * 100, 1) };
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
    const year = yearOf(c.date_naissance);
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

  const age_brackets = bracketLabels.map((label) => ({
    label,
    client_count: bracketCounts.get(label),
    policy_count: bracketPolicyCounts.get(label),
    pct: total ? pyRound(bracketCounts.get(label) / total * 100, 1) : 0,
  }));

  return { gender, age_brackets, unknown_age: unknownAge, total };
}

// ---------------------------------------------------------------------------
// Section 4: Civil & Social Status
// ---------------------------------------------------------------------------

export function computeCivilSocialStatus(clients) {
  const total = clients.length;
  if (total === 0) return { civil_status: [], social_status: [], total: 0 };

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

  const toList = (o) => o.order.map((k) => ({
    label: k,
    count: o.counts.get(k),
    pct: pyRound(o.counts.get(k) / total * 100, 1),
  }));

  return {
    civil_status: sortByCountDesc(toList(civil)),
    social_status: sortByCountDesc(toList(social)),
    total,
  };
}

// ---------------------------------------------------------------------------
// Section 5: Data Quality
// ---------------------------------------------------------------------------

export function computeDataQuality(clients) {
  const total = clients.length;
  if (total === 0) return { fields: [], total: 0 };

  const fieldsToCheck = [
    ['sexe', 'Sexe'],
    ['date_naissance', 'Âge'],
    ['statut_social', 'Statut social'],
    ['etat_civil', 'État civil'],
    ['telephone', 'Téléphone'],
    ['email', 'E-mail'],
  ];

  const fields = [];
  for (const [key, label] of fieldsToCheck) {
    let known = 0;
    for (const c of clients) {
      const val = c[key];
      if (val != null && !['', 'None', 'none'].includes(String(val).trim())) known += 1;
    }
    const missing = total - known;
    fields.push({
      key,
      label,
      known,
      missing,
      pct_missing: total ? pyRound(missing / total * 100, 1) : 0,
      critical: total ? missing / total > 0.5 : false,
    });
  }

  return { fields, total };
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

export function computeCompanyPenetration(polices) {
  const total = polices.length;
  if (total === 0) return { companies: [], total: 0 };

  const order = [];
  const counts = new Map();
  for (const p of polices) {
    const comp = String(p.compagnie ?? '').trim();
    if (comp && comp.toLowerCase() !== 'none') {
      if (!counts.has(comp)) { counts.set(comp, 0); order.push(comp); }
      counts.set(comp, counts.get(comp) + 1);
    }
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

export function computeKpiSummary(clients, polices, compagniePolices, sinistres, snapshotYear) {
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

  let total_premium = 0;
  let total_commission = 0;
  for (const cp of compagniePolices) {
    total_premium += Number(cp.prime_totale_annuelle) || 0;
    total_commission += Number(cp.commission_annuelle) || 0;
  }
  const avg_premium_per_client = active_clients
    ? pyRound(total_premium / active_clients, 2) : 0;
  const avg_commission_per_client = active_clients
    ? pyRound(total_commission / active_clients, 2) : 0;

  let mono_policy_clients = 0;
  for (const [, count] of policesPerClient) if (count === 1) mono_policy_clients += 1;

  const sinistreKeys = new Set();
  for (const s of sinistres) if (s.dossier_key) sinistreKeys.add(s.dossier_key);

  return {
    total_clients,
    active_clients,
    clients_sans_police: total_clients - active_clients,
    total_polices,
    avg_polices_per_client,
    mono_policy_clients,
    total_premium: pyRound(total_premium, 2),
    total_commission: pyRound(total_commission, 2),
    avg_premium_per_client,
    avg_commission_per_client,
    total_sinistres: sinistres.length,
    clients_with_sinistres: sinistreKeys.size,
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
    const year = yearOf(c.date_naissance);
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
    const year = yearOf(c.date_naissance);
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

    // Age
    const year = yearOf(c.date_naissance);
    const age = year != null ? snapshotYear - year : null;

    // Type PE
    const pm = String(c.physique_morale ?? '').trim().toLowerCase();
    const type_pe = (pm === 'p' || pm === 'physique' || pm === 'personne physique' || pm === '') ? 'P' : 'E';

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
      age,
      langue: c.langue ?? '',
      telephone: c.telephone ?? '',
      description_telephone: c.description_telephone ?? '',
      fax: c.fax ?? '',
      email: c.email ?? '',
      profession: c.profession ?? '',
      physique_morale: c.physique_morale ?? '',
      etat_civil: c.etat_civil ?? '',
      type_pe,
      n_pol,
      pol_adres,
      com_iard: com_iard ? pyRound(com_iard, 2) : null,
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
  const activeKeys = new Set();
  for (const p of polices) if (p.dossier_key) activeKeys.add(p.dossier_key);
  const activeClients = clients.filter((c) => activeKeys.has(c.dossier_key));

  return {
    overview: computeClientOverview(clients, polices),
    kpi_summary: computeKpiSummary(clients, polices, compagniePolices, sinistres, snapshotYear),
    geographic: computeGeographicProfile(activeClients),
    demographics: computeDemographics(activeClients, polices, snapshotYear),
    civil_social: computeCivilSocialStatus(activeClients),
    data_quality: computeDataQuality(activeClients),
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
