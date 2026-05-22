// nfc-gate.js — passive NFC capture to prevent Android OS from intercepting taps
(function() {
  if (!('NDEFReader' in window)) return;
  window._nfcGateAbort = null;
  window._nfcPageHandler = !!window._nfcPageHandler;
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
        if (typeof extractNdefUrl === 'function') {
          extractNdefUrl(event.message.records, ['lnurlw://', 'lnurlp://', 'https://']).then(function(url) {
            navigateToCardUrl(url);
          }).catch(function() {});
        } else {
          navigateToCardUrl(extractFallbackUrl(event.message.records));
        }
      };
    }).catch(function() {});
  }
  function bytesFromRecordData(data) {
    if (!data) return new Uint8Array();
    if (data instanceof DataView) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array();
  }
  function decodeUriRecord(data) {
    var bytes = bytesFromRecordData(data);
    if (!bytes.length) return '';
    var prefixes = ['', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:'];
    var prefix = prefixes[bytes[0]];
    var decoder = new TextDecoder();
    return (prefix === undefined ? '' : prefix) + decoder.decode(bytes.slice(prefix === undefined ? 0 : 1));
  }
  function extractFallbackUrl(records) {
    var decoder = new TextDecoder();
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.recordType === 'url') return decodeUriRecord(r.data);
      if (r.recordType === 'absolute-url') return r.id || decoder.decode(bytesFromRecordData(r.data));
      if (r.recordType === 'text') {
        var bytes = bytesFromRecordData(r.data);
        var langLength = bytes.length ? bytes[0] & 0x3f : 0;
        var text = bytes.length > langLength + 1 ? decoder.decode(bytes.slice(langLength + 1)) : decoder.decode(bytes);
        if (text.indexOf('://') !== -1) return text;
      }
    }
    return '';
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
