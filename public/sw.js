/* Service worker con actualización inmediata (network-first para HTML, JS y CSS). */

const CACHE_NAME = 'primitiva-temes-shell-v7';
const APP_SHELL = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // Navegación (index.html) y scripts/estilos: siempre red primero sin caché HTTP intermedia.
  const isCodeOrDoc =
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.webmanifest');

  if (isCodeOrDoc) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            const cacheKey = request.mode === 'navigate' ? '/' : request;
            void caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
          }
          return response;
        })
        .catch(async () => {
          const fallback = await caches.match(request.mode === 'navigate' ? '/' : request);
          return fallback || Response.error();
        }),
    );
    return;
  }

  // Imágenes, iconos y audio: stale-while-revalidate (rápido y se actualiza en segundo plano).
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());

      return cached || networkFetch;
    }),
  );
});
