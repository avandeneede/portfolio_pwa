// Service worker for the Portefeuille PWA.
//
// Strategy:
//   - Precache the app shell (HTML, CSS, JS, manifest, icons, vendored libs)
//     at install time so the app works offline immediately after first load.
//   - Network-first for navigation (fresh HTML when online, cached shell offline).
//   - Cache-first for everything else (static assets).
//
// Bump CACHE_VERSION on any release to force clients to re-fetch.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `portefeuille-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/app.css',
  './src/main.js',
  './src/router.js',
  './src/i18n/index.js',
  './src/ui/dom.js',
  './src/ui/toast.js',
  './src/ui/format.js',
  './src/store/db.js',
  './src/store/local.js',
  './src/store/crypto.js',
  './src/store/backup.js',
  './src/ingest/detect.js',
  './src/ingest/parser.js',
  './src/core/analyzer.js',
  './src/core/branch_mapping.js',
  './src/screens/home.js',
  './src/screens/upload.js',
  './src/screens/preview.js',
  './src/screens/dashboard.js',
  './src/screens/settings.js',
  './locales/fr.json',
  './config/branch_mapping.json',
  './vendor/sql.js/sql-wasm.js',
  './vendor/sql.js/sql-wasm.wasm',
  './vendor/sheetjs/xlsx.full.min.js',
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first, fall back to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then((res) => res || Response.error())
      )
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cache successful responses for next time
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached || Response.error());
    })
  );
});
