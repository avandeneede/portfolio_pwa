#!/usr/bin/env node
// Locale key-parity test. Asserts that every key present in any locale
// file is present in all of them. The app falls back to the key string
// itself when a translation is missing, so drift here means a French or
// Dutch user sees a raw "evolution.empty_desc" instead of a sentence.
//
// Usage:
//   node tests/locales/run.mjs
//
// Exit codes:
//   0 = parity OK
//   1 = at least one locale is missing keys present in another, OR a
//       translation value is empty (treated as missing)

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const LOCALES = ['fr', 'nl', 'en'];

async function loadLocale(code) {
  const path = resolve(ROOT, 'locales', `${code}.json`);
  const raw = await readFile(path, 'utf8');
  /** @type {Record<string, string>} */
  const parsed = JSON.parse(raw);
  return parsed;
}

function diffKeys(a, aName, b, bName) {
  const aKeys = new Set(Object.keys(a));
  const bKeys = new Set(Object.keys(b));
  const missingFromB = [...aKeys].filter((k) => !bKeys.has(k)).sort();
  const missingFromA = [...bKeys].filter((k) => !aKeys.has(k)).sort();
  return { missingFromB, missingFromA, aName, bName };
}

function findEmpty(locale, code) {
  const empty = [];
  for (const [k, v] of Object.entries(locale)) {
    if (typeof v !== 'string' || v.trim() === '') empty.push(k);
  }
  return { code, empty: empty.sort() };
}

async function main() {
  const data = {};
  for (const code of LOCALES) data[code] = await loadLocale(code);

  let problems = 0;

  // Reference locale = fr (the canonical authoring locale). Compare nl and en
  // against fr both ways.
  for (const other of ['nl', 'en']) {
    const d = diffKeys(data.fr, 'fr', data[other], other);
    if (d.missingFromB.length) {
      problems += d.missingFromB.length;
      console.error(`${other}: missing ${d.missingFromB.length} key(s) present in fr:`);
      for (const k of d.missingFromB) console.error(`  - ${k}`);
    }
    if (d.missingFromA.length) {
      problems += d.missingFromA.length;
      console.error(`fr: missing ${d.missingFromA.length} key(s) present in ${other}:`);
      for (const k of d.missingFromA) console.error(`  - ${k}`);
    }
  }

  // Empty-string check across all locales (an empty string falls back to the
  // key in i18n/index.js, which renders the raw key in the UI).
  for (const code of LOCALES) {
    const { empty } = findEmpty(data[code], code);
    if (empty.length) {
      problems += empty.length;
      console.error(`${code}: ${empty.length} key(s) with empty translation:`);
      for (const k of empty) console.error(`  - ${k}`);
    }
  }

  const counts = LOCALES.map((c) => `${c}=${Object.keys(data[c]).length}`).join('  ');

  if (problems === 0) {
    console.log(`locales ✔  ${counts}`);
    process.exit(0);
  }

  console.error(`\nlocales ✘ — ${problems} problem(s).  ${counts}`);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
