// File-type detection for broker Excel exports.
//
// Four expected file types: clients, polices, compagnies (compagnies-polices),
// sinistres. Detection is driven by headers (primary) with filename fallback.

const HEADER_HINTS = {
  clients: ['dossier', 'sous_dossier', 'nom', 'code_postal', 'date_naissance', 'physique_morale'],
  polices: ['dossier', 'police', 'date_effet', 'type_police', 'compagnie'],
  compagnies: ['nom', 'numero_fsma', 'prime_totale_annuelle', 'commission_annuelle', 'periodicite'],
  sinistres: ['police', 'description', 'date_evenement', 'etat_dossier', 'date_etat'],
};

const FILENAME_HINTS = {
  clients: ['client'],
  polices: ['police'],
  compagnies: ['compagnie', 'companies', 'compagnies_polices'],
  sinistres: ['sinistre', 'claim'],
};

function normalizeHeader(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function normalizeHeaders(row) {
  return row.map(normalizeHeader);
}

// Returns { type, score } where score is 0..n (hints matched).
export function detectFromHeaders(headers) {
  const set = new Set(headers.map(normalizeHeader));
  let best = { type: null, score: 0 };
  for (const [type, hints] of Object.entries(HEADER_HINTS)) {
    let score = 0;
    for (const h of hints) if (set.has(h)) score += 1;
    if (score > best.score) best = { type, score };
  }
  return best;
}

export function detectFromFilename(name) {
  const low = String(name).toLowerCase();
  for (const [type, hints] of Object.entries(FILENAME_HINTS)) {
    if (hints.some((h) => low.includes(h))) return type;
  }
  return null;
}

export function detect(headers, filename) {
  const fromHeaders = detectFromHeaders(headers);
  if (fromHeaders.score >= 2) return { type: fromHeaders.type, confidence: 'high', score: fromHeaders.score };
  const fromName = detectFromFilename(filename);
  if (fromName) return { type: fromName, confidence: fromHeaders.score > 0 ? 'medium' : 'low', score: fromHeaders.score };
  return { type: null, confidence: 'none', score: 0 };
}
