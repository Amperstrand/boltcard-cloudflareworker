// client-error.js — reports uncaught JS errors to the server with page version info
(function() {
  function getVersion() {
    var meta = document.querySelector('meta[name="deploy-revision"]');
    return meta ? meta.getAttribute('content') : 'unknown';
  }

  function getJsFingerprint() {
    var meta = document.querySelector('meta[name="js-fingerprint"]');
    return meta ? meta.getAttribute('content') : 'unknown';
  }

  function getPageUrl() {
    try { return location.pathname + location.search; } catch(e) { return ''; }
  }

  function report(error, context) {
    if (!error) return;
    var payload = {
      message: (error && error.message) ? error.message : String(error),
      stack: (error && error.stack) ? String(error.stack).substring(0, 2000) : '',
      source: context || '',
      url: getPageUrl(),
      deploy: getVersion(),
      js: getJsFingerprint(),
      ts: Date.now()
    };
    try {
      navigator.sendBeacon('/api/client-error', JSON.stringify(payload));
    } catch(e) {
      fetch('/api/client-error', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function() {});
    }
  }

  window.reportClientError = report;

  window.onerror = function(message, source, lineno, colno, error) {
    report(error || message, 'onerror:' + (source || '') + ':' + lineno + ':' + colno);
  };

  window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason;
    report(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledrejection');
  });
})();
