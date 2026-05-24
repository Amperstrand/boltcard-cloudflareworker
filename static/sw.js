// sw.js — service worker for boltcard PWA
// No ES modules, no dependencies. Route-based caching strategy.
// NOTE: The actual served SW is generated from static/pwa-assets.ts with BUILD_REVISION in cache name.
// This file is the source template used by scripts/sync-js-exports.mjs.

var CACHE_NAME = 'boltcard-v1';
var MAX_CARD_INFO_AGE = 3600000;

var SHELL_ASSETS = [
  '/card',
  '/static/icons/bolt.svg',
  '/static/manifest.webmanifest',
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (url.pathname === '/card/info') {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          if (cached) {
            var cachedTime = cached.headers.get('sw-cached-at');
            if (cachedTime && (Date.now() - Number(cachedTime)) > MAX_CARD_INFO_AGE) {
              cache.delete(event.request);
              cached = null;
            }
          }
          var fetchPromise = fetch(event.request).then(function(response) {
            if (response.ok) {
              var stamped = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
              stamped.headers.set('sw-cached-at', String(Date.now()));
              cache.put(event.request, stamped.clone());
              return response;
            }
            return response;
          }).catch(function() {
            return cached || new Response(JSON.stringify({ error: 'offline' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  if (url.hostname === 'cdn.tailwindcss.com') {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request).then(function(response) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
          return response;
        });
      })
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match('/card');
      })
    );
    return;
  }
});
