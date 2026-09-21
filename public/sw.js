/*
 * Offline support for the installed app.
 *
 * Hand-written rather than generated, because the rules are short:
 *
 * - Pages (navigations) go to the network first, past the browser's HTTP
 *   cache, so an update you deploy is picked up the next time the app
 *   opens online. Offline, the last copy is served instead.
 * - Everything else from this site is served from the cache when present.
 *   Vite puts a content hash in every built file name, so a cached file can
 *   never be stale: new code arrives under a new name.
 *
 * The page tells the worker which files it has already loaded (see
 * registerServiceWorker in main.tsx). Without that, the files fetched
 * before the worker took control would never be cached, and the app would
 * not start offline until it had been opened a second time.
 */

const CACHE = 'clefcraft-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['./', './manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls' || !Array.isArray(event.data.urls)) return;
  const sameOrigin = event.data.urls.filter((url) => new URL(url).origin === self.location.origin);
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        sameOrigin.map((url) =>
          cache.match(url).then((hit) => hit || cache.add(url).catch(() => undefined)),
        ),
      ),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      // `no-cache` makes the browser check with the server every time.
      // Without it, the browser's own HTTP cache answers: GitHub Pages
      // allows it to keep a page for ten minutes, so an app reopened soon
      // after a deploy kept starting the old version — from "the network".
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./', copy));
          }
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
