'use strict';
// v4: self-updating. Shell (same-origin) is network-first so deploys appear on
// the next open; cross-origin (tiles, CDN libs) stays cache-first with
// fetch-and-cache fallback. skipWaiting + clients.claim activate instantly,
// and app.js reloads open clients on controllerchange.
const CACHE = 'cadence-v14';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './engine.js',
  './app.js',
  './ai.js',
  './sync.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    // network-first: fresh deploy wins; cache is the offline fallback
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return resp;
      }).catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then(hit => hit || caches.match('./index.html'))
      )
    );
  } else {
    // cache-first for immutable cross-origin assets (map tiles, leaflet)
    e.respondWith(
      caches.match(e.request).then(hit =>
        hit || fetch(e.request).then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          return resp;
        }).catch(() => Response.error())
      )
    );
  }
});
