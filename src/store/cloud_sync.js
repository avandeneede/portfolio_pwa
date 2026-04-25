// Cloud sync via the File System Access API.
//
// Idea: the user picks a file on their file system that happens to live inside
// a cloud-synced folder — iCloud Drive, OneDrive, Dropbox, Google Drive.
// We persist the FileSystemFileHandle in IndexedDB (handles *are* serializable
// into IDB, unlike most objects) and after every local DB save we also write
// the same encrypted payload to the picked file. The cloud provider then
// propagates it to other devices.
//
// Read-back on boot: if a handle exists and the remote file is newer than the
// local OPFS copy, we offer to pull it in. (Pull is wired separately in main.)
//
// Availability: `showSaveFilePicker` is Chromium-only (Chrome / Edge / Opera
// desktop, plus Android Chrome). Safari and Firefox don't implement it as of
// 2026. The `isSyncSupported` check lets the UI hide the feature elsewhere.
//
// SECURITY: the passphrase is never persisted. It lives only in module-scope
// memory for the lifetime of the tab. On boot, the app calls
// `requestPassphrase()` once if a sync handle is linked — the user enters it,
// it's held in RAM, and lost when the tab closes. Auto-saves between then and
// tab close use the cached passphrase. If the user cancels the boot prompt or
// reaches a sync write before unlocking, the write is skipped silently
// (`reason: 'locked'`) and surfaced via the settings UI.
//
// Threat model improvement vs. v50: anything with origin access could read
// IDB plaintext. Now an attacker needs to either be present during an active
// session or trigger a fresh prompt — significantly higher bar.

import { exportEncrypted } from './backup.js';

const IDB_NAME = 'portefeuille-sync';
const IDB_STORE = 'sync';
const IDB_KEY = 'active';
// One-shot migration: if a legacy record carries a `passphrase` field we
// strip it on first read. Tracked so we don't re-write on every boot.
const LEGACY_FIELD = 'passphrase';

// Module-scope passphrase cache. Cleared on tab close (no persistence).
let cachedPassphrase = null;
// Caller-supplied prompt. Installed at boot by main.js so this module
// stays UI-agnostic and tree-shakeable in tests.
let passphrasePrompt = null;

// Full File System Access API: Chromium only. Unlocks live auto-sync:
// after every local DB save we also write the same encrypted blob to the
// picked file, so iCloud/OneDrive/Dropbox can propagate it automatically.
export function isSyncSupported() {
  // showSaveFilePicker is from the File System Access API. It's standardized
  // in WICG but not yet in TS lib.dom; cast to any to access it without
  // pulling in @types/wicg-file-system-access.
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : null);
  return !!w && typeof w.showSaveFilePicker === 'function';
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

// One-shot migration: any record from v50 or earlier carries a plaintext
// `passphrase` field. Strip it and rewrite the record without it. The user
// will be prompted next time they save, exactly like a fresh link.
async function stripLegacyPassphraseField(rec) {
  if (!rec || !(LEGACY_FIELD in rec)) return rec;
  const { [LEGACY_FIELD]: _stripped, ...clean } = rec;
  await idbPut(clean);
  return clean;
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
  let rec = await idbGet();
  rec = await stripLegacyPassphraseField(rec);
  return rec || null;
}

// Link a sync file. The passphrase is cached in memory for this session
// (so the next auto-write doesn't need to re-prompt), but never persisted.
export async function setSyncHandle(handle, { passphrase }) {
  if (!handle) throw new Error('handle required');
  if (!passphrase) throw new Error('passphrase required');
  await idbPut({ handle, name: handle.name || '', savedAt: Date.now() });
  cachedPassphrase = passphrase;
}

export async function clearSyncHandle() {
  await idbDelete();
  cachedPassphrase = null;
}

// --- Passphrase lifecycle (memory only) -------------------------------------

// Install the prompt callback at app boot. Decoupled from the modal module so
// this file stays import-light for smoke tests.
export function setPassphrasePrompt(fn) {
  passphrasePrompt = typeof fn === 'function' ? fn : null;
}

export function hasCachedPassphrase() {
  return cachedPassphrase != null;
}

// Forget the in-memory passphrase. Wired to a "Lock sync" button in settings.
export function lockSync() {
  cachedPassphrase = null;
}

// Try to obtain a passphrase, in order:
//   1. cached in memory (fast path)
//   2. caller-supplied (e.g. unlock-on-boot path)
//   3. prompt the user via the installed callback
// Returns null if no callback is installed or the user cancelled.
/**
 * @param {{ explicit?: string|null, prompt?: boolean }} [opts]
 * @returns {Promise<string|null>}
 */
export async function ensurePassphrase({ explicit, prompt = true } = {}) {
  if (explicit) {
    cachedPassphrase = explicit;
    return cachedPassphrase;
  }
  if (cachedPassphrase) return cachedPassphrase;
  if (!prompt || !passphrasePrompt) return null;
  const value = await passphrasePrompt();
  if (value) cachedPassphrase = value;
  return cachedPassphrase;
}

// Write the current DB (+ optional profile) to the linked sync file.
// Silently no-ops if no handle is linked or no passphrase is cached and we
// can't prompt (background save). Throws on actual write failures so the
// caller can surface them.
//
// Options:
//   prompt: when false (default for fire-and-forget background saves), skip
//           prompting if the passphrase isn't cached. UI-initiated calls pass
//           `prompt: true` so the user sees the unlock modal.
export async function writeToSync(dbBytes, profile, { prompt = false } = {}) {
  const rec = await getSyncHandle();
  if (!rec) return { written: false, reason: 'no-handle' };
  const passphrase = await ensurePassphrase({ prompt });
  if (!passphrase) return { written: false, reason: 'locked' };
  const ok = await ensureWritable(rec.handle);
  if (!ok) return { written: false, reason: 'permission-denied' };
  const payload = await exportEncrypted(dbBytes, passphrase, { profile });
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
//
// If the passphrase isn't cached we prompt for it here (this is always a
// user-initiated path — boot pull-in or "sync now" — so prompting is fine).
export async function readFromSync({ prompt = true } = {}) {
  const rec = await getSyncHandle();
  if (!rec) return null;
  const ok = await ensureWritable(rec.handle);
  if (!ok) return null;
  const passphrase = await ensurePassphrase({ prompt });
  if (!passphrase) return { locked: true };
  const file = await rec.handle.getFile();
  const buf = await file.arrayBuffer();
  return {
    bytes: new Uint8Array(buf),
    lastModified: file.lastModified,
    name: file.name,
    passphrase,
  };
}
