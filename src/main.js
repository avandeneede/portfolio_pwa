// App bootstrap. Loads i18n, initializes sql.js + storage, wires routes,
// mounts the persistent shell once, and renders screens into its content slot.

import { setLocale, t, getLocale } from './i18n/index.js';
import { addRoute, start, navigate, currentPath } from './router.js';
import { init as initDb, Database } from './store/db.js';
import { load as loadBytes, save as saveBytes, backendName, requestPersistent } from './store/local.js';
import { loadProfile, saveProfile } from './store/profile.js';
import { toast } from './ui/toast.js';
import { renderShell, refreshSidebar, getContentRoot } from './ui/shell.js';
import { renderHome } from './screens/home.js';
import { renderUpload } from './screens/upload.js';
import { renderPreview } from './screens/preview.js';
import { renderDashboard } from './screens/dashboard.js';
import { renderEvolution } from './screens/evolution.js';
import { renderSettings } from './screens/settings.js';
import { buildBranchIndex } from './core/branch_mapping.js';

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
  const nav = (navigator.language || 'fr').slice(0, 2).toLowerCase();
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
    await saveBytes(ctx.db.export());
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

async function loadSqlJs() {
  if (typeof globalThis.initSqlJs === 'function') return globalThis.initSqlJs;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/sql.js/sql-wasm.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load sql.js'));
    document.head.appendChild(s);
  });
  if (typeof globalThis.initSqlJs !== 'function') {
    throw new Error('initSqlJs not found after script load');
  }
  return globalThis.initSqlJs;
}

async function loadXLSX() {
  if (typeof globalThis.XLSX !== 'undefined') return globalThis.XLSX;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/sheetjs/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load SheetJS'));
    document.head.appendChild(s);
  });
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

async function bootstrap() {
  const initialLocale = loadSavedLocale();
  await setLocale(initialLocale);
  ctx.locale = initialLocale;
  document.title = t('app.title') + ' — ' + t('app.subtitle');

  // Load branch mapping for analyzer
  const mappingRes = await fetch('config/branch_mapping.json');
  if (!mappingRes.ok) throw new Error('Failed to load branch_mapping.json');
  ctx.branchIndex = buildBranchIndex(await mappingRes.json());

  // Init sql.js
  await initDb({
    loadSqlJs,
    locateFile: (file) => `vendor/sql.js/${file}`,
  });

  // Restore DB from local storage or create fresh
  const bytes = await loadBytes();
  ctx.db = bytes ? Database.open(bytes) : Database.create();

  const backend = await backendName();
  console.info(`[storage] backend=${backend}, bytes=${bytes?.length ?? 0}`);

  requestPersistent().then((granted) => {
    if (granted) console.info('[storage] persistent storage granted');
  });

  // Mount the persistent app shell once. Screens render into #content.
  renderShell(root, ctx);

  // Refresh sidebar active-state on every route change
  window.addEventListener('hashchange', () => refreshSidebar(ctx));

  // Routes
  addRoute('/', () => render(renderHome));
  addRoute('/upload', () => render(renderUpload));
  addRoute('/preview', () => render(renderPreview));
  addRoute('/snapshot/:id', ({ params }) => render(renderDashboard, { snapshotId: Number(params.id) }));
  addRoute('/evolution', () => render(renderEvolution));
  addRoute('/settings', () => render(renderSettings));

  start(() => render(renderHome));
}

function render(renderer, args = {}) {
  const target = getContentRoot();
  if (!target) return;
  ctx.lastRender = { renderer, args };
  try {
    renderer(target, ctx, args);
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
