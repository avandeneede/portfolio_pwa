// Re-parse a snapshot from its stored source XLSX files.
//
// When the parser, the detect heuristics, or the schema change, snapshots
// already imported with the old code keep their stale parsed rows. Rather
// than asking the broker to re-upload, we keep the raw XLSX bytes in the
// DB (table `snapshot_files`) and offer a one-click "reparse" that:
//
//   1. fetches the saved files for the snapshot
//   2. lazy-loads SheetJS
//   3. re-runs `parseFile` on each
//   4. wipes the snapshot's data tables (clients/polices/compagnies/sinistres)
//   5. re-inserts the freshly parsed rows
//   6. persists the DB
//
// The snapshot row itself (id, date, label, files) is preserved so URLs
// and references stay valid.

import { parseFile } from '../ingest/parser.js';

// slot_type -> table name. Mirrors the SLOTS table mapping in upload.js.
const SLOT_TO_TABLE = {
  clients: 'clients',
  polices: 'polices',
  compagnies: 'compagnies_polices',
  sinistres: 'sinistres',
};

// Reparse a single snapshot. `ctx` must expose `db`, `loadXLSX`, `persistDb`.
// Returns `{ slot_type, filename, row_count, warnings }[]`.
export async function reparseSnapshot(ctx, snapshotId) {
  const files = ctx.db.getSnapshotFiles(snapshotId);
  if (!files || files.length === 0) {
    throw new Error('NO_SOURCE_FILES');
  }
  const XLSX = await ctx.loadXLSX();

  // Parse all files first. If any fails, abort before touching the DB so the
  // snapshot's existing rows stay intact.
  const parsed = [];
  for (const f of files) {
    const table = SLOT_TO_TABLE[f.slot_type];
    if (!table) continue;  // unknown slot type — ignore (forward compat)
    // parseFile expects an ArrayBuffer-ish; pass the underlying buffer of the
    // Uint8Array we got back from sql.js.
    const buf = f.bytes.buffer.slice(
      f.bytes.byteOffset,
      f.bytes.byteOffset + f.bytes.byteLength
    );
    const result = await parseFile(XLSX, buf, f.filename);
    parsed.push({ slot_type: f.slot_type, table, filename: f.filename, result });
  }

  // Atomic-ish swap: wipe rows, then insert fresh ones. sql.js runs in a
  // single thread so there's no concurrent reader to worry about.
  ctx.db.deleteSnapshotRows(snapshotId);
  const summary = [];
  for (const p of parsed) {
    ctx.db.insertRows(p.table, snapshotId, p.result.rows);
    summary.push({
      slot_type: p.slot_type,
      filename: p.filename,
      row_count: p.result.row_count,
      warnings: p.result.warnings || [],
    });
  }
  await ctx.persistDb();
  return summary;
}

// Reparse every snapshot that has source files. Returns
// `{ ok: number, skipped: number, failed: { id, error }[] }`.
// Snapshots without saved files (legacy / pre-feature) are skipped silently.
export async function reparseAllSnapshots(ctx) {
  const snapshots = ctx.db.listSnapshots();
  let ok = 0, skipped = 0;
  const failed = [];
  for (const s of snapshots) {
    if (!ctx.db.hasSnapshotFiles(s.id)) { skipped += 1; continue; }
    try {
      await reparseSnapshot(ctx, s.id);
      ok += 1;
    } catch (e) {
      failed.push({ id: s.id, label: s.label, error: e.message });
    }
  }
  return { ok, skipped, failed };
}
