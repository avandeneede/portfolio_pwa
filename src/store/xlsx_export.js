// CLIENT TOTAL .xlsx export. Ports the column layout from
// reference/services/excel_export.py so generated files match the legacy output.
//
// SheetJS (XLSX) is lazy-loaded via ctx.loadXLSX().

// Header labels per locale. Keys mirror the computeClientTotal row shape.
const HEADERS = {
  fr: {
    dossier_key: 'Nclient',
    nclient: 'Nclient',
    titre: 'Titre',
    nom: 'Nom',
    nom_conjoint: 'Nom conjoint',
    rue: 'Rue, no, boîte',
    pays: 'Pays',
    code_postal: 'Code postal',
    localite: 'Localité',
    langue: 'Langue',
    date_naissance: 'Date naissance',
    telephone: 'Téléphone',
    age: 'âge (en {year})',
    description_telephone: 'Description téléphone',
    fax: 'Fax',
    email: 'E-mail',
    profession: 'Profession',
    physique_morale: 'Physique/Morale',
    etat_civil: 'Etat civil',
    sexe: 'Sexe',
    type_pe: 'Type PE',
    n_pol: '#POL',
    pol_adres: '#POL Adres',
    com_iard: 'COM IARD',
  },
  nl: {
    dossier_key: 'Nclient',
    nclient: 'Nclient',
    titre: 'Titel',
    nom: 'Naam',
    nom_conjoint: 'Naam partner',
    rue: 'Straat, nr, bus',
    pays: 'Land',
    code_postal: 'Postcode',
    localite: 'Gemeente',
    langue: 'Taal',
    date_naissance: 'Geboortedatum',
    telephone: 'Telefoon',
    age: 'leeftijd (in {year})',
    description_telephone: 'Beschrijving telefoon',
    fax: 'Fax',
    email: 'E-mail',
    profession: 'Beroep',
    physique_morale: 'Fysiek/Moreel',
    etat_civil: 'Burgerlijke staat',
    sexe: 'Geslacht',
    type_pe: 'Type PE',
    n_pol: '#POL',
    pol_adres: '#POL Adres',
    com_iard: 'COM IARD',
  },
  en: {
    dossier_key: 'Client ID',
    nclient: 'Client No',
    titre: 'Title',
    nom: 'Name',
    nom_conjoint: 'Spouse name',
    rue: 'Street, no, box',
    pays: 'Country',
    code_postal: 'Postal code',
    localite: 'City',
    langue: 'Language',
    date_naissance: 'Date of birth',
    telephone: 'Phone',
    age: 'Age (in {year})',
    description_telephone: 'Phone description',
    fax: 'Fax',
    email: 'E-mail',
    profession: 'Profession',
    physique_morale: 'Physical/Legal',
    etat_civil: 'Marital status',
    sexe: 'Gender',
    type_pe: 'Type PE',
    n_pol: '#POL',
    pol_adres: '#POL Addr',
    com_iard: 'COM P&C',
  },
};

// Column order — matches the legacy Dossche reference xlsx (which includes
// Date naissance + Sexe; the current Python exporter omits both). Branch
// codes appended at end.
const BASE_COLS = [
  'dossier_key', 'nclient', 'titre', 'nom', 'nom_conjoint',
  'rue', 'pays', 'code_postal', 'localite', 'langue',
  'date_naissance', 'age', 'telephone', 'description_telephone',
  'fax', 'email', 'profession', 'physique_morale', 'etat_civil',
  'sexe', 'type_pe', 'n_pol', 'pol_adres', 'com_iard',
];

export async function exportClientTotalXlsx(ctx, rows, opts = {}) {
  const XLSX = await ctx.loadXLSX();
  const locale = opts.locale || 'fr';
  const year = opts.year || new Date().getFullYear();
  const branchCodes = opts.branchCodes || ctx.branchIndex?.codes || [];

  const headersMap = HEADERS[locale] || HEADERS.fr;
  const columns = [...BASE_COLS, ...branchCodes];

  // AOA: first row = header, then data rows.
  const header = columns.map((key) => {
    const raw = headersMap[key] ?? key;
    return raw.replace('{year}', String(year));
  });

  // Empty cells stay null so SheetJS writes no-value cells (matching the
  // legacy reference file, which uses null rather than empty strings).
  const data = rows.map((r) => columns.map((key) => {
    const v = r[key];
    if (v == null) return null;
    if (typeof v === 'string' && v === '') return null;
    return v;
  }));

  const aoa = [header, ...data];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths: roughly fit longest value seen in first 50 rows.
  const widths = columns.map((key, idx) => {
    let w = String(header[idx] || '').length;
    const max = Math.min(data.length, 50);
    for (let i = 0; i < max; i++) {
      const v = data[i][idx];
      if (v == null) continue;
      const s = String(v);
      if (s.length > w) w = s.length;
    }
    return { wch: Math.min(w + 2, 40) };
  });
  ws['!cols'] = widths;

  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Client_avec_nombre_de_polices_e');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return blob;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Generic opportunity list export. Takes a header row + plain data rows
// (strings / numbers / null) and produces a one-sheet xlsx blob. Used by
// the opportunity detail modal so brokers can take the full list (not just
// the first 500 rows shown on screen) into their prospection tool.
export async function exportOppXlsx(ctx, { header, rows, sheetName }) {
  const XLSX = await ctx.loadXLSX();
  const aoa = [header, ...rows.map((r) => r.map((v) => {
    if (v == null) return null;
    if (typeof v === 'string' && v === '') return null;
    return v;
  }))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths: longest value in the first 50 rows, capped at 40.
  const widths = header.map((h, idx) => {
    let w = String(h || '').length;
    const max = Math.min(rows.length, 50);
    for (let i = 0; i < max; i++) {
      const v = rows[i][idx];
      if (v == null) continue;
      const s = String(v);
      if (s.length > w) w = s.length;
    }
    return { wch: Math.min(w + 2, 40) };
  });
  ws['!cols'] = widths;
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  // Excel limits sheet names to 31 chars and forbids `: \ / ? * [ ]`.
  const safeName = String(sheetName || 'Export').slice(0, 31).replace(/[\\/:?*[\]]/g, '_');
  XLSX.utils.book_append_sheet(wb, ws, safeName);

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Format a date as a filename-safe ISO day (YYYY-MM-DD). Anchors every
// export to the exact snapshot it was generated from so the broker can
// tell two exports of the same portfolio apart when dated weeks apart.
function formatIsoDay(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  if (Number.isNaN(d.valueOf())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Build a safe xlsx filename from a title + snapshot date. Strips
// Windows-forbidden characters and appends the full YYYY-MM-DD of the
// underlying snapshot so exports stay pinned to their source data.
export function buildOppFilename(title, date) {
  const iso = formatIsoDay(date);
  const safe = String(title || 'Export').replace(/[\\/:*?"<>|]/g, '_');
  return iso ? `${safe} ${iso}.xlsx` : `${safe}.xlsx`;
}

// Build "CLIENT TOTAL {YYYY-MM-DD}.xlsx" — the YYYY-MM-DD is the snapshot
// date. We intentionally omit the snapshot label: it used to carry the
// broker's own portfolio name (e.g. "Dossche") which isn't useful to the
// downstream consumer and leaked a client-identifying string into files
// brokers share around.
export function buildClientTotalFilename(date) {
  const iso = formatIsoDay(date);
  return iso ? `CLIENT TOTAL ${iso}.xlsx` : `CLIENT TOTAL.xlsx`;
}
