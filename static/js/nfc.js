// nfc.js — classic script (no import/export)

function browserSupportsNfc() {
  return 'NDEFReader' in window;
}

function normalizeNfcSerial(serialNumber) {
  return serialNumber ? serialNumber.replace(/:/g, '').toLowerCase() : '';
}

async function extractNdefUrl(records, prefixes) {
  var acceptedPrefixes = prefixes || ['lnurlw://', 'lnurlp://', 'https://'];
  var decoder = new TextDecoder();
  for (var i = 0; i < records.length; i++) {
    var record = records[i];
    if (record.recordType !== 'url' && record.recordType !== 'text') {
      continue;
    }
    var text = record.recordType === 'url'
      ? await new Response(record.data).text()
      : decoder.decode(record.data);
    var lower = text.toLowerCase();
    for (var j = 0; j < acceptedPrefixes.length; j++) {
      if (lower.startsWith(acceptedPrefixes[j])) {
        return text;
      }
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
  window._nfcPageHandler = true;
  if (window._nfcGateAbort) { window._nfcGateAbort.abort(); window._nfcGateAbort = null; }
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

function stateLabel(state) {
  var labels = {
    'new': 'New',
    'pending': 'Pending',
    'discovered': 'Discovered',
    'keys_delivered': 'Keys Delivered',
    'active': 'Active',
    'wipe_requested': 'Wipe Requested',
    'terminated': 'Terminated',
    'legacy': 'Legacy',
  };
  return labels[state] || state;
}

function stateColor(state) {
  var colors = {
    'active': 'text-emerald-400',
    'discovered': 'text-blue-400',
    'pending': 'text-yellow-400',
    'keys_delivered': 'text-cyan-400',
    'terminated': 'text-red-400',
    'wipe_requested': 'text-orange-400',
    'new': 'text-gray-400',
    'legacy': 'text-gray-500',
  };
  return colors[state] || 'text-gray-300';
}

function provenanceLabel(p, short) {
  var full = {
    'public_issuer': 'Public Key',
    'env_issuer': 'Private (Server)',
    'percard': 'Per-Card Import',
    'user_provisioned': 'User Provisioned',
    'unknown': 'Unknown',
  };
  var abbr = {
    'public_issuer': 'Public',
    'env_issuer': 'Private',
    'percard': 'Per-Card',
    'user_provisioned': 'User',
    'unknown': 'Unknown',
  };
  return short ? (abbr[p] || p || '-') : (full[p] || p || 'Unknown');
}

function provenanceColor(p) {
  if (p === 'public_issuer') return 'text-yellow-400';
  if (p === 'env_issuer') return 'text-emerald-400';
  return 'text-gray-300';
}
