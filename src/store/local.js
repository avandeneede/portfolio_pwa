// Local persistence for the SQLite DB bytes.
//
// Preferred: OPFS (Origin Private File System) — zero-overhead, quota-backed,
// invisible to user, survives reloads. Widely supported (Chrome/Safari/Firefox).
//
// Fallback: IndexedDB blob store if OPFS is unavailable.
//
// API intentionally small: load() returns Uint8Array|null, save(bytes) persists,
// clear() wipes. No streaming; DB is typically <50MB for a broker portfolio.

const DB_FILENAME = 'portefeuille.sqlite';
const IDB_NAME = 'portefeuille';
const IDB_STORE = 'blobs';

async function opfsAvailable() {
  try {
    if (!('storage' in navigator) || !navigator.storage.getDirectory) return false;
    const root = await navigator.storage.getDirectory();
    return !!root;
  } catch { return false; }
}

async function opfsLoad() {
  const root = await navigator.storage.getDirectory();
  try {
    const handle = await root.getFileHandle(DB_FILENAME);
    const file = await handle.getFile();
    if (file.size === 0) return null;
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    if (e.name === 'NotFoundError') return null;
    throw e;
  }
}

async function opfsSave(bytes) {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(DB_FILENAME, { create: true });
  // getFile + write via createWritable (supported in browsers with OPFS write)
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
}

async function opfsClear() {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DB_FILENAME).catch(() => {});
  } catch { /* ignore */ }
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbLoad() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(DB_FILENAME);
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSave(bytes) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, DB_FILENAME);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(DB_FILENAME);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let backend = null;
async function getBackend() {
  if (backend) return backend;
  backend = (await opfsAvailable())
    ? { name: 'opfs', load: opfsLoad, save: opfsSave, clear: opfsClear }
    : { name: 'idb', load: idbLoad, save: idbSave, clear: idbClear };
  return backend;
}

export async function load() { return (await getBackend()).load(); }
export async function save(bytes) { return (await getBackend()).save(bytes); }
export async function clear() { return (await getBackend()).clear(); }
export async function backendName() { return (await getBackend()).name; }

// Request persistent storage so the browser won't evict the DB under quota pressure.
// Safe to call multiple times; no-op if already granted.
export async function requestPersistent() {
  try {
    if (navigator.storage?.persist) return !!(await navigator.storage.persist());
  } catch { /* ignore */ }
  return false;
}
