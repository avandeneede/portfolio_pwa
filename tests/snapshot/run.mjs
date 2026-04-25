#!/usr/bin/env node
// Snapshot test for the JS analyzer. Runs the analyzer pipeline on the
// synthetic fixtures in tests/fixtures/synthetic/ and compares the output
// against tests/snapshot/baseline.json.
//
// Replaces the older Python-parity test (tests/parity/) which has gone
// stale — the JS analyzer now emits more fields than the Python reference,
// and the comparison was producing 800+ "extra" diffs that masked real
// regressions. This test is JS-only, hermetic, and detects any change in
// analyzer output (number, shape, or new field).
//
// Usage:
//   node tests/snapshot/run.mjs               # diff vs baseline, fail on drift
//   node tests/snapshot/run.mjs --update      # accept current output as the new baseline
//
// When you intentionally change analyzer output, regenerate with --update
// and inspect the resulting `git diff tests/snapshot/baseline.json`. If the
// diff matches your intent, commit it. If unexpected fields appear, your
// change had a side effect.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  computeAllStats,
  computeClientTotal,
  extractMetricsFlat,
  buildMetricTree,
} from '../../src/core/analyzer.js';
import { buildBranchIndex } from '../../src/core/branch_mapping.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'synthetic');
const CONFIG = join(ROOT, 'config', 'branch_mapping.json');
const BASELINE = join(HERE, 'baseline.json');
const SNAPSHOT_YEAR = 2026;

const updateMode = process.argv.includes('--update');

async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')); }

// Stable sort of keys + array element order normalization where order isn't
// semantic (sets serialized as arrays). Keep this in sync with whatever the
// app considers "set-shaped" — currently just opportunities.cross_sell ids.
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function canonicalize(payload) {
  const opp = payload?.stats?.opportunities;
  if (opp) {
    for (const group of ['succession', 'young_families', 'high_value']) {
      for (const row of opp[group] ?? []) {
        if (Array.isArray(row.current_branches)) {
          row.current_branches = [...row.current_branches].sort();
        }
      }
    }
  }
  return payload;
}

function diff(expected, actual, path = '') {
  const diffs = [];
  if (typeof expected !== typeof actual) {
    diffs.push({ path, expected, actual, kind: 'type' });
    return diffs;
  }
  if (expected === null || actual === null || typeof expected !== 'object') {
    if (expected !== actual) {
      // Numeric tolerance: float drift below 1e-9 is noise, not signal.
      if (typeof expected === 'number' && typeof actual === 'number'
          && Math.abs(expected - actual) < 1e-9) {
        return diffs;
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

async function computeOutput() {
  const mapping = await readJson(CONFIG);
  const branchIndex = buildBranchIndex(mapping);
  const clients = await readJson(join(FIX, 'clients.json'));
  const polices = await readJson(join(FIX, 'polices.json'));
  const compagnies = await readJson(join(FIX, 'compagnies.json'));
  const sinistres = await readJson(join(FIX, 'sinistres.json'));

  const stats = computeAllStats(clients, polices, compagnies, sinistres, SNAPSHOT_YEAR, branchIndex);
  const client_total = computeClientTotal(clients, polices, compagnies, SNAPSHOT_YEAR, branchIndex);
  const flat = extractMetricsFlat(stats);
  const tree = buildMetricTree(new Set(Object.keys(flat)));

  return canonicalize({ stats, client_total, flat, tree });
}

async function main() {
  const actual = await computeOutput();
  const sortedActual = sortKeys(actual);

  if (updateMode) {
    await writeFile(BASELINE, JSON.stringify(sortedActual, null, 2) + '\n');
    console.log(`snapshot: wrote new baseline (${BASELINE})`);
    console.log(`  stats.sections=${Object.keys(actual.stats).length}`);
    console.log(`  client_total=${actual.client_total.length}`);
    console.log(`  flat=${Object.keys(actual.flat).length}`);
    console.log(`  tree=${actual.tree.length}`);
    return;
  }

  let baseline;
  try {
    baseline = await readJson(BASELINE);
  } catch (_) {
    console.error(`snapshot: no baseline at ${BASELINE}`);
    console.error(`          regenerate with: node tests/snapshot/run.mjs --update`);
    process.exit(1);
  }

  const diffs = diff(sortKeys(baseline), sortedActual);
  if (diffs.length === 0) {
    console.log(
      `snapshot ✔  stats.sections=${Object.keys(baseline.stats).length}  ` +
      `client_total=${baseline.client_total.length}  ` +
      `flat=${Object.keys(baseline.flat).length}  ` +
      `tree=${baseline.tree.length}`
    );
    return;
  }

  console.error(`snapshot ✘ — ${diffs.length} difference(s):`);
  for (const d of diffs.slice(0, 40)) {
    const exp = JSON.stringify(d.expected);
    const act = JSON.stringify(d.actual);
    console.error(`  ${d.path}  expected=${exp}  actual=${act}  (${d.kind})`);
  }
  if (diffs.length > 40) console.error(`  ... and ${diffs.length - 40} more`);
  console.error(`\nIf the new output is correct, accept it with:`);
  console.error(`  node tests/snapshot/run.mjs --update`);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
