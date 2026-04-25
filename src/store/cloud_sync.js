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

// Full File System Access API: Chromium only. Unlocks live auto-sync:
// after every local DB save we also write the same encrypted blob to the
// picked file, so iCloud/OneDrive/Dropbox can propagate it automatically.
export function isSyncSupported() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

// Web Share API with file support: iOS Safari 15+, modern Android.
// Lets the user hand the encrypted backup to the OS share sheet, which on
// iOS includes "Save to Files" → iCloud Drive. Not as seamless as FSA
// (the user must tap a button each time) but it covers the one gap iOS has.
//
// Restricted to iOS / iPadOS / Android. macOS Safari implements the API but
// its share sheet has no "Save to Files" entry — the screen ends up as
// AirDrop / Mail / Messages / Copy, which is useless for backups. Desktop
// users have File System Access (Chromium) or manual export/import.
function isMobileShareTarget() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPhone / iPod, classic iPad, and iPadOS in desktop-mode (which reports
  // "Macintosh" + touch points, hence the maxTouchPoints fallback).
  const isIOS = /iPhone|iPod|iPad/.test(ua)
    || (ua.includes('Macintosh') && (navigator.maxTouchPoints || 0) > 1);
  const isAndroid = /Android/.test(ua);
  return isIOS || isAndroid;
}

export function isShareSyncSupported() {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  if (!isMobileShareTarget()) return false;
  try {
    const probe = new File([new Uint8Array(1)], 'probe.ptf', { type: 'application/octet-stream' });
    return navigator.canShare({ files: [probe] });
  } catch (_) {
    return false;
  }
}

// Any sync path available? Used by the UI to decide whether to show the
// cloud-sync section at all (Chromium or iOS Safari).
export function isAnySyncSupported() {
  return isSyncSupported() || isShareSyncSupported();
}

// Package the DB + optional profile as an encrypted .ptf blob and hand it
// to the OS share sheet. On iOS the user picks "Save to Files" → iCloud
// Drive, overwriting the previous copy. Returns true if the share resolved,
// false if the user cancelled.
export async function shareEncryptedBackup(dbBytes, passphrase, { profile = null, filename = 'portefeuille.ptf' } = {}) {
  if (!isShareSyncSupported()) throw new Error('share-files-unsupported');
  const payload = await exportEncrypted(dbBytes, passphrase, { profile });
  const file = new File([payload], filename, { type: 'application/octet-stream' });
  try {
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) return false;
    throw e;
  }
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
