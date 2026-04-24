// Cloud sync via the File System Access API.
//
// Idea: the user picks a file on their file system that happens to live inside
// a cloud-synced folder — iCloud Drive, OneDrive, Dropbox, Google Drive.
// We persist the FileSystemFileHandle in IndexedDB (handles *are* serializable
// into IDB, unlike most objects), along with the passphrase the user chose for
// this sync file, and after every local DB save we also write the same
// encrypted payload to the picked file. The cloud provider then propagates it
// to other devices.
//
// Read-back on boot: if a handle exists and the remote file is newer than the
// local OPFS copy, we offer to pull it in. (Pull is wired separately in main.)
//
// Availability: `showSaveFilePicker` is Chromium-only (Chrome / Edge / Opera
// desktop, plus Android Chrome). Safari and Firefox don't implement it as of
// 2026. The `isSyncSupported` check lets the UI hide the feature elsewhere.
//
// Security note: the passphrase is stored in IndexedDB in plaintext. This is
// the same trust model as localStorage — anything with access to the origin
// can read it. We call this out in the GDPR disclaimer.

import { exportEncrypted } from './backup.js';

const IDB_NAME = 'portefeuille-sync';
const IDB_STORE = 'sync';
const IDB_KEY = 'active';

export function isSyncSupported() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
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

async function idbGet() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Verify we still have write permission on the handle. Browsers require a
// user gesture the first time; afterwards queryPermission may return 'granted'
// without a prompt. If it's 'prompt', we request again (which will fail if not
// in a user gesture — caller should handle the rejection).
async function ensureWritable(handle) {
  if (typeof handle.queryPermission !== 'function') return true;
  const q = await handle.queryPermission({ mode: 'readwrite' });
  if (q === 'granted') return true;
  const r = await handle.requestPermission({ mode: 'readwrite' });
  return r === 'granted';
}

export async function getSyncHandle() {
  const rec = await idbGet();
  return rec || null;
}

export async function setSyncHandle(handle, { passphrase }) {
  if (!handle) throw new Error('handle required');
  if (!passphrase) throw new Error('passphrase required');
  await idbPut({ handle, passphrase, name: handle.name || '', savedAt: Date.now() });
}

export async function clearSyncHandle() {
  await idbDelete();
}

// Write the current DB (+ optional profile) to the linked sync file.
// Silently no-ops if no handle is linked. Throws on actual write failures so
// the caller can surface them.
export async function writeToSync(dbBytes, profile) {
  const rec = await idbGet();
  if (!rec) return { written: false };
  const ok = await ensureWritable(rec.handle);
  if (!ok) return { written: false, reason: 'permission-denied' };
  const payload = await exportEncrypted(dbBytes, rec.passphrase, { profile });
  const writable = await rec.handle.createWritable();
  try {
    await writable.write(payload);
  } finally {
    await writable.close();
  }
  return { written: true, bytes: payload.byteLength };
}

// Read the sync file's current contents and its mtime. Returns null if no
// handle, or if permission is not granted.
export async function readFromSync() {
  const rec = await idbGet();
  if (!rec) return null;
  const ok = await ensureWritable(rec.handle);
  if (!ok) return null;
  const file = await rec.handle.getFile();
  const buf = await file.arrayBuffer();
  return {
    bytes: new Uint8Array(buf),
    lastModified: file.lastModified,
    name: file.name,
    passphrase: rec.passphrase,
  };
}
