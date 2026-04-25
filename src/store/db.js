// sql.js wrapper. SQLite compiled to WASM, runs entirely in-browser.
//
// The DB holds snapshots and their rows. Stats are recomputed on demand from
// the rows via analyzer.js (fast enough; keeps stats_json out of the schema).
//
// init() is async because sql.js needs to fetch the WASM binary.
// Subsequent calls reuse the initialized SQL factory.

let SQL = null;
let initPromise = null;

// Caller passes loadWasm() — in browser it fetches vendor/sql.js/sql-wasm.wasm,
// in Node it reads from disk. This keeps db.js environment-agnostic.
export async function init({ loadSqlJs, locateFile }) {
  if (SQL) return SQL;
  if (!initPromise) {
    initPromise = (async () => {
      const initSqlJs = await loadSqlJs();
      SQL = await initSqlJs({ locateFile });
      return SQL;
    })();
  }
  return initPromise;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  label         TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  snapshot_id           INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  dossier               TEXT, sous_dossier TEXT, dossier_key TEXT,
  classement            TEXT, titre TEXT, nom TEXT, nom_conjoint TEXT,
  rue                   TEXT, pays TEXT, code_postal TEXT, localite TEXT,
  langue                TEXT, date_naissance TEXT,
  telephone             TEXT, description_telephone TEXT, fax TEXT, email TEXT,
  profession            TEXT, physique_morale TEXT, etat_civil TEXT, sexe TEXT,
  forme_juridique       TEXT, statut_social TEXT
);
CREATE INDEX IF NOT EXISTS idx_clients_snapshot ON clients(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_clients_dossier_key ON clients(snapshot_id, dossier_key);

CREATE TABLE IF NOT EXISTS polices (
  snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  dossier       TEXT, sous_dossier TEXT, dossier_key TEXT, email TEXT,
  police        TEXT, date_effet TEXT, domaine TEXT, type_police TEXT,
  compagnie     TEXT
);
CREATE INDEX IF NOT EXISTS idx_polices_snapshot ON polices(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_polices_dossier_key ON polices(snapshot_id, dossier_key);

CREATE TABLE IF NOT EXISTS compagnies_polices (
  snapshot_id            INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  nom                    TEXT, numero_fsma TEXT, domaine TEXT,
  dossier                TEXT, sous_dossier TEXT, dossier_key TEXT,
  police                 TEXT,
  prime_totale_annuelle  REAL, commission_annuelle REAL, periodicite TEXT
);
CREATE INDEX IF NOT EXISTS idx_comp_snapshot ON compagnies_polices(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_comp_dossier_key ON compagnies_polices(snapshot_id, dossier_key);

CREATE TABLE IF NOT EXISTS sinistres (
  snapshot_id    INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  dossier        TEXT, sous_dossier TEXT, dossier_key TEXT,
  classement     TEXT, nom TEXT, police TEXT, description TEXT,
  date_evenement TEXT, etat_dossier TEXT, date_etat TEXT,
  domaine        TEXT, type_police TEXT
);
CREATE INDEX IF NOT EXISTS idx_sin_snapshot ON sinistres(snapshot_id);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- Raw source XLSX files kept alongside the parsed rows. Lets the user trigger
-- a full re-parse after parser/code changes without re-uploading. One row per
-- (snapshot, slot_type) — replacing a slot replaces the file. Lives inside the
-- DB BLOB so it round-trips through .ptf backups automatically.
CREATE TABLE IF NOT EXISTS snapshot_files (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  slot_type   TEXT    NOT NULL,
  filename    TEXT    NOT NULL,
  bytes       BLOB    NOT NULL,
  PRIMARY KEY (snapshot_id, slot_type)
);
CREATE INDEX IF NOT EXISTS idx_snapfiles_snapshot ON snapshot_files(snapshot_id);
`;

const CLIENT_COLS = ['dossier','sous_dossier','dossier_key','classement','titre','nom','nom_conjoint','rue','pays','code_postal','localite','langue','date_naissance','telephone','description_telephone','fax','email','profession','physique_morale','etat_civil','sexe','forme_juridique','statut_social'];
const POLICE_COLS = ['dossier','sous_dossier','dossier_key','email','police','date_effet','domaine','type_police','compagnie'];
const COMP_COLS = ['nom','numero_fsma','domaine','dossier','sous_dossier','dossier_key','police','prime_totale_annuelle','commission_annuelle','periodicite'];
const SIN_COLS = ['dossier','sous_dossier','dossier_key','classement','nom','police','description','date_evenement','etat_dossier','date_etat','domaine','type_police'];

const TABLE_META = {
  clients: { cols: CLIENT_COLS },
  polices: { cols: POLICE_COLS },
  compagnies_polices: { cols: COMP_COLS },
  sinistres: { cols: SIN_COLS },
};

export class Database {
  constructor(raw) {
    this.raw = raw;
    this.raw.run('PRAGMA foreign_keys = ON;');
  }

  static create() {
    if (!SQL) throw new Error('db.init() must be called first');
    const raw = new SQL.Database();
    raw.run(SCHEMA);
    return new Database(raw);
  }

  static open(bytes) {
    if (!SQL) throw new Error('db.init() must be called first');
    const raw = new SQL.Database(bytes);
    // Ensure schema exists (idempotent) for forward-compat.
    raw.run(SCHEMA);
    return new Database(raw);
  }

  export() { return this.raw.export(); }
  close() { this.raw.close(); }

  kvGet(key) {
    const res = this.raw.exec('SELECT v FROM kv WHERE k = ?', [key]);
    if (res.length === 0 || res[0].values.length === 0) return null;
    return res[0].values[0][0];
  }
  kvSet(key, value) {
    this.raw.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', [key, String(value)]);
  }

  listSnapshots() {
    const res = this.raw.exec(
      'SELECT id, snapshot_date, label, created_at FROM snapshots ORDER BY snapshot_date DESC, id DESC'
    );
    if (res.length === 0) return [];
    return res[0].values.map(([id, snapshot_date, label, created_at]) => ({
      id, snapshot_date, label, created_at,
    }));
  }

  getSnapshot(id) {
    const res = this.raw.exec(
      'SELECT id, snapshot_date, label, created_at FROM snapshots WHERE id = ?',
      [id]
    );
    if (res.length === 0 || res[0].values.length === 0) return null;
    const [i, d, l, c] = res[0].values[0];
    return { id: i, snapshot_date: d, label: l, created_at: c };
  }

  createSnapshot({ snapshot_date, label }) {
    this.raw.run(
      'INSERT INTO snapshots (snapshot_date, label) VALUES (?, ?)',
      [snapshot_date, label]
    );
    const res = this.raw.exec('SELECT last_insert_rowid()');
    return res[0].values[0][0];
  }

  deleteSnapshot(id) {
    this.raw.run('DELETE FROM snapshots WHERE id = ?', [id]);
  }

  updateSnapshot(id, { snapshot_date, label }) {
    // Only updates the fields actually provided. The label is persisted too
    // so legacy export paths keep working; the shell re-derives it from the
    // date at render time for locale-aware display.
    const sets = [];
    const vals = [];
    if (snapshot_date != null) { sets.push('snapshot_date = ?'); vals.push(snapshot_date); }
    if (label != null) { sets.push('label = ?'); vals.push(label); }
    if (sets.length === 0) return;
    vals.push(id);
    this.raw.run(`UPDATE snapshots SET ${sets.join(', ')} WHERE id = ?`, vals);
  }

  insertRows(table, snapshotId, rows) {
    const meta = TABLE_META[table];
    if (!meta) throw new Error(`Unknown table: ${table}`);
    if (!rows || rows.length === 0) return 0;

    const cols = ['snapshot_id', ...meta.cols];
    const placeholders = cols.map(() => '?').join(',');
    const stmt = this.raw.prepare(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`
    );
    this.raw.run('BEGIN');
    try {
      for (const r of rows) {
        const values = [snapshotId, ...meta.cols.map((c) => {
          const v = r[c];
          if (v == null || v === '') return null;
          return v;
        })];
        stmt.run(values);
      }
      this.raw.run('COMMIT');
    } catch (e) {
      this.raw.run('ROLLBACK');
      throw e;
    } finally {
      stmt.free();
    }
    return rows.length;
  }

  // ---- Snapshot source files -----------------------------------------------
  //
  // Files are stored as raw bytes inside the SQLite BLOB so they round-trip
  // through .ptf backups automatically (see store/backup.js — it just wraps
  // the DB export). One row per (snapshot_id, slot_type); replacing a slot
  // overwrites the previous file.
  //
  // `files` is an array of `{ slot_type, filename, bytes (Uint8Array) }`.
  saveSnapshotFiles(snapshotId, files) {
    if (!files || files.length === 0) return 0;
    const stmt = this.raw.prepare(
      'INSERT OR REPLACE INTO snapshot_files (snapshot_id, slot_type, filename, bytes) VALUES (?,?,?,?)'
    );
    this.raw.run('BEGIN');
    try {
      for (const f of files) {
        if (!f || !f.slot_type || !f.bytes) continue;
        stmt.run([snapshotId, f.slot_type, f.filename || '', f.bytes]);
      }
      this.raw.run('COMMIT');
    } catch (e) {
      this.raw.run('ROLLBACK');
      throw e;
    } finally {
      stmt.free();
    }
    return files.length;
  }

  // Returns `[{ slot_type, filename, bytes (Uint8Array) }]`. Empty array if
  // the snapshot was created before source-file storage existed.
  getSnapshotFiles(snapshotId) {
    const res = this.raw.exec(
      'SELECT slot_type, filename, bytes FROM snapshot_files WHERE snapshot_id = ?',
      [snapshotId]
    );
    if (res.length === 0) return [];
    return res[0].values.map(([slot_type, filename, bytes]) => ({
      slot_type, filename, bytes,
    }));
  }

  hasSnapshotFiles(snapshotId) {
    const res = this.raw.exec(
      'SELECT COUNT(*) FROM snapshot_files WHERE snapshot_id = ?',
      [snapshotId]
    );
    if (res.length === 0) return false;
    return Number(res[0].values[0][0]) > 0;
  }

  // Wipe data tables for a snapshot but keep the snapshot row + its source
  // files. Used by the reparse flow before re-inserting freshly parsed rows.
  deleteSnapshotRows(snapshotId) {
    this.raw.run('BEGIN');
    try {
      for (const table of Object.keys(TABLE_META)) {
        this.raw.run(`DELETE FROM ${table} WHERE snapshot_id = ?`, [snapshotId]);
      }
      this.raw.run('COMMIT');
    } catch (e) {
      this.raw.run('ROLLBACK');
      throw e;
    }
  }

  fetchRows(table, snapshotId) {
    const meta = TABLE_META[table];
    if (!meta) throw new Error(`Unknown table: ${table}`);
    const res = this.raw.exec(
      `SELECT ${meta.cols.join(',')} FROM ${table} WHERE snapshot_id = ?`,
      [snapshotId]
    );
    if (res.length === 0) return [];
    const cols = res[0].columns;
    return res[0].values.map((row) => {
      const obj = {};
      cols.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
  }
}
