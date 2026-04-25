// Service worker for the Portefeuille PWA.
//
// Strategy:
//   - Precache the app shell (HTML, CSS, JS, manifest, icons, vendored libs)
//     at install time so the app works offline immediately after first load.
//   - Network-first for navigation (fresh HTML when online, cached shell offline).
//   - Cache-first for everything else (static assets).
//
// Bump CACHE_VERSION on any release to force clients to re-fetch.
// Keep in sync with APP_VERSION in src/version.js — that's what triggers
// the client-side auto-reparse of stored snapshots after a parser change.

const CACHE_VERSION = 'v62';
const CACHE_NAME = `portefeuille-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/app.css',
  './src/main.js',
  './src/router.js',
  './src/version.js',
  './src/i18n/index.js',
  './src/ui/dom.js',
  './src/ui/toast.js',
  './src/ui/format.js',
  './src/ui/icon.js',
  './src/ui/shell.js',
  './src/ui/charts.js',
  './src/ui/passphrase_modal.js',
  './src/store/db.js',
  './src/store/local.js',
  './src/store/crypto.js',
  './src/store/backup.js',
  './src/store/cloud_sync.js',
  './src/store/profile.js',
  './src/store/xlsx_export.js',
  './src/ingest/detect.js',
  './src/ingest/parser.js',
  './src/core/analyzer.js',
  './src/core/branch_mapping.js',
  './src/core/ratios_summary.js',
  './src/core/reparse.js',
  './src/screens/home.js',
  './src/screens/upload.js',
  './src/screens/preview.js',
  './src/screens/dashboard.js',
  './src/screens/evolution.js',
  './src/screens/report.js',
  './src/screens/settings.js',
  './src/screens/tutorial.js',
  './src/ui/choropleth.js',
  './data/be_municipalities.json',
  './locales/fr.json',
  './locales/nl.json',
  './locales/en.json',
  './config/branch_mapping.json',
  './vendor/sql.js/sql-wasm.js',
  './vendor/sql.js/sql-wasm.wasm',
  './vendor/sheetjs/xlsx.full.min.js',
  './vendor/fontawesome/fa-sprite.svg',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Use addAll with individual catches so one missing file doesn't fail install.
      Promise.all(PRECACHE.map((url) =>
        cache.add(url).catch((err) => {
          console.warn('[sw] precache miss', url, err.message);
        })
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App source is served network-first so updates show up on reload.
// Heavy vendored libs + static assets stay cache-first for offline use.
function isAppSource(url) {
  return url.pathname.endsWith('.js')
      || url.pathname.endsWith('.css')
      || url.pathname.endsWith('.json')
      || url.pathname.endsWith('.html');
}
function isVendorOrStatic(url) {
  return url.pathname.startsWith('/vendor/')
      || url.pathname.startsWith('/icons/')
      || url.pathname.endsWith('.wasm')
      || url.pathname.endsWith('.webmanifest');
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type === 'basic') {
      const clone = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
    }
    return res;
  } catch (_) {
    const cached = await caches.match(req);
    return cached || Response.error();
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type === 'basic') {
      const clone = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
    }
    return res;
  } catch (_) {
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then((res) => res || Response.error())
      )
    );
    return;
  }

  if (isAppSource(url)) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (isVendorOrStatic(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});
