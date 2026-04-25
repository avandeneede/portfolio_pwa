// App bootstrap. Loads i18n, initializes sql.js + storage, wires routes,
// mounts the persistent shell once, and renders screens into its content slot.

import { setLocale, t, getLocale } from './i18n/index.js';
import { addRoute, start, navigate, currentPath } from './router.js';
import { init as initDb, Database } from './store/db.js';
import { load as loadBytes, save as saveBytes, backendName, requestPersistent } from './store/local.js';
import { loadProfile, saveProfile } from './store/profile.js';
import { writeToSync, getSyncHandle, setPassphrasePrompt, ensurePassphrase } from './store/cloud_sync.js';
import { askPassphraseModal } from './ui/passphrase_modal.js';
import { toast } from './ui/toast.js';
import { renderShell, refreshSidebar, getContentRoot } from './ui/shell.js';
import { ensureIconSprite } from './ui/icon.js';
// Home is the landing screen + the target of every fallback redirect.
// Keep it eager so the boot path doesn't pay an extra round-trip for it.
import { renderHome } from './screens/home.js';

// Every other screen is loaded lazily via dynamic import on first navigation.
// Cuts the boot-time JS payload roughly in half — dashboard.js + report.js +
// settings.js + evolution.js + upload.js account for the bulk of the app.
// The module cache makes subsequent hits instant.
function lazyScreen(importer, exportName) {
  let cached = null;
  return async (target, ctx, args) => {
    if (!cached) {
      const mod = await importer();
      cached = mod[exportName];
    }
    return cached(target, ctx, args);
  };
}
const renderUpload = lazyScreen(() => import('./screens/upload.js'), 'renderUpload');
const renderPreview = lazyScreen(() => import('./screens/preview.js'), 'renderPreview');
const renderDashboard = lazyScreen(() => import('./screens/dashboard.js'), 'renderDashboard');
const renderEvolution = lazyScreen(() => import('./screens/evolution.js'), 'renderEvolution');
const renderSettings = lazyScreen(() => import('./screens/settings.js'), 'renderSettings');
const renderTutorial = lazyScreen(() => import('./screens/tutorial.js'), 'renderTutorial');
import { buildBranchIndex } from './core/branch_mapping.js';
import { reparseAllSnapshots } from './core/reparse.js';
import { APP_VERSION } from './version.js';

const root = document.getElementById('root');

// Legacy key — kept only for one-shot migration into profile.locale. New
// writes always go to the profile store.
const LEGACY_LOCALE_KEY = 'portfolio.locale';
const SUPPORTED_LOCALES = ['fr', 'nl', 'en'];

function loadSavedLocale() {
  // Profile is the source of truth.
  try {
    const profile = loadProfile();
    if (profile.locale && SUPPORTED_LOCALES.includes(profile.locale)) {
      return profile.locale;
    }
    // One-shot migration: upgrade from the old flat key into the profile blob.
    const legacy = localStorage.getItem(LEGACY_LOCALE_KEY);
    if (legacy && SUPPORTED_LOCALES.includes(legacy)) {
      saveProfile({ locale: legacy });
      return legacy;
    }
  } catch (_) { /* ignore */ }
  // No saved preference: use navigator.language when it matches a supported
  // locale, otherwise fall back to FR (the primary audience — Belgian brokers).
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return SUPPORTED_LOCALES.includes(nav) ? nav : 'fr';
}

// App-wide state. Kept simple: screens read/write through ctx.
const ctx = {
  db: null,
  branchIndex: null,
  saving: false,
  locale: 'fr',
  pendingUpload: null,     // carries parsed data between upload -> preview
  lastRender: null,        // { renderer, args } for re-render on locale change
};

async function persistDb() {
  if (!ctx.db || ctx.saving) return;
  ctx.saving = true;
  try {
    const bytes = ctx.db.export();
    await saveBytes(bytes);
    // Best-effort cloud-sync write. Fire-and-forget: sync failures must not
    // block the local save path (user is offline, file moved, permission
    // revoked, etc.). Surfaced via console so devtools can debug.
    writeToSync(bytes, loadProfile()).catch((e) => {
      console.warn('[sync] write failed', e);
    });
  } finally {
    ctx.saving = false;
  }
}

// Debounced persist after any mutation
let persistTimer = null;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistDb().catch((e) => {
    console.error(e);
    toast('Error saving DB: ' + e.message, 'danger');
  }), 250);
}
ctx.schedulePersist = schedulePersist;
ctx.persistDb = persistDb;

// Subresource Integrity for vendored libs. Even though we self-host, SRI is a
// defense-in-depth: if the hosting origin is ever compromised and a tampered
// sql.js / sheetjs is served, the browser will refuse to execute it.
//
// Regenerate with: bun run tools/vendor-integrity.mjs (or `node`).
// Update both the sw.js precache list AND these hashes when bumping a vendor
// dependency — the SW will cache the new bytes, and the script tag will
// require them to match the new hash.
const VENDOR_SRI = {
  'vendor/sql.js/sql-wasm.js': 'sha384-8D3Rsfo535FqoC1pHCCQMrNf75UgzyoG/HQm9zOzITRrz3QKzecc2E7JXKGCXoWu',
  'vendor/sheetjs/xlsx.full.min.js': 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
};

function loadVendorScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    const integrity = VENDOR_SRI[src];
    if (integrity) {
      s.integrity = integrity;
      // SRI on script tags requires CORS metadata, even for same-origin loads
      // — without it, browsers treat the response as opaque and skip the
      // integrity check. 'anonymous' is the right level for our case
      // (no credentials, no cookies on vendor fetches).
      s.crossOrigin = 'anonymous';
    }
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src} (possible SRI mismatch)`));
    document.head.appendChild(s);
  });
}

async function loadSqlJs() {
  if (typeof globalThis.initSqlJs === 'function') return globalThis.initSqlJs;
  await loadVendorScript('vendor/sql.js/sql-wasm.js');
  if (typeof globalThis.initSqlJs !== 'function') {
    throw new Error('initSqlJs not found after script load');
  }
  return globalThis.initSqlJs;
}

async function loadXLSX() {
  if (typeof globalThis.XLSX !== 'undefined') return globalThis.XLSX;
  await loadVendorScript('vendor/sheetjs/xlsx.full.min.js');
  if (typeof globalThis.XLSX === 'undefined') throw new Error('XLSX not found after script load');
  return globalThis.XLSX;
}

ctx.loadXLSX = loadXLSX;

async function setAppLocale(code) {
  if (!SUPPORTED_LOCALES.includes(code)) return;
  if (code === getLocale()) return;
  await setLocale(code);
  ctx.locale = code;
  // Persist into the profile blob (source of truth). Legacy key left alone;
  // it's ignored once the profile has a locale.
  try { saveProfile({ locale: code }); } catch (_) { /* ignore */ }
  document.title = t('app.title') + ' — ' + t('app.subtitle');
  refreshSidebar(ctx);
  // Re-render current screen (if any) with the new locale
  if (ctx.lastRender) {
    render(ctx.lastRender.renderer, ctx.lastRender.args);
  }
}
ctx.setAppLocale = setAppLocale;

// Notify sidebar + re-render current screen when the profile changes (e.g. name,
// logo). Used from settings after saves so the sidebar reflects the new brand
// immediately. Separate from setAppLocale to avoid swapping locale by accident.
function onProfileChanged() {
  refreshSidebar(ctx);
  if (ctx.lastRender) {
    render(ctx.lastRender.renderer, ctx.lastRender.args);
  }
}
ctx.onProfileChanged = onProfileChanged;

// Updates the boot-splash status line. No-op once the splash has been
// replaced by the rendered shell. Translations are best-effort: the
// splash exists before i18n is loaded, so the first stages use raw FR.
function setBootStage(label) {
  const el = document.querySelector('[data-boot-stage]');
  if (el) el.textContent = label;
}

async function bootstrap() {
  // Inject the FA7 sprite into <body> before any UI renders. Icons are rendered
  // via <use href="#alias"/> so they need the sprite to be in the DOM. Fire and
  // forget — UI that mounts before this resolves will simply paint blank icons
  // for a frame, then catch up the moment <use> resolves.
  ensureIconSprite().catch((e) => console.warn('[icon] sprite load failed', e));

  setBootStage('Langue…');
  const initialLocale = loadSavedLocale();
  await setLocale(initialLocale);
  ctx.locale = initialLocale;
  document.title = t('app.title') + ' — ' + t('app.subtitle');
  setBootStage(t('boot.stage.config') || 'Configuration…');

  // Load branch mapping for analyzer
  const mappingRes = await fetch('config/branch_mapping.json');
  if (!mappingRes.ok) throw new Error('Failed to load branch_mapping.json');
  ctx.branchIndex = buildBranchIndex(await mappingRes.json());

  setBootStage(t('boot.stage.engine') || 'Moteur SQL…');
  // Init sql.js
  await initDb({
    loadSqlJs,
    locateFile: (file) => `vendor/sql.js/${file}`,
  });

  setBootStage(t('boot.stage.data') || 'Lecture des données…');
  // Restore DB from local storage or create fresh
  const bytes = await loadBytes();
  ctx.db = bytes ? Database.open(bytes) : Database.create();

  const backend = await backendName();
  console.info(`[storage] backend=${backend}, bytes=${bytes?.length ?? 0}`);

  requestPersistent().then((granted) => {
    if (granted) console.info('[storage] persistent storage granted');
  });

  // Install the passphrase prompt for cloud sync. The cloud_sync module stays
  // UI-agnostic; this hooks it up to the real modal at boot.
  setPassphrasePrompt(() => askPassphraseModal({
    mode: 'get',
    title: t('settings.sync.unlock_title'),
    message: t('settings.sync.unlock_hint'),
  }));

  // If sync is linked, prompt once at boot so subsequent auto-saves can write
  // without interrupting the user. If they cancel, sync auto-writes are
  // silently skipped this session — they can unlock from Settings later.
  try {
    const rec = await getSyncHandle();
    if (rec) {
      ensurePassphrase({ prompt: true }).catch(() => {});
    }
  } catch (_) { /* ignore */ }

  // Mount the persistent app shell once. Screens render into #content.
  renderShell(root, ctx);

  // Auto-reparse on app update. The only reason stored rows can drift from
  // what the current code would derive is a parser/code change between the
  // version that imported the XLSX and the version running now. Compare the
  // version stored in `kv` to the one shipped with this build; if it changed
  // and any snapshot has saved source files, re-run the parser across all of
  // them. Best-effort — failures are logged and don't block startup.
  try {
    const stored = ctx.db.kvGet('app_version');
    if (stored !== APP_VERSION) {
      const snaps = ctx.db.listSnapshots() || [];
      const hasAny = snaps.some((s) => ctx.db.hasSnapshotFiles(s.id));
      if (hasAny) {
        toast(t('app.auto_reparse.running').replace('{version}', APP_VERSION), 'info');
        const result = await reparseAllSnapshots(ctx);
        const parts = [`${result.ok} ${t('app.auto_reparse.done')}`];
        if (result.skipped > 0) parts.push(`${result.skipped} ${t('app.auto_reparse.skipped')}`);
        if (result.failed.length > 0) {
          parts.push(`${result.failed.length} ${t('app.auto_reparse.failed')}`);
          for (const f of result.failed) console.warn('[auto-reparse]', f);
        }
        toast(parts.join(' · '), result.failed.length > 0 ? 'warning' : 'success');
      }
      ctx.db.kvSet('app_version', APP_VERSION);
      // Persist the version bump (and any reparse rows). Don't await — the
      // home route render shouldn't wait on disk I/O.
      schedulePersist();
    }
  } catch (e) {
    console.warn('[auto-reparse] skipped', e);
  }

  // Refresh sidebar active-state on every route change
  window.addEventListener('hashchange', () => refreshSidebar(ctx));

  // Routes
  addRoute('/', () => render(renderHome));
  addRoute('/upload', () => render(renderUpload));
  addRoute('/preview', () => render(renderPreview));
  addRoute('/snapshot/:id', ({ params }) => render(renderDashboard, { snapshotId: Number(params.id) }));
  addRoute('/evolution', () => render(renderEvolution));
  addRoute('/settings', () => render(renderSettings));
  addRoute('/tutorial', () => render(renderTutorial));

  start(() => render(renderHome));
}

function render(renderer, args = {}) {
  const target = getContentRoot();
  if (!target) return;
  ctx.lastRender = { renderer, args };
  try {
    const result = renderer(target, ctx, args);
    // Lazy screens return a promise. Catch async errors symmetrically with
    // the synchronous path so screens can throw or reject identically.
    if (result && typeof result.then === 'function') {
      result.catch((e) => {
        console.error(e);
        toast(t('error.generic') + ' ' + e.message, 'danger');
      });
    }
  } catch (e) {
    console.error(e);
    toast(t('error.generic') + ' ' + e.message, 'danger');
  }
}

ctx.render = render;
ctx.navigate = navigate;
ctx.currentPath = currentPath;

bootstrap().catch((e) => {
  console.error(e);
  root.textContent = 'Failed to start: ' + e.message;
});

// Register service worker (PWA).
// When a new SW takes over this page, auto-reload so the user always runs
// the latest code without needing a manual double-refresh.
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
