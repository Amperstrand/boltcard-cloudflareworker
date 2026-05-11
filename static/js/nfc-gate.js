// nfc-gate.js — passive NFC capture to prevent Android OS from intercepting taps
(function() {
  if (!('NDEFReader' in window)) return;
  window._nfcGateAbort = null;
  window._nfcPageHandler = false;
  function startGate() {
    if (window._nfcPageHandler) return;
    if (window._nfcGateAbort) window._nfcGateAbort.abort();
    var ctrl = new AbortController();
    window._nfcGateAbort = ctrl;
    var ndef = new NDEFReader();
    ndef.scan({ signal: ctrl.signal }).then(function() {
      if (ctrl.signal.aborted) return;
      ndef.onreading = function(event) {
        if (window._nfcPageHandler) return;
        var decoder = new TextDecoder();
        var records = event.message.records;
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          var text = null;
          if (r.recordType === 'url') {
            text = new Response(r.data).text();
            break;
          }
          if (r.recordType === 'text') {
            text = decoder.decode(r.data);
            break;
          }
        }
        if (!text) return;
        var resolved = text;
        if (typeof text === 'object' && text && typeof text.then === 'function') {
          text.then(function(url) { navigateToCardUrl(url); });
        } else {
          navigateToCardUrl(text);
        }
      };
    }).catch(function() {});
  }
  function navigateToCardUrl(rawUrl) {
    if (!rawUrl) return;
    var url = rawUrl;
    if (url.toLowerCase().startsWith('lnurlw://') || url.toLowerCase().startsWith('lnurlp://')) {
      url = 'https://' + url.substring(url.indexOf('://') + 3);
    } else if (url.toLowerCase().startsWith('http://')) {
      url = url.replace(/^http:\/\//i, 'https://');
    }
    try {
      var u = new URL(url, location.origin);
      if (u.origin === location.origin && u.pathname === '/' && u.searchParams.has('p') && u.searchParams.has('c')) {
        location.href = u.href;
      }
    } catch(e) {}
  }
  startGate();
})();
