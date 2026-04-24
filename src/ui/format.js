// Formatters. All currency in EUR; numeric/date locale tracks the active i18n locale.
//
// `formatPercent` accepts the raw percentage value (e.g. 42.5 → "42,5 %").
// Callers should pass the percentage as-is and NOT divide by 100.

import { getLocale, t } from '../i18n/index.js';

const LOCALE_MAP = {
  fr: 'fr-BE',
  nl: 'nl-BE',
  en: 'en-GB',
};

function resolveLocale(loc) {
  if (loc) return loc;
  return LOCALE_MAP[getLocale()] || 'fr-BE';
}

// fr-BE defaults to a narrow no-break space as the thousand separator
// (e.g. `1 234 567`). That's visually ambiguous next to other digits,
// so we swap it for a dot — the other Belgian convention — which brokers
// recognise instantly. nl-BE already uses `.`; en-GB keeps `,`.
function useDotGroups(locale) {
  return locale.startsWith('fr');
}
function formatWithGroups(n, opts, locale) {
  const loc = resolveLocale(locale);
  const parts = new Intl.NumberFormat(loc, opts).formatToParts(Number(n));
  const swap = useDotGroups(loc);
  return parts.map((p) => (swap && p.type === 'group') ? '.' : p.value).join('');
}

export function formatInt(n, locale) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return formatWithGroups(n, {}, locale);
}

export function formatDecimal(n, digits = 2, locale) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return formatWithGroups(n, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }, locale);
}

export function formatCurrency(n, locale, currency = 'EUR') {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return formatWithGroups(n, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }, locale);
}

// Accepts a raw percentage value (e.g. 42.5 → "42,5 %"). Do NOT divide by 100.
export function formatPercent(n, digits = 1, locale) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return formatWithGroups(n, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }, locale) + ' %';
}

export function formatDate(iso, locale) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.valueOf())) return '—';
  return new Intl.DateTimeFormat(resolveLocale(locale), { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

export function formatMonthYear(iso, locale) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.valueOf())) return '—';
  const s = new Intl.DateTimeFormat(resolveLocale(locale), { year: 'numeric', month: 'long' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// EU date helpers: render/parse dd/mm/yyyy so users stay on the Belgian
// convention regardless of the browser's locale (the native `<input type="date">`
// follows the OS locale and ends up showing mm/dd/yyyy on English-language
// macOS). Canonical storage remains ISO (yyyy-mm-dd).
export function formatDateEU(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Accepts dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (or single-digit day/month).
// Returns ISO yyyy-mm-dd on success, or null if the string doesn't look
// like a valid EU date.
export function parseDateEU(str) {
  if (!str) return null;
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(String(str).trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Round-trip through Date to reject impossible dates (e.g. 31/02/2025).
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Returns the localized branch label for a canonical code (e.g. "AUT" -> "Auto"
// in FR, "Auto" in NL, "Auto" in EN). Falls back to the code itself when the
// translation key is missing so unknown codes stay visible instead of showing
// "branch.XYZ".
export function branchLabel(code) {
  if (!code) return '';
  const key = `branch.${code}`;
  const s = t(key);
  return s === key ? code : s;
}
