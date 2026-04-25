#!/usr/bin/env node
// Unit tests for src/core/ helpers. Pure-function level — no fixtures, no
// SQLite, no DOM. Complements tests/snapshot/ (integration over the full
// pipeline) by pinning down the deterministic primitives so a regression
// shows up here with a tight, readable failure instead of a 200-line
// snapshot diff.
//
// Conventions:
//   - One file, no framework. node:assert/strict + a 4-line `test()` helper.
//   - Each test is independent; failures print the expected vs actual.
//   - Exit non-zero on any failure so CI / pre-commit can gate on it.
//
// Usage:
//   node tests/unit/run.mjs

import { strict as assert } from 'node:assert';

import {
  pyRound,
  normalizeAddress,
  computeClientOverview,
  computeEntrepriseKeys,
  computeBranches,
} from '../../src/core/analyzer.js';
import { buildBranchIndex, getBranchCode } from '../../src/core/branch_mapping.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    failures.push({ name, error: e });
  }
}

// --- pyRound ---------------------------------------------------------------
// Banker's rounding parity with Python 3's round(). The whole portfolio
// pipeline depends on this function rounding identically to the legacy
// Python reference; otherwise pct totals drift in the 4th decimal and the
// snapshot baseline goes red for the wrong reason.

test('pyRound: integer halves round to even', () => {
  assert.equal(pyRound(0.5), 0);
  assert.equal(pyRound(1.5), 2);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
  assert.equal(pyRound(-0.5), 0);
  assert.equal(pyRound(-1.5), -2);
});

test('pyRound: non-half values round normally', () => {
  assert.equal(pyRound(0.4), 0);
  assert.equal(pyRound(0.6), 1);
  assert.equal(pyRound(-0.4), 0);
  assert.equal(pyRound(-0.6), -1);
});

test('pyRound: ndigits>0 keeps decimals', () => {
  // 12.345 * 100 = 1234.4999… in IEEE754, so banker's rounding sees diff<0.5
  // and rounds down. Pin the actual behavior so a future "fix" that breaks
  // Python-parity shows up here, not in the snapshot baseline.
  assert.equal(pyRound(12.345, 2), 12.34);
  assert.equal(pyRound(12.355, 2), 12.36);
  assert.equal(pyRound(1.25, 1), 1.2);  // exact half, even neighbour wins
  assert.equal(pyRound(1.35, 1), 1.4);  // FP: 1.35*10 = 13.499… → diff<0.5 …
  // (the previous line documents FP behavior; both are inherited from Py3's
  //  round() against the same IEEE754 doubles)
});

test('pyRound: passes through non-finite', () => {
  assert.ok(Number.isNaN(pyRound(NaN)));
  assert.equal(pyRound(Infinity), Infinity);
  assert.equal(pyRound(-Infinity), -Infinity);
});

// --- normalizeAddress ------------------------------------------------------

test('normalizeAddress: empty/null', () => {
  assert.equal(normalizeAddress(null), '');
  assert.equal(normalizeAddress(undefined), '');
  assert.equal(normalizeAddress(''), '');
});

test('normalizeAddress: strips parenthetical qualifiers', () => {
  // From the inline doc-comment: "Kasseide(Lie) 58" -> "Kasseide 58"
  assert.equal(normalizeAddress('Kasseide(Lie) 58'), 'kasseide 58');
});

test('normalizeAddress: collapses separators', () => {
  assert.equal(normalizeAddress('Rue de la Loi, 16'), 'rue de la loi 16');
  assert.equal(normalizeAddress('Av. Louise / 100'), 'avenue louise 100');
});

test('normalizeAddress: expands word-boundary abbreviations', () => {
  // Each replacement uses \b…\b so they only fire on standalone tokens.
  // "Hauptstr" doesn't expand because there's no boundary between "t" and "s".
  assert.equal(normalizeAddress('Av Louise 100'), 'avenue louise 100');
  assert.equal(normalizeAddress('Bd du Souverain'), 'boulevard du souverain');
  assert.equal(normalizeAddress('Hoofd str 5'), 'hoofd straat 5');
  // "rue" alone normalises through (the rué? branch is a defense for
  // diacritic-only typos but only fires when followed by a word boundary).
  assert.equal(normalizeAddress('Rue Royale'), 'rue royale');
});

// --- branch_mapping --------------------------------------------------------

test('buildBranchIndex / getBranchCode: forward + reverse lookup', () => {
  const idx = buildBranchIndex({
    AUTO: ['Auto', 'Auto missionnée'],
    INC: ['Incendie habitation'],
  });
  assert.deepEqual(new Set(idx.codes), new Set(['AUTO', 'INC']));
  assert.equal(getBranchCode('Auto', idx.reverse), 'AUTO');
  // Case + surrounding whitespace.
  assert.equal(getBranchCode('  AUTO MISSIONNÉE  ', idx.reverse), 'AUTO');
  assert.equal(getBranchCode('Incendie habitation', idx.reverse), 'INC');
});

test('getBranchCode: unknown / falsy → DIV', () => {
  const idx = buildBranchIndex({ AUTO: ['Auto'] });
  assert.equal(getBranchCode(null, idx.reverse), 'DIV');
  assert.equal(getBranchCode('', idx.reverse), 'DIV');
  assert.equal(getBranchCode('Some random thing', idx.reverse), 'DIV');
});

// --- computeEntrepriseKeys -------------------------------------------------

test('computeEntrepriseKeys: physique_morale=Personne morale → entreprise', () => {
  const clients = [
    { dossier_key: 'A', physique_morale: 'Personne morale' },
    { dossier_key: 'B', physique_morale: 'P' },
  ];
  const eKeys = computeEntrepriseKeys(clients, []);
  assert.ok(eKeys.has('A'));
  assert.ok(!eKeys.has('B'));
});

test('computeEntrepriseKeys: travailleur indépendant → entreprise', () => {
  const clients = [
    { dossier_key: 'C', physique_morale: 'P', statut_social: 'Travailleur indépendant' },
    { dossier_key: 'D', physique_morale: 'P', statut_social: 'Salarié' },
  ];
  const eKeys = computeEntrepriseKeys(clients, []);
  assert.ok(eKeys.has('C'));
  assert.ok(!eKeys.has('D'));
});

// --- computeClientOverview -------------------------------------------------

test('computeClientOverview: empty → zeros', () => {
  const r = computeClientOverview([], [], null);
  assert.equal(r.total, 0);
  assert.equal(r.particuliers, 0);
  assert.equal(r.entreprises, 0);
  assert.equal(r.active_clients, 0);
});

test('computeClientOverview: counts particuliers vs entreprises and active', () => {
  const clients = [
    { dossier_key: 'A', physique_morale: 'P' },                   // particulier, has police
    { dossier_key: 'B', physique_morale: 'P' },                   // particulier, no police
    { dossier_key: 'C', physique_morale: 'Personne morale' },     // entreprise, has police
    { dossier_key: 'D', physique_morale: 'Personne morale' },     // entreprise, no police
  ];
  const polices = [
    { dossier_key: 'A', type_police: 'Auto' },
    { dossier_key: 'C', type_police: 'RC entreprise' },
  ];
  const r = computeClientOverview(clients, polices, null);
  assert.equal(r.total, 4);
  assert.equal(r.particuliers, 2);
  assert.equal(r.entreprises, 2);
  assert.equal(r.active_clients, 2);
  assert.equal(r.active_particuliers, 1);
  assert.equal(r.active_entreprises, 1);
  assert.equal(r.clients_sans_police, 2);
  // pct_particuliers = 2/4 * 100 = 50.0 (banker's rounding doesn't affect this).
  assert.equal(r.pct_particuliers, 50);
  assert.equal(r.pct_entreprises, 50);
});

// --- computeBranches -------------------------------------------------------

test('computeBranches: groups by branch code via mapping, falls back to DIV', () => {
  const idx = buildBranchIndex({
    AUTO: ['Auto'],
    INC: ['Incendie'],
  });
  const polices = [
    { type_police: 'Auto', domaine: 'Auto' },
    { type_police: 'Auto', domaine: 'Auto' },
    { type_police: 'Incendie', domaine: 'Habitation' },
    { type_police: 'Mystery', domaine: 'Autres' },
  ];
  const r = computeBranches(polices, idx);
  assert.equal(r.total, 4);
  // Sorted by count desc.
  const codes = r.branches.map((b) => b.code);
  assert.equal(codes[0], 'AUTO'); // 2
  // INC and DIV both have 1 — both must be present.
  assert.ok(codes.includes('INC'));
  assert.ok(codes.includes('DIV'));
  // Domain percentages also computed.
  const auto = r.domains.find((d) => d.label === 'Auto');
  assert.equal(auto.count, 2);
  assert.equal(auto.pct, 50);
});

test('computeBranches: empty → empty', () => {
  const idx = buildBranchIndex({ AUTO: ['Auto'] });
  const r = computeBranches([], idx);
  assert.equal(r.total, 0);
  assert.deepEqual(r.branches, []);
  assert.deepEqual(r.domains, []);
});

// --- summary ---------------------------------------------------------------

if (failed > 0) {
  console.error(`unit ✗  ${passed} passed, ${failed} failed`);
  for (const f of failures) {
    console.error(`\n  FAIL: ${f.name}`);
    console.error(`    ${f.error.message}`);
    if (f.error.stack) {
      const indent = f.error.stack.split('\n').slice(1, 4).map((l) => '    ' + l.trim()).join('\n');
      console.error(indent);
    }
  }
  process.exit(1);
}
console.log(`unit ✔  ${passed} tests passed`);
