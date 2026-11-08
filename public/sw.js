/**
 * Diner's Cafe Mobile Service Worker (Network-First for Dynamic Pages)
 */

const CACHE_NAME = 'diners-cafe-cache-v5';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Always use Network-First for HTML navigation, scripts, styles, and APIs
  if (
    e.request.mode === 'navigate' ||
    e.request.destination === 'document' ||
    e.request.destination === 'script' ||
    e.request.destination === 'style' ||
    e.request.url.includes('/api/') ||
    e.request.url.includes('.js') ||
    e.request.url.includes('.css')
  ) {
    e.respondWith(
      fetch(e.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Stale-while-revalidate for media assets (images, fonts, icons)
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);
      return cachedResponse || fetchPromise;
    })
  );
});
