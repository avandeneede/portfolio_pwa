// SheetJS-driven Excel parser. Works for .xlsx and .xls.
//
// Caller supplies a `XLSX` module reference (from vendored script tag or Node
// import) so this file stays environment-agnostic.
//
// parseFile(xlsx, arrayBuffer, filename) -> { type, filename, headers, row_count, warnings, rows }

import { detect, normalizeHeaders } from './detect.js';

const DATE_FIELDS = new Set([
  'date_naissance', 'date_effet', 'date_evenement', 'date_etat',
]);

const NUMERIC_FIELDS = new Set([
  'prime_totale_annuelle', 'commission_annuelle',
]);

function excelSerialToISO(serial) {
  // Excel epoch: 1899-12-30 (accounts for the 1900 leap-year bug).
  if (!Number.isFinite(serial)) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.valueOf())) return null;
  return d.toISOString().slice(0, 10);
}

function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.valueOf())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') return excelSerialToISO(v);
  const s = String(v).trim();
  // ISO
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY
  const fr = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(s);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
  // Fallback
  const d = new Date(s);
  if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  return null;
}

function coerceCell(key, value) {
  if (value == null || value === '') return null;
  if (DATE_FIELDS.has(key)) return parseDate(value);
  if (NUMERIC_FIELDS.has(key)) {
    if (typeof value === 'number') return value;
    const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return typeof value === 'string' ? value.trim() : value;
}

function buildDossierKey(row) {
  if (row.dossier_key && String(row.dossier_key).trim()) return row.dossier_key;
  const d = String(row.dossier ?? '').trim();
  const s = String(row.sous_dossier ?? '').trim();
  if (d && s) return `${d}/${s}`;
  if (d) return d;
  return null;
}

export function parseWorkbook(XLSX, workbook, filename) {
  const warnings = [];
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { type: null, filename, headers: [], row_count: 0, warnings: ['No sheet in workbook'], rows: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  if (rawRows.length === 0) {
    return { type: null, filename, headers: [], row_count: 0, warnings: ['Empty sheet'], rows: [] };
  }

  // Find the header row — usually row 0, sometimes preceded by title/description rows.
  // Use the first row that, once normalized, matches at least 2 hints of any type.
  let headerRow = 0;
  let detected = detect(rawRows[0].map((v) => String(v ?? '')), filename);
  for (let i = 1; i < Math.min(rawRows.length, 5); i++) {
    const tryDetect = detect(rawRows[i].map((v) => String(v ?? '')), filename);
    if (tryDetect.score > detected.score) {
      headerRow = i;
      detected = tryDetect;
    }
  }

  if (!detected.type) {
    warnings.push(`Could not identify file type from headers or name: ${filename}`);
  }

  const rawHeaders = rawRows[headerRow].map((v) => String(v ?? ''));
  const headers = normalizeHeaders(rawHeaders);
  const body = rawRows.slice(headerRow + 1);

  const rows = [];
  for (const r of body) {
    // Skip fully-empty rows
    if (!r || r.every((c) => c == null || c === '')) continue;
    const obj = {};
    headers.forEach((h, i) => {
      if (!h) return;
      obj[h] = coerceCell(h, r[i]);
    });
    const dk = buildDossierKey(obj);
    if (dk) obj.dossier_key = dk;
    rows.push(obj);
  }

  return {
    type: detected.type,
    filename,
    headers,
    row_count: rows.length,
    warnings,
    rows,
  };
}

export async function parseFile(XLSX, fileOrBuffer, filename) {
  let buf;
  if (fileOrBuffer instanceof ArrayBuffer) buf = fileOrBuffer;
  else if (ArrayBuffer.isView(fileOrBuffer)) buf = fileOrBuffer.buffer;
  else if (typeof Blob !== 'undefined' && fileOrBuffer instanceof Blob) buf = await fileOrBuffer.arrayBuffer();
  else throw new Error('parseFile expects ArrayBuffer, TypedArray, or Blob');

  const workbook = XLSX.read(buf, { type: 'array', cellDates: true });
  return parseWorkbook(XLSX, workbook, filename);
}
