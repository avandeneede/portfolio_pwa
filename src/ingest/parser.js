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

// Validate a YYYY-MM-DD triple. Rejects impossible dates like 20210230 by
// round-tripping through Date.UTC.
function validYmd(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.valueOf())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    // Some broker exports ship birthdates as compact YYYYMMDD integers
    // (e.g. 19920410) instead of Excel date serials. Integers in the
    // 8-digit calendar range are always YYYYMMDD — Excel serials for real
    // dates stay well below 100k, so there's no collision. Return null on
    // an invalid calendar date instead of falling through to the serial
    // epoch, which would spit out a nonsense date in the year 5xxxx.
    if (Number.isInteger(v) && v >= 10000101 && v <= 99991231) {
      const y = Math.floor(v / 10000);
      const m = Math.floor((v % 10000) / 100);
      const d = v % 100;
      return validYmd(y, m, d);
    }
    return excelSerialToISO(v);
  }
  const s = String(v).trim();
  // Compact YYYYMMDD (no separators) — seen in Portima-style client exports.
  const ymd = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (ymd) {
    const iso = validYmd(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    if (iso) return iso;
  }
  // ISO or YYYY/MM/DD / YYYY.MM.DD
  const iso = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s);
  if (iso) {
    const out = validYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (out) return out;
  }
  // DD/MM/YYYY
  const fr = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(s);
  if (fr) {
    const out = validYmd(Number(fr[3]), Number(fr[2]), Number(fr[1]));
    if (out) return out;
  }
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
    // Broker exports write amounts like "1 234,56 €" / "1.234,56" / "(1,50)".
    // Strip currency symbols, spaces (incl. non-breaking & narrow no-break),
    // then convert European comma decimal to a dot.
    let s = String(value)
      .replace(/[\u00A0\u202F\s]/g, '')
      .replace(/[€$£¥]/g, '');
    // Negative in parentheses: "(1,50)" → "-1,50"
    const paren = /^\((.+)\)$/.exec(s);
    if (paren) s = '-' + paren[1];
    // If both separators present, "." is the thousands separator (fr/nl convention):
    // "1.234,56" → "1234.56". Otherwise treat the lone comma as decimal point.
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(',', '.');
    }
    const n = Number(s);
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
