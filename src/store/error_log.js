// Local error log. Captures uncaught errors + unhandled promise rejections
// + explicit logError() calls from screens, persists them to IndexedDB so they
// survive reloads, and exposes a simple API for the Settings panel to view,
// copy, and clear.
//
// Why local-only:
//   - Privacy: a broker's portfolio is sensitive. Routing crash logs to a
//     third party would bake an exfiltration vector into the app that no
//     amount of CSP can undo.
//   - Offline: the app runs on flaky connections (broker laptops on hotel
//     wifi). A network-bound logger silently drops the most interesting
//     errors — the ones that fire when the network breaks.
//
// Schema is intentionally tiny so the log itself can never become a bug: a
// ring buffer of {ts, kind, message, stack, route, version} entries, capped
// at LIMIT. Rotation happens inside the same transaction as the insert so we
// can never grow unbounded.
//
// Storage: own IndexedDB database (separate from store/local.js's `portefeuille`
// DB) so a corrupt SQLite blob can't take the error log down with it. That's
// exactly when we'd want it most.

import { APP_VERSION } from '../version.js';

const IDB_NAME = 'portefeuille_errors';
const IDB_STORE = 'log';
const SCHEMA_VERSION = 1;
const LIMIT = 200; // ~200 entries × ~2KB = ~400KB worst case. Plenty.

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, SCHEMA_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        // autoIncrement gives us a monotonically rising id we use both as the
        // key and as a stable sort handle for the ring buffer.
        db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Trim the store down to the most recent LIMIT entries. Runs inside the
// caller's transaction to keep the rotation atomic with the insert.
function trim(store) {
  return new Promise((resolve, reject) => {
    const countReq = store.count();
    countReq.onsuccess = () => {
      const overshoot = countReq.result - LIMIT;
      if (overshoot <= 0) { resolve(); return; }
      // Iterate from the lowest id upward and delete until we're under the cap.
      let deleted = 0;
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || deleted >= overshoot) { resolve(); return; }
        cursor.delete();
        deleted += 1;
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    };
    countReq.onerror = () => reject(countReq.error);
  });
}

/**
 * Append an entry. Best-effort: any IndexedDB failure is swallowed because the
 * error log itself must not surface errors (would loop on top of the original
 * failure). Console-warns instead so devtools can debug log breakage.
 *
 * @param {{ kind?: string, message?: string, stack?: string, route?: string, extra?: any }} entry
 */
export async function logError(entry) {
  try {
    const row = {
      ts: Date.now(),
      kind: entry.kind || 'error',
      message: String(entry.message || '').slice(0, 2000),
      stack: entry.stack ? String(entry.stack).slice(0, 6000) : null,
      route: entry.route || (typeof location !== 'undefined' ? location.hash : null),
      version: APP_VERSION,
      extra: entry.extra ? safeJson(entry.extra) : null,
    };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.add(row);
      trim(store).then(() => {}, () => {});
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // Never throw from the logger. console.warn so a dev sees it during
    // development; in prod the user will just not have an entry for this one.
    if (typeof console !== 'undefined') console.warn('[error_log] write failed', e);
  }
}

// Stringify with a safety net: circular refs, BigInts, Errors, DOM nodes etc.
// can all blow up JSON.stringify. We trade fidelity for resilience.
function safeJson(v) {
  try {
    return JSON.stringify(v, (_k, val) => {
      if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack };
      if (typeof val === 'bigint') return String(val) + 'n';
      if (val instanceof Node) return `[Node ${val.nodeName}]`;
      return val;
    }).slice(0, 4000);
  } catch {
    try { return String(v).slice(0, 1000); } catch { return null; }
  }
}

/**
 * @returns {Promise<Array<{id:number, ts:number, kind:string, message:string, stack:?string, route:?string, version:string, extra:?string}>>}
 */
export async function listErrors() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => {
        // Newest first. The store is keyPath autoIncrement, so id ordering
        // matches insertion order.
        const rows = (req.result || []).slice().sort((a, b) => b.id - a.id);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[error_log] list failed', e);
    return [];
  }
}

export async function clearErrors() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[error_log] clear failed', e);
  }
}

// Wire global handlers exactly once. Idempotent: safe to call from main.js
// boot regardless of HMR / accidental double-import.
let installed = false;
export function installGlobalErrorHandlers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    // e.error is undefined when the error came from a CORS-tainted script.
    // Fall back to e.message so we still capture *something* useful.
    const err = e.error;
    logError({
      kind: 'window.error',
      message: err?.message || e.message || 'unknown error',
      stack: err?.stack || null,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = /** @type {any} */ (e).reason;
    logError({
      kind: 'unhandledrejection',
      message: reason?.message || (typeof reason === 'string' ? reason : 'unhandled rejection'),
      stack: reason?.stack || null,
    });
  });
}

// Format a single entry as a copy-friendly multi-line string. Used by the
// "copy all" button in Settings.
export function formatEntry(row) {
  const when = new Date(row.ts).toISOString();
  const lines = [
    `[${when}] ${row.kind} (v${row.version}) ${row.route || ''}`,
    row.message,
  ];
  if (row.stack) lines.push(row.stack);
  if (row.extra) lines.push(`extra: ${row.extra}`);
  return lines.join('\n');
}
