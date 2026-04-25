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
import { installGlobalErrorHandlers, logError, listErrors, formatEntry } from './store/error_log.js';
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
  // Wire global error handlers as the very first thing so any failure during
  // boot (sprite fetch, sql.js init, locale load) gets persisted to the local
  // error log. Idempotent — safe even if main.js is re-imported by HMR.
  installGlobalErrorHandlers();

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
  // Capture the renderer name so the error log can point at *which* screen
  // blew up, not just "render error".
  const where = renderer && renderer.name ? `render:${renderer.name}` : 'render';
  try {
    const result = renderer(target, ctx, args);
    // Lazy screens return a promise. Catch async errors symmetrically with
    // the synchronous path so screens can throw or reject identically.
    if (result && typeof result.then === 'function') {
      result.catch((e) => {
        console.error(e);
        logError({ kind: where, message: e?.message || String(e), stack: e?.stack });
        toast(t('error.generic') + ' ' + e.message, 'danger');
      });
    }
  } catch (e) {
    console.error(e);
    logError({ kind: where, message: e?.message || String(e), stack: e?.stack });
    toast(t('error.generic') + ' ' + e.message, 'danger');
  }
}

ctx.render = render;
ctx.navigate = navigate;
ctx.currentPath = currentPath;

bootstrap().catch((e) => {
  console.error(e);
  // Persist the boot failure too — most opaque "white screen of death"
  // reports come from this exact path.
  logError({ kind: 'bootstrap', message: e?.message || String(e), stack: e?.stack });
  // Render a real diagnostic screen instead of a single line of text. When
  // bootstrap fails we still want the user to (a) see *what* broke, (b)
  // copy the last few entries to send us, and (c) try a hard reload before
  // giving up. i18n may not have loaded — fall back to FR.
  renderBootError(e).catch((re) => {
    console.error('[boot-error] render failed', re);
    root.textContent = 'Failed to start: ' + (e?.message || String(e));
  });
});

// Boot error screen. Self-contained: no lazy imports, no router, no shell.
// Designed to render even when most of the app failed to load.
async function renderBootError(err) {
  // Best-effort i18n. If setLocale ran before the failure, t() works; if not,
  // we use the FR strings inline below.
  const tt = (key, fallback) => {
    try { const v = t(key); return v && v !== key ? v : fallback; }
    catch { return fallback; }
  };
  const entries = await listErrors();
  // Only show the last 5 — anything older is noise here, full list is in
  // Settings → Diagnostics once the app comes back up.
  const recent = entries.slice(0, 5);

  // Build with createElement: no innerHTML, CSP-clean.
  while (root.firstChild) root.removeChild(root.firstChild);
  const wrap = document.createElement('div');
  wrap.className = 'boot-error';

  const h1 = document.createElement('h1');
  h1.textContent = tt('boot.error.title', 'Échec du démarrage');
  wrap.appendChild(h1);

  const lead = document.createElement('p');
  lead.className = 'boot-error-lead';
  lead.textContent = tt('boot.error.lead',
    'L\'application n\'a pas pu démarrer. Détails ci-dessous — copiez-les si vous nous contactez.');
  wrap.appendChild(lead);

  const msg = document.createElement('pre');
  msg.className = 'boot-error-msg';
  msg.textContent = (err?.message || String(err)) + '\n\n' + (err?.stack || '');
  wrap.appendChild(msg);

  const meta = document.createElement('p');
  meta.className = 'boot-error-meta';
  meta.textContent = `${tt('settings.storage.version', 'Version')} ${APP_VERSION} · ${navigator.userAgent}`;
  wrap.appendChild(meta);

  if (recent.length > 0) {
    const h2 = document.createElement('h2');
    h2.textContent = tt('boot.error.recent', 'Erreurs récentes');
    wrap.appendChild(h2);
    const list = document.createElement('div');
    list.className = 'error-log-list';
    for (const row of recent) {
      const entry = document.createElement('div');
      entry.className = 'error-log-entry';
      const m = document.createElement('div');
      m.className = 'error-log-meta';
      m.textContent = `${new Date(row.ts).toISOString()} · ${row.kind} · v${row.version}`;
      const t1 = document.createElement('div');
      t1.className = 'error-log-msg';
      t1.textContent = row.message;
      entry.appendChild(m);
      entry.appendChild(t1);
      list.appendChild(entry);
    }
    wrap.appendChild(list);
  }

  const actions = document.createElement('div');
  actions.className = 'boot-error-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn primary';
  copyBtn.textContent = tt('boot.error.copy', 'Copier les diagnostics');
  copyBtn.addEventListener('click', async () => {
    const blob = [
      `App: portefeuille v${APP_VERSION}`,
      `UA: ${navigator.userAgent}`,
      `When: ${new Date().toISOString()}`,
      '',
      'Boot error:',
      err?.message || String(err),
      err?.stack || '',
      '',
      'Recent log:',
      ...entries.slice(0, 20).map(formatEntry),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(blob);
      copyBtn.textContent = tt('boot.error.copied', 'Copié ✓');
    } catch {
      copyBtn.textContent = tt('boot.error.copy_failed', 'Échec de la copie');
    }
  });
  actions.appendChild(copyBtn);

  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.className = 'btn ghost';
  reloadBtn.textContent = tt('boot.error.hard_reload', 'Recharger en force');
  reloadBtn.addEventListener('click', async () => {
    // Mirror the settings.js handleReloadLatest path: clear SW caches, force
    // network on critical entry points, then replace location with a buster.
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
      }
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
      }
      const critical = ['./', './index.html', './src/main.js', './src/version.js', './src/app.css', './sw.js'];
      await Promise.all(critical.map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
    } catch (_) { /* swallow — we still want to reload */ }
    const bust = `?v=${Date.now()}`;
    location.replace(location.pathname + bust + (location.hash || ''));
  });
  actions.appendChild(reloadBtn);

  wrap.appendChild(actions);
  root.appendChild(wrap);
}

// Register service worker (PWA).
// When a new SW takes over this page we used to auto-reload. That's hostile
// when the user is mid-edit (e.g. typing into Settings, reviewing a snapshot)
// — the page just blinks away. Replace with a toast that lets the user choose
// when to reload. The toast carries an action button (no auto-dismiss until
// clicked or the page is replaced).
if ('serviceWorker' in navigator) {
  let prompted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (prompted) return;
    prompted = true;
    toast(t('app.update.available'), {
      kind: 'info',
      // 60s instead of the 4s default — long enough for the user to notice,
      // short enough to vanish if they ignore it. The new SW is already
      // active; next manual reload will pick it up regardless.
      durationMs: 60000,
      action: {
        label: t('app.update.reload'),
        onClick: () => {
          // Cache buster so the browser HTTP cache can't serve a stale shell.
          location.replace(location.pathname + `?v=${Date.now()}` + (location.hash || ''));
        },
      },
    });
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
