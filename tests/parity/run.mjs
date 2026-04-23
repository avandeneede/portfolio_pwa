#!/usr/bin/env node
// Parity harness. Runs the JS port on synthetic fixtures, loads the Python
// baseline, and exits non-zero on any difference.
//
// Usage:
//   python3 tests/fixtures/generate.py
//   python3 tests/parity/python_baseline.py
//   node tests/parity/run.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computePartialStats } from '../../src/core/analyzer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'synthetic');
const SNAPSHOT_YEAR = 2026;

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

// Sort object keys recursively so JSON.stringify is stable.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

// Walk two values and return a list of differences.
function diff(expected, actual, path = '') {
  const diffs = [];
  if (typeof expected !== typeof actual) {
    diffs.push({ path, expected, actual, kind: 'type' });
    return diffs;
  }
  if (expected === null || actual === null || typeof expected !== 'object') {
    if (expected !== actual) {
      // Treat -0 === 0, and compare numbers with tight tolerance for float noise.
      if (typeof expected === 'number' && typeof actual === 'number') {
        if (Math.abs(expected - actual) < 1e-9) return diffs;
      }
      diffs.push({ path, expected, actual, kind: 'value' });
    }
    return diffs;
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    diffs.push({ path, expected, actual, kind: 'shape' });
    return diffs;
  }
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) {
      diffs.push({ path, expected: `len=${expected.length}`, actual: `len=${actual.length}`, kind: 'length' });
    }
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) diffs.push(...diff(expected[i], actual[i], `${path}[${i}]`));
    return diffs;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of keys) {
    if (!(k in expected)) { diffs.push({ path: `${path}.${k}`, expected: '<missing>', actual: actual[k], kind: 'extra' }); continue; }
    if (!(k in actual)) { diffs.push({ path: `${path}.${k}`, expected: expected[k], actual: '<missing>', kind: 'missing' }); continue; }
    diffs.push(...diff(expected[k], actual[k], `${path}.${k}`));
  }
  return diffs;
}

async function main() {
  const clients = await readJson(join(FIX, 'clients.json'));
  const polices = await readJson(join(FIX, 'polices.json'));
  const baseline = await readJson(join(HERE, 'baseline.json'));

  const actual = computePartialStats(clients, polices, SNAPSHOT_YEAR);

  const sortedBaseline = sortKeys(baseline);
  const sortedActual = sortKeys(actual);

  const diffs = diff(sortedBaseline, sortedActual);
  if (diffs.length === 0) {
    console.log(`parity ✔ (${Object.keys(baseline).length} sections, ` +
      `overview.total=${baseline.overview.total}, ` +
      `geographic.rows=${baseline.geographic.rows.length}, ` +
      `demographics.unknown_age=${baseline.demographics.unknown_age})`);
    process.exit(0);
  }

  console.error(`parity ✘ — ${diffs.length} difference(s):`);
  for (const d of diffs.slice(0, 30)) {
    console.error(`  ${d.path}  expected=${JSON.stringify(d.expected)}  actual=${JSON.stringify(d.actual)}  (${d.kind})`);
  }
  if (diffs.length > 30) console.error(`  ... and ${diffs.length - 30} more`);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
