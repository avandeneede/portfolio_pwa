// Formatters. All currency in EUR, all dates Belgian default.

export function formatInt(n, locale = 'fr-BE') {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat(locale).format(Number(n));
}

export function formatDecimal(n, digits = 2, locale = 'fr-BE') {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(n));
}

export function formatCurrency(n, locale = 'fr-BE', currency = 'EUR') {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(n));
}

export function formatPercent(n, digits = 1, locale = 'fr-BE') {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(n)) + ' %';
}

export function formatDate(iso, locale = 'fr-BE') {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.valueOf())) return '—';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

export function formatMonthYear(iso, locale = 'fr-BE') {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.valueOf())) return '—';
  const s = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
