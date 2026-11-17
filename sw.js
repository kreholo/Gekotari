const CACHE_NAME = 'gekkotari-shell-v15';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/kategori.html',
  '/404.html',
  '/assets/css/style.css?v=12',
  '/assets/js/ads-config.js?v=10',
  '/assets/js/supabase-sync.js?v=10',
  '/assets/js/common.js?v=12',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/apple-touch-icon.png',
  '/assets/icon-192.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch(() => {})
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept SWF proxy streams, SSR game pages dynamically beyond network-first, or /p/
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/p/')) return;

  // Cache-first for immutable visual assets (SVGs, PNGs, icons)
  if (url.pathname.startsWith('/assets/img/') || url.pathname.endsWith('.png') || url.pathname.endsWith('.ico') || url.pathname.endsWith('.svg')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // Network-first for HTML, JS, CSS with offline fallback
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const fallback = await caches.match('/404.html') || await caches.match('/index.html');
        if (fallback) return fallback;
      }
      return new Response('Çevrimdışı', { status: 503, statusText: 'Offline' });
    })
  );
});
