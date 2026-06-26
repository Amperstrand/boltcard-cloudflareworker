// sw-register.js — classic script (no import/export)
// Registers the PWA service worker for offline support

(function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function() {});
  }
})();
