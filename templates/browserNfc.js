import { rawHtml } from "../utils/rawTemplate.js";
import { validateUid } from "../utils/validation.js";

export const CSRF_FETCH_HELPER = rawHtml`
function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\\s*)op_csrf=([^;]*)/);
  return match ? match[1] : '';
}
var _origFetch = window.fetch;
window.fetch = function(input, init) {
  init = init || {};
  init.headers = init.headers || {};
  if (typeof init.headers.set === 'function') {
    if (!init.headers.has('X-CSRF-Token')) init.headers.set('X-CSRF-Token', getCsrfToken());
  } else {
    if (!init.headers['X-CSRF-Token']) init.headers['X-CSRF-Token'] = getCsrfToken();
  }
  return _origFetch.call(this, input, init);
};
`;

export const BROWSER_VALIDATE_UID_HELPER = rawHtml`
  const UID_REGEX = /^[0-9a-f]{14}$/;
  ${validateUid.toString()}
`;

export const BROWSER_NFC_HELPERS = rawHtml`
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function browserSupportsNfc() {
  return 'NDEFReader' in window;
}

function normalizeNfcSerial(serialNumber) {
  return serialNumber ? serialNumber.replace(/:/g, '').toLowerCase() : '';
}

async function extractNdefUrl(records, prefixes) {
  const acceptedPrefixes = prefixes || ['lnurlw://', 'lnurlp://', 'https://'];
  const decoder = new TextDecoder();
  for (const record of records) {
    if (record.recordType !== 'url' && record.recordType !== 'text') {
      continue;
    }
    const text = record.recordType === 'url'
      ? await new Response(record.data).text()
      : decoder.decode(record.data);
    const lower = text.toLowerCase();
    if (acceptedPrefixes.some(prefix => lower.startsWith(prefix))) {
      return text;
    }
  }
  return '';
}

function normalizeBrowserNfcUrl(rawUrl) {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('lnurlw://') || rawUrl.startsWith('lnurlp://')) {
    return 'https://' + rawUrl.substring(rawUrl.indexOf('://') + 3);
  }
  return rawUrl.replace(/^http:\/\//i, 'https://');
}

function createNfcScanner(opts) {
  var abortCtrl = null;
  var _active = false;
  var lastReadTime = 0;
  var o = Object.assign({
    onTap: null,
    onError: null,
    onStatus: null,
    prefixes: ['lnurlw://', 'lnurlp://', 'https://'],
    continuous: true,
    debounceMs: 1500
  }, opts || {});

  async function scan() {
    if (!browserSupportsNfc()) {
      if (o.onError) o.onError(new Error('Web NFC not supported'), 'permission');
      return;
    }
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    if (o.onStatus) o.onStatus('starting');
    try {
      var ndef = new NDEFReader();
      await ndef.scan({ signal: abortCtrl.signal });
      _active = true;
      if (o.onStatus) o.onStatus('scanning');
      ndef.onreadingerror = function() {
        if (o.onError) o.onError(new Error('NFC read failed'), 'scan');
      };
      ndef.onreading = async function(event) {
        var now = Date.now();
        if (o.debounceMs > 0 && now - lastReadTime < o.debounceMs) return;
        lastReadTime = now;
        var serial = normalizeNfcSerial(event.serialNumber);
        var url = await extractNdefUrl(event.message.records, o.prefixes);
        url = normalizeBrowserNfcUrl(url);
        if (!o.continuous && _active) stop();
        if (o.onTap) {
          try { await o.onTap({ url: url, serial: serial, records: event.message.records, event: event }); }
          catch (e) { if (o.onError) o.onError(e, 'parse'); }
        }
      };
    } catch (error) {
      _active = false;
      if (error.name === 'AbortError') {
        if (o.onStatus) o.onStatus('stopped');
      } else {
        var phase = (error.name === 'NotAllowedError' || error.name === 'NotSupportedError') ? 'permission' : 'scan';
        if (o.onError) o.onError(error, phase);
        if (o.onStatus) o.onStatus('stopped');
      }
    }
  }

  function stop() {
    if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
    _active = false;
    if (o.onStatus) o.onStatus('stopped');
  }

  function restart() {
    stop();
    setTimeout(function() { scan(); }, 200);
  }

  function isActive() { return _active; }

  return { scan: scan, stop: stop, restart: restart, isActive: isActive };
}
`;
