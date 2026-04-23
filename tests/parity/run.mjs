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
const SNAPSHOT_YEAR = 2026;

async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')); }

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

// Canonicalize JS output to match Python's canonicalization:
// - opportunities.cross_sell[*].current_branch dropped (set-order ambiguity)
// - opportunities.{succession,young_families,high_value}[*].current_branches sorted
function canonicalize(baseline) {
  const opp = baseline?.stats?.opportunities;
  if (!opp) return baseline;
  for (const row of opp.cross_sell ?? []) delete row.current_branch;
  for (const group of ['succession', 'young_families', 'high_value']) {
    for (const row of opp[group] ?? []) {
      if (Array.isArray(row.current_branches)) row.current_branches = [...row.current_branches].sort();
    }
  }
  return baseline;
}

function diff(expected, actual, path = '') {
  const diffs = [];
  if (typeof expected !== typeof actual) {
    diffs.push({ path, expected, actual, kind: 'type' });
    return diffs;
  }
  if (expected === null || actual === null || typeof expected !== 'object') {
    if (expected !== actual) {
      if (typeof expected === 'number' && typeof actual === 'number' && Math.abs(expected - actual) < 1e-9) {
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

async function main() {
  const mapping = await readJson(CONFIG);
  const branchIndex = buildBranchIndex(mapping);
  const clients = await readJson(join(FIX, 'clients.json'));
  const polices = await readJson(join(FIX, 'polices.json'));
  const compagnies = await readJson(join(FIX, 'compagnies.json'));
  const sinistres = await readJson(join(FIX, 'sinistres.json'));
  const baseline = await readJson(join(HERE, 'baseline.json'));

  const stats = computeAllStats(clients, polices, compagnies, sinistres, SNAPSHOT_YEAR, branchIndex);
  const client_total = computeClientTotal(clients, polices, compagnies, SNAPSHOT_YEAR, branchIndex);
  const flat = extractMetricsFlat(stats);
  const tree = buildMetricTree(new Set(Object.keys(flat)));

  const actual = canonicalize({ stats, client_total, flat, tree });
  const sortedBaseline = sortKeys(baseline);
  const sortedActual = sortKeys(actual);

  const diffs = diff(sortedBaseline, sortedActual);
  if (diffs.length === 0) {
    console.log(
      `parity ✔  stats.sections=${Object.keys(baseline.stats).length}  ` +
      `client_total=${baseline.client_total.length}  ` +
      `flat=${Object.keys(baseline.flat).length}  ` +
      `tree=${baseline.tree.length}`
    );
    process.exit(0);
  }

  console.error(`parity ✘ — ${diffs.length} difference(s):`);
  for (const d of diffs.slice(0, 40)) {
    const exp = JSON.stringify(d.expected);
    const act = JSON.stringify(d.actual);
    console.error(`  ${d.path}  expected=${exp}  actual=${act}  (${d.kind})`);
  }
  if (diffs.length > 40) console.error(`  ... and ${diffs.length - 40} more`);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
