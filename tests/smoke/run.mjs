// Node smoke tests for crypto + parser + db.
//
// Runs without any framework — tiny custom assert. Exits 0 on success,
// 1 on any failure. Invoked from CI and locally via:
//   node tests/smoke/run.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { encryptBlob, decryptBlob } from '../../src/store/crypto.js';
import { exportEncrypted, importEncrypted } from '../../src/store/backup.js';
import { parseWorkbook } from '../../src/ingest/parser.js';
import { init as initDb, Database } from '../../src/store/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ✓ ${msg}`); }
  else { failed += 1; console.error(`  ✗ ${msg}`); }
}

async function test(name, fn) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (e) {
    failed += 1;
    console.error(`  ✗ threw: ${e.message}`);
    console.error(e.stack);
  }
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------
await test('crypto: round-trip', async () => {
  const plain = new TextEncoder().encode('Hello, Portefeuille — contenu test.');
  const pass = 'correct horse battery staple';
  const blob = await encryptBlob(plain, pass);
  // Magic "PORT" + version byte
  assert(blob[0] === 80 && blob[1] === 79 && blob[2] === 82 && blob[3] === 84, 'magic "PORT"');
  assert(blob[4] === 1, 'version byte = 1');
  assert(blob.length > plain.length + 33, 'blob larger than plaintext + header');
  const dec = await decryptBlob(blob, pass);
  assert(new TextDecoder().decode(dec) === 'Hello, Portefeuille — contenu test.', 'decrypted matches');
});

await test('crypto: wrong passphrase fails', async () => {
  const blob = await encryptBlob(new Uint8Array([1, 2, 3, 4]), 'right');
  let threw = false;
  try { await decryptBlob(blob, 'wrong'); } catch { threw = true; }
  assert(threw, 'decryption fails with wrong passphrase');
});

await test('crypto: corrupt blob fails', async () => {
  const blob = await encryptBlob(new Uint8Array([1, 2, 3, 4]), 'pass');
  blob[blob.length - 1] ^= 0xff; // flip a bit in the tag
  let threw = false;
  try { await decryptBlob(blob, 'pass'); } catch { threw = true; }
  assert(threw, 'decryption fails on tampered ciphertext');
});

// ---------------------------------------------------------------------------
// Backup envelope v2 (.ptf, opt-in profile)
// ---------------------------------------------------------------------------
await test('backup: round-trip without profile', async () => {
  const db = new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 1, 2, 3, 4]);
  const blob = await exportEncrypted(db, 'pw');
  const out = await importEncrypted(blob, 'pw');
  assert(out.db.length === db.length, 'db bytes length preserved');
  assert(out.db[0] === 0x53 && out.db[6] === 1, 'db bytes content preserved');
  assert(out.profile === null, 'profile is null when not included');
});

await test('backup: round-trip with profile', async () => {
  const db = new Uint8Array([9, 8, 7, 6]);
  const profile = { user: { name: 'Alice' }, company: { name: 'Acme', vat: 'BE0.000' } };
  const blob = await exportEncrypted(db, 'pw', { profile });
  const out = await importEncrypted(blob, 'pw');
  assert(out.db.length === 4 && out.db[0] === 9 && out.db[3] === 6, 'db bytes preserved');
  assert(out.profile && out.profile.user.name === 'Alice', 'profile.user.name round-trips');
  assert(out.profile.company.vat === 'BE0.000', 'profile.company.vat round-trips');
});

await test('backup: legacy v1 blob (no PTFP header) still reads', async () => {
  // Simulate a pre-v2 backup: plain DB bytes wrapped in the PORT v1 envelope.
  const db = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const blob = await encryptBlob(db, 'pw'); // PORT v1, plaintext = raw db
  const out = await importEncrypted(blob, 'pw');
  assert(out.db.length === db.length, 'legacy blob yields raw db bytes');
  assert(out.profile === null, 'legacy blob has no profile');
});

// ---------------------------------------------------------------------------
// Parser (SheetJS)
// ---------------------------------------------------------------------------
await test('parser: detects clients from synthetic fixture', async () => {
  const xlsxPath = resolve(__dirname, '../../vendor/sheetjs/xlsx.full.min.js');
  const XLSX = require(xlsxPath);
  assert(typeof XLSX.utils === 'object', 'SheetJS loaded');

  // Build a tiny workbook in memory. Headers match the real broker export shape
  // (accented, space-separated), which normalizeHeader() folds to snake_case.
  const headers = [
    'Dossier', 'Sous dossier', 'Nom', 'Date naissance', 'Sexe',
    'Code postal', 'Localité', 'État civil', 'Statut social', 'Physique morale',
  ];
  const rows = [
    headers,
    ['D1', 'S1', 'DOE', '1970-01-01', 'M', '1000', 'Bruxelles', 'Marié', 'Salarié', 'P'],
    ['D2', 'S2', 'SMITH', '1985-05-15', 'F', '1050', 'Ixelles', 'Célibataire', 'Indépendant', 'P'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CLIENTS');

  const result = parseWorkbook(XLSX, wb, 'clients_test.xlsx');
  assert(result.type === 'clients', `detected type clients (got ${result.type})`);
  assert(result.row_count === 2, `row count 2 (got ${result.row_count})`);
  assert(result.rows[0].nom === 'DOE', 'first row nom=DOE');
  assert(result.rows[0].date_naissance === '1970-01-01', 'ISO date preserved');
  assert(result.rows[0].dossier_key === 'D1/S1', 'dossier_key built');
});

// ---------------------------------------------------------------------------
// DB (sql.js)
// ---------------------------------------------------------------------------
await test('db: schema + insert + fetch', async () => {
  const sqlWasmJs = resolve(__dirname, '../../vendor/sql.js/sql-wasm.js');
  const sqlWasmBin = resolve(__dirname, '../../vendor/sql.js/sql-wasm.wasm');
  // Load sql.js UMD via createRequire (CommonJS).
  const initSqlJs = require(sqlWasmJs);
  await initDb({
    loadSqlJs: () => Promise.resolve(initSqlJs),
    locateFile: () => sqlWasmBin,
  });
  const db = Database.create();
  const id = db.createSnapshot({ snapshot_date: '2026-04-23', label: 'Avril 2026' });
  assert(typeof id === 'number' && id > 0, `createSnapshot returned id ${id}`);

  db.insertRows('clients', id, [
    { dossier: 'D1', sous_dossier: 'S1', dossier_key: 'D1/S1', nom: 'DOE', sexe: 'M',
      code_postal: '1000' },
    { dossier: 'D2', sous_dossier: 'S2', dossier_key: 'D2/S2', nom: 'SMITH', sexe: 'F',
      code_postal: '1050' },
  ]);
  const fetched = db.fetchRows('clients', id);
  assert(fetched.length === 2, `fetched 2 clients (got ${fetched.length})`);
  assert(fetched[0].nom === 'DOE', 'first client nom=DOE');

  const snapshots = db.listSnapshots();
  assert(snapshots.length === 1 && snapshots[0].label === 'Avril 2026', 'listSnapshots');

  // Export round-trip
  const bytes = db.export();
  assert(bytes instanceof Uint8Array && bytes.length > 0, 'export returns bytes');
  const db2 = Database.open(bytes);
  assert(db2.listSnapshots().length === 1, 'reopened DB keeps snapshot');
  db2.close();
  db.close();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
