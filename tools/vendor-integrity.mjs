#!/usr/bin/env node
// Regenerate the SRI hashes embedded in src/main.js (VENDOR_SRI).
//
// Run after bumping any vendored library. Prints the hashes to stdout in
// the exact format expected inside src/main.js so they can be pasted in
// (or sed'd if you're brave).
//
// Usage:
//   node tools/vendor-integrity.mjs
//
// Files audited:
//   vendor/sql.js/sql-wasm.js
//   vendor/sheetjs/xlsx.full.min.js
//
// Note: the .wasm hash is enforced separately by sql.js itself when it
// initializes (the JS shim asserts the WASM length / signature). The SVG
// sprite is fetched via the SW and validated only by the Origin same-origin
// guarantee — we don't enforce SRI on opaque fetch() bodies.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const FILES = [
  'vendor/sql.js/sql-wasm.js',
  'vendor/sheetjs/xlsx.full.min.js',
];

async function sri(path) {
  const buf = await readFile(join(ROOT, path));
  const digest = createHash('sha384').update(buf).digest('base64');
  return `sha384-${digest}`;
}

const out = {};
for (const f of FILES) out[f] = await sri(f);

console.log('Paste into VENDOR_SRI in src/main.js:\n');
console.log('const VENDOR_SRI = {');
for (const [k, v] of Object.entries(out)) {
  console.log(`  '${k}': '${v}',`);
}
console.log('};');
