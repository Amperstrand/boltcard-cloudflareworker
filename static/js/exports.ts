export const NFC_JS = `// nfc.js — classic script (no import/export)

function browserSupportsNfc() {
  return 'NDEFReader' in window;
}

function normalizeNfcSerial(serialNumber) {
  return serialNumber ? serialNumber.replace(/:/g, '').toLowerCase() : '';
}

async function extractNdefUrl(records, prefixes) {
  var acceptedPrefixes = prefixes || ['lnurlw://', 'lnurlp://', 'https://'];
  var decoder = new TextDecoder();

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
    var uriPrefixes = ['', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:'];
    var prefix = uriPrefixes[bytes[0]];
    if (prefix !== undefined) {
      return prefix + decoder.decode(bytes.slice(1));
    }
    return decoder.decode(bytes);
  }

  function decodeTextRecord(data) {
    var bytes = bytesFromRecordData(data);
    if (!bytes.length) return '';
    var direct = decoder.decode(bytes);
    var langLength = bytes[0] & 0x3f;
    if (bytes.length > langLength + 1) {
      var payload = decoder.decode(bytes.slice(langLength + 1));
      if (payload.indexOf('://') !== -1) return payload;
    }
    return direct;
  }

  for (var i = 0; i < records.length; i++) {
    var record = records[i];
    if (record.recordType !== 'url' && record.recordType !== 'absolute-url' && record.recordType !== 'text') {
      continue;
    }
    var text = record.recordType === 'absolute-url'
      ? record.id || await new Response(record.data).text()
      : record.recordType === 'url'
        ? decodeUriRecord(record.data)
        : decodeTextRecord(record.data);
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
  return rawUrl.replace(/^http:\\/\\//i, 'https://');
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
}`;
export const NFC_JS_HASH = "8e4157fa574b";

export const NFC_GATE_JS = `// nfc-gate.js — passive NFC capture to prevent Android OS from intercepting taps
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
      url = url.replace(/^http:\\/\\//i, 'https://');
    }
    try {
      var u = new URL(url, location.origin);
      if (u.origin === location.origin && u.pathname === '/' && u.searchParams.has('p') && u.searchParams.has('c')) {
        location.href = u.href;
      }
    } catch(e) {}
  }
  startGate();
})();`;
export const NFC_GATE_JS_HASH = "19c662710d1d";

export const CLIENT_ERROR_JS = `// client-error.js — reports uncaught JS errors to the server with page version info
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
})();`;
export const CLIENT_ERROR_JS_HASH = "65664854a4c3";

export const HELPERS_JS = `// helpers.js — classic script (no import/export)

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text != null ? String(text) : '';
}

function showEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function toggleEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('hidden');
}

function formatDuration(ms) {
  var totalSec = Math.floor(ms / 1000);
  var h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  var m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  var s = String(totalSec % 60).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

function relativeTime(unixSeconds) {
  var diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

function formatUnits(value) {
  if (!value || value === 0) return '';
  return Number(value).toLocaleString();
}

function statusBadge(status) {
  var map = {
    read:        'bg-sky-500/10 text-sky-400 border-sky-500/30',
    provisioned: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    activated:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    wipe_requested: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    terminated:  'bg-red-500/10 text-red-400 border-red-500/30',
    completed:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    failed:      'bg-red-500/10 text-red-400 border-red-500/30',
    pending:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    paying:      'bg-blue-500/10 text-blue-400 border-blue-500/30',
    expired:     'bg-gray-600/10 text-gray-400 border-gray-500/30',
    topup:       'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    payment:     'bg-orange-500/10 text-orange-400 border-orange-500/30',
  };
  var labels = { topup: 'TOP UP', payment: 'PAYMENT' };
  var cls = map[status] || map.pending;
  var label = labels[status] || status;
  var span = document.createElement('span');
  span.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold border ' + cls;
  span.textContent = label;
  return span;
}`;
export const HELPERS_JS_HASH = "84e8b5eb92ca";

export const CARD_INFO_JS = `// card-info.js — classic script (no import/export)
// Depends on: helpers.js (relativeTime, formatUnits, statusBadge)

/**
 * Render tap history into prefixed DOM elements.
 * @param {Array} taps - Array of tap objects with created_at, status, amount_msat, counter, note, balance_after
 * @param {string} prefix - Element ID prefix (e.g., 'priv', 'pub')
 */
function renderTapHistory(taps, prefix) {
  var section = document.getElementById(prefix + '-tap-history');
  var list = document.getElementById(prefix + '-tap-list');
  var countEl = document.getElementById(prefix + '-tap-count');
  if (!taps || taps.length === 0) {
    section.classList.remove('hidden');
    list.replaceChildren();
    countEl.textContent = '';
    document.getElementById(prefix + '-tap-empty').classList.remove('hidden');
    return;
  }
  document.getElementById(prefix + '-tap-empty').classList.add('hidden');
  countEl.textContent = taps.length + ' entries';
  var elements = [];
  for (var i = 0; i < taps.length; i++) {
    var t = taps[i];
    var time = relativeTime(t.created_at);
    var isTopup = t.status === 'topup';
    var isPayment = t.status === 'payment';

    var amountEl = null;
    if (isTopup && t.amount_msat) {
      amountEl = document.createElement('span');
      amountEl.className = 'font-mono text-emerald-400 font-bold';
      amountEl.textContent = '+' + formatUnits(t.amount_msat);
    } else if (isPayment && t.amount_msat) {
      amountEl = document.createElement('span');
      amountEl.className = 'font-mono text-orange-400 font-bold';
      amountEl.textContent = '-' + formatUnits(t.amount_msat);
    } else if (t.amount_msat) {
      amountEl = document.createElement('span');
      amountEl.className = 'font-mono text-gray-400';
      amountEl.textContent = formatUnits(t.amount_msat);
    }

    var detailParts = [];
    if (t.counter != null) detailParts.push('#' + String(t.counter));
    if (t.note) detailParts.push(t.note);
    if (t.balance_after != null && (isTopup || isPayment)) detailParts.push('bal: ' + String(t.balance_after));

    var outer = document.createElement('div');
    outer.className = 'py-2 border-b border-gray-700/50 last:border-0';
    var row = document.createElement('div');
    row.className = 'flex items-center justify-between';
    var left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    var timeSpan = document.createElement('span');
    timeSpan.className = 'text-gray-500 text-xs shrink-0';
    timeSpan.textContent = time;
    left.appendChild(timeSpan);
    left.appendChild(statusBadge(t.status));
    row.appendChild(left);
    if (amountEl) row.appendChild(amountEl);
    outer.appendChild(row);
    if (detailParts.length > 0) {
      var detailDiv = document.createElement('div');
      detailDiv.className = 'text-gray-500 text-[11px] mt-0.5 pl-1';
      detailDiv.textContent = detailParts.join(' \\u00B7 ');
      outer.appendChild(detailDiv);
    }
    elements.push(outer);
  }
  list.replaceChildren.apply(list, elements);
  section.classList.remove('hidden');
}

/**
 * Build K0-K4 key rows as a DocumentFragment for appending to a tbody.
 * @param {string} k0-k4 - Hex key values
 * @returns {DocumentFragment}
 */
function buildKeysRows(k0, k1, k2, k3, k4) {
  var keys = [
    { label: 'K0', value: k0 },
    { label: 'K1', value: k1 },
    { label: 'K2', value: k2 },
    { label: 'K3', value: k3 },
    { label: 'K4', value: k4 }
  ];
  var fragment = document.createDocumentFragment();
  for (var i = 0; i < keys.length; i++) {
    var tr = document.createElement('tr');
    var td1 = document.createElement('td');
    td1.className = 'pr-3 text-gray-500';
    td1.textContent = keys[i].label;
    var td2 = document.createElement('td');
    td2.className = 'font-mono text-xs text-gray-400';
    td2.textContent = keys[i].value || '-';
    tr.appendChild(td1);
    tr.appendChild(td2);
    fragment.appendChild(tr);
  }
  return fragment;
}`;
export const CARD_INFO_JS_HASH = "41e1cbc054f8";

export const CARD_ACTIONS_JS = `// card-actions.js — classic script (no import/export)
// Depends on: helpers.js (reportClientError via window)

/**
 * Request wipe keys for a card via /login endpoint.
 * @param {string} apiHost - API base URL
 * @param {string} uid - Card UID hex
 * @param {Object} opts - { btnId, statusId, qrId, deeplinkId, jsonId, resultId }
 * @returns {Promise}
 */
function requestWipeKeys(apiHost, uid, opts) {
  if (!uid) return Promise.resolve();
  var btn = document.getElementById(opts.btnId);
  var status = document.getElementById(opts.statusId);
  btn.disabled = true;
  btn.textContent = 'FETCHING...';
  btn.classList.add('opacity-50');
  status.classList.remove('hidden');
  status.className = 'mt-3 text-center text-sm text-gray-400';
  status.textContent = 'Retrieving wipe keys...';

  return fetch(apiHost + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, action: 'request-wipe' }),
  }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok && result.data.success) {
      btn.textContent = 'WIPE KEYS RETRIEVED';
      btn.classList.remove('bg-red-600', 'hover:bg-red-500');
      btn.classList.add('bg-gray-600');
      status.className = 'mt-3 text-center text-sm text-emerald-400';
      status.textContent = 'Card is now pending wipe (v' + result.data.keyVersion + ')';
      if (opts.qrId && typeof QRCode !== 'undefined') {
        var qrEl = document.getElementById(opts.qrId);
        qrEl.replaceChildren();
        new QRCode(qrEl, { text: result.data.wipeJson, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
      }
      if (opts.deeplinkId) document.getElementById(opts.deeplinkId).href = result.data.wipeDeeplink;
      if (opts.jsonId) document.getElementById(opts.jsonId).textContent = result.data.wipeJson;
      if (opts.resultId) document.getElementById(opts.resultId).classList.remove('hidden');
      return result.data;
    } else {
      throw new Error(result.data.error || 'Failed to fetch wipe keys');
    }
  }).catch(function(e) {
    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'card-actions:request-wipe');
    status.className = 'mt-3 text-center text-sm text-red-400';
    status.textContent = 'Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'GET WIPE KEYS';
    btn.classList.remove('opacity-50');
    throw e;
  });
}

/**
 * Confirm a card has been physically wiped (terminate via /login).
 * @param {string} apiHost - API base URL
 * @param {string} uid - Card UID hex
 * @param {Object} opts - { btnId, statusId }
 * @returns {Promise<Object>} Termination result data
 */
function confirmWipedCard(apiHost, uid, opts) {
  if (!uid) return Promise.reject(new Error('No UID'));
  var btn = document.getElementById(opts.btnId);
  var status = document.getElementById(opts.statusId);
  btn.disabled = true;
  btn.textContent = 'TERMINATING...';
  btn.classList.add('opacity-50');
  status.classList.remove('hidden');
  status.className = 'mt-3 text-center text-sm text-gray-400';
  status.textContent = 'Terminating card...';

  return fetch(apiHost + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, action: 'terminate' }),
  }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok && result.data.success) {
      status.className = 'mt-3 text-center text-sm text-emerald-400';
      status.textContent = 'Card terminated. Ready for re-provision at version ' + (result.data.keyVersion || 2) + '.';
      btn.textContent = 'TERMINATED';
      btn.classList.remove('bg-red-600', 'hover:bg-red-500');
      btn.classList.add('bg-gray-600');
      return result.data;
    } else {
      throw new Error(result.data.error || 'Termination failed');
    }
  }).catch(function(e) {
    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'card-actions:confirm-wiped');
    status.className = 'mt-3 text-center text-sm text-red-400';
    status.textContent = 'Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
    btn.classList.remove('opacity-50');
    throw e;
  });
}

/**
 * Provision a card by posting to a programming endpoint.
 * @param {string} endpointUrl - The pull payment / boltcards endpoint URL
 * @param {string} uid - Card UID hex
 * @param {Object} opts - { btnId, statusId, successText }
 * @returns {Promise<Object>} Provisioning result
 */
function provisionCard(endpointUrl, uid, opts) {
  if (!uid) return Promise.reject(new Error('No UID'));
  var btn = document.getElementById(opts.btnId);
  var status = document.getElementById(opts.statusId);
  btn.disabled = true;
  btn.textContent = 'PROVISIONING...';
  btn.classList.add('opacity-50');
  status.classList.remove('hidden');
  status.className = 'mt-3 text-center text-sm text-gray-400';
  status.textContent = 'Writing keys to card...';

  return fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ UID: uid }),
  }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok) {
      status.className = 'mt-3 text-center text-sm text-emerald-400';
      status.textContent = (opts.successText || 'Card provisioned!') + ' Version ' + (result.data.Version || 1) + '.';
      btn.textContent = 'PROVISIONED';
      btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
      btn.classList.add('bg-gray-600');
      return result.data;
    } else {
      throw new Error(result.data.error || 'Provisioning failed');
    }
  }).catch(function(e) {
    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'card-actions:provision');
    status.className = 'mt-3 text-center text-sm text-red-400';
    if (e.message.includes('active') || e.message.includes('Terminate')) {
      status.textContent = 'This card is already active and working. Wipe it first if you want to re-provision.';
    } else {
      status.textContent = 'Error: ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = opts.btnText || 'PROVISION AS WITHDRAW CARD';
    btn.classList.remove('opacity-50');
    throw e;
  });
}`;
export const CARD_ACTIONS_JS_HASH = "9a43a89754b4";

export const PROGRAMMING_JS = `// programming.js — classic script (no import/export)
// Depends on: helpers.js (relativeTime)

/**
 * Build a boltcard programming deeplink URL.
 * @param {string} endpointUrl - The programming endpoint URL
 * @returns {string} boltcard://program?url=... deeplink
 */
function buildProgrammingDeeplink(endpointUrl) {
  return 'boltcard://program?url=' + encodeURIComponent(endpointUrl);
}

/**
 * Render a QR code into a container element, replacing any existing content.
 * @param {string} containerId - Element ID to render QR into
 * @param {string} text - QR code content
 */
function renderQrCode(containerId, text) {
  if (typeof QRCode === 'undefined') return;
  var el = document.getElementById(containerId);
  if (!el) return;
  el.replaceChildren();
  new QRCode(el, { text: text, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
}

/**
 * Build wipe JSON from key cells in a table.
 * @param {string} tableId - tbody element ID containing key rows
 * @returns {string} JSON string of wipe data
 */
function buildWipeJson(tableId) {
  var cells = document.querySelectorAll('#' + tableId + ' td:last-child');
  var vals = Array.from(cells).map(function(t) { return t.textContent.trim(); });
  return JSON.stringify({
    k0: vals[0] || '', k1: vals[1] || '', k2: vals[2] || '',
    k3: vals[3] || '', k4: vals[4] || '',
    action: 'wipe', version: '1'
  }, null, 2);
}`;
export const PROGRAMMING_JS_HASH = "9c1970f908eb";

export const CSRF_JS = `// csrf.js — classic script (no import/export)

function getCsrfToken() {
  var match = document.cookie.match(/(?:^|;\\s*)op_csrf=([^;]*)/);
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
};`;
export const CSRF_JS_HASH = "27a4b8928b37";

export const CARD_DASHBOARD_JS = `// card-dashboard.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner, stateLabel, stateColor, provenanceLabel, provenanceColor)

var lastP = null;
var lastC = null;

function formatBalance(msat) {
  if (!msat || msat === 0) return '0 msat';
  if (msat >= 1000000) return (msat / 1000000).toFixed(3) + ' BTC';
  if (msat >= 1000) return (msat / 1000).toFixed(0) + ' sats';
  return msat + ' msat';
}

function formatTime(iso) {
  if (!iso) return null;
  try {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

function renderHistory(items) {
  var el = document.getElementById('history-list');
  if (!items || items.length === 0) {
    var p = document.createElement('p');
    p.className = 'text-gray-500 text-xs text-center';
    p.textContent = 'No activity';
    el.replaceChildren(p);
    return;
  }
  el.replaceChildren.apply(el, items.slice(0, 15).map(function(item) {
    var status = item.status || 'unknown';
    var icon, color;
    if (status === 'completed') { icon = '\\u2713'; color = 'text-emerald-400'; }
    else if (status === 'failed') { icon = '\\u2717'; color = 'text-red-400'; }
    else if (status === 'topup') { icon = '+'; color = 'text-cyan-400'; }
    else if (status === 'payment') { icon = '\\u2192'; color = 'text-amber-400'; }
    else if (status === 'read') { icon = '\\u2022'; color = 'text-gray-500'; }
    else { icon = '?'; color = 'text-gray-500'; }
    var amt = item.amount_msat || item.amountMsat;
    var time = formatTime(item.created_at || item.createdAt);

    var row = document.createElement('div');
    row.className = 'flex items-center gap-2 text-xs py-1.5 border-b border-gray-700/30 last:border-0';

    var iconSpan = document.createElement('span');
    iconSpan.className = color + ' w-4 text-center font-bold';
    iconSpan.textContent = icon;
    row.appendChild(iconSpan);

    var counterSpan = document.createElement('span');
    counterSpan.className = 'text-gray-400 font-mono w-12 text-[10px]';
    counterSpan.textContent = 'ctr ' + (item.counter || '-');
    row.appendChild(counterSpan);

    var statusSpan = document.createElement('span');
    statusSpan.className = color + ' flex-1';
    statusSpan.textContent = status;
    if (item.note) {
      var noteSpan = document.createElement('span');
      noteSpan.className = 'text-gray-600';
      noteSpan.textContent = ' (' + item.note + ')';
      statusSpan.appendChild(noteSpan);
    }
    row.appendChild(statusSpan);

    if (amt) {
      var amtSpan = document.createElement('span');
      amtSpan.className = 'text-gray-300 font-mono';
      amtSpan.textContent = formatBalance(amt);
      row.appendChild(amtSpan);
    }

    if (time) {
      var timeSpan = document.createElement('span');
      timeSpan.className = 'text-gray-600 text-[10px] w-28 text-right';
      timeSpan.textContent = time;
      row.appendChild(timeSpan);
    }

    return row;
  }));
}

function showLoading() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('card-info').classList.add('hidden');
  document.getElementById('error-display').classList.add('hidden');
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
}

async function showCardInfo(p, c) {
  lastP = p;
  lastC = c;
  document.getElementById('error-display').classList.add('hidden');
  showLoading();

  try {
    var resp = await fetch('/card/info?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
    var data = await resp.json();

    hideLoading();

    if (!resp.ok) {
      showError(data.reason || data.error || 'Failed to load card info');
      return;
    }

    document.getElementById('scan-section').classList.add('hidden');
    document.getElementById('card-info').classList.remove('hidden');

    document.getElementById('card-uid').textContent = data.maskedUid || data.uid;

    var stateEl = document.getElementById('card-state');
    stateEl.textContent = stateLabel(data.state);
    stateEl.className = 'font-mono ' + stateColor(data.state);

    var provEl = document.getElementById('card-provenance');
    provEl.textContent = provenanceLabel(data.keyProvenance);
    provEl.className = 'font-mono ' + provenanceColor(data.keyProvenance);

    if (data.keyLabel) {
      document.getElementById('key-label-row').classList.remove('hidden');
      document.getElementById('card-key-label').textContent = data.keyLabel;
    } else {
      document.getElementById('key-label-row').classList.add('hidden');
    }

    if (data.activeVersion && data.activeVersion > 1) {
      document.getElementById('version-row').classList.remove('hidden');
      document.getElementById('card-version').textContent = data.activeVersion;
    } else {
      document.getElementById('version-row').classList.add('hidden');
    }

    if (data.paymentMethodLabel) {
      document.getElementById('method-row').classList.remove('hidden');
      document.getElementById('card-method').textContent = data.paymentMethodLabel;
    } else {
      document.getElementById('method-row').classList.add('hidden');
    }

    document.getElementById('card-balance').textContent = formatBalance(data.balance);

    if (data.activatedAt) {
      var fmtAct = formatTime(data.activatedAt);
      if (fmtAct) {
        document.getElementById('activated-row').classList.remove('hidden');
        document.getElementById('card-activated').textContent = fmtAct;
      } else {
        document.getElementById('activated-row').classList.add('hidden');
      }
    } else {
      document.getElementById('activated-row').classList.add('hidden');
    }

    if (data.firstSeenAt) {
      var formattedFirstSeen = formatTime(data.firstSeenAt);
      if (formattedFirstSeen) {
        document.getElementById('first-seen-row').classList.remove('hidden');
        document.getElementById('card-first-seen').textContent = formattedFirstSeen;
      } else {
        document.getElementById('first-seen-row').classList.add('hidden');
      }
    } else {
      document.getElementById('first-seen-row').classList.add('hidden');
    }

    if (data.programmingRecommended) {
      document.getElementById('provenance-banner').classList.remove('hidden');
      if (data.uid) {
        document.getElementById('activate-link').href = '/experimental/activate?uid=' + encodeURIComponent(data.uid);
      }
    } else {
      document.getElementById('provenance-banner').classList.add('hidden');
    }

    if (data.analytics && data.analytics.totalTaps > 0) {
      document.getElementById('analytics-section').classList.remove('hidden');
      document.getElementById('analytics-spent').textContent = formatBalance(data.analytics.completedMsat || 0);
      document.getElementById('analytics-taps').textContent = data.analytics.totalTaps;
      var rate = data.analytics.totalTaps > 0 ? Math.round((data.analytics.completedTaps / data.analytics.totalTaps) * 100) : 0;
      document.getElementById('analytics-rate').textContent = rate + '%';
    } else {
      document.getElementById('analytics-section').classList.add('hidden');
    }

    renderHistory(data.history);

    var canLock = data.state === 'active' || data.state === 'discovered';
    if (canLock) {
      document.getElementById('lock-section').classList.remove('hidden');
    } else {
      document.getElementById('lock-section').classList.add('hidden');
    }
    document.getElementById('lock-confirm').classList.add('hidden');
    document.getElementById('lock-status').classList.add('hidden');

    var isTerminated = data.state === 'terminated';
    if (isTerminated && data.reactivationAvailable) {
      document.getElementById('reactivate-section').classList.remove('hidden');
      var nextVer = (data.currentVersion || 1) + 1;
      document.getElementById('reactivate-version').textContent = nextVer;
      document.getElementById('reactivate-success').classList.add('hidden');
      document.getElementById('reactivate-scan').classList.remove('hidden');
      document.getElementById('reactivate-scan-status').textContent = '';
      document.getElementById('reactivate-scan-error').classList.add('hidden');
    } else {
      document.getElementById('reactivate-section').classList.add('hidden');
    }

    var newUrl = window.location.pathname + '?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c);
    window.history.replaceState(null, '', newUrl);

    document.getElementById('card-info').focus();
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-dashboard.js:load-info');
     hideLoading();
     showError('Failed to load card info. Please try again.');
   }
}

function showError(msg) {
  document.getElementById('error-display').classList.remove('hidden');
  document.getElementById('error-message').textContent = msg;
}

function resetView() {
  document.getElementById('scan-section').classList.remove('hidden');
  document.getElementById('card-info').classList.add('hidden');
  document.getElementById('error-display').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('scan-error').classList.add('hidden');
  lastP = null;
  lastC = null;
}

function extractParams(url) {
  try {
    var u = new URL(url);
    var p = u.searchParams.get('p');
    var c = u.searchParams.get('c');
    if (p && c) return { p: p, c: c };
  } catch (e) {}
  return null;
}

var cardScanner = createNfcScanner({
  continuous: false,
  debounceMs: 0,
  onStatus: function(status) {
    if (status === 'scanning') {
      document.getElementById('scan-status').textContent = 'Ready \\u2014 tap your card now...';
    } else if (status === 'stopped') {
      document.getElementById('scan-status').textContent = 'Hold your card to the back of your phone';
    }
  },
  onError: function(err, phase) {
    var scanError = document.getElementById('scan-error');
    if (phase === 'permission') {
      document.getElementById('nfc-unsupported').classList.remove('hidden');
      scanError.classList.add('hidden');
    } else {
      scanError.textContent = 'NFC error: ' + (err.message || 'unknown');
      scanError.classList.remove('hidden');
    }
  },
  onTap: function(data) {
    if (!data.url) {
      var scanError = document.getElementById('scan-error');
      scanError.textContent = 'Card did not contain a valid bolt card URL';
      scanError.classList.remove('hidden');
      return;
    }
    var params = extractParams(data.url);
    if (params) {
      document.getElementById('scan-error').classList.add('hidden');
      showCardInfo(params.p, params.c);
    } else {
      var scanError = document.getElementById('scan-error');
      scanError.textContent = 'Card did not contain a valid bolt card URL';
      scanError.classList.remove('hidden');
    }
  }
});

document.getElementById('btn-scan-again').addEventListener('click', function() {
  resetView();
  cardScanner.restart();
});

document.getElementById('btn-load-url').addEventListener('click', function() {
  var input = document.getElementById('url-input').value.trim();
  var urlError = document.getElementById('url-error');
  urlError.classList.add('hidden');
  if (!input) {
    urlError.textContent = 'Please enter a card URL';
    urlError.classList.remove('hidden');
    return;
  }
  var params = extractParams(input);
  if (!params) {
    urlError.textContent = 'URL must contain p and c parameters';
    urlError.classList.remove('hidden');
    return;
  }
  resetView();
  showCardInfo(params.p, params.c);
});

document.getElementById('url-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('btn-load-url').click();
});

document.getElementById('btn-refresh').addEventListener('click', function() {
  if (lastP && lastC) showCardInfo(lastP, lastC);
});

document.getElementById('btn-retry').addEventListener('click', function() {
  resetView();
  cardScanner.restart();
});

document.getElementById('btn-lock').addEventListener('click', function() {
  document.getElementById('lock-confirm').classList.remove('hidden');
});

document.getElementById('btn-lock-cancel').addEventListener('click', function() {
  document.getElementById('lock-confirm').classList.add('hidden');
});

document.getElementById('btn-lock-confirm').addEventListener('click', async function() {
  if (!lastP || !lastC) return;
  var btn = document.getElementById('btn-lock-confirm');
  btn.disabled = true;
  btn.textContent = 'Locking...';
  try {
    var resp = await fetch('/api/card/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: lastP, c: lastC }),
    });
    var data = await resp.json();
    if (resp.ok && data.success) {
      document.getElementById('lock-confirm').classList.add('hidden');
      document.getElementById('btn-lock').disabled = true;
      document.getElementById('btn-lock').textContent = 'Card Locked';
      document.getElementById('btn-lock').classList.remove('hover:bg-red-800/50');
      document.getElementById('lock-status').classList.remove('hidden');
      document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
      document.getElementById('lock-status').textContent = 'Your card has been locked.';
      var stateEl = document.getElementById('card-state');
      stateEl.textContent = stateLabel('terminated');
      stateEl.className = 'font-mono ' + stateColor('terminated');
    } else {
      document.getElementById('lock-status').classList.remove('hidden');
      document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
      document.getElementById('lock-status').textContent = data.reason || data.error || 'Lock failed';
      btn.disabled = false;
      btn.textContent = 'Confirm Lock';
    }
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-dashboard.js:lock');
     document.getElementById('lock-status').classList.remove('hidden');
     document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
     document.getElementById('lock-status').textContent = 'Network error';
     btn.disabled = false;
     btn.textContent = 'Confirm Lock';
   }
});

var reactivateScanner = null;

function startReactivateScan() {
  if (reactivateScanner) {
    reactivateScanner.restart();
  } else if (browserSupportsNfc()) {
    reactivateScanner = createNfcScanner({
      continuous: false,
      debounceMs: 0,
      onStatus: function(status) {
        if (status === 'scanning') {
          document.getElementById('reactivate-scan-status').textContent = 'Tap your card now...';
        }
      },
      onError: function(err, phase) {
        var el = document.getElementById('reactivate-scan-error');
        if (phase === 'permission') {
          el.textContent = 'NFC not available. Use an operator to re-provision.';
        } else {
          el.textContent = 'NFC error: ' + (err.message || 'unknown');
        }
        el.classList.remove('hidden');
      },
      onTap: function(data) {
        if (!data.url) {
          document.getElementById('reactivate-scan-error').textContent = 'Card did not contain a valid URL';
          document.getElementById('reactivate-scan-error').classList.remove('hidden');
          return;
        }
        var params = extractParams(data.url);
        if (params) {
          document.getElementById('reactivate-scan-error').classList.add('hidden');
          document.getElementById('reactivate-scan-status').textContent = 'Verifying...';
          submitReactivate(params.p, params.c);
        } else {
          document.getElementById('reactivate-scan-error').textContent = 'Invalid card URL';
          document.getElementById('reactivate-scan-error').classList.remove('hidden');
        }
      }
    });
    reactivateScanner.scan();
  } else {
    document.getElementById('reactivate-scan-status').textContent = 'NFC not available on this device. Ask an operator to re-provision your card.';
  }
}

async function submitReactivate(p, c) {
  try {
    var resp = await fetch('/api/card/reactivate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: p, c: c }),
    });
    var data = await resp.json();
    if (resp.ok && data.success) {
      document.getElementById('reactivate-scan').classList.add('hidden');
      document.getElementById('reactivate-success').classList.remove('hidden');
      document.getElementById('reactivate-new-version').textContent = data.version;
      if (data.uid) {
        document.getElementById('reactivate-program-link').href = '/experimental/activate?uid=' + encodeURIComponent(data.uid);
      }
    } else {
      document.getElementById('reactivate-scan-status').textContent = '';
      document.getElementById('reactivate-scan-error').textContent = data.reason || data.error || 'Re-activation failed';
      document.getElementById('reactivate-scan-error').classList.remove('hidden');
    }
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-dashboard.js:reactivate');
     document.getElementById('reactivate-scan-error').textContent = 'Network error';
     document.getElementById('reactivate-scan-error').classList.remove('hidden');
   }
}

(function init() {
  var currentUrl = window.location.href;
  var params = extractParams(currentUrl);
  if (params) {
    showCardInfo(params.p, params.c);
    return;
  }

  if (browserSupportsNfc()) {
    cardScanner.scan();
  } else {
    document.getElementById('nfc-unsupported').classList.remove('hidden');
  }
})();`;
export const CARD_DASHBOARD_JS_HASH = "93d85fc50e1b";

export const DEBUG_JS = `// debug.js — classic script (no import/export)
// Requires: nfc.js (esc, browserSupportsNfc, createNfcScanner)

(function() {
  var debugRoot = document.getElementById('debug-root');
  var BASE_URL = debugRoot ? debugRoot.getAttribute('data-base-url') : '';

  var lastP = null;
  var lastC = null;
  var lastIdentifyData = null;
  var wipeQrCode = null;
  var nfcScanner = null;

  var scanBtn = document.getElementById('nfc-scan-btn');
  var errorBox = document.getElementById('error-message');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }
  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }

  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function _kv(label, value, valueCls, labelCls) {
    var d = document.createElement('div');
    d.appendChild(_el('span', labelCls || 'font-semibold text-gray-100', label));
    if (valueCls) {
      d.appendChild(document.createTextNode(' '));
      var s = _el('span', valueCls);
      s.textContent = value;
      d.appendChild(s);
    } else {
      d.appendChild(document.createTextNode(' ' + value));
    }
    return d;
  }

  function updateScanBtn(state) {
    if (state === 'scanning') {
      scanBtn.textContent = 'Scanning\\u2026';
      scanBtn.className = 'ml-auto rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-500/50';
    } else if (state === 'error') {
      scanBtn.textContent = 'Restart NFC scan';
      scanBtn.className = 'ml-auto rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:border-red-500/50';
    } else {
      scanBtn.textContent = 'Start NFC scan';
      scanBtn.className = 'ml-auto rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-cyan-500/50 hover:text-cyan-300';
    }
  }

  function setCardInfo(data) {
    document.getElementById('ci-uid').textContent = data.uid || '--';
    document.getElementById('ci-counter').textContent = data.counter || '--';
    document.getElementById('ci-issuer').textContent = data.issuer || '--';
    document.getElementById('ci-version').textContent = data.version != null ? data.version : '--';
    document.getElementById('ci-state').textContent = data.state || '--';
    document.getElementById('ci-method').textContent = data.method || '--';
    document.getElementById('ci-fingerprint').textContent = data.fingerprint || '--';
    document.getElementById('ci-cmac').textContent = data.cmac || '--';
    if (data.cmac === 'valid') {
      document.getElementById('ci-cmac').className = 'font-mono text-xs text-emerald-400';
    } else if (data.cmac === 'invalid') {
      document.getElementById('ci-cmac').className = 'font-mono text-xs text-red-400';
    } else {
      document.getElementById('ci-cmac').className = 'font-mono text-xs';
    }
  }

  function switchTab(tabId) {
    document.querySelectorAll('.debug-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tabId); });
    document.querySelectorAll('.debug-panel').forEach(function(p) { p.classList.toggle('hidden', p.id !== 'panel-' + tabId); });
  }

  function initTabs() {
    document.querySelectorAll('.debug-tab').forEach(function(t) {
      t.addEventListener('click', function() { switchTab(t.dataset.tab); });
    });
    var hash = location.hash.replace('#', '');
    if (hash && document.getElementById('panel-' + hash)) switchTab(hash);
  }

  function initNfc() {
    if (!browserSupportsNfc()) {
      updateScanBtn('error');
      scanBtn.textContent = 'Web NFC unavailable';
      scanBtn.disabled = true;
      return;
    }

    nfcScanner = createNfcScanner({
      onTap: handleNfcTap,
      onError: function(err, phase) {
        if (phase === 'permission') {
          updateScanBtn('error');
          showError('NFC permission denied. Click the button to retry.');
        } else if (phase === 'scan') {
          showError('NFC read error: ' + err.message);
        } else {
          showError('Error: ' + err.message);
        }
      },
      onStatus: function(status) {
        if (status === 'scanning') updateScanBtn('scanning');
        else if (status === 'stopped') updateScanBtn('error');
        else if (status === 'starting') updateScanBtn('scanning');
      },
      debounceMs: 3000
    });

    scanBtn.addEventListener('click', function() {
      clearError();
      if (nfcScanner.isActive()) {
        nfcScanner.restart();
      } else {
        nfcScanner.scan();
      }
    });
  }

  function handleNfcTap(tap) {
    clearError();
    var uid = tap.serial || null;
    var nfcUrl = tap.url;
    var p = null, c = null;

    if (nfcUrl) {
      try {
        var u = new URL(nfcUrl);
        p = u.searchParams.get('p');
        c = u.searchParams.get('c');
      } catch (e) {}
    }

    lastP = p;
    lastC = c;

    var activePanel = document.querySelector('.debug-panel:not(.hidden)');
    if (!activePanel) return;
    var tabId = activePanel.id.replace('panel-', '');

    var handlers = {
      console: handleConsoleTab,
      identify: handleIdentifyTab,
      wipe: handleWipeTab,
      twofa: handleTwofaTab,
      identity: handleIdentityTab,
      pos: handlePosTab
    };
    if (handlers[tabId]) handlers[tabId]({ uid: uid, nfcUrl: nfcUrl, p: p, c: c });
  }

  function handleConsoleTab(data) {
    var ndefBox = document.getElementById('console-ndef');
    var detailsBox = document.getElementById('console-lnurlw-details');
    var payBtn = document.getElementById('console-pay-btn');
    var statusBox = document.getElementById('console-payment-status');

    if (!data.nfcUrl) {
      ndefBox.textContent = 'No NDEF records (blank or unprogrammed card)';
      detailsBox.replaceChildren(_el('span', 'text-gray-500', 'No LNURLW payload found.'));
      payBtn.classList.add('hidden');
      statusBox.classList.add('hidden');
      return;
    }

    ndefBox.textContent = data.nfcUrl;
    payBtn.classList.add('hidden');
    statusBox.classList.add('hidden');

    if (data.nfcUrl.startsWith('https://')) {
      fetch(data.nfcUrl).then(function(r) { return r.json(); }).then(function(json) {
        if (json.tag === 'withdrawRequest') {
          var _w = _el('div', 'space-y-1 text-sm');
          _w.appendChild(_kv('Callback:', json.callback, 'break-all font-mono text-xs text-cyan-300'));
          _w.appendChild(_kv('K1:', json.k1, 'break-all font-mono text-xs text-amber-300'));
          _w.appendChild(_kv('Min:', (json.minWithdrawable / 1000) + ' sats'));
          _w.appendChild(_kv('Max:', (json.maxWithdrawable / 1000) + ' sats'));
          detailsBox.replaceChildren(_w);
          payBtn.classList.remove('hidden');
          payBtn.disabled = false;
          window._consoleCallbackUrl = json.callback;
          window._consoleK1 = json.k1;
        } else {
          detailsBox.textContent = 'The card did not return a withdrawRequest payload.';
        }
      }).catch(function(e) {
        if (typeof window.reportClientError === 'function') window.reportClientError(e, 'debug.js:console-fetch');
        detailsBox.textContent = 'Error fetching LNURLW response: ' + e.message;
      });
    }
  }

  function handleIdentifyTab(data) {
    var detailsBox = document.getElementById('identify-details');
    var rawBox = document.getElementById('identify-raw');

    if (!data.p || !data.c) {
      detailsBox.replaceChildren(_el('p', 'text-gray-500', 'No card data available.'));
      rawBox.textContent = '--';
      return;
    }

    detailsBox.replaceChildren(_el('p', 'text-gray-500 animate-pulse', 'Identifying\\u2026'));
    fetch('/api/identify-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: data.p, c: data.c }),
    }).then(function(r) { return r.json(); }).then(function(json) {
      lastIdentifyData = json;
      rawBox.textContent = JSON.stringify(json, null, 2);

      if (json.status === 'ERROR') {
        detailsBox.replaceChildren(_el('p', 'text-red-300', json.reason || 'Identification failed'));
        return;
      }

      if (json.matched) {
        var m = json.matched;
        var _w = _el('div', 'space-y-2 text-sm');
        _w.appendChild(_kv('UID:', json.uid || '--', 'font-mono text-amber-300'));
        _w.appendChild(_kv('Counter:', json.counter || '--', 'font-mono text-cyan-300'));
        _w.appendChild(_kv('CMAC:', 'valid', 'text-emerald-300'));
        _w.appendChild(_kv('State:', m.card_state || '--'));
        _w.appendChild(_kv('Method:', m.payment_method || '--'));
        _w.appendChild(_kv('Version:', m.version != null ? String(m.version) : '--'));
        _w.appendChild(_kv('Source:', m.source === 'config' ? 'Known card' : 'Deterministic'));
        detailsBox.replaceChildren(_w);

        setCardInfo({
          uid: json.uid,
          counter: json.counter,
          state: m.card_state,
          method: m.payment_method,
          issuer: m.issuerKeyFingerprint ? m.issuerKeyFingerprint.slice(0, 8) + '...' : '--',
          version: m.version != null ? m.version : '--',
          fingerprint: m.issuerKeyFingerprint || '--',
          cmac: 'valid',
        });
      } else {
        var _w2 = _el('div', 'space-y-2 text-sm');
        _w2.appendChild(_kv('UID:', json.uid || '--', 'font-mono text-amber-300'));
        _w2.appendChild(_kv('Counter:', json.counter || '--', 'font-mono text-cyan-300'));
        _w2.appendChild(_kv('CMAC:', 'no match', 'text-red-300'));
        var _att = _el('div', 'text-xs text-gray-500 mt-2');
        _att.textContent = 'Tried ' + ((json.all_attempts && json.all_attempts.length) || 0) + ' key(s). None matched CMAC.';
        _w2.appendChild(_att);
        detailsBox.replaceChildren(_w2);

        setCardInfo({
          uid: json.uid,
          counter: json.counter,
          cmac: 'invalid',
        });
      }
      }).catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'debug.js:identify-fetch');
        detailsBox.replaceChildren(_el('p', 'text-red-300', 'Error: ' + err.message));
      });
  }

  function handleWipeTab(data) {
    var statusDiv = document.getElementById('wipe-status');
    var generateBtn = document.getElementById('wipe-generate-btn');
    var outputDiv = document.getElementById('wipe-output');
    var actionsDiv = document.getElementById('wipe-actions');

    if (!data.uid || data.uid === 'blank') {
      statusDiv.textContent = 'No card detected. Tap a card first.';
      generateBtn.classList.add('hidden');
      outputDiv.classList.add('hidden');
      actionsDiv.classList.add('hidden');
      return;
    }

    statusDiv.textContent = 'Card detected: ' + data.uid.toUpperCase();
    generateBtn.classList.remove('hidden');
    generateBtn.disabled = false;
    outputDiv.classList.add('hidden');
    actionsDiv.classList.add('hidden');

    generateBtn.onclick = function() {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating\\u2026';
      fetch(BASE_URL + '/wipe?uid=' + encodeURIComponent(data.uid))
        .then(function(r) { return r.json(); })
        .then(function(json) {
          outputDiv.classList.remove('hidden');
          var resultDiv = document.getElementById('wipe-result');

          if (json.reset_deeplink) {
            resultDiv.textContent = 'Keys generated successfully.';
            var deeplink = json.reset_deeplink;
            document.getElementById('wipe-deeplink').href = deeplink;
            document.getElementById('wipe-deeplink').textContent = deeplink;

            if (wipeQrCode) { wipeQrCode.clear(); wipeQrCode = null; }
            var qrContainer = document.getElementById('wipe-qr');
            qrContainer.replaceChildren();
            wipeQrCode = new QRCode(qrContainer, { text: deeplink, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });
            actionsDiv.classList.remove('hidden');
          } else {
            resultDiv.textContent = json.reason || 'Failed to generate wipe data.';
          }
        }).catch(function(err) {
          if (typeof window.reportClientError === 'function') window.reportClientError(err, 'debug.js:wipe-fetch');
          var resultDiv = document.getElementById('wipe-result');
          resultDiv.textContent = 'Error: ' + err.message;
        });
      generateBtn.textContent = 'Generate Wipe Data';
      generateBtn.disabled = false;
    };
  }

  function handleTwofaTab(data) {
    var outputDiv = document.getElementById('twofa-output');
    if (!data.p || !data.c) {
      outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4', 'Tap a card to load 2FA codes.'));
      return;
    }
    outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4 animate-pulse', 'Loading\\u2026'));
    fetch(BASE_URL + '/2fa?p=' + encodeURIComponent(data.p) + '&c=' + encodeURIComponent(data.c), {
      headers: { 'Accept': 'application/json' }
    })
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.totpCode) {
          var _w = _el('div', 'space-y-4 text-center');
          var _td = _el('div');
          _td.appendChild(_el('p', 'text-xs text-gray-500 uppercase tracking-wider mb-1', 'TOTP'));
          _td.appendChild(_el('p', 'text-2xl font-mono text-emerald-400', json.totpCode));
          _td.appendChild(_el('p', 'text-xs text-gray-500 mt-1', String(json.totpSecondsRemaining) + 's remaining'));
          _w.appendChild(_td);
          var _hd = _el('div');
          _hd.appendChild(_el('p', 'text-xs text-gray-500 uppercase tracking-wider mb-1', 'HOTP'));
          _hd.appendChild(_el('p', 'text-2xl font-mono text-blue-400', json.hotpCode));
          _hd.appendChild(_el('p', 'text-xs text-gray-500 mt-1', 'Counter: ' + String(json.counterValue)));
          _w.appendChild(_hd);
          _w.appendChild(_el('p', 'text-xs text-gray-500 font-mono', 'UID: ' + (json.maskedUid || json.uidHex || '--')));
          outputDiv.replaceChildren(_w);
        } else {
          outputDiv.replaceChildren(_el('div', 'text-center text-red-400 py-4', json.reason || json.error || 'Error'));
        }
      })
      .catch(function() {
        if (typeof window.reportClientError === 'function') window.reportClientError(new Error('2FA data load failed'), 'debug.js:twofa-fetch');
        outputDiv.replaceChildren(_el('div', 'text-center text-red-400 py-4', 'Error loading 2FA data.'));
      });
  }

  function handleIdentityTab(data) {
    var outputDiv = document.getElementById('identity-output');
    if (!data.p || !data.c) {
      outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4', 'Tap a card to verify identity.'));
      return;
    }
    outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4 animate-pulse', 'Verifying\\u2026'));
    fetch(BASE_URL + '/api/verify-identity?p=' + encodeURIComponent(data.p) + '&c=' + encodeURIComponent(data.c))
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.verified) {
          var _outer = _el('div', 'rounded-xl border border-pink-500/20 bg-pink-500/5 p-4 mt-4');
          var _flex = _el('div', 'flex items-center gap-3 mb-3');
          var _emoji = _el('div', 'h-8 w-8 rounded-full bg-pink-500 flex items-center justify-center text-xl');
          _emoji.textContent = (json.profile && json.profile.emoji) || '?';
          _flex.appendChild(_emoji);
          var _info = _el('div');
          var _name = _el('div', 'font-bold text-white text-lg');
          _name.textContent = (json.profile && json.profile.name) || 'Unknown';
          _info.appendChild(_name);
          var _role = _el('div', 'text-xs text-gray-400');
          _role.textContent = (json.profile && json.profile.role || '') + ' \\u00b7 ' + (json.profile && json.profile.department || '');
          _info.appendChild(_role);
          _flex.appendChild(_info);
          _outer.appendChild(_flex);
          var _grid = _el('div', 'grid grid-cols-2 gap-2 text-sm');
          _grid.appendChild(_kv('UID:', json.uid || '--', 'font-mono text-amber-300', 'text-gray-500'));
          _grid.appendChild(_kv('Clearance:', (json.profile && json.profile.clearance) || '--', 'text-pink-300', 'text-gray-500'));
          _outer.appendChild(_grid);
          outputDiv.replaceChildren(_outer);
        } else {
          var _denied = _el('div', 'rounded-xl border border-red-500/30 bg-red-500/10 p-4 mt-4');
          _denied.appendChild(_el('p', 'text-red-300', json.reason || 'Not verified'));
          outputDiv.replaceChildren(_denied);
        }
      }).catch(function() {
        if (typeof window.reportClientError === 'function') window.reportClientError(new Error('Identity data load failed'), 'debug.js:identity-fetch');
        outputDiv.replaceChildren(_el('div', 'text-center text-red-400 py-4', 'Error loading identity data.'));
      });
  }

  function handlePosTab(data) {
    var chargeBtn = document.getElementById('pos-charge-btn');
    var statusBox = document.getElementById('pos-status');

    if (!data.p || !data.c) {
      chargeBtn.classList.add('hidden');
      statusBox.classList.add('hidden');
      return;
    }

    chargeBtn.classList.remove('hidden');
    chargeBtn.disabled = false;
    statusBox.classList.add('hidden');
    document.getElementById('pos-amount').focus();
  }

  function showPosStatus(msg, ok) {
    var statusBox = document.getElementById('pos-status');
    statusBox.textContent = msg;
    statusBox.className = ok
      ? 'mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200'
      : 'mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200';
    statusBox.classList.remove('hidden');
  }

  function handleManualUrl() {
    var input = document.getElementById('manual-url');
    var url = input.value.trim();
    if (!url) return;
    try {
      var u = new URL(url);
      var p = u.searchParams.get('p');
      var c = u.searchParams.get('c');
      if (!p || !c) { showError('URL must contain p and c parameters'); return; }
      input.value = '';
      clearError();
      var activePanel = document.querySelector('.debug-panel:not(.hidden)');
      if (!activePanel) return;
      var tabId = activePanel.id.replace('panel-', '');
      var handlers = {
        console: handleConsoleTab,
        identify: handleIdentifyTab,
        wipe: handleWipeTab,
        twofa: handleTwofaTab,
        identity: handleIdentityTab,
        pos: handlePosTab
      };
      lastP = p;
      lastC = c;
      if (handlers[tabId]) handlers[tabId]({ uid: null, nfcUrl: url, p: p, c: c });
    } catch (e) { showError('Invalid URL format'); }
  }

  // Event delegation for data-action buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'copy-wipe-deeplink') {
      var link = document.getElementById('wipe-deeplink');
      if (link) {
        navigator.clipboard.writeText(link.href).then(function() {
          var t = document.getElementById('wipe-copy-toast');
          if (t) {
            t.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(function() { t.classList.add('translate-y-20', 'opacity-0'); }, 2000);
          }
        });
      }
    }
  });

  // POS charge button
  document.getElementById('pos-charge-btn').addEventListener('click', function() {
    if (!lastP || !lastC) return;
    var amount = parseInt(document.getElementById('pos-amount').value, 10);
    if (!amount || amount <= 0) { showPosStatus('Enter a valid amount', false); return; }
    var chargeBtn = document.getElementById('pos-charge-btn');
    chargeBtn.disabled = true;
    fetch(BASE_URL + '/operator/pos/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: lastP, c: lastC, amount: amount }),
    }).then(function(r) { return r.json(); }).then(function(json) {
      showPosStatus(json.reason || (json.status === 'OK' ? 'Charged ' + amount + ' credits' : 'Charge failed'), json.status === 'OK');
     }).catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'debug.js:pos-charge-fetch');
        showPosStatus('Error: ' + err.message, false);
      });
    chargeBtn.disabled = false;
  });

  // Console toggle JSON
  document.getElementById('console-toggle-json').addEventListener('click', function() {
    var jsonBox = document.getElementById('console-json');
    jsonBox.classList.toggle('hidden');
    this.textContent = jsonBox.classList.contains('hidden') ? 'Show raw JSON' : 'Hide raw JSON';
  });

  // Manual URL input
  document.getElementById('manual-load-btn').addEventListener('click', handleManualUrl);
  document.getElementById('manual-url').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleManualUrl();
  });

  // Initialize
  initTabs();
  initNfc();

  var nfcStatusEl = document.getElementById('nfc-status');
  if (nfcStatusEl) {
    if (!browserSupportsNfc()) {
      nfcStatusEl.classList.remove('hidden');
      nfcStatusEl.textContent = 'Web NFC not available in this browser. Use the manual URL input below.';
    }
  }

  var activePanel = document.querySelector('.debug-panel:not(.hidden)');
  if (activePanel && activePanel.id === 'panel-console' && nfcScanner) {
    nfcScanner.scan();
  }
})();`;
export const DEBUG_JS_HASH = "bf0c88d19b49";

export const LOGIN_JS = `// login.js — classic script (no import/export)
// Depends on: nfc.js, helpers.js, card-info.js, card-actions.js, programming.js

(function() {
  // Read server config from data attributes
  var loginView = document.getElementById('login-view');
  var API_HOST = loginView ? loginView.getAttribute('data-api-host') : '';
  var DEFAULT_PROGRAMMING_ENDPOINT = loginView ? loginView.getAttribute('data-default-endpoint') : '';

  // State
  var loginTime = null;
  var timerInterval = null;
  var scanner = createNfcScanner({
    continuous: true,
    debounceMs: 3000,
    prefixes: ['lnurlw://', 'lnurlp://', 'https://'],
    onTap: function(tap) {
      clearErrors();
      var statusEl = document.getElementById('scan-status');
      if (tap.url) {
        showNdef(tap.url);
        statusEl.textContent = 'Card detected! Verifying...';
        try {
          var urlObj = new URL(tap.url);
          var p = urlObj.searchParams.get('p');
          var c = urlObj.searchParams.get('c');
          if (p && c) {
            validateWithServer(p, c).then(function(result) {
              if (result.success) {
                if (!result.deployed && !result.public) {
                  showUndeployedCard(result);
                } else if (result.public) {
                  showPublicCard(result);
                } else {
                  showPrivateCard(result);
                }
                scanner.stop();
              } else {
                showPersistentError(result.error || result.reason || 'Authentication failed');
                statusEl.textContent = 'Failed. Tap card to retry.';
              }
            }).catch(function(e) {
              if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:validate-server');
              showPersistentError('Validation error: ' + e.message);
              statusEl.textContent = 'Error. Tap to retry.';
            });
          } else {
            showPersistentError('Card URL missing p/c parameters. Raw: ' + tap.url);
            statusEl.textContent = 'Invalid card. Tap to retry.';
          }
        } catch(e) {
          if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:parse-url');
          showPersistentError('Could not parse card URL: ' + e.message + '. Raw: ' + tap.url);
          statusEl.textContent = 'Parse error. Tap to retry.';
        }
      }
      if (!tap.url && tap.serial) {
        var uid = tap.serial;
        if (/^[0-9a-f]{14}$/.test(uid)) {
          showNdef('No NDEF record found. UID: ' + uid.toUpperCase());
          statusEl.textContent = 'Card detected! Reading UID...';
          validateUid(uid).then(function(result) {
            if (result.success) {
              if (result.deployed) {
                if (result.cardState === 'terminated') {
                  showTerminatedCard(result);
                } else if (result.cardState === 'wipe_requested') {
                  autoConfirmWipe(result);
                } else if (result.cardState === 'active') {
                  showWipedCard(result);
                } else {
                  showPrivateCard(result);
                }
              } else {
                showUndeployedCard(result);
              }
              scanner.stop();
            } else {
              showPersistentError(result.error || result.reason || 'UID lookup failed');
              statusEl.textContent = 'Failed. Tap card to retry.';
            }
          }).catch(function(e) {
            if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:uid-lookup');
            showPersistentError('UID lookup error: ' + e.message);
            statusEl.textContent = 'Error. Tap to retry.';
          });
        }
      }
    },
    onError: function(error, phase) {
      if (typeof window.reportClientError === 'function') window.reportClientError(error, 'login.js:nfc-' + phase);
      var statusEl = document.getElementById('scan-status');
      if (phase === 'permission') {
        if (error.name === 'NotAllowedError') {
          statusEl.textContent = 'NFC permission denied';
          showPersistentError('NFC permission was denied. Refresh the page and allow NFC access.');
        } else if (error.name === 'NotSupportedError') {
          statusEl.textContent = 'NFC not available';
          showPersistentError('NFC is not available on this device. Use Chrome 89+ on Android.');
        } else {
          statusEl.textContent = 'NFC error';
          showPersistentError('NFC error: ' + error.message);
        }
      } else if (phase === 'scan') {
        if (scanner.isActive()) {
          statusEl.textContent = 'Read error. Tap card again.';
        } else {
          statusEl.textContent = 'NFC error';
          showPersistentError('NFC error: ' + error.message);
        }
      }
    },
    onStatus: function(status) {
      var statusEl = document.getElementById('scan-status');
      var indicatorEl = document.getElementById('nfc-indicator');
      if (status === 'scanning') {
        statusEl.textContent = 'Scanning... tap your card';
        indicatorEl.classList.remove('hidden');
      } else if (status === 'stopped') {
        indicatorEl.classList.add('hidden');
      }
    }
  });
  var currentUid = null;
  var currentProgrammingEndpoint = DEFAULT_PROGRAMMING_ENDPOINT;
  var currentUndeployedUid = null;
  var currentTerminatedUid = null;

  // Event delegation for data-action buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    switch (action) {
      case 'rescan': rescanCard(); break;
      case 'copy': copyElementText(btn.getAttribute('data-copy-target')); break;
      case 'copy-href': copyElementHref(btn.getAttribute('data-copy-target')); break;
      case 'copy-wipe': copyWipeJson(btn.getAttribute('data-target')); break;
      case 'copy-all-keys': copyAllKeys(btn.getAttribute('data-target')); break;
      case 'provision': provisionCard(); break;
      case 'reprovision': reprovisionCard(); break;
      case 'reprovision-private': reprovisionPrivateCard(); break;
      case 'fetch-wipe': fetchWipeKeys(); break;
      case 'topup': topUpBalance(); break;
      case 'confirm-wiped': confirmWipedCard(); break;
      case 'show-view': hideAllViews(); document.getElementById(btn.getAttribute('data-view')).classList.remove('hidden'); break;
    }
  });

  function copyElementText(id) {
    var el = document.getElementById(id);
    if (el) navigator.clipboard.writeText(el.textContent);
  }

  function copyElementHref(id) {
    var el = document.getElementById(id);
    if (el) navigator.clipboard.writeText(el.href);
  }

  if (!browserSupportsNfc()) {
    document.getElementById('nfc-not-supported').classList.remove('hidden');
    document.getElementById('nfc-ready').classList.add('hidden');
  } else {
    scanner.scan();
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(function() {
      if (loginTime) {
        document.getElementById('priv-timer').textContent = formatDuration(Date.now() - loginTime);
      }
    }, 1000);
  }

  function hideAllViews() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('undeployed-view').classList.add('hidden');
    document.getElementById('public-view').classList.add('hidden');
    document.getElementById('private-view').classList.add('hidden');
    document.getElementById('terminated-view').classList.add('hidden');
    document.getElementById('wiped-detection-view').classList.add('hidden');
  }

  function showPersistentError(msg) {
    var privView = document.getElementById('private-view');
    var pubView = document.getElementById('public-view');
    if (!privView.classList.contains('hidden')) {
      document.getElementById('private-error-msg').textContent = msg;
      document.getElementById('private-error-box').classList.remove('hidden');
    } else if (!pubView.classList.contains('hidden')) {
      document.getElementById('public-error-msg').textContent = msg;
      document.getElementById('public-error-box').classList.remove('hidden');
    } else {
      document.getElementById('error-msg').textContent = msg;
      document.getElementById('error-box').classList.remove('hidden');
    }
  }

  function clearErrors() {
    document.getElementById('error-box').classList.add('hidden');
    document.getElementById('public-error-box').classList.add('hidden');
    document.getElementById('private-error-box').classList.add('hidden');
  }

  function showNdef(url) {
    document.getElementById('ndef-raw').textContent = url;
    document.getElementById('last-ndef').classList.remove('hidden');
  }

  function typeBadgeClass(cardType) {
    return 'px-3 py-1 rounded text-xs font-bold border ' +
      (cardType === 'lnurlpay' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
       cardType === 'twofactor' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
       'bg-amber-500/10 text-amber-400 border-amber-500/30');
  }

  function copyWipeJson(prefix) {
    navigator.clipboard.writeText(buildWipeJson(prefix + '-keys'));
  }

  function copyAllKeys(target) {
    var tbody = document.getElementById(target);
    if (!tbody) return;
    var cells = tbody.querySelectorAll('td:last-child');
    var vals = Array.from(cells).map(function(t) { return t.textContent.trim(); });
    var obj = {k0: vals[0] || '', k1: vals[1] || '', k2: vals[2] || '', k3: vals[3] || '', k4: vals[4] || ''};
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
  }

  function setCurrentProgrammingEndpoint(endpointUrl) {
    currentProgrammingEndpoint = endpointUrl || DEFAULT_PROGRAMMING_ENDPOINT;
  }

  function buildProgrammingEndpointUrl() {
    return currentProgrammingEndpoint || DEFAULT_PROGRAMMING_ENDPOINT;
  }

  function showUndeployedProgrammingInstructions(endpointUrl, deliveredAt) {
    var deeplink = buildProgrammingDeeplink(endpointUrl || buildProgrammingEndpointUrl());
    renderQrCode('qr-undep-program', deeplink);
    document.getElementById('undep-program-deeplink').href = deeplink;
    if (deliveredAt) {
      document.getElementById('undep-keys-delivered-time').textContent = 'Keys generated ' + relativeTime(Math.floor(deliveredAt / 1000)) + '.';
    } else {
      document.getElementById('undep-keys-delivered-time').textContent = '';
    }
    document.getElementById('undep-program-section').classList.remove('hidden');
    document.getElementById('undep-provision-btn').parentElement.classList.add('hidden');
  }

  function hideUndeployedProgrammingInstructions() {
    document.getElementById('undep-program-section').classList.add('hidden');
    document.getElementById('undep-provision-btn').parentElement.classList.remove('hidden');
  }

  function provisionCard() {
    if (!currentUndeployedUid) return;
    var btn = document.getElementById('undep-provision-btn');
    var status = document.getElementById('undep-provision-status');
    btn.disabled = true;
    btn.textContent = 'PROVISIONING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Writing keys to card...';

    var endpoint = buildProgrammingEndpointUrl();
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UID: currentUndeployedUid }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card provisioned! Version ' + (result.data.Version || 1) + '. Tap again to activate.';
        btn.textContent = 'PROVISIONED';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-600');
        showUndeployedProgrammingInstructions(endpoint, Date.now());
      } else {
        throw new Error(result.data.error || 'Provisioning failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:provision');
      status.className = 'mt-3 text-center text-sm text-red-400';
      if (e.message.includes('active') || e.message.includes('Terminate')) {
        status.textContent = 'This card is already active and working. Wipe it first if you want to re-provision.';
      } else {
        status.textContent = 'Error: ' + e.message;
      }
      btn.disabled = false;
      btn.textContent = 'PROVISION AS WITHDRAW CARD';
      btn.classList.remove('opacity-50');
    });
  }

  function showUndeployedCard(result) {
    clearErrors();
    hideAllViews();
    currentUndeployedUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    document.getElementById('undep-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('undep-version').textContent = result.keyVersion || 1;
    document.getElementById('undep-state').textContent = result.cardState || 'new';
    document.getElementById('undep-keys').replaceChildren(buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4));
    var btn = document.getElementById('undep-provision-btn');
    btn.disabled = false;
    btn.textContent = 'PROVISION AS WITHDRAW CARD';
    btn.classList.remove('opacity-50', 'bg-gray-600');
    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    document.getElementById('undep-provision-status').classList.add('hidden');
    if (result.awaitingProgramming) {
      showUndeployedProgrammingInstructions(result.programmingEndpoint, result.keysDeliveredAt);
    } else {
      hideUndeployedProgrammingInstructions();
    }
    document.getElementById('undeployed-view').classList.remove('hidden');
  }

  function showPublicCard(result) {
    clearErrors();
    hideAllViews();
    var cardType = result.cardType || 'unknown';
    var typeLabels = { fakewallet: 'WITHDRAW', lnurlpay: 'POS', twofactor: '2FA' };

    document.getElementById('pub-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('pub-card-type-badge').textContent = typeLabels[cardType] || cardType.toUpperCase();
    document.getElementById('pub-card-type-badge').className = typeBadgeClass(cardType);
    document.getElementById('pub-version').textContent = result.keyVersion || '-';
    document.getElementById('pub-state').textContent = result.cardState || '-';
    document.getElementById('pub-counter').textContent = result.counterValue;
    document.getElementById('pub-issuer').textContent = result.issuerKey || 'recovered';
    var cmacEl = document.getElementById('pub-cmac');
    cmacEl.textContent = result.cmacValid ? 'VERIFIED' : 'FAILED';
    cmacEl.className = result.cmacValid ? 'font-mono text-emerald-400' : 'font-mono text-red-400';
    document.getElementById('pub-keys').replaceChildren(buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4));
    document.getElementById('pub-ndef').textContent = result.ndef || '';
    document.getElementById('public-view').classList.remove('hidden');
    renderTapHistory(result.tapHistory || [], 'pub');
    var pubUid = result.uidHex;
    var pubKeys = [result.k0, result.k1, result.k2, result.k3, result.k4];
    if (pubKeys[0] && pubKeys[1] && pubKeys[2] && pubKeys[3] && pubKeys[4]) {
      var endpointUrl = API_HOST + '/api/keys?uid=' + pubUid + '&format=boltcard';
      document.getElementById('pub-wipe-deeplink').href = 'boltcard://reset?url=' + encodeURIComponent(endpointUrl);
      var qrEl = document.getElementById('qr-pub-wipe');
      qrEl.replaceChildren();
      renderQrCode('qr-pub-wipe', buildWipeJson('pub-keys'));
    }
  }

  function showPrivateCard(result) {
    clearErrors();
    hideAllViews();
    currentUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    var cardType = result.cardType || 'unknown';
    var typeLabels = { fakewallet: 'WITHDRAW', lnurlpay: 'POS', twofactor: '2FA' };

    document.getElementById('priv-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('priv-card-type-badge').textContent = typeLabels[cardType] || cardType.toUpperCase();
    document.getElementById('priv-card-type-badge').className = typeBadgeClass(cardType);
    document.getElementById('priv-version').textContent = result.keyVersion || '-';
    document.getElementById('priv-state').textContent = result.cardState || '-';
    document.getElementById('priv-counter').textContent = result.counterValue;
    if (result.balance !== undefined) {
      document.getElementById('priv-balance').textContent = result.balance;
    }
    document.getElementById('priv-issuer').textContent = result.issuerKey || 'current';
    document.getElementById('topup-amount').value = '';
    document.getElementById('topup-status').classList.add('hidden');
    var cmacEl = document.getElementById('priv-cmac');
    cmacEl.textContent = result.cmacValid ? 'VERIFIED' : 'FAILED';
    cmacEl.className = result.cmacValid ? 'font-mono text-emerald-400' : 'font-mono text-red-400';
    document.getElementById('priv-debug-issuer').textContent = '-';
    document.getElementById('priv-debug-version').textContent = '-';
    document.getElementById('priv-debug-versions').textContent = '-';
    if (result.debug) {
      document.getElementById('priv-debug-issuer').textContent = result.debug.issuerKey || '-';
      document.getElementById('priv-debug-version').textContent = result.debug.matchedVersion || '-';
      if (result.debug.versionsTried && result.debug.versionsTried.length > 0) {
        document.getElementById('priv-debug-versions').textContent = result.debug.versionsTried.map(function(v) {
          return 'v' + v.version + ':' + (v.cmac ? 'OK' : 'FAIL');
        }).join(', ');
      }
    }
    document.getElementById('priv-keys').replaceChildren(buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4));
    document.getElementById('priv-ndef').textContent = result.ndef || '';
    var privProgrammingSection = document.getElementById('priv-awaiting-programming');
    var terminatedBanner = document.getElementById('priv-terminated-banner');
    var wipeSection = document.getElementById('priv-wipe-section');
    var reprovisionBtn = document.getElementById('priv-reprovision-btn');
    reprovisionBtn.disabled = false;
    reprovisionBtn.textContent = 'RE-PROVISION CARD';
    reprovisionBtn.classList.remove('opacity-50', 'bg-gray-600');
    reprovisionBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    document.getElementById('priv-reprovision-status').classList.add('hidden');
    document.getElementById('priv-reprovision-program').classList.add('hidden');
    if (result.cardState === 'keys_delivered' && result.programmingEndpoint) {
      var privProgramEndpoint = result.programmingEndpoint;
      var privDeeplink = 'boltcard://program?url=' + encodeURIComponent(privProgramEndpoint);
      renderQrCode('qr-priv-program', privDeeplink);
      document.getElementById('priv-program-deeplink').href = privDeeplink;
      if (result.keysDeliveredAt) {
        document.getElementById('priv-keys-delivered-time').textContent = 'Keys generated ' + relativeTime(Math.floor(result.keysDeliveredAt / 1000)) + '.';
      } else {
        document.getElementById('priv-keys-delivered-time').textContent = '';
      }
      privProgrammingSection.classList.remove('hidden');
      wipeSection.classList.add('hidden');
    } else {
      privProgrammingSection.classList.add('hidden');
    }

    if (result.cardState === 'terminated') {
      document.getElementById('priv-term-version').textContent = result.keyVersion || 1;
      terminatedBanner.classList.remove('hidden');
      wipeSection.classList.add('hidden');
    } else {
      terminatedBanner.classList.add('hidden');
    }

    document.getElementById('priv-wipe-version').textContent = 'v' + (result.keyVersion || 1);
    document.getElementById('priv-fetch-wipe-btn').disabled = false;
    document.getElementById('priv-fetch-wipe-btn').textContent = 'GET WIPE KEYS';
    document.getElementById('priv-fetch-wipe-btn').classList.remove('opacity-50', 'bg-gray-600');
    document.getElementById('priv-fetch-wipe-btn').classList.add('bg-red-600', 'hover:bg-red-500');
    document.getElementById('priv-wipe-status').classList.add('hidden');
    document.getElementById('priv-wipe-result').classList.add('hidden');
    if (result.cardState === 'active') {
      wipeSection.classList.remove('hidden');
    } else if (result.cardState === 'wipe_requested') {
      wipeSection.classList.remove('hidden');
      document.getElementById('priv-fetch-wipe-btn').textContent = 'WIPE KEYS ALREADY RETRIEVED';
      document.getElementById('priv-fetch-wipe-btn').disabled = true;
      document.getElementById('priv-fetch-wipe-btn').classList.remove('bg-red-600', 'hover:bg-red-500');
      document.getElementById('priv-fetch-wipe-btn').classList.add('bg-gray-600');
      var statusEl = document.getElementById('priv-wipe-status');
      statusEl.classList.remove('hidden');
      statusEl.className = 'mt-3 text-center text-sm text-amber-400';
      statusEl.textContent = 'Card is pending physical wipe. Tap card with blank NDEF to confirm.';
    } else {
      wipeSection.classList.add('hidden');
    }

    loginTime = Date.now();
    document.getElementById('priv-timer').textContent = '00:00:00';
    document.getElementById('private-view').classList.remove('hidden');
    renderTapHistory(result.tapHistory || [], 'priv');
    startTimer();
  }

  function showTerminatedCard(result) {
    clearErrors();
    hideAllViews();
    currentTerminatedUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    var prevVersion = result.keyVersion || 1;
    var nextVersion = prevVersion + 1;
    document.getElementById('term-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('term-prev-version').textContent = prevVersion;
    document.getElementById('term-next-version').textContent = nextVersion;
    document.getElementById('term-version').textContent = prevVersion;
    var btn = document.getElementById('term-provision-btn');
    btn.disabled = false;
    btn.textContent = 'RE-PROVISION AS WITHDRAW CARD (v' + nextVersion + ')';
    btn.classList.remove('opacity-50', 'bg-gray-600');
    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    document.getElementById('term-provision-status').classList.add('hidden');
    document.getElementById('term-program-section').classList.add('hidden');
    document.getElementById('terminated-view').classList.remove('hidden');
  }

  function showWipedCard(result) {
    clearErrors();
    hideAllViews();
    currentTerminatedUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    var version = result.keyVersion || 1;
    document.getElementById('wiped-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('wiped-version').textContent = version;
    document.getElementById('wiped-key-version').textContent = version;
    document.getElementById('wiped-next-version').textContent = version + 1;
    var btn = document.getElementById('wiped-confirm-btn');
    btn.disabled = false;
    btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
    btn.classList.remove('opacity-50', 'bg-gray-600');
    btn.classList.add('bg-red-600', 'hover:bg-red-500');
    document.getElementById('wiped-confirm-status').classList.add('hidden');
    document.getElementById('wiped-detection-view').classList.remove('hidden');
  }

  function confirmWipedCard() {
    var uid = currentTerminatedUid;
    if (!uid) return;
    var btn = document.getElementById('wiped-confirm-btn');
    var status = document.getElementById('wiped-confirm-status');
    btn.disabled = true;
    btn.textContent = 'TERMINATING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Terminating card...';

    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, action: 'terminate' }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok && result.data.success) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card terminated. Ready for re-provision at version ' + (result.data.keyVersion || 2) + '.';
        btn.textContent = 'TERMINATED';
        btn.classList.remove('bg-red-600', 'hover:bg-red-500');
        btn.classList.add('bg-gray-600');
        setTimeout(function() {
          showTerminatedCard({
            uidHex: uid,
            keyVersion: result.data.keyVersion || 2,
            cardState: 'terminated',
            programmingEndpoint: result.data.programmingEndpoint,
          });
        }, 1500);
      } else {
        throw new Error(result.data.error || 'Termination failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:terminate');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
      btn.classList.remove('opacity-50');
    });
  }

  function fetchWipeKeys() {
    var uid = document.getElementById('priv-uid-display').textContent.replace('UID: ', '').toLowerCase();
    if (!uid) return;
    var btn = document.getElementById('priv-fetch-wipe-btn');
    var status = document.getElementById('priv-wipe-status');
    btn.disabled = true;
    btn.textContent = 'FETCHING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Retrieving wipe keys...';

    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, action: 'request-wipe' }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok && result.data.success) {
        btn.textContent = 'WIPE KEYS RETRIEVED';
        btn.classList.remove('bg-red-600', 'hover:bg-red-500');
        btn.classList.add('bg-gray-600');
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card is now pending wipe (v' + result.data.keyVersion + ')';
        renderQrCode('qr-priv-wipe', result.data.wipeJson);
        document.getElementById('priv-wipe-link').href = result.data.wipeDeeplink;
        document.getElementById('priv-wipe-json').textContent = result.data.wipeJson;
        document.getElementById('priv-wipe-result').classList.remove('hidden');
      } else {
        throw new Error(result.data.error || 'Failed to fetch wipe keys');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:fetch-wipe-keys');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      btn.textContent = 'GET WIPE KEYS';
      btn.classList.remove('opacity-50');
    });
  }

  function topUpBalance() {
    var amountInput = document.getElementById('topup-amount');
    var statusEl = document.getElementById('topup-status');
    var amount = parseInt(amountInput.value, 10);
    if (!amount || amount <= 0) {
      statusEl.textContent = 'Enter a positive amount';
      statusEl.className = 'text-xs mt-2 text-red-400';
      statusEl.classList.remove('hidden');
      return;
    }
    statusEl.textContent = 'Processing...';
    statusEl.className = 'text-xs mt-2 text-gray-400';
    statusEl.classList.remove('hidden');

    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: currentUid, action: 'top-up', amount: amount }),
    }).then(function(resp) { return resp.json(); })
    .then(function(result) {
      if (result.success) {
        document.getElementById('priv-balance').textContent = result.balance;
        amountInput.value = '';
        statusEl.textContent = result.message;
        statusEl.className = 'text-xs mt-2 text-emerald-400';
      } else {
        statusEl.textContent = result.error || 'Top-up failed';
        statusEl.className = 'text-xs mt-2 text-red-400';
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:topup');
      statusEl.textContent = 'Error: ' + e.message;
      statusEl.className = 'text-xs mt-2 text-red-400';
    });
  }

  function autoConfirmWipe(result) {
    clearErrors();
    hideAllViews();
    showNdef('No NDEF record found. UID: ' + result.uidHex.toUpperCase());
    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: result.uidHex, action: 'terminate' }),
    }).then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (data.success) {
        showTerminatedCard({
          uidHex: result.uidHex,
          keyVersion: data.keyVersion || (result.keyVersion + 1),
          cardState: 'terminated',
          programmingEndpoint: data.programmingEndpoint,
        });
      } else {
        showPersistentError('Failed to confirm wipe: ' + (data.error || 'unknown'));
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:confirm-wipe');
      showPersistentError('Wipe confirmation error: ' + e.message);
    });
  }

  function reprovisionCard() {
    if (!currentTerminatedUid) return;
    var btn = document.getElementById('term-provision-btn');
    var status = document.getElementById('term-provision-status');
    btn.disabled = true;
    btn.textContent = 'PROVISIONING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Generating new keys...';

    var endpoint = buildProgrammingEndpointUrl();
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UID: currentTerminatedUid }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card re-provisioned at version ' + (result.data.Version || 2) + '!';
        btn.textContent = 'PROVISIONED';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-600');
        var deeplink = buildProgrammingDeeplink(endpoint);
        renderQrCode('qr-term-program', deeplink);
        document.getElementById('term-program-deeplink').href = deeplink;
        document.getElementById('term-keys-delivered-time').textContent = 'Keys generated just now.';
        document.getElementById('term-program-section').classList.remove('hidden');
      } else {
        throw new Error(result.data.error || 'Provisioning failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:reprovision');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      var prevVersion = document.getElementById('term-version').textContent;
      btn.textContent = 'RE-PROVISION AS WITHDRAW CARD (v' + (parseInt(prevVersion) + 1) + ')';
      btn.classList.remove('opacity-50');
    });
  }

  function reprovisionPrivateCard() {
    var uid = document.getElementById('priv-uid-display').textContent.replace('UID: ', '').toLowerCase();
    if (!uid) return;
    var btn = document.getElementById('priv-reprovision-btn');
    var status = document.getElementById('priv-reprovision-status');
    btn.disabled = true;
    btn.textContent = 'PROVISIONING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Generating new keys...';

    var endpoint = buildProgrammingEndpointUrl();
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UID: uid }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Re-provisioned at version ' + (result.data.Version || 2) + '!';
        btn.textContent = 'PROVISIONED';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-600');
        var deeplink = buildProgrammingDeeplink(endpoint);
        renderQrCode('qr-priv-reprovision', deeplink);
        document.getElementById('priv-reprovision-deeplink').href = deeplink;
        document.getElementById('priv-reprovision-program').classList.remove('hidden');
      } else {
        throw new Error(result.data.error || 'Provisioning failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:reprovision-private');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      btn.textContent = 'RE-PROVISION CARD';
      btn.classList.remove('opacity-50');
    });
  }

  function validateWithServer(p, c) {
    return fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: p, c: c }),
    }).then(function(resp) { return resp.json(); });
  }

  function validateUid(uid) {
    return fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid }),
    }).then(function(resp) { return resp.json(); });
  }

  function rescanCard() {
    hideAllViews();
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('scan-status').textContent = 'Scanning... tap your card';
    scanner.scan();
  }
})();`;
export const LOGIN_JS_HASH = "3c91b8660592";

export const ACTIVATE_JS = `// activate.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)
// Used by both renderActivatePage() and renderActivateCardPage()

var UID_REGEX = /^[0-9a-f]{14}$/;

function validateUid(uid) {
  if (!uid || typeof uid !== 'string') return null;
  var normalized = uid.replace(/:/g, '').toLowerCase();
  if (!UID_REGEX.test(normalized)) return null;
  return normalized;
}

// --- Page 1: Activation page (QR codes, copy, toast) ---

(function initActivatePage() {
  var configEl = document.getElementById('activate-config');
  if (!configEl) return;

  var posBaseUrl = configEl.getAttribute('data-api-url') || '';
  var programUrl = configEl.getAttribute('data-program-url') || '';
  var resetUrl = configEl.getAttribute('data-reset-url') || '';
  var posQr = null;

  function updatePosConfig() {
    var address = document.getElementById('pos-lightning-address').value.trim();
    var amount = parseInt(document.getElementById('pos-amount').value) || 1;
    var amountMsat = amount * 1000;
    var posUrl = posBaseUrl + '&card_type=pos&lightning_address=' + encodeURIComponent(address) + '&min_sendable=' + amountMsat + '&max_sendable=' + amountMsat;
    var deepLink = 'boltcard://program?url=' + encodeURIComponent(posUrl);

    var linkEl = document.getElementById('link-pos');
    linkEl.textContent = deepLink;

    var deeplinkEl = document.getElementById('pos-deeplink');
    deeplinkEl.href = deepLink;

    if (posQr) posQr.clear();
    posQr.makeCode(posUrl);
  }

  function setup2faConfig() {
    var twoFaUrl = posBaseUrl + '&card_type=2fa';
    var deepLink = 'boltcard://program?url=' + encodeURIComponent(twoFaUrl);

    document.getElementById('link-2fa').textContent = deepLink;
    document.getElementById('2fa-deeplink').href = deepLink;

    var qr2fa = new QRCode(document.getElementById("qr-2fa"), {
      text: twoFaUrl,
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    new QRCode(document.getElementById("qr-program"), {
      text: programUrl,
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });

    new QRCode(document.getElementById("qr-reset"), {
      text: resetUrl,
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });

    posQr = new QRCode(document.getElementById("qr-pos"), {
      text: "",
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });

    updatePosConfig();
    setup2faConfig();

    document.getElementById('pos-lightning-address').addEventListener('input', updatePosConfig);
    document.getElementById('pos-amount').addEventListener('input', updatePosConfig);
  });

  // Copy + toast for activation page
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-copy-id]');
    if (!btn) return;
    var elementId = btn.getAttribute('data-copy-id');
    var el = document.getElementById(elementId);
    if (!el) return;
    var text = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : el.innerText;
    navigator.clipboard.writeText(text).then(function() {
      var toast = document.getElementById('toast');
      if (toast) {
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(function() {
          toast.classList.add('translate-y-20', 'opacity-0');
        }, 2000);
      }
    }).catch(function() {});
  });
})();

// --- Page 2: Activate card form (NFC scan + submit) ---

(function initActivateCardPage() {
  var formEl = document.getElementById('activateForm');
  if (!formEl) return;

  var activateFormScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onTap: function(data) {
      var nfcStatus = document.getElementById('nfc-status');
      var uidInput = document.getElementById('uid');
      nfcStatus.classList.remove('hidden');
      if (data.serial) {
        var formattedUid = data.serial;
        var validatedUid = validateUid(formattedUid);
        if (validatedUid) {
          uidInput.value = validatedUid;
          nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300';
          nfcStatus.textContent = 'Successfully scanned card UID: ' + validatedUid;
        } else {
          nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
          nfcStatus.textContent = 'Invalid UID format after processing. Expected 14 hex characters.';
        }
      } else {
        nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
        nfcStatus.textContent = 'Could not read UID from card. Please try again.';
      }
      var scanHint = document.getElementById('nfc-scanning-hint');
      if (scanHint) scanHint.textContent = 'Tap again to re-scan card';
    },
    onError: function(err, phase) {
      var nfcStatus = document.getElementById('nfc-status');
      if (phase !== 'permission') {
        nfcStatus.classList.remove('hidden');
        nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
        nfcStatus.textContent = 'Error: ' + err.message;
      }
    }
  });

  document.getElementById('activateForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var result = document.getElementById('result');
    var uidInput = document.getElementById('uid');
    var validatedUid = validateUid(uidInput.value.replace(/:/g, '').toLowerCase());

    if (!validatedUid) {
      result.className = 'mt-4 text-sm text-red-300';
      result.textContent = 'Error: UID must be exactly 7 bytes (14 hex characters)';
      return;
    }

    fetch('/experimental/activate/form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: validatedUid })
    }).then(function(r) { return r.json(); }).then(function(json) {
      if (json.status === 'OK') {
        result.className = 'mt-4 text-sm text-emerald-300';
        result.textContent = 'Card activated successfully! ' + (json.message || '');
      } else {
        result.className = 'mt-4 text-sm text-red-300';
        result.textContent = 'Error: ' + (json.reason || 'Unknown error');
      }
     }).catch(function(error) {
       if (typeof window.reportClientError === 'function') window.reportClientError(error, 'activate.js:submit');
       result.className = 'mt-4 text-sm text-red-300';
       result.textContent = 'Error submitting form: ' + error.message;
     });
  });
})();`;
export const ACTIVATE_JS_HASH = "5d4333367688";

export const ANALYTICS_JS = `// analytics.js — classic script (no import/export)
// No external dependencies

var UID_REGEX = /^[0-9a-f]{14}$/;

function _analyticsValidateUid(uid) {
  if (!uid || typeof uid !== 'string') return null;
  var normalized = uid.toLowerCase();
  if (!UID_REGEX.test(normalized)) return null;
  return normalized;
}

function _formatMsat(msat) {
  if (!msat || msat === 0) return '0 sats';
  var sats = msat / 1000;
  if (sats < 1) return msat + ' msat';
  if (sats < 1000) return (sats % 1 === 0 ? sats : sats.toFixed(3)) + ' sats';
  return (sats / 1e8).toFixed(8) + ' BTC';
}

function _loadAnalytics() {
  var uid = document.getElementById('uid-input').value.trim().toLowerCase();
  var normalizedUid = _analyticsValidateUid(uid);
  var errEl = document.getElementById('lookup-error');
  errEl.classList.add('hidden');

  if (!normalizedUid) {
    errEl.textContent = 'Invalid UID — must be 14 hex characters';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    fetch('/analytics/data?uid=' + normalizedUid).then(function(resp) {
      if (!resp.ok) {
        errEl.textContent = 'Failed to load analytics (HTTP ' + resp.status + ')';
        errEl.classList.remove('hidden');
        return;
      }
      return resp.json().then(function(data) {
        _renderAnalytics(normalizedUid, data);
       });
     }).catch(function(e) {
       if (typeof window.reportClientError === 'function') window.reportClientError(e, 'analytics.js:load-data');
       errEl.textContent = 'Error: ' + e.message;
       errEl.classList.remove('hidden');
     });
   } catch (e) {
     if (typeof window.reportClientError === 'function') window.reportClientError(e, 'analytics.js:load-data');
     errEl.textContent = 'Error: ' + e.message;
     errEl.classList.remove('hidden');
   }
 }

function _renderAnalytics(uid, d) {
  document.getElementById('display-uid').textContent = uid.toUpperCase();
  document.getElementById('stat-completed').textContent = _formatMsat(d.completedMsat || 0);
  document.getElementById('stat-failed').textContent = _formatMsat(d.failedMsat || 0);
  document.getElementById('stat-pending').textContent = _formatMsat(d.pendingMsat || 0);
  document.getElementById('stat-taps').textContent = d.totalTaps || 0;

  document.getElementById('breakdown-completed-count').textContent = (d.completedTaps || 0) + ' taps';
  document.getElementById('breakdown-completed-amount').textContent = _formatMsat(d.completedMsat || 0);
  document.getElementById('breakdown-failed-count').textContent = (d.failedTaps || 0) + ' taps';
  document.getElementById('breakdown-failed-amount').textContent = _formatMsat(d.failedMsat || 0);
  document.getElementById('breakdown-pending-count').textContent = (d.pendingTaps || 0) + ' taps';
  document.getElementById('breakdown-pending-amount').textContent = _formatMsat(d.pendingMsat || 0);

  var total = d.totalTaps || 0;
  var completed = d.completedTaps || 0;
  var rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  document.getElementById('success-bar').style.width = rate + '%';
  document.getElementById('success-rate').textContent = completed + ' / ' + total + ' (' + rate + '%)';

  document.getElementById('analytics-content').classList.remove('hidden');
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action="load-analytics"]');
  if (btn) _loadAnalytics();
});

var _analyticsParams = new URLSearchParams(window.location.search);
var _analyticsPrefill = _analyticsParams.get('uid');
if (_analyticsPrefill) {
  document.getElementById('uid-input').value = _analyticsPrefill;
  _loadAnalytics();
}`;
export const ANALYTICS_JS_HASH = "acb7eb5d907f";

export const CARD_AUDIT_JS = `// card-audit.js — classic script (no import/export)
// Depends on: nfc.js (stateLabel, stateColor, provenanceLabel, provenanceColor)

var currentFilter = "";
var nextCursor = null;
var hasMore = false;
var allCards = [];
var selectedUids = new Set();

function _auditFormatTime(ts) {
  if (!ts) return '-';
  try {
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return '-'; }
}

function _updateBatchBar() {
  var bar = document.getElementById('batch-bar');
  var count = selectedUids.size;
  document.getElementById('batch-count').textContent = count + ' selected';
  document.getElementById('btn-batch-terminate').disabled = count === 0;
  document.getElementById('btn-batch-wipe').disabled = count === 0;
  document.getElementById('btn-batch-activate').disabled = count === 0;
  document.getElementById('btn-batch-reprovision').disabled = count === 0;
  if (count > 0) {
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
  document.getElementById('select-all-checkbox').checked = allCards.length > 0 && selectedUids.size === allCards.length;
}

function _toggleCard(uid) {
  if (selectedUids.has(uid)) {
    selectedUids.delete(uid);
  } else {
    selectedUids.add(uid);
  }
  _updateBatchBar();
}

function _loadCards(append) {
  if (!append) {
    nextCursor = null;
    hasMore = false;
    allCards = [];
    selectedUids.clear();
    _updateBatchBar();
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('cards-table').classList.add('hidden');
    document.getElementById('no-cards').classList.add('hidden');
    document.getElementById('error-display').classList.add('hidden');
    document.getElementById('batch-result').classList.add('hidden');
  }

  try {
    var url = '/operator/cards/data?limit=100';
    if (currentFilter) url += '&state=' + encodeURIComponent(currentFilter);
    if (append && nextCursor) url += '&cursor=' + encodeURIComponent(nextCursor);
    fetch(url).then(function(resp) {
      return resp.json().then(function(data) {
        document.getElementById('loading').classList.add('hidden');

        if (!resp.ok) {
          _showAuditError(data.reason || 'Failed to load cards');
          return;
        }

        var cards = data.cards || [];
        allCards = append ? allCards.concat(cards) : cards;
        hasMore = !!data.cursor;
        nextCursor = data.cursor || null;

        if (!append && cards.length === 0) {
          document.getElementById('no-cards').classList.remove('hidden');
          document.getElementById('load-more-container').classList.add('hidden');
          return;
        }

        document.getElementById('cards-table').classList.remove('hidden');
        _renderCards();

        if (hasMore) {
          document.getElementById('load-more-container').classList.remove('hidden');
        } else {
          document.getElementById('load-more-container').classList.add('hidden');
        }
      });
     }).catch(function(err) {
       if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:load-cards');
       document.getElementById('loading').classList.add('hidden');
       _showAuditError('Failed to load card registry');
     });
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:load-cards');
     document.getElementById('loading').classList.add('hidden');
     _showAuditError('Failed to load card registry');
   }
 }

function _renderCards() {
  var list = document.getElementById('cards-list');
  list.replaceChildren.apply(list, allCards.map(function(card) {
    var row = document.createElement('div');
    row.className = 'grid grid-cols-7 gap-2 px-4 py-3 text-sm hover:bg-gray-700/30 transition-colors';

    var checkCell = document.createElement('div');
    checkCell.className = 'w-5';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'card-checkbox rounded';
    cb.setAttribute('data-uid', card.uid);
    cb.checked = selectedUids.has(card.uid);
    cb.addEventListener('change', function() {
      _toggleCard(this.getAttribute('data-uid'));
    });
    checkCell.appendChild(cb);
    row.appendChild(checkCell);

    var uidSpan = document.createElement('span');
    uidSpan.className = 'font-mono text-gray-300 text-xs';
    uidSpan.textContent = card.uid;
    row.appendChild(uidSpan);

    var stateSpan = document.createElement('span');
    stateSpan.className = 'font-mono ' + stateColor(card.state);
    stateSpan.textContent = card.state;
    row.appendChild(stateSpan);

    var provSpan = document.createElement('span');
    provSpan.className = 'font-mono text-xs ' + provenanceColor(card.keyProvenance);
    provSpan.textContent = provenanceLabel(card.keyProvenance, true);
    row.appendChild(provSpan);

    var labelSpan = document.createElement('span');
    labelSpan.className = 'font-mono text-xs text-gray-400';
    labelSpan.textContent = card.keyLabel || '-';
    row.appendChild(labelSpan);

    var timeSpan = document.createElement('span');
    timeSpan.className = 'text-xs text-gray-500';
    timeSpan.textContent = _auditFormatTime(card.updatedAt);
    row.appendChild(timeSpan);

    var linkCell = document.createElement('span');
    linkCell.className = 'text-right';
    var link = document.createElement('a');
    link.href = '/experimental/analytics?uid=' + encodeURIComponent(card.uid);
    link.className = 'text-emerald-500 hover:text-emerald-400 text-xs';
    link.textContent = 'analytics';
    linkCell.appendChild(link);
    row.appendChild(linkCell);

    return row;
  }));
}

function _batchAction(action) {
  if (selectedUids.size === 0) return;
  var uids = Array.from(selectedUids);
  var btnMap = { terminate: 'btn-batch-terminate', wipe: 'btn-batch-wipe', activate: 'btn-batch-activate', reprovision: 'btn-batch-reprovision' };
  var btn = document.getElementById(btnMap[action]);
  var origText = btn.textContent;
  btn.textContent = 'Working...';
  btn.disabled = true;

  fetch('/operator/cards/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uids: uids, action: action }),
  }).then(function(resp) {
    return resp.json().then(function(data) {
      var resultDiv = document.getElementById('batch-result');
      var contentDiv = document.getElementById('batch-result-content');

      if (!resp.ok) {
        _showAuditError(data.reason || 'Batch action failed');
        return;
      }

      var succeeded = data.results.filter(function(r) { return r.status !== 'skipped'; }).length;
      var skipped = data.results.filter(function(r) { return r.status === 'skipped'; }).length;
      var failed = (data.errors || []).length;

      var wrapper = document.createElement('div');
      wrapper.className = 'space-y-1';

      var successP = document.createElement('p');
      successP.className = 'text-emerald-300 font-semibold';
      successP.textContent = succeeded + ' card(s) processed: ' + action;
      wrapper.appendChild(successP);

      if (skipped > 0) {
        var skipP = document.createElement('p');
        skipP.className = 'text-yellow-300';
        skipP.textContent = skipped + ' card(s) skipped';
        wrapper.appendChild(skipP);
        data.results.filter(function(r) { return r.status === 'skipped'; }).forEach(function(r) {
          var detail = document.createElement('p');
          detail.className = 'text-xs text-gray-500 ml-3';
          detail.textContent = r.uid + ': ' + r.reason;
          wrapper.appendChild(detail);
        });
      }
      if (failed > 0) {
        var failP = document.createElement('p');
        failP.className = 'text-red-300';
        failP.textContent = failed + ' card(s) failed';
        wrapper.appendChild(failP);
        data.errors.forEach(function(e) {
          var detail = document.createElement('p');
          detail.className = 'text-xs text-gray-500 ml-3';
          detail.textContent = e.uid + ': ' + e.error;
          wrapper.appendChild(detail);
        });
      }
      contentDiv.replaceChildren(wrapper);
      resultDiv.classList.remove('hidden');

      selectedUids.clear();
      _updateBatchBar();
      _loadCards(false);
      btn.textContent = origText;
      btn.disabled = selectedUids.size === 0;
    });
   }).catch(function(err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:batch-action');
     _showAuditError('Batch action failed: ' + err.message);
     btn.textContent = origText;
     btn.disabled = selectedUids.size === 0;
   });
 }

function _showAuditError(msg) {
  document.getElementById('error-display').classList.remove('hidden');
  document.getElementById('error-message').textContent = msg;
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var action = btn.getAttribute('data-action');
  switch (action) {
    case 'filter':
      currentFilter = btn.getAttribute('data-filter') || '';
      document.querySelectorAll('[data-action="filter"]').forEach(function(b) { b.classList.remove('ring-2', 'ring-emerald-500'); });
      btn.classList.add('ring-2', 'ring-emerald-500');
      _loadCards(false);
      break;
    case 'refresh':
      _loadCards(false);
      break;
    case 'load-more':
      _loadCards(true);
      break;
    case 'select-all':
      allCards.forEach(function(c) { selectedUids.add(c.uid); });
      _updateBatchBar();
      _renderCards();
      break;
    case 'deselect-all':
      selectedUids.clear();
      _updateBatchBar();
      _renderCards();
      break;
    case 'batch-terminate':
      _batchAction('terminate');
      break;
    case 'batch-wipe':
      _batchAction('wipe');
      break;
    case 'batch-activate':
      _batchAction('activate');
      break;
    case 'batch-reprovision':
      _batchAction('reprovision');
      break;
    case 'repair':
      _handleRepair(btn);
      break;
  }
});

document.getElementById('select-all-checkbox').addEventListener('change', function() {
  var checked = this.checked;
  allCards.forEach(function(c) {
    if (checked) selectedUids.add(c.uid);
    else selectedUids.delete(c.uid);
  });
  _updateBatchBar();
  _renderCards();
});

function _handleRepair(btn) {
  var origText = btn.textContent;
  btn.textContent = 'Scanning...';
  btn.disabled = true;
  document.getElementById('repair-result').classList.add('hidden');

  fetch('/operator/cards/repair', { method: 'POST' }).then(function(resp) {
    return resp.json().then(function(data) {
      var resultDiv = document.getElementById('repair-result');
      var contentDiv = document.getElementById('repair-result-content');

      if (!resp.ok) {
        var errP = document.createElement('p');
        errP.className = 'text-red-300';
        errP.textContent = 'Repair failed: ' + (data.error || 'unknown error');
        contentDiv.replaceChildren(errP);
      } else {
        var wrapper = document.createElement('div');
        var mainP = document.createElement('p');
        mainP.className = 'text-amber-300';
        mainP.textContent = 'Scanned ';
        var strong1 = document.createElement('strong');
        strong1.textContent = data.scanned;
        mainP.appendChild(strong1);
        mainP.appendChild(document.createTextNode(' card(s), repaired '));
        var strong2 = document.createElement('strong');
        strong2.textContent = data.repaired;
        mainP.appendChild(strong2);
        wrapper.appendChild(mainP);

        if (data.errors && data.errors.length > 0) {
          var errHeader = document.createElement('p');
          errHeader.className = 'text-red-300 text-xs mt-1';
          errHeader.textContent = data.errors.length + ' error(s):';
          wrapper.appendChild(errHeader);
          data.errors.forEach(function(e) {
            var detail = document.createElement('p');
            detail.className = 'text-xs text-gray-500 ml-3';
            detail.textContent = e.uid + ': ' + e.error;
            wrapper.appendChild(detail);
          });
        }
        if (data.repaired === 0 && (!data.errors || data.errors.length === 0)) {
          var noneP = document.createElement('p');
          noneP.className = 'text-gray-400 text-xs mt-1';
          noneP.textContent = 'All index entries match DO state.';
          wrapper.appendChild(noneP);
        }
        contentDiv.replaceChildren(wrapper);
      }
      resultDiv.classList.remove('hidden');
      if (data.repaired > 0) _loadCards(false);
      btn.textContent = origText;
      btn.disabled = false;
    });
   }).catch(function(err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:repair-action');
     _showAuditError('Index repair failed: ' + err.message);
     btn.textContent = origText;
     btn.disabled = false;
   });
 }

_loadCards(false);`;
export const CARD_AUDIT_JS_HASH = "7e3c240e9247";

export const MENU_EDITOR_JS = `// menu-editor.js — classic script (no import/export)

(function() {
  var configEl = document.getElementById('menu-editor-config');
  var items = configEl ? JSON.parse(configEl.getAttribute('data-items') || '[]') : [];
  var terminalId = configEl ? configEl.getAttribute('data-terminal-id') : '';

  function render() {
    var list = document.getElementById('items-list');
    if (items.length === 0) {
      var p = document.createElement('p');
      p.className = 'text-gray-500 text-sm text-center py-4';
      p.textContent = 'No items. Click "Add Item" to start.';
      list.replaceChildren(p);
      return;
    }
    list.replaceChildren.apply(list, items.map(function(item, i) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg p-3';

      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.dataset.idx = i;
      nameInput.dataset.field = 'name';
      nameInput.value = item.name;
      nameInput.placeholder = 'Item name';
      nameInput.className = 'flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm focus:border-emerald-500 focus:outline-none';
      nameInput.addEventListener('input', function() {
        items[i].name = this.value;
      });
      row.appendChild(nameInput);

      var priceInput = document.createElement('input');
      priceInput.type = 'number';
      priceInput.dataset.idx = i;
      priceInput.dataset.field = 'price';
      priceInput.value = String(item.price);
      priceInput.placeholder = 'Price';
      priceInput.min = '0';
      priceInput.className = 'w-24 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm text-right focus:border-emerald-500 focus:outline-none';
      priceInput.addEventListener('input', function() {
        items[i].price = parseInt(this.value) || 0;
      });
      row.appendChild(priceInput);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '\\u00D7';
      removeBtn.className = 'text-red-500 hover:text-red-400 text-lg font-bold px-1';
      removeBtn.addEventListener('click', function() { items.splice(i, 1); render(); });
      row.appendChild(removeBtn);

      return row;
    }));
  }

  document.getElementById('add-item-btn').addEventListener('click', function() {
    items.push({ name: '', price: 0 });
    render();
    var inputs = document.querySelectorAll('[data-field="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  document.getElementById('clear-btn').addEventListener('click', function() {
    if (items.length === 0) return;
    items = [];
    render();
  });

  document.getElementById('save-btn').addEventListener('click', function() {
    var valid = items.filter(function(i) { return i.name.trim(); });
    var status = document.getElementById('status');
    status.classList.remove('hidden');
    status.className = 'mt-4 text-center text-sm text-gray-400';
    status.textContent = 'Saving...';
    fetch('/operator/pos/menu?t=' + terminalId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: valid }),
    }).then(function(resp) {
      return resp.json().then(function(data) {
        if (resp.ok && data.success) {
          status.className = 'mt-4 text-center text-sm text-emerald-400';
          status.textContent = 'Saved ' + valid.length + ' items';
        } else {
          status.className = 'mt-4 text-center text-sm text-red-400';
          status.textContent = data.error || 'Save failed';
        }
      });
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'menu-editor.js:save');
      status.className = 'mt-4 text-center text-sm text-red-400';
      status.textContent = 'Network error: ' + e.message;
    });
  });

  render();
})();`;
export const MENU_EDITOR_JS_HASH = "789d4ae511f1";

export const WIPE_JS = `// wipe.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var wipeRoot = document.getElementById('wipe-root');
  var baseUrl = wipeRoot ? wipeRoot.getAttribute('data-base-url') : '';
  var resetApiUrl = wipeRoot ? wipeRoot.getAttribute('data-reset-api-url') : '';
  var wipeQrCode = null;
  var currentResetLink = '';

  // Workflow 1: NFC Scanner (auto-starts on load)
  var wipeScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onStatus: function(status) {
      var autoHint = document.getElementById('scan-auto-hint');
      var btn = document.getElementById('btn-scan');
      if (status === 'scanning') {
        if (autoHint) autoHint.classList.remove('hidden');
        btn.classList.add('hidden');
      } else {
        if (autoHint) autoHint.classList.add('hidden');
      }
    },
    onError: function(err, phase) {
      var autoHint = document.getElementById('scan-auto-hint');
      if (autoHint) autoHint.classList.add('hidden');
      if (phase !== 'permission') {
        alert("Error reading NFC: " + err.message);
      }
    },
    onTap: function(data) {
      var autoHint = document.getElementById('scan-auto-hint');
      if (autoHint) autoHint.classList.add('hidden');
      var btn = document.getElementById('btn-scan');
      document.getElementById('scan-uid').innerText = data.serial || "Unknown";
      var pParam = "Not found";
      var cParam = "Not found";
      if (data.url) {
        try {
          var url = new URL(data.url);
          pParam = url.searchParams.get("p") || pParam;
          cParam = url.searchParams.get("c") || cParam;
        } catch(e) {}
      }
      document.getElementById('scan-p').innerText = pParam;
      document.getElementById('scan-c').innerText = cParam;
      document.getElementById('scan-results').classList.remove('hidden');
      btn.classList.remove('hidden');
      btn.innerText = "SCAN AGAIN";
    }
  });

  if (browserSupportsNfc()) {
    window.addEventListener('load', function() { wipeScanner.scan(); });
  }

  document.getElementById('btn-scan').addEventListener('click', function() {
    wipeScanner.restart();
  });

  // Handlers for Wipe requests
  document.getElementById('btn-wipe-scanned').addEventListener('click', function() {
    var uid = document.getElementById('scan-uid').innerText;
    if (!uid || uid === "Unknown") {
      alert("Valid UID required.");
      return;
    }
    fetchWipeKeys(uid);
  });

  document.getElementById('btn-wipe-manual').addEventListener('click', function() {
    var uid = document.getElementById('manual-uid').value.trim().toLowerCase();
    if (!uid || uid.length !== 14) {
      alert("Please enter a valid 14-character hex UID.");
      return;
    }
    fetchWipeKeys(uid);
  });

  function fetchWipeKeys(uid) {
    var wipeApiUrl = baseUrl + '/wipe?uid=' + encodeURIComponent(uid);
    fetch(wipeApiUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        displayOutput(uid, data, resetApiUrl);
      })
       .catch(function(error) {
         if (typeof window.reportClientError === 'function') window.reportClientError(error, 'wipe.js:fetch-keys');
         alert("Error fetching wipe keys: " + error.message);
       });
  }

  function displayOutput(uid, data, resetApiUrl) {
    document.getElementById('output-section').classList.remove('hidden');
    document.getElementById('output-uid-badge').innerText = 'UID: ' + uid.toUpperCase();
    document.getElementById('api-response').innerText = JSON.stringify(data, null, 2);

    currentResetLink = 'boltcard://reset?url=' + encodeURIComponent(resetApiUrl);
    document.getElementById('link-wipe-btn').href = currentResetLink;
    document.getElementById('link-wipe-text').innerText = currentResetLink;

    var qrContainer = document.getElementById('qr-wipe');
    qrContainer.replaceChildren();

    wipeQrCode = new QRCode(qrContainer, {
      text: currentResetLink,
      width: 180,
      height: 180,
      colorDark : "#000000",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.L
    });

    document.getElementById('output-section').scrollIntoView({ behavior: 'smooth' });
  }

  // Event delegation for data-action buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'copy-wipe-link') {
      navigator.clipboard.writeText(currentResetLink).then(function() {
        var toast = document.getElementById('toast');
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(function() {
          toast.classList.add('translate-y-20', 'opacity-0');
        }, 2000);
      });
    }
  });
})();`;
export const WIPE_JS_HASH = "c4adfe7191d0";

export const BULK_WIPE_JS = `// bulk-wipe.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

var UID_REGEX = /^[0-9a-f]{14}$/;
function validateUid(uid) {
  var normalized = uid.replace(/:/g, '').toLowerCase();
  if (UID_REGEX.test(normalized)) return normalized;
  return null;
}

(function() {
  var bulkRoot = document.getElementById('bulk-wipe-root');
  var baseUrl = bulkRoot ? bulkRoot.getAttribute('data-base-url') : '';

  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Tap-to-detect
  var detectScanner = null;
  var detectedUid = null;
  var detectedVersion = null;
  var detectedFingerprint = null;

  function initDetectScanner() {
    detectScanner = createNfcScanner({
      continuous: false,
      debounceMs: 0,
      onTap: function(data) {
        var url = data.url;
        if (!url) {
          document.getElementById('detect-error').textContent = 'No URL found on card. The card may not be programmed.';
          document.getElementById('detect-error').classList.remove('hidden');
          document.getElementById('detect-status').classList.add('hidden');
          return;
        }
        try {
          var parsed = new URL(url);
          var p = parsed.searchParams.get('p');
          var c = parsed.searchParams.get('c');
          if (!p || !c) {
            document.getElementById('detect-error').textContent = 'Card URL missing p/c parameters.';
            document.getElementById('detect-error').classList.remove('hidden');
            document.getElementById('detect-status').classList.add('hidden');
            return;
          }
          document.getElementById('detect-status').querySelector('span').textContent = 'Identifying card...';
          fetch('/api/identify-issuer-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ p: p, c: c })
          }).then(function(r) { return r.json(); }).then(function(result) {
            document.getElementById('detect-status').classList.add('hidden');
            if (result.matched) {
              detectedUid = result.uid;
              detectedVersion = result.version;
              detectedFingerprint = result.issuerKeyFingerprint;
              document.getElementById('detect-uid').textContent = result.uid.toUpperCase();
              document.getElementById('detect-version').textContent = result.version;
              document.getElementById('detect-label').textContent = result.issuerKeyLabel;
              document.getElementById('detect-result').classList.remove('hidden');
              document.getElementById('detect-error').classList.add('hidden');
              var keySelect = document.getElementById('key-select');
              var matchedOption = keySelect.querySelector('option[data-fingerprint="' + result.issuerKeyFingerprint + '"]');
              if (matchedOption) {
                keySelect.value = matchedOption.value;
                keySelect.dispatchEvent(new Event('change'));
              } else {
                keySelect.value = 'custom';
                keySelect.dispatchEvent(new Event('change'));
                document.getElementById('custom-key').value = '';
                document.getElementById('custom-key').focus();
              }
            } else {
              document.getElementById('detect-error').textContent = 'Unknown issuer \\u2014 this card was not provisioned with any of our known issuer keys. Switch to Custom key\\u2026 and paste the master secret manually.';
              document.getElementById('detect-error').classList.remove('hidden');
              document.getElementById('detect-result').classList.add('hidden');
              document.getElementById('key-select').value = 'custom';
              document.getElementById('key-select').dispatchEvent(new Event('change'));
              document.getElementById('custom-key').focus();
            }
          }).catch(function(e) {
            if (typeof window.reportClientError === 'function') window.reportClientError(e, 'bulk-wipe.js:identify');
            document.getElementById('detect-error').textContent = 'Error: ' + e.message;
            document.getElementById('detect-error').classList.remove('hidden');
            document.getElementById('detect-status').classList.add('hidden');
          });
        } catch (e) {
          if (typeof window.reportClientError === 'function') window.reportClientError(e, 'bulk-wipe.js:identify');
          document.getElementById('detect-error').textContent = 'Error: ' + e.message;
          document.getElementById('detect-error').classList.remove('hidden');
          document.getElementById('detect-status').classList.add('hidden');
        }
      },
      onError: function(err, phase) {
        if (phase === 'permission') {
          document.getElementById('detect-status').querySelector('span').textContent = 'NFC permission denied. Tap to retry.';
        }
      },
      onStatus: function(status) {
        var el = document.getElementById('detect-status');
        if (status === 'scanning') {
          el.classList.remove('hidden');
          el.querySelector('span').textContent = 'Tap your card to detect issuer key...';
        } else {
          el.classList.add('hidden');
        }
      }
    });
  }

  if (browserSupportsNfc()) {
    initDetectScanner();
    window.addEventListener('load', function() { detectScanner.scan(); });
  } else {
    document.getElementById('detect-status').querySelector('span').textContent = 'Web NFC not supported. Use Chrome on Android.';
    document.getElementById('detect-status').querySelector('div').className = 'w-2 h-2 bg-red-500 rounded-full';
  }

  document.getElementById('detect-wipe-this').addEventListener('click', function() {
    if (!detectedUid) return;
    document.getElementById('uid-input').value = detectedUid.toUpperCase();
    var keySelect = document.getElementById('key-select');
    if (keySelect.value !== 'custom') {
      var matchedOption = keySelect.querySelector('option[data-fingerprint="' + detectedFingerprint + '"]');
      if (matchedOption) keySelect.value = matchedOption.value;
    }
    document.getElementById('btn-generate').click();
  });

  document.getElementById('detect-use-key').addEventListener('click', function() {
    document.getElementById('uid-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Toggle custom key section
  document.getElementById('key-select').addEventListener('change', function(e) {
    var section = document.getElementById('custom-key-section');
    if (e.target.value === 'custom') {
      section.classList.remove('hidden');
    } else {
      section.classList.add('hidden');
    }
  });

  // Show inline error
  function showError(msg) {
    var el = document.getElementById('error-msg');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() {
    document.getElementById('error-msg').classList.add('hidden');
  }

  // Toast
  function showToast() {
    var toast = document.getElementById('toast');
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(function() {
      toast.classList.add('translate-y-20', 'opacity-0');
    }, 2000);
  }

  // Copy helper
  function copyText(text) {
    navigator.clipboard.writeText(text).then(function() { showToast(); }).catch(function() {});
  }

  // Generate button
  document.getElementById('btn-generate').addEventListener('click', function() {
    hideError();
    var results = document.getElementById('results');
    results.replaceChildren();

    var keySelect = document.getElementById('key-select');
    var key = keySelect.value;
    if (key === 'custom') {
      key = document.getElementById('custom-key').value.trim().toLowerCase();
      if (!key || !/^[0-9a-f]{32}$/.test(key)) {
        showError('Please enter a valid 32-character hex issuer key.');
        return;
      }
    }
    if (!key) {
      showError('Please select an issuer key.');
      return;
    }

    var raw = document.getElementById('uid-input').value;
    var uids = raw.split(/[\\n\\r]+/).map(function(u) { return u.trim().toLowerCase(); }).filter(function(u) { return u.length > 0; });
    if (uids.length === 0) {
      showError('Please enter at least one card UID.');
      return;
    }

    var invalidUids = uids.filter(function(u) { return !validateUid(u); });
    if (invalidUids.length > 0) {
      showError('Invalid UID format (must be 14 hex chars): ' + invalidUids.join(', '));
      return;
    }

    var btn = document.getElementById('btn-generate');
    btn.disabled = true;
    btn.textContent = 'PROCESSING ' + uids.length + ' CARD(S)...';

    (function processUids(index) {
      if (index >= uids.length) {
        btn.disabled = false;
        btn.textContent = 'GENERATE WIPE DATA';
        if (results.children.length > 0) {
          results.children[0].scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }
      var uid = uids[index];
      var apiUrl = baseUrl + '/api/bulk-wipe-keys?uid=' + encodeURIComponent(uid) + '&key=' + encodeURIComponent(key);
      fetch(apiUrl).then(function(resp) {
        if (!resp.ok) return resp.text().then(function(errBody) {
          renderCardError(results, uid, 'Server error ' + resp.status + ': ' + errBody);
          processUids(index + 1);
        });
        return resp.json().then(function(data) {
          renderCardResult(results, data);
          processUids(index + 1);
        });
      }).catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'bulk-wipe.js:batch-action');
        renderCardError(results, uid, 'Fetch failed: ' + err.message);
        processUids(index + 1);
      });
    })(0);
  });

  function renderCardResult(container, data) {
    var uid = (data.uid || '').toUpperCase();
    var wipeJson = data.wipe_json || {};
    var wipeJsonStr = JSON.stringify(wipeJson);
    var resetLink = data.reset_deeplink || '';

    var card = document.createElement('div');
    card.className = 'bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl';

    var header = _el('div', 'flex items-center justify-between mb-4 border-b border-gray-700 pb-2');
    var h3 = _el('h3', 'text-lg font-bold text-gray-200');
    h3.appendChild(document.createTextNode('UID: '));
    var uidSpan = _el('span', 'text-amber-500 font-mono');
    uidSpan.textContent = uid;
    h3.appendChild(uidSpan);
    header.appendChild(h3);
    header.appendChild(_el('span', 'px-2 py-1 bg-green-500/10 text-green-500 text-xs font-mono rounded border border-green-500/20', 'OK'));
    card.appendChild(header);

    var grid = _el('div', 'grid grid-cols-1 md:grid-cols-2 gap-6');
    var jsonCol = _el('div');
    jsonCol.appendChild(_el('label', 'block text-xs font-bold text-gray-500 uppercase mb-2', 'Wipe JSON'));
    var pre = _el('pre', 'font-mono text-xs text-green-400 bg-gray-900 p-4 rounded border border-gray-700 overflow-x-auto min-h-[140px] mb-2');
    pre.textContent = JSON.stringify(wipeJson, null, 2);
    jsonCol.appendChild(pre);
    var jsonCopyBtn = _el('button', 'copy-btn text-xs text-amber-500 hover:text-amber-400 font-bold', 'COPY JSON');
    jsonCopyBtn.dataset.copy = encodeURIComponent(wipeJsonStr);
    jsonCol.appendChild(jsonCopyBtn);
    grid.appendChild(jsonCol);

    var qrCol = _el('div', 'flex flex-col items-center');
    qrCol.appendChild(_el('label', 'block text-xs font-bold text-gray-500 uppercase mb-2', 'QR Code'));
    var qrDiv = _el('div', 'qr-container mb-4');
    qrDiv.id = 'qr-' + data.uid;
    qrCol.appendChild(qrDiv);
    grid.appendChild(qrCol);
    card.appendChild(grid);

    var footer = _el('div', 'mt-4 bg-gray-900 rounded p-3 border border-gray-800');
    var footerRow = _el('div', 'flex justify-between items-center mb-2');
    footerRow.appendChild(_el('span', 'text-xs font-bold text-red-500 uppercase', 'Reset Deeplink'));
    var linkCopyBtn = _el('button', 'copy-btn text-xs text-amber-500 hover:text-amber-400 font-bold', 'COPY LINK');
    linkCopyBtn.dataset.copy = encodeURIComponent(resetLink);
    footerRow.appendChild(linkCopyBtn);
    footer.appendChild(footerRow);
    var resetAnchor = document.createElement('a');
    resetAnchor.href = resetLink;
    resetAnchor.className = 'text-blue-400 hover:text-blue-300 text-sm font-mono break-all underline';
    resetAnchor.textContent = resetLink;
    footer.appendChild(resetAnchor);
    card.appendChild(footer);

    container.appendChild(card);

    if (qrDiv && wipeJsonStr) {
      new QRCode(qrDiv, {
        text: wipeJsonStr,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.L
      });
    }
  }

  function renderCardError(container, uid, msg) {
    var card = document.createElement('div');
    card.className = 'bg-gray-800 border border-red-500/30 rounded-lg p-6 shadow-xl';

    var header = _el('div', 'flex items-center justify-between mb-2');
    var h3 = _el('h3', 'text-lg font-bold text-gray-200');
    h3.appendChild(document.createTextNode('UID: '));
    var uidSpan = _el('span', 'text-amber-500 font-mono');
    uidSpan.textContent = uid.toUpperCase();
    h3.appendChild(uidSpan);
    header.appendChild(h3);
    header.appendChild(_el('span', 'px-2 py-1 bg-red-500/10 text-red-500 text-xs font-mono rounded border border-red-500/20', 'ERROR'));
    card.appendChild(header);

    card.appendChild(_el('p', 'text-sm text-red-400 font-mono', msg));

    container.appendChild(card);
  }

  // Event delegation for copy buttons
  document.getElementById('results').addEventListener('click', function(e) {
    var btn = e.target.closest('.copy-btn');
    if (btn) {
      copyText(decodeURIComponent(btn.getAttribute('data-copy')));
    }
  });
})();`;
export const BULK_WIPE_JS_HASH = "d2823720a078";

export const TWO_FACTOR_JS = `// two-factor.js — classic script (no import/export)
// Contains both OTP timer (renderTwoFactorPage) and NFC landing scanner (renderTwoFactorLandingPage)
// Depends on: nfc.js (browserSupportsNfc, extractNdefUrl, normalizeBrowserNfcUrl)

// === Part 1: OTP countdown timer (used by renderTwoFactorPage) ===
(function initOtpTimer() {
  var otpRoot = document.getElementById('otp-root');
  if (!otpRoot) return; // not on OTP page

  var bar = document.getElementById('totp-bar');
  var timer = document.getElementById('totp-timer');
  var seconds = parseInt(otpRoot.getAttribute('data-seconds-remaining'), 10);
  if (isNaN(seconds)) seconds = 30;

  setInterval(function() {
    seconds--;
    if (seconds < 0) seconds = 29;
    if (bar) bar.style.width = ((seconds / 30) * 100) + '%';
    if (timer) timer.textContent = seconds + 's';
  }, 1000);
  setTimeout(function() { window.location.reload(); }, 30000);
})();

// === Part 2: NFC landing scanner (used by renderTwoFactorLandingPage) ===
(function initTwoFactorLanding() {
  var landingRoot = document.getElementById('twofa-landing-root');
  if (!landingRoot) return; // not on landing page

  var BASE_URL = landingRoot.getAttribute('data-base-url') || '';
  var scanStatus = document.getElementById('scan-status');
  var scanDetail = document.getElementById('scan-detail');
  var scanError = document.getElementById('scan-error');
  var scanButton = document.getElementById('scan-button');
  var scanIndicator = document.getElementById('scan-indicator');
  var scanAbortController = null;

  function updateIndicator(active) {
    if (active) {
      scanIndicator.className = 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20';
      scanIndicator.textContent = 'NFC active \\u00b7 click to restart';
    } else {
      scanIndicator.className = 'rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20';
      scanIndicator.textContent = 'NFC inactive \\u00b7 click to start';
    }
  }

  function showError(message) {
    scanError.textContent = message;
    scanError.classList.remove('hidden');
  }

  function clearError() {
    scanError.textContent = '';
    scanError.classList.add('hidden');
  }

  function startScan() {
    clearError();
    if (!browserSupportsNfc()) {
      scanStatus.textContent = 'Web NFC unavailable';
      scanDetail.textContent = 'Use Chrome on Android to demo boltcard-powered 2FA.';
      showError('Web NFC is not supported on this device/browser.');
      return;
    }

    if (scanAbortController) {
      scanAbortController.abort();
    }

    try {
      var ndef = new NDEFReader();
      scanAbortController = new AbortController();
      ndef.scan({ signal: scanAbortController.signal }).then(function() {
        updateIndicator(true);
        scanStatus.textContent = 'Scanning for boltcard payload\\u2026';
        scanDetail.textContent = 'Tap the card now. We will redirect into the live TOTP/HOTP view.';

        ndef.onreadingerror = function() {
          showError('NFC read failed. Try holding the card still against the back of the device.');
        };

        ndef.onreading = function(event) {
          extractNdefUrl(event.message.records, ['lnurlw://', 'https://']).then(function(rawUrl) {
            var url = normalizeBrowserNfcUrl(rawUrl);
            if (!url) {
              showError('No compatible boltcard URL was found on the card.');
              return;
            }

            var parsed = new URL(url);
            var p = parsed.searchParams.get('p');
            var c = parsed.searchParams.get('c');
            if (!p || !c) {
              showError('The scanned card did not include the signed 2FA parameters.');
              return;
            }

            scanStatus.textContent = 'Card read. Opening OTP screen\\u2026';
            window.location.href = BASE_URL + '/2fa?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c);
          });
        };
       }).catch(function(error) {
         updateIndicator(false);
         if (error.name !== 'AbortError') {
           if (typeof window.reportClientError === 'function') window.reportClientError(error, 'two-factor.js:scan');
           showError(error.message || 'Unable to start NFC scan.');
           scanStatus.textContent = 'Unable to start NFC scan';
         }
       });
     } catch (error) {
       if (typeof window.reportClientError === 'function') window.reportClientError(error, 'two-factor.js:scan');
       updateIndicator(false);
       showError(error.message || 'Unable to start NFC scan.');
       scanStatus.textContent = 'Unable to start NFC scan';
     }
  }

  scanButton.addEventListener('click', startScan);
  scanIndicator.addEventListener('click', startScan);
  updateIndicator(false);
  if (browserSupportsNfc()) {
    window.addEventListener('load', startScan);
  }
})();`;
export const TWO_FACTOR_JS_HASH = "b5c22e50eb30";

export const BOLT11_DECODE_JS = `// bolt11-decode.js — classic script (no import/export)

(function() {
  function decode() {
    var input = document.getElementById('invoice-input').value.trim();
    var errEl = document.getElementById('decode-error');
    var resultEl = document.getElementById('decode-result');
    errEl.classList.add('hidden');
    resultEl.classList.add('hidden');

    if (!input) {
      errEl.textContent = 'Please paste a BOLT11 invoice';
      errEl.classList.remove('hidden');
      return;
    }

    fetch('/api/decode?invoice=' + encodeURIComponent(input))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) {
          errEl.textContent = data.error || 'Decode failed';
          errEl.classList.remove('hidden');
          return;
        }
        renderResult(data);
      })
       .catch(function(e) {
         if (typeof window.reportClientError === 'function') window.reportClientError(e, 'bolt11-decode.js:decode');
         errEl.textContent = 'Request failed: ' + e.message;
         errEl.classList.remove('hidden');
       });
   }

  function makeBadge(text, bgClass, textClass) {
    var span = document.createElement('span');
    span.className = 'inline-block px-2 py-0.5 text-xs font-bold rounded ' + bgClass + ' ' + textClass;
    span.textContent = text;
    return span;
  }

  function cardEl(labelEl, valueContent) {
    var div = document.createElement('div');
    div.className = 'bg-gray-800 border border-gray-700 rounded-lg p-3';
    var labelP = document.createElement('p');
    labelP.className = 'text-xs text-gray-500 uppercase tracking-wider mb-1';
    labelP.appendChild(labelEl);
    div.appendChild(labelP);
    var valueP = document.createElement('p');
    valueP.className = 'text-sm font-mono text-gray-200';
    valueP.appendChild(valueContent);
    div.appendChild(valueP);
    return div;
  }

  function textNode(s) {
    return document.createTextNode(String(s));
  }

  function renderResult(d) {
    document.getElementById('decode-result').classList.remove('hidden');

    var sigBadge = d.signatureValid
      ? makeBadge('VALID', 'bg-emerald-900', 'text-emerald-300')
      : makeBadge('INVALID', 'bg-red-900', 'text-red-300');

    var expiryBadge = d.isExpired
      ? makeBadge('EXPIRED', 'bg-red-900', 'text-red-300')
      : makeBadge('ACTIVE', 'bg-emerald-900', 'text-emerald-300');

    var headerCards = [
      cardEl(textNode('Network'), textNode(d.network)),
      cardEl(textNode('Amount'), textNode(d.amountDisplay || 'any')),
      cardEl(textNode('Timestamp'), textNode(d.timestampISO || '')),
      (function() {
        var c = cardEl(textNode('Expiry'), textNode(d.expiry + 's '));
        c.querySelector('p:last-child').appendChild(expiryBadge);
        return c;
      })(),
      cardEl(textNode('Expires At'), textNode(d.expiresAt || '')),
      cardEl(textNode('Signature'), sigBadge),
    ];
    document.getElementById('result-header').replaceChildren.apply(
      document.getElementById('result-header'), headerCards
    );

    var table = document.createElement('table');
    table.className = 'w-full';
    var tags = d.rawTags || [];
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i];
      var tr = document.createElement('tr');
      tr.className = 'border-b border-gray-700/50';

      var td1 = document.createElement('td');
      td1.className = 'px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap';
      td1.textContent = t.name + ' ';
      var codeSpan = document.createElement('span');
      codeSpan.className = 'text-gray-600';
      codeSpan.textContent = '[' + t.code + ']';
      td1.appendChild(codeSpan);
      tr.appendChild(td1);

      var td2 = document.createElement('td');
      td2.className = 'px-4 py-2 text-sm text-gray-300';
      if (Array.isArray(t.value)) {
        t.value.forEach(function(v) {
          var chip = document.createElement('span');
          chip.className = 'inline-block bg-gray-700 rounded px-1.5 py-0.5 text-xs mr-1 mb-1';
          chip.textContent = v;
          td2.appendChild(chip);
        });
      } else {
        var valSpan = document.createElement('span');
        valSpan.className = 'font-mono text-xs break-all';
        valSpan.textContent = String(t.value);
        td2.appendChild(valSpan);
        if (String(t.value).length === 64) {
          var copyBtn = document.createElement('button');
          copyBtn.setAttribute('data-copy-val', String(t.value));
          copyBtn.className = 'copy-val-btn ml-1 text-amber-400 hover:text-amber-300 text-xs';
          copyBtn.textContent = 'copy';
          td2.appendChild(copyBtn);
        }
      }
      if (t.rawHex) {
        var hexNote = document.createElement('span');
        hexNote.className = 'text-gray-500 text-xs';
        hexNote.textContent = ' (' + t.rawHex + ')';
        td2.appendChild(hexNote);
      }
      tr.appendChild(td2);
      table.appendChild(tr);
    }

    if (d.payee) {
      var payeeTr = document.createElement('tr');
      payeeTr.className = 'border-b border-gray-700/50';
      var payeeTd1 = document.createElement('td');
      payeeTd1.className = 'px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap';
      payeeTd1.textContent = 'payee (recovered)';
      payeeTr.appendChild(payeeTd1);
      var payeeTd2 = document.createElement('td');
      payeeTd2.className = 'px-4 py-2 text-sm font-mono text-purple-300 break-all';
      payeeTd2.textContent = d.payee + ' ';
      var payeeCopyBtn = document.createElement('button');
      payeeCopyBtn.setAttribute('data-copy-val', d.payee);
      payeeCopyBtn.className = 'copy-val-btn ml-1 text-amber-400 hover:text-amber-300 text-xs';
      payeeCopyBtn.textContent = 'copy';
      payeeTd2.appendChild(payeeCopyBtn);
      payeeTr.appendChild(payeeTd2);
      table.appendChild(payeeTr);
    }

    document.getElementById('result-tags').replaceChildren(table);
  }

  function clearAll() {
    document.getElementById('invoice-input').value = '';
    document.getElementById('decode-error').classList.add('hidden');
    document.getElementById('decode-result').classList.add('hidden');
  }

  // Event delegation for data-action
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'decode') decode();
    else if (action === 'clear') clearAll();
    else if (action === 'copy-val') {
      var val = btn.getAttribute('data-copy-val');
      if (val) navigator.clipboard.writeText(val).catch(function() {});
    }
  });

  // Ctrl/Cmd+Enter to decode
  document.getElementById('invoice-input').addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') decode();
  });
})();`;
export const BOLT11_DECODE_JS_HASH = "f8b81a160586";

export const POS_JS = `// pos.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var posRoot = document.getElementById('pos-root');
  var CURRENCY_LABEL = posRoot ? posRoot.getAttribute('data-currency-label') || 'credits' : 'credits';

  // Result box helpers (inlined — same as operatorShared resultBoxHelpers)
  var resultBox = document.getElementById('result-box');
  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultMessage = document.getElementById('result-message');

  function showResult(kind, title, message) {
    resultBox.classList.remove('hidden');
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    if (kind === 'success') {
      resultBox.className = 'rounded-xl border p-3 mb-3 border-emerald-500/40 bg-emerald-900/20';
      resultIcon.textContent = '\\u2713';
      resultIcon.className = 'text-xl leading-none text-emerald-400';
      resultTitle.className = 'font-bold text-sm text-emerald-300';
      resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
    } else {
      resultBox.className = 'rounded-xl border p-3 mb-3 border-red-500/40 bg-red-900/20';
      resultIcon.textContent = '\\u2717';
      resultIcon.className = 'text-xl leading-none text-red-400';
      resultTitle.className = 'font-bold text-sm text-red-300';
      resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
    }
  }

  function clearResult() {
    resultBox.className = 'hidden rounded-xl border p-3 mb-3';
  }

  var amountInput = '0';
  var appState = 'idle';
  var posScanner = null;
  var autoChargeTimer = null;
  var chargeAmount = '0';
  var posMode = localStorage.getItem('pos_mode') || 'free';
  var terminalId = localStorage.getItem('terminal_id') || '';
  var menuData = { items: [] };
  var cart = [];

  posScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onError: function(err, phase) {
      if (appState !== 'scanning') return;
      stopScanning();
      setState('idle');
      if (phase === 'scan') showResult('error', 'NFC error', 'Try again');
      else if (phase !== 'permission') showResult('error', 'NFC error', err.message);
    },
    onTap: async function(data) {
      if (appState !== 'scanning') return;
      try {
        var nfcUrl = data.url;
        if (!nfcUrl) throw new Error('No URL on card');
        var parsed = new URL(nfcUrl);
        var p = parsed.searchParams.get('p');
        var c = parsed.searchParams.get('c');
        if (!p || !c) throw new Error('Card URL missing parameters');
        stopScanning();
        setState('processing');
        await directCharge(p, c);
       } catch (error) {
         if (typeof window.reportClientError === 'function') window.reportClientError(error, 'pos.js:nfc-tap');
         stopScanning();
         setState('failed');
         showResult('error', 'Payment failed', error.message);
       }
    }
  });

  if (!terminalId) {
    terminalId = crypto.randomUUID ? crypto.randomUUID() : ('t-' + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('terminal_id', terminalId);
  }
  document.getElementById('terminal-id').textContent = terminalId.slice(0, 8);

  var amountDisplay = document.getElementById('amount-display');
  var keypadButtons = Array.from(document.querySelectorAll('.keypad-btn'));
  var chargeButton = document.getElementById('charge-btn');
  var newSaleButton = document.getElementById('new-sale-btn');
  var modeToggle = document.getElementById('mode-toggle');
  var modeFree = document.getElementById('mode-free');
  var modeMenu = document.getElementById('mode-menu');
  var menuGrid = document.getElementById('menu-grid');
  var menuItems = document.getElementById('menu-items');
  var menuEmpty = document.getElementById('menu-empty');
  var menuEditBtn = document.getElementById('menu-edit-btn');
  var cartTotal = document.getElementById('cart-total');
  var cartCount = document.getElementById('cart-count');
  var cartBar = document.getElementById('cart-bar');
  var cartItemsEl = document.getElementById('cart-items');
  var cartClearBtn = document.getElementById('cart-clear-btn');
  var tapOverlay = document.getElementById('tap-overlay');
  var overlayAmount = document.getElementById('overlay-amount');
  var overlayStatus = document.getElementById('overlay-status');
  var overlayCancel = document.getElementById('overlay-cancel');

  document.getElementById('keypad').addEventListener('click', function(e) { var btn = e.target.closest('[data-key]'); if (btn) handleKeypadInput(btn.dataset.key); });
  chargeButton.addEventListener('click', startChargeFlow);
  newSaleButton.addEventListener('click', resetSale);
  overlayCancel.addEventListener('click', cancelCharge);
  modeToggle.addEventListener('click', toggleMode);
  cartClearBtn.addEventListener('click', clearCart);
  menuEditBtn.addEventListener('click', function() { window.location.href = '/operator/pos/menu'; });
  window.addEventListener('beforeunload', stopScanning);

  applyMode();
  loadMenu();
  updateView();

  function normalizeAmount(value) {
    if (!value || value === '.') return '0';
    var next = String(value).replace(/[^0-9.]/g, '');
    var firstDecimal = next.indexOf('.');
    if (firstDecimal !== -1) { next = next.slice(0, firstDecimal + 1) + next.slice(firstDecimal + 1).replace(/\\./g, ''); }
    var parts = next.split('.');
    var whole = parts[0] || '0';
    var fraction = parts[1] || '';
    whole = whole.replace(/^0+(\\d)/, '$1');
    if (whole === '') whole = '0';
    return parts.length > 1 ? whole + '.' + fraction : whole;
  }

  function amountIsZero(value) { var n = Number(normalizeAmount(value)); return !Number.isFinite(n) || n <= 0; }

  function formatAmount(value) {
    var normalized = normalizeAmount(value);
    var parts = normalized.split('.');
    var whole = parts[0] || '0';
    var fraction = parts[1];
    return (whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + (fraction !== undefined ? '.' + fraction : '')) + ' ' + CURRENCY_LABEL;
  }

  function formatDisplayOnly(value) {
    var normalized = normalizeAmount(value);
    var parts = normalized.split('.');
    var whole = parts[0] || '0';
    return whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + (parts[1] !== undefined ? '.' + parts[1] : '');
  }

  function toggleMode() {
    posMode = posMode === 'free' ? 'menu' : 'free';
    localStorage.setItem('pos_mode', posMode);
    applyMode();
    clearCart();
    amountInput = '0';
    clearResult();
    updateView();
  }

  function applyMode() {
    if (posMode === 'menu') {
      modeToggle.textContent = 'KEYPAD';
      modeFree.classList.add('hidden');
      modeFree.classList.remove('flex');
      modeMenu.classList.remove('hidden');
      modeMenu.classList.add('flex');
    } else {
      modeToggle.textContent = 'MENU';
      modeFree.classList.remove('hidden');
      modeFree.classList.add('flex');
      modeMenu.classList.add('hidden');
      modeMenu.classList.remove('flex');
    }
  }

  function loadMenu() {
    fetch('/api/pos/menu?t=' + terminalId).then(function(r) { return r.json(); }).then(function(data) {
      if (data.items && data.items.length > 0) {
        menuData = data;
        renderMenuItems();
      }
    }).catch(function() {});
  }

  function renderMenuItems() {
    if (!menuData.items || menuData.items.length === 0) {
      menuEmpty.classList.remove('hidden');
      menuItems.classList.add('hidden');
      return;
    }
    menuEmpty.classList.add('hidden');
    menuItems.classList.remove('hidden');
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < menuData.items.length; i++) {
      (function(idx) {
        var item = menuData.items[idx];
        var cartItem = cart.find(function(c) { return c.name === item.name; });
        var qty = cartItem ? cartItem.qty : 0;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'relative bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 rounded-lg p-3 transition-colors text-left';

        if (qty > 0) {
          var badge = document.createElement('span');
          badge.className = 'absolute -top-1 -right-1 bg-emerald-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center';
          badge.textContent = qty;
          btn.appendChild(badge);
        }

        var nameDiv = document.createElement('div');
        nameDiv.className = 'font-semibold text-sm text-gray-200';
        nameDiv.textContent = item.name;
        btn.appendChild(nameDiv);

        var priceDiv = document.createElement('div');
        priceDiv.className = 'text-emerald-400 font-bold text-lg';
        priceDiv.textContent = String(item.price);
        btn.appendChild(priceDiv);

        btn.addEventListener('click', function() { addToCart(menuData.items[idx]); });
        fragment.appendChild(btn);
      })(i);
    }
    menuItems.replaceChildren(fragment);
  }

  function addToCart(item) {
    var existing = cart.find(function(c) { return c.name === item.name; });
    if (existing) { existing.qty++; }
    else { cart.push({ name: item.name, price: item.price, qty: 1 }); }
    renderMenuItems();
    renderCart();
    updateView();
  }

  function clearCart() { cart = []; renderMenuItems(); renderCart(); updateView(); }

  function renderCart() {
    if (cart.length === 0) {
      cartBar.classList.add('hidden');
      cartCount.textContent = '';
      cartItemsEl.replaceChildren();
      return;
    }
    cartBar.classList.remove('hidden');
    var total = 0;
    var totalQty = 0;
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < cart.length; i++) {
      var c = cart[i];
      var subtotal = c.price * c.qty;
      total += subtotal;
      totalQty += c.qty;
      var row = document.createElement('div');
      row.className = 'flex justify-between text-xs text-gray-400';
      var labelSpan = document.createElement('span');
      labelSpan.textContent = c.name + ' x' + c.qty;
      row.appendChild(labelSpan);
      var valSpan = document.createElement('span');
      valSpan.textContent = String(subtotal);
      row.appendChild(valSpan);
      fragment.appendChild(row);
    }
    cartItemsEl.replaceChildren(fragment);
    cartTotal.textContent = total + ' ' + CURRENCY_LABEL;
    cartCount.textContent = totalQty + ' item' + (totalQty !== 1 ? 's' : '');
  }

  function getCartTotal() {
    var total = 0;
    for (var i = 0; i < cart.length; i++) { total += cart[i].price * cart[i].qty; }
    return total;
  }

  function setState(next) { appState = next; updateView(); }

  function updateView() {
    amountDisplay.textContent = formatDisplayOnly(amountInput);
    var totalForCharge = posMode === 'menu' ? getCartTotal() : parseInt(normalizeAmount(amountInput), 10) || 0;
    var overlayActive = appState === 'charging' || appState === 'scanning' || appState === 'processing';
    if (overlayActive) {
      tapOverlay.classList.add('visible');
      overlayAmount.textContent = (posMode === 'menu' ? getCartTotal() : formatDisplayOnly(chargeAmount)) + ' ' + CURRENCY_LABEL;
    } else {
      tapOverlay.classList.remove('visible');
    }
    if (appState === 'charging' || appState === 'scanning') {
      overlayStatus.textContent = 'TAP CARD TO PAY';
      overlayStatus.className = 'text-lg font-bold text-emerald-400';
      overlayCancel.classList.remove('hidden');
    } else if (appState === 'processing') {
      overlayStatus.textContent = 'PROCESSING...';
      overlayStatus.className = 'text-lg font-bold text-amber-400';
      overlayCancel.classList.add('hidden');
    }
    var editingLocked = overlayActive;
    keypadButtons.forEach(function(b) { b.disabled = editingLocked; b.classList.toggle('opacity-40', editingLocked); });
    chargeButton.disabled = editingLocked || (posMode === 'menu' ? getCartTotal() <= 0 : amountIsZero(amountInput));
    newSaleButton.classList.toggle('hidden', !(appState === 'success' || appState === 'failed'));
    if (appState === 'idle' && !editingLocked) {
      var hasAmount = (posMode === 'menu' && getCartTotal() > 0) || (posMode === 'free' && !amountIsZero(amountInput));
      clearTimeout(autoChargeTimer);
      if (hasAmount && browserSupportsNfc()) {
        autoChargeTimer = setTimeout(function() { if (appState === 'idle') startChargeFlow(); }, 1000);
      }
    }
  }

  function handleKeypadInput(key) {
    if (appState !== 'idle') return;
    if (key === 'backspace') { amountInput = amountInput.length > 1 ? amountInput.slice(0, -1) : '0'; }
    else if (key === 'clear') { amountInput = '0'; }
    else if (key === '.') { if (!amountInput.includes('.')) amountInput += '.'; }
    else if (/^[0-9]$/.test(key)) { amountInput = amountInput === '0' ? key : amountInput + key; }
    amountInput = normalizeAmount(amountInput);
    clearResult();
    updateView();
  }

  function resetSale() { stopScanning(); amountInput = '0'; chargeAmount = '0'; clearCart(); clearResult(); setState('idle'); }
  function cancelCharge() { stopScanning(); setState('idle'); showResult('error', 'Cancelled', 'Charge cancelled'); }
  function stopScanning() { posScanner.stop(); clearTimeout(autoChargeTimer); }

  async function directCharge(p, c) {
    var amount = posMode === 'menu' ? getCartTotal() : parseInt(normalizeAmount(chargeAmount), 10);
    var items = posMode === 'menu' ? cart.map(function(c) { return { name: c.name, qty: c.qty, unitPrice: c.price }; }) : null;
    var resp = await fetch('/operator/pos/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: p, c: c, amount: amount, items: items, terminalId: terminalId }),
    });
    var data = await resp.json();
    if (resp.ok && data.success) {
      setState('success');
      showResult('success', 'Payment approved', (posMode === 'menu' ? getCartTotal() : formatDisplayOnly(chargeAmount)) + ' charged. Balance: ' + data.balance);
      if (posMode === 'menu') clearCart();
    } else {
      setState('failed');
      showResult('error', 'Payment failed', data.error || data.reason || 'Unknown error');
    }
  }

  async function startChargeFlow() {
    if (posMode === 'menu' && getCartTotal() <= 0) return;
    if (posMode === 'free' && amountIsZero(amountInput)) return;

    chargeAmount = posMode === 'menu' ? String(getCartTotal()) : normalizeAmount(amountInput);
    clearResult();
    stopScanning();
    setState('charging');

    try {
      await posScanner.scan();
      setState('scanning');
       } catch (error) {
         if (error.name !== 'AbortError') {
           if (typeof window.reportClientError === 'function') window.reportClientError(error, 'pos.js:nfc-scan');
           stopScanning();
           setState('idle');
           showResult('error', 'NFC error', error.message);
         }
       }
  }
})();`;
export const POS_JS_HASH = "a3fcdd460afe";

export const TOPUP_JS = `// topup.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  // Result box helpers (inlined)
  var resultBox = document.getElementById('result-box');
  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultMessage = document.getElementById('result-message');

  function showResult(kind, title, message) {
    resultBox.classList.remove('hidden');
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    if (kind === 'success') {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-emerald-500/40 bg-emerald-900/20';
      resultIcon.textContent = '\\u2713';
      resultIcon.className = 'text-2xl leading-none text-emerald-400';
      resultTitle.className = 'font-bold text-sm text-emerald-300';
      resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
    } else {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-red-500/40 bg-red-900/20';
      resultIcon.textContent = '\\u2717';
      resultIcon.className = 'text-2xl leading-none text-red-400';
      resultTitle.className = 'font-bold text-sm text-red-300';
      resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
    }
  }

  function clearResult() {
    resultBox.className = 'hidden w-full max-w-xs rounded-xl border p-4 mb-4';
  }

  // Operator logout
  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  // Amount helpers (integer-only)
  function normalizeAmount(val) {
    if (!val || val === '.') return '0';
    var s = String(val).replace(/[^0-9]/g, '');
    if (s === '') s = '0';
    s = s.replace(/^0+(\\d)/, '$1');
    return s;
  }

  function formatDisplay(val) {
    var n = normalizeAmount(val);
    return n.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  }

  var amountInput = '0';
  var appState = 'idle';
  var nfcScanner = null;

  var amountDisplay = document.getElementById('amount-display');
  var keypad = document.getElementById('keypad');
  var nfcTapBtn = document.getElementById('nfc-tap-btn');
  var wedgeArea = document.getElementById('wedge-area');
  var wedgeInput = document.getElementById('wedge-input');
  var nfcBtnArea = document.getElementById('nfc-btn-area');
  var toggleWedge = document.getElementById('toggle-wedge');
  var logoutBtn = document.getElementById('logout-btn');

  nfcScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onStatus: function(status) {
      if (status === 'scanning') { appState = 'scanning'; updateView(); }
    },
    onError: function(err, phase) {
      appState = 'idle';
      updateView();
      if (phase === 'scan') showResult('error', 'NFC error', 'Could not read card. Try again.');
      else if (phase !== 'permission') showResult('error', 'NFC error', err.message);
    },
    onTap: async function(data) {
      if (!data.url) { appState = 'idle'; updateView(); showResult('error', 'No card data', 'Could not read card URL'); return; }
      try {
        var parsed = new URL(data.url);
        var p = parsed.searchParams.get('p');
        var c = parsed.searchParams.get('c');
        if (p && c) { await submitTopup(p, c); }
        else { appState = 'idle'; updateView(); showResult('error', 'Invalid card data', 'Card URL missing p or c parameters'); }
       } catch(e) {
        if (typeof window.reportClientError === 'function') window.reportClientError(e, 'topup.js:card-read');
        appState = 'idle';
        updateView();
        showResult('error', 'Card read error', e.message);
      }
    }
  });

  keypad.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-key]');
    if (!btn) return;
    handleKeypad(btn.dataset.key);
  });

  nfcTapBtn.addEventListener('click', function() {
    if (appState !== 'idle') return;
    clearResult();
    nfcScanner.scan();
  });
  toggleWedge.addEventListener('click', toggleWedgeMode);
  logoutBtn.addEventListener('click', operatorLogout);
  wedgeInput.addEventListener('keydown', handleWedgeInput);

  if (!browserSupportsNfc()) {
    toggleWedgeMode();
    toggleWedge.classList.add('hidden');
  } else {
    window.addEventListener('load', function() { clearResult(); nfcScanner.scan(); });
  }

  function handleKeypad(key) {
    if (appState !== 'idle') return;
    if (key === 'backspace') {
      amountInput = amountInput.length > 1 ? amountInput.slice(0, -1) : '0';
    } else if (key === 'clear') {
      amountInput = '0';
    } else if (/^[0-9]$/.test(key)) {
      amountInput = amountInput === '0' ? key : amountInput + key;
    }
    amountInput = normalizeAmount(amountInput);
    updateView();
  }

  function toggleWedgeMode() {
    var isHidden = wedgeArea.classList.contains('hidden');
    wedgeArea.classList.toggle('hidden');
    nfcBtnArea.classList.toggle('hidden');
    if (isHidden) {
      wedgeInput.focus();
      toggleWedge.textContent = 'NFC TAP';
    } else {
      nfcScanner.stop();
      toggleWedge.textContent = 'USB READER';
    }
  }

  function handleWedgeInput(e) {
    if (e.key !== 'Enter') return;
    var val = wedgeInput.value.trim();
    if (!val) return;
    wedgeInput.value = '';

    try {
      var url = new URL(val);
      var p = url.searchParams.get('p');
      var c = url.searchParams.get('c');
      if (p && c) {
        submitTopup(p, c);
        return;
      }
    } catch(_) {}

    showResult('error', 'Invalid card read', 'USB reader must output a URL with p and c parameters');
  }

  function updateView() {
    amountDisplay.textContent = formatDisplay(amountInput);
    nfcTapBtn.disabled = appState !== 'idle' || amountInput === '0';
    if (appState === 'idle') {
      nfcTapBtn.textContent = amountInput === '0' ? 'TAP CARD TO TOP UP' : 'SCANNING FOR CARD...';
    } else if (appState === 'scanning') {
      nfcTapBtn.textContent = 'SCANNING FOR CARD...';
    } else {
      nfcTapBtn.textContent = 'TAP CARD TO TOP UP';
    }
  }

  async function submitTopup(p, c) {
    if (appState !== 'idle') return;
    var amount = parseInt(normalizeAmount(amountInput), 10);
    if (!amount || amount <= 0) {
      showResult('error', 'Invalid amount', 'Enter an amount first');
      return;
    }
    appState = 'processing';
    updateView();
    try {
      var resp = await fetch('/operator/topup/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: p, c: c, amount: amount }),
      });
      var data = await resp.json();
      if (resp.ok && data.success) {
        showResult('success', 'Top-up successful', 'New balance: ' + (data.balance !== undefined ? data.balance : 'unknown'));
        amountInput = '0';
        updateView();
      } else {
        showResult('error', 'Top-up failed', data.error || data.reason || 'Unknown error');
      }
     } catch(e) {
       if (typeof window.reportClientError === 'function') window.reportClientError(e, 'topup.js:network');
       showResult('error', 'Network error', e.message || 'Could not reach server');
     }
    appState = 'idle';
    updateView();
  }

  updateView();
})();`;
export const TOPUP_JS_HASH = "86faac35c73a";

export const REFUND_JS = `// refund.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  // Result box helpers (inlined)
  var resultBox = document.getElementById('result-box');
  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultMessage = document.getElementById('result-message');

  function showResult(kind, title, message) {
    resultBox.classList.remove('hidden');
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    if (kind === 'success') {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-emerald-500/40 bg-emerald-900/20';
      resultIcon.textContent = '\\u2713';
      resultIcon.className = 'text-2xl leading-none text-emerald-400';
      resultTitle.className = 'font-bold text-sm text-emerald-300';
      resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
    } else {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-red-500/40 bg-red-900/20';
      resultIcon.textContent = '\\u2717';
      resultIcon.className = 'text-2xl leading-none text-red-400';
      resultTitle.className = 'font-bold text-sm text-red-300';
      resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
    }
  }

  function clearResult() {
    resultBox.className = 'hidden w-full max-w-xs rounded-xl border p-4 mb-4';
  }

  // Operator logout
  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  var appState = 'idle';
  var nfcScanner = null;
  var lastP = null;
  var lastC = null;

  var cardInfo = document.getElementById('card-info');
  var cardBalance = document.getElementById('card-balance');
  var refundOptions = document.getElementById('refund-options');
  var fullRefundBtn = document.getElementById('full-refund-btn');
  var partialRefundBtn = document.getElementById('partial-refund-btn');
  var partialAmount = document.getElementById('partial-amount');
  var nfcTapBtn = document.getElementById('nfc-tap-btn');
  var logoutBtn = document.getElementById('logout-btn');

  nfcScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onStatus: function(status) {
      if (status === 'scanning') appState = 'scanning';
    },
    onError: function(err, phase) {
      appState = 'idle';
      if (phase === 'scan') showResult('error', 'NFC error', 'Try again');
      else if (phase !== 'permission') showResult('error', 'NFC error', err.message);
    },
    onTap: async function(data) {
      if (!data.url) { appState = 'idle'; showResult('error', 'No card data', 'Could not read card'); return; }
      try {
        var parsed = new URL(data.url);
        var p = parsed.searchParams.get('p');
        var c = parsed.searchParams.get('c');
        if (p && c) { lastP = p; lastC = c; await fetchBalance(p, c); }
        else { appState = 'idle'; showResult('error', 'Invalid card', 'Missing p/c parameters'); }
       } catch(e) {
        if (typeof window.reportClientError === 'function') window.reportClientError(e, 'refund.js:card-read');
        appState = 'idle';
        showResult('error', 'Error', e.message);
      }
    }
  });

  fullRefundBtn.addEventListener('click', function() { submitRefund(true, 0); });
  partialRefundBtn.addEventListener('click', function() {
    var amt = parseInt(partialAmount.value, 10);
    if (!amt || amt <= 0) { showResult('error', 'Invalid amount', 'Enter a positive amount'); return; }
    submitRefund(false, amt);
  });
  nfcTapBtn.addEventListener('click', function() { clearResult(); nfcScanner.scan(); });
  logoutBtn.addEventListener('click', operatorLogout);

  if (!browserSupportsNfc()) {
    nfcTapBtn.textContent = 'NFC NOT AVAILABLE — use Chrome on Android or USB reader';
    nfcTapBtn.disabled = true;
    nfcTapBtn.classList.add('opacity-50');
  } else {
    window.addEventListener('load', function() { nfcScanner.scan(); });
  }

  async function submitRefund(fullRefund, amount) {
    if (!lastP || !lastC) { showResult('error', 'No card', 'Tap a card first'); return; }
    appState = 'processing';
    try {
      var body = { p: lastP, c: lastC, fullRefund: fullRefund };
      if (!fullRefund) body.amount = amount;
      var resp = await fetch('/operator/refund/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await resp.json();
      if (resp.ok && data.success) {
        cardBalance.textContent = data.balance || 0;
        partialAmount.value = '';
        showResult('success', 'Refund issued', 'Refunded ' + data.amount + '. Remaining: ' + data.balance);
      } else {
        showResult('error', 'Refund failed', data.error || data.reason || 'Unknown error');
      }
     } catch(e) {
       if (typeof window.reportClientError === 'function') window.reportClientError(e, 'refund.js:network');
       showResult('error', 'Network error', e.message);
     }
    appState = 'idle';
  }

  async function fetchBalance(p, c) {
    try {
      var resp = await fetch('/api/balance-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: p, c: c }),
      });
      var data = await resp.json();
      if (resp.ok) {
        cardBalance.textContent = data.balance || 0;
        cardInfo.classList.remove('hidden');
        refundOptions.classList.remove('hidden');
        appState = 'idle';
      } else {
        appState = 'idle';
        showResult('error', 'Read failed', data.error || data.reason || 'Could not read card');
      }
     } catch(e) {
       if (typeof window.reportClientError === 'function') window.reportClientError(e, 'refund.js:network');
       appState = 'idle';
       showResult('error', 'Network error', e.message);
     }
  }
})();`;
export const REFUND_JS_HASH = "d5223fbda65d";

export const IDENTITY_JS = `// identity.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var ui = {
    idle: document.getElementById('state-idle'),
    scanning: document.getElementById('state-scanning'),
    verified: document.getElementById('state-verified'),
    denied: document.getElementById('state-denied'),
    panel: document.getElementById('card-panel'),
    btnScan: document.getElementById('btn-scan'),
    btnRetry: document.getElementById('btn-retry'),
    btnReset: document.getElementById('btn-reset'),
    noNfcMsg: document.getElementById('no-nfc-msg'),
    nfcStatus: document.getElementById('nfc-status')
  };

  var profile = {
    avatar: document.getElementById('profile-avatar'),
    name: document.getElementById('profile-name'),
    role: document.getElementById('profile-role'),
    dept: document.getElementById('profile-dept'),
    clearance: document.getElementById('profile-clearance'),
    uid: document.getElementById('profile-uid'),
    time: document.getElementById('profile-time'),
    reason: document.getElementById('error-reason'),
    openTwoFactor: document.getElementById('identity-open-2fa'),
    emojiSaveButton: document.getElementById('emoji-save-button'),
    emojiSaveStatus: document.getElementById('emoji-save-status'),
    emojiButtons: Array.from(document.querySelectorAll('.identity-emoji-btn')),
  };

  function iconSpan(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  var appState = 'idle';
  var currentVerification = null;
  var selectedEmoji = null;
  var nfcScanner = null;

  function setEmojiSelection(emoji) {
    selectedEmoji = emoji;
    profile.emojiButtons.forEach(function(button) {
      var active = button.dataset.emoji === emoji;
      button.classList.toggle('border-pink-400', active);
      button.classList.toggle('bg-pink-500/10', active);
      button.classList.toggle('scale-105', active);
    });
    profile.emojiSaveButton.disabled = !emoji;
  }

  function setSaveStatus(message, tone) {
    tone = tone || 'muted';
    var toneClass = tone === 'success'
      ? 'text-emerald-300'
      : tone === 'error'
        ? 'text-red-300'
        : 'text-gray-500';
    profile.emojiSaveStatus.className = 'text-xs ' + toneClass;
    profile.emojiSaveStatus.textContent = message;
  }

  function hydrateVerifiedProfile(result, verificationParams) {
    var profileData = result.profile || {};
    profile.avatar.textContent = profileData.emoji || '\\uD83D\\uDC64';
    profile.name.textContent = profileData.name || 'Operator';
    profile.role.textContent = profileData.role || 'Role';
    profile.dept.textContent = profileData.dept || 'Engineering';
    profile.clearance.textContent = profileData.level || 'Level 1';
    profile.uid.textContent = result.maskedUid;
    profile.time.textContent = new Date().toLocaleTimeString([], { hour12: false });
    currentVerification = verificationParams;
    profile.openTwoFactor.href = '/2fa?p=' + encodeURIComponent(verificationParams.p) + '&c=' + encodeURIComponent(verificationParams.c);
    setEmojiSelection(profileData.emoji || null);
    setSaveStatus('Pick an emoji to save it to this card profile.');
  }

  async function saveEmojiSelection() {
    if (!currentVerification || !selectedEmoji) {
      return;
    }

    profile.emojiSaveButton.disabled = true;
    setSaveStatus('Saving avatar choice...', 'muted');

    try {
      var response = await fetch('/api/identity/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p: currentVerification.p,
          c: currentVerification.c,
          emoji: selectedEmoji,
        }),
      });
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.reason || data.error || 'Unable to save avatar');
      }
      hydrateVerifiedProfile(Object.assign({}, data, { maskedUid: data.maskedUid || profile.uid.textContent }), currentVerification);
      setSaveStatus('Saved. This emoji will show the next time this card is verified.', 'success');
     } catch (error) {
       if (typeof window.reportClientError === 'function') window.reportClientError(error, 'identity.js:save-profile');
       setSaveStatus(error.message || 'Unable to save avatar.', 'error');
     } finally {
      profile.emojiSaveButton.disabled = !selectedEmoji;
    }
  }

  function setState(newState) {
    appState = newState;

    ['idle', 'scanning', 'verified', 'denied'].forEach(function(s) {
      ui[s].classList.add('hidden');
      ui[s].classList.remove('opacity-100');
      ui[s].classList.add('opacity-0');
    });

    ui.panel.className = 'w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-8 shadow-2xl transition-all duration-500 relative overflow-hidden flex flex-col items-center text-center';
    ui.nfcStatus.className = 'w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-300';
    ui.nfcStatus.replaceChildren(iconSpan('text-gray-500', '\\u26A1'));

    var target = ui[newState];
    target.classList.remove('hidden');

    void target.offsetWidth; // Reflow

    target.classList.remove('opacity-0');
    target.classList.add('opacity-100');

    if (newState === 'verified') {
      ui.panel.classList.replace('border-gray-800', 'border-emerald-500/50');
      ui.panel.classList.add('shadow-[0_0_30px_rgba(16,185,129,0.15)]');
      ui.nfcStatus.classList.add('bg-emerald-500/20', 'border-emerald-500/50');
      ui.nfcStatus.replaceChildren(iconSpan('text-emerald-400', '\\u2713'));
    } else if (newState === 'denied') {
      ui.panel.classList.replace('border-gray-800', 'border-red-500/50');
      ui.panel.classList.add('shadow-[0_0_30px_rgba(239,68,68,0.15)]');
      ui.nfcStatus.classList.add('bg-red-500/20', 'border-red-500/50');
      ui.nfcStatus.replaceChildren(iconSpan('text-red-400', '\\u2717'));
    } else if (newState === 'scanning') {
      ui.panel.classList.replace('border-gray-800', 'border-blue-500/50');
      ui.nfcStatus.classList.add('bg-blue-500/20', 'border-blue-500/50', 'animate-pulse');
      ui.nfcStatus.replaceChildren(iconSpan('text-blue-400', '\\uD83D\\uDCF3'));
    } else {
      ui.nfcStatus.classList.add('bg-gray-900', 'border-gray-800');
    }
  }

  async function processNdefUrl(url) {
    setState('scanning');
    try {
      var parsed = new URL(url);
      var p = parsed.searchParams.get('p');
      var c = parsed.searchParams.get('c');

      if (!p || !c) {
        throw new Error('Invalid card payload');
      }

      var response = await fetch('/api/verify-identity?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
      var data = await response.json();

      if (data.verified) {
        hydrateVerifiedProfile(data, { p: p, c: c });
        setState('verified');
      } else {
        profile.reason.textContent = data.reason || 'Verification failed';
        setState('denied');
      }
     } catch (err) {
       if (typeof window.reportClientError === 'function') window.reportClientError(err, 'identity.js:verify');
       profile.reason.textContent = err.message || 'Network error';
       setState('denied');
     }
  }

  function initNfc() {
    var params = new URLSearchParams(window.location.search);
    var hasUrlCardParams = params.get('p') && params.get('c');

    nfcScanner = createNfcScanner({
      continuous: false,
      debounceMs: 0,
      onStatus: function(status) {
        if (status === 'scanning') setState('scanning');
      },
      onError: function(err, phase) {
        if (phase === 'permission') {
          ui.noNfcMsg.classList.remove('hidden');
          ui.btnScan.classList.remove('hidden');
        } else {
          profile.reason.textContent = err.message || 'Scan failed';
          setState('denied');
        }
      },
      onTap: async function(data) {
        if (data.url) {
          processNdefUrl(data.url);
        } else {
          profile.reason.textContent = 'No NDEF URL found on card';
          setState('denied');
        }
      }
    });
    if (hasUrlCardParams) {
      processNdefUrl(window.location.href);
      return;
    }
    if (browserSupportsNfc()) {
      window.addEventListener('load', function() { nfcScanner.scan(); });
    } else {
      ui.noNfcMsg.classList.remove('hidden');
    }
  }

  ui.btnScan.addEventListener('click', function() {
    setState('idle');
    if (nfcScanner) nfcScanner.restart();
  });

  ui.btnRetry.addEventListener('click', function() {
    setState('idle');
    if (nfcScanner) nfcScanner.restart();
  });

  ui.btnReset.addEventListener('click', function() {
    setState('idle');
    if (nfcScanner) nfcScanner.restart();
  });

  initNfc();

  profile.emojiButtons.forEach(function(button) {
    button.addEventListener('click', function() { setEmojiSelection(button.dataset.emoji); });
  });

  profile.emojiSaveButton.addEventListener('click', saveEmojiSelection);
  profile.emojiSaveButton.disabled = true;
})();`;
export const IDENTITY_JS_HASH = "5117270eeb63";
