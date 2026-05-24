// PWA asset content served from index.ts routes.
// Cloudflare Workers have no filesystem — all static content is in JS string constants.

export const MANIFEST_JSON = JSON.stringify({
  name: "My Bolt Card",
  short_name: "Bolt Card",
  description: "Your festival payment card — balance, history, and card management",
  start_url: "/card",
  display: "standalone",
  background_color: "#111827",
  theme_color: "#10b981",
  orientation: "portrait",
  icons: [
    {
      src: "/static/icons/bolt.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
}, null, 2);

export const SW_JS = `// sw.js — service worker for boltcard PWA
var CACHE_NAME = 'boltcard-v1';
var SHELL_ASSETS = ['/card', '/static/icons/bolt.svg', '/static/manifest.webmanifest'];
self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function(c) { return c.addAll(SHELL_ASSETS); }));
  self.skipWaiting();
});
self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(ks) { return Promise.all(ks.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })); }));
  self.clients.claim();
});
self.addEventListener('fetch', function(e) {
  var u = new URL(e.request.url);
  if (u.pathname === '/card/info') {
    e.respondWith(caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        var p = fetch(e.request).then(function(r) { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(function() { return cached || new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } }); });
        return cached || p;
      });
    }));
    return;
  }
  if (u.pathname.startsWith('/static/')) {
    e.respondWith(caches.match(e.request).then(function(c) { return c || fetch(e.request).then(function(r) { if (r.ok) { var cl = r.clone(); caches.open(CACHE_NAME).then(function(ca) { ca.put(e.request, cl); }); } return r; }); }));
    return;
  }
  if (u.hostname === 'cdn.tailwindcss.com') {
    e.respondWith(caches.match(e.request).then(function(c) { return c || fetch(e.request).then(function(r) { var cl = r.clone(); caches.open(CACHE_NAME).then(function(ca) { ca.put(e.request, cl); }); return r; }); }));
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(function() { return caches.match('/card'); }));
    return;
  }
});
`;

export const BOLT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#111827"/>
  <path d="M296 32L120 288h112l-32 192 160-256H248z" fill="#10b981" stroke="#10b981" stroke-width="8" stroke-linejoin="round"/>
</svg>`;
