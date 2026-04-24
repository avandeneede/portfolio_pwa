// File-type detection for broker Excel exports.
//
// Four expected file types: clients, polices, compagnies (compagnies-polices),
// sinistres. Detection is driven by headers (primary) with filename fallback.

// Hints are matched against header names *after* the parser's alias step, so
// we list canonical forms here. A file needs at least 2 matches to be detected
// from headers alone.
const HEADER_HINTS = {
  clients: ['code_postal', 'date_naissance', 'physique_morale', 'etat_civil', 'sexe', 'statut_social', 'localite'],
  polices: ['date_effet', 'type_police', 'compagnie', 'domaine'],
  compagnies: ['numero_fsma', 'prime_totale_annuelle', 'commission_annuelle', 'periodicite'],
  sinistres: ['description', 'date_evenement', 'etat_dossier', 'date_etat'],
};

const FILENAME_HINTS = {
  clients: ['client'],
  polices: ['police'],
  compagnies: ['compagnie', 'companies', 'compagnies_polices'],
  sinistres: ['sinistre', 'claim'],
};

// Alias variants of slugified headers to the canonical field names the
// analyzer + db schema expect. Broker exports use column titles like
// "Type de police", "E-mail", "Rue (no, boîte)", "État dossier (courtier)" —
// which slugify to `type_de_police`, `e_mail`, `rue_no_boite`, etc. Without
// aliases every branch maps to DIV and email is always "unknown".
const HEADER_ALIASES = {
  type_de_police: 'type_police',
  e_mail: 'email',
  rue_no_boite: 'rue',
  rue_no: 'rue',
  rue_numero_boite: 'rue',
  etat_dossier_courtier: 'etat_dossier',
  date_etat_courtier: 'date_etat',
  n_police: 'police',
  numero_police: 'police',
  no_police: 'police',
  // Birth date: sometimes exported as "Date de naissance" (FR), "Datum geboorte"
  // / "Geboortedatum" (NL) or "Date of birth" (EN). Without these aliases the
  // analyzer sees `c.date_naissance === undefined` and every client lands in
  // the "unknown age" bucket.
  date_de_naissance: 'date_naissance',
  datum_geboorte: 'date_naissance',
  geboortedatum: 'date_naissance',
  date_of_birth: 'date_naissance',
  date_naiss: 'date_naissance',
};

function normalizeHeader(s) {
  const slug = String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return HEADER_ALIASES[slug] || slug;
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
