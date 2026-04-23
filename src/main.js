// App bootstrap. Loads i18n, initializes sql.js + storage, wires routes,
// and mounts the initial screen.

import { setLocale, t } from './i18n/index.js';
import { addRoute, start, navigate } from './router.js';
import { init as initDb, Database } from './store/db.js';
import { load as loadBytes, save as saveBytes, backendName, requestPersistent } from './store/local.js';
import { toast } from './ui/toast.js';
import { renderHome } from './screens/home.js';
import { renderUpload } from './screens/upload.js';
import { renderPreview } from './screens/preview.js';
import { renderDashboard } from './screens/dashboard.js';
import { renderSettings } from './screens/settings.js';
import { buildBranchIndex } from './core/branch_mapping.js';

const root = document.getElementById('root');

// App-wide state. Kept simple: screens read/write through ctx.
const ctx = {
  db: null,                // Database instance (in-memory sql.js)
  branchIndex: null,
  saving: false,
  locale: 'fr',
  pendingUpload: null,     // carries parsed data between upload -> preview
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
  // Load the vendored sql.js UMD bundle via dynamic <script> injection.
  // It attaches `initSqlJs` on globalThis.
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

async function bootstrap() {
  await setLocale('fr');
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

  // Ask for persistent storage (no harm if declined)
  requestPersistent().then((granted) => {
    if (granted) console.info('[storage] persistent storage granted');
  });

  // Routes
  addRoute('/', () => render(renderHome));
  addRoute('/upload', () => render(renderUpload));
  addRoute('/preview', () => render(renderPreview));
  addRoute('/snapshot/:id', ({ params }) => render(renderDashboard, { snapshotId: Number(params.id) }));
  addRoute('/settings', () => render(renderSettings));

  start(() => render(renderHome));
}

function render(renderer, args = {}) {
  try {
    renderer(root, ctx, args);
  } catch (e) {
    console.error(e);
    toast('Error rendering: ' + e.message, 'danger');
  }
}

ctx.render = render;
ctx.navigate = navigate;

bootstrap().catch((e) => {
  console.error(e);
  root.textContent = 'Failed to start: ' + e.message;
});

// Register service worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
