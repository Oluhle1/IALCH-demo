/* ═══════════════════════════════════════════════════════════════
   Service Worker for Porter App
   - Caches the app shell so the app loads offline
   - Caches last known job data so porters can see jobs without signal
   - Uses network-first strategy with cache fallback
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'porter-app-v6';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './firebase-config.js',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css'
];
// Install: pre-cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL).catch(err => {
        console.log('[SW] Some shell items failed to cache (non-critical):', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy:
// - For app shell: cache-first (fast offline load)
// - For everything else: network-first, fallback to cache
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // App shell — cache first
  if (request.mode === 'navigate' || APP_SHELL.includes(url.pathname) || url.pathname.endsWith('.html')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // CDN assets (icons font, etc.) — stale-while-revalidate
  if (url.hostname.includes('jsdelivr') || url.hostname.includes('cdn')) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else — network first, fallback to cache
  event.respondWith(
    fetch(request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(c => c.put(request, clone));
      return response;
    }).catch(() => caches.match(request))
  );
});

// Listen for skip-waiting message (forces new SW to take over)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
