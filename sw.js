/* ═══════════════════════════════════════════════════════════════
   Service Worker for Porter App
   - Caches the app shell so the app loads offline
   - Caches last known job data so porters can see jobs without signal
   - Uses network-first strategy with cache fallback
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'porter-app-v6.1-role-routing';
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

/* ═══════════════════════════════════════════════════════════════
   v6: Background push (FCM)
   This is the minimum surface area that Firebase Cloud Messaging
   needs. To wire it up server-side, add a Firebase Cloud Function
   that listens to /jobs and sends an FCM message targeted at the
   porter's ward (e.g. topic "ward-A"). The snippet lives in
   porter-app-v6.html near CLOUD_FN_SNIPPET.
   ═══════════════════════════════════════════════════════════════ */
self.addEventListener('push', event => {
  let payload = { title: 'New porter request', body: 'Tap to view the job' };
  try { payload = Object.assign(payload, event.data ? event.data.json() : {}); } catch (e) {}
  const title = payload.title || 'New porter request';
  const options = {
    body:    payload.body || '',
    icon:    payload.icon || 'icons/icon-192.png',
    badge:   'icons/icon-72.png',
    tag:     payload.tag || 'porter-job-' + Date.now(),
    renotify: true,
    requireInteraction: !!payload.requireInteraction,
    data:    payload.data || {},
    vibrate: [200, 100, 200, 100, 200]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
