// Tiny i18n. Flat JSON keys, interpolation with {name}, pluralization
// separated by '|' using Intl.PluralRules.
//
// Locales are fetched lazily. Default fallback is French.

const CACHE = new Map();
let currentLocale = 'fr';
let currentDict = null;

function interpolate(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

function selectPlural(str, count, locale) {
  if (!str.includes('|')) return str;
  const forms = str.split('|');
  const pr = new Intl.PluralRules(locale);
  const rule = pr.select(count);
  // forms are ordered: other|one|two|few|many|zero — first is 'other' fallback
  // Simpler convention: singular|plural for 2-form locales.
  if (forms.length === 2) return rule === 'one' ? forms[0] : forms[1];
  const map = { other: forms[0], one: forms[1], two: forms[2], few: forms[3], many: forms[4], zero: forms[5] };
  return map[rule] ?? forms[0];
}

export async function loadLocale(locale) {
  if (CACHE.has(locale)) return CACHE.get(locale);
  const res = await fetch(`locales/${locale}.json`);
  if (!res.ok) throw new Error(`Locale not found: ${locale}`);
  const dict = await res.json();
  CACHE.set(locale, dict);
  return dict;
}

export async function setLocale(locale) {
  currentDict = await loadLocale(locale);
  currentLocale = locale;
  document.documentElement.lang = locale;
}

export function t(key, vars) {
  if (!currentDict) return key;
  let s = currentDict[key];
  if (s == null) return key;
  if (vars && 'count' in vars) s = selectPlural(s, vars.count, currentLocale);
  return interpolate(s, vars);
}

export function getLocale() { return currentLocale; }
