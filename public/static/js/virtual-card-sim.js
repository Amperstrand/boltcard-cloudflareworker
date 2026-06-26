(function() {
  var VC_KEY = 'virtual_boltcard';
  var AES_JS_URL = 'https://cdn.jsdelivr.net/npm/aes-js@3.1.2/index.js';

  function loadVC() {
    try {
      var raw = localStorage.getItem(VC_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && data.uid && data.k1 && data.k2 && typeof data.counter === 'number') return data;
    } catch (e) {}
    return null;
  }

  function saveVC(card) {
    try { localStorage.setItem(VC_KEY, JSON.stringify(card)); } catch (e) {}
  }

  function clearVC() {
    try { localStorage.removeItem(VC_KEY); } catch (e) {}
  }

  var virtualCard = loadVC();
  if (!virtualCard) {
    window._virtualSim = { isActive: function() { return false; } };
    window._vcTap = function() { return null; };
    window._vcGetKeys = function() { return null; };
    if (!('NDEFReader' in window)) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addCreateCardFab);
      } else {
        addCreateCardFab();
      }
    }
    return;
  }

  var mockReaders = [];

  function MockNDEFReader() {
    this.onreading = null;
    this.onreadingerror = null;
    this._signal = null;
    this._active = false;
  }

  MockNDEFReader.prototype.scan = function(options) {
    var self = this;
    var signal = options && options.signal ? options.signal : null;
    self._signal = signal;
    return new Promise(function(resolve, reject) {
      if (signal && signal.aborted) {
        var err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      self._active = true;
      mockReaders.push(self);
      if (signal) {
        signal.addEventListener('abort', function() {
          self._active = false;
          var idx = mockReaders.indexOf(self);
          if (idx !== -1) mockReaders.splice(idx, 1);
        });
      }
      resolve();
    });
  };

  window.NDEFReader = MockNDEFReader;

  if (navigator.permissions && navigator.permissions.query) {
    var originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(desc) {
      if (desc && desc.name === 'nfc') {
        return Promise.resolve({ state: 'granted', onchange: null });
      }
      return originalQuery(desc);
    };
  }

  var URI_PREFIX_TABLE = [
    '', 'http://www.', 'https://www.', 'http://', 'https://',
    'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.',
    'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://',
    'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:',
    'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://',
    'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:',
    'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:'
  ];

  function encodeNdefUrlRecord(url) {
    var prefixCode = -1;
    for (var i = 0; i < URI_PREFIX_TABLE.length; i++) {
      if (url.indexOf(URI_PREFIX_TABLE[i]) === 0) {
        prefixCode = i;
        break;
      }
    }
    var encoder = new TextEncoder();
    var payload;
    if (prefixCode >= 0) {
      var remainder = url.substring(URI_PREFIX_TABLE[prefixCode].length);
      var body = encoder.encode(remainder);
      payload = new Uint8Array(1 + body.length);
      payload[0] = prefixCode;
      payload.set(body, 1);
    } else {
      payload = encoder.encode(url);
    }
    return payload.buffer;
  }

  function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    var hex = [];
    for (var i = 0; i < bytes.length; i++) {
      hex.push((bytes[i] & 0xff).toString(16).padStart(2, '0'));
    }
    return hex.join('');
  }

  function aesEcbEncrypt(key, plaintext) {
    var aes = new aesjs.ModeOfOperation.ecb(key);
    return new Uint8Array(aes.encrypt(plaintext));
  }

  function xorArrays(a, b) {
    var result = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) result[i] = a[i] ^ b[i];
    return result;
  }

  function shiftLeft(src) {
    var shifted = new Uint8Array(src.length);
    var carry = 0;
    for (var i = src.length - 1; i >= 0; i--) {
      var msb = src[i] >> 7;
      shifted[i] = ((src[i] << 1) & 0xff) | carry;
      carry = msb;
    }
    return { shifted: shifted, carry: carry };
  }

  function generateSubkey(input) {
    var result = shiftLeft(input);
    var subkey = new Uint8Array(result.shifted);
    if (result.carry) subkey[subkey.length - 1] ^= 0x87;
    return subkey;
  }

  function computeAesCmac(message, key) {
    var zeroBlock = new Uint8Array(16);
    var L = aesEcbEncrypt(key, zeroBlock);
    var K1 = generateSubkey(L);
    var M_last;
    if (message.length === 16) {
      M_last = xorArrays(message, K1);
    } else {
      var padded = new Uint8Array(16);
      padded.set(message);
      padded[message.length] = 0x80;
      var K2 = generateSubkey(K1);
      M_last = xorArrays(padded, K2);
    }
    return aesEcbEncrypt(key, M_last);
  }

  function computeCm(ks) {
    var zeroBlock = new Uint8Array(16);
    var Lprime = aesEcbEncrypt(ks, zeroBlock);
    var K1prime = generateSubkey(Lprime);
    var hk1 = generateSubkey(K1prime);
    var hashVal = new Uint8Array(hk1);
    hashVal[0] ^= 0x80;
    return aesEcbEncrypt(ks, hashVal);
  }

  function buildVerificationData(uidBytes, ctr, k2Bytes) {
    var sv2 = new Uint8Array(16);
    sv2[0] = 0x3c; sv2[1] = 0xc3; sv2[2] = 0x00; sv2[3] = 0x01;
    sv2[4] = 0x00; sv2[5] = 0x80;
    sv2.set(uidBytes, 6);
    sv2[13] = ctr[2]; sv2[14] = ctr[1]; sv2[15] = ctr[0];
    var ks = computeAesCmac(sv2, k2Bytes);
    var cm = computeCm(ks);
    return new Uint8Array([cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]);
  }

  function virtualTap(uidHex, counter, k1Hex, k2Hex) {
    var k1 = hexToBytes(k1Hex);
    var uid = hexToBytes(uidHex);
    var plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(uid, 1);
    plaintext[8] = counter & 0xff;
    plaintext[9] = (counter >> 8) & 0xff;
    plaintext[10] = (counter >> 16) & 0xff;
    var encrypted = aesEcbEncrypt(k1, plaintext);
    var pHex = bytesToHex(encrypted);
    var ctrBytes = new Uint8Array([
      (counter >> 16) & 0xff,
      (counter >> 8) & 0xff,
      counter & 0xff
    ]);
    var ct = buildVerificationData(uid, ctrBytes, hexToBytes(k2Hex));
    var cHex = bytesToHex(ct);
    return { p: pHex, c: cHex };
  }

  var aesJsPromise = null;
  function ensureAesJs() {
    if (window.aesjs) return Promise.resolve();
    if (aesJsPromise) return aesJsPromise;
    aesJsPromise = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = AES_JS_URL;
      script.onload = function() { resolve(); };
      script.onerror = function() {
        aesJsPromise = null;
        reject(new Error('Failed to load aes-js library'));
      };
      document.head.appendChild(script);
    });
    return aesJsPromise;
  }

  function formatSerial(uidHex) {
    return uidHex.match(/.{2}/g).join(':');
  }

  function computeTapParams() {
    return ensureAesJs().then(function() {
      var result = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
      virtualCard.counter++;
      saveVC(virtualCard);
      updateFabLabel();
      return { p: result.p, c: result.c };
    });
  }

  function performVirtualTap() {
    return computeTapParams().then(function(params) {
      var baseUrl = window.location.origin;
      var tapUrl = baseUrl + '/?p=' + encodeURIComponent(params.p) + '&c=' + encodeURIComponent(params.c);
      var recordData = encodeNdefUrlRecord(tapUrl);
      var event = {
        serialNumber: formatSerial(virtualCard.uid),
        message: { records: [{ recordType: 'url', mediaType: '', id: '', data: recordData }] }
      };

      var readers = mockReaders.slice();
      var fired = 0;
      for (var i = 0; i < readers.length; i++) {
        var reader = readers[i];
        if (reader._active && typeof reader.onreading === 'function') {
          try { reader.onreading(event); fired++; } catch (e) {}
        }
      }

      if (fired === 0) {
        navigateToTapUrl(tapUrl);
      }
      return { fired: fired, url: tapUrl };
    });
  }

  function navigateToTapUrl(url) {
    try {
      var u = new URL(url, location.origin);
      if (u.origin === location.origin && u.searchParams.has('p') && u.searchParams.has('c')) {
        location.href = u.href;
      }
    } catch (e) {}
  }

  var fab = null;
  function updateFabLabel() {
    if (!fab) return;
    var label = fab.querySelector('.vc-fab-label');
    if (label) {
      label.textContent = 'Virtual Tap #' + virtualCard.counter + ' (' + virtualCard.uid.substring(0, 7).toUpperCase() + '\u2026)';
    }
  }

  function addCreateCardFab() {
    if (document.getElementById('virtual-create-fab')) return;
    if (window.location.pathname === '/virtual') return;
    var fab = document.createElement('div');
    fab.id = 'virtual-create-fab';
    fab.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:99998;';
    var link = document.createElement('a');
    link.href = '/virtual';
    link.style.cssText = 'display:flex;align-items:center;gap:0.5rem;background:#6366f1;color:white;text-decoration:none;padding:0.75rem 1.5rem;border-radius:9999px;font-size:0.875rem;font-weight:600;box-shadow:0 4px 6px -1px rgba(0,0,0,0.3),0 2px 4px -2px rgba(99,102,241,0.4);transition:transform 0.15s,background 0.15s;';
    link.addEventListener('mouseenter', function() { link.style.background = '#4f46e5'; link.style.transform = 'scale(1.05)'; });
    link.addEventListener('mouseleave', function() { link.style.background = '#6366f1'; link.style.transform = 'scale(1)'; });
    var icon = document.createElement('span');
    icon.textContent = '\u{1f4cb}';
    icon.style.fontSize = '1.125rem';
    link.appendChild(icon);
    var label = document.createElement('span');
    label.textContent = 'Create Virtual Card';
    link.appendChild(label);
    fab.appendChild(link);
    document.body.appendChild(fab);
  }

  function addFloatingButton() {
    if (document.getElementById('virtual-tap-fab')) return;
    fab = document.createElement('div');
    fab.id = 'virtual-tap-fab';
    fab.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:99998;';
    var inner = document.createElement('button');
    inner.className = 'vc-fab-label';
    inner.style.cssText = 'display:flex;align-items:center;gap:0.5rem;background:#6366f1;color:white;border:none;padding:0.75rem 1.5rem;border-radius:9999px;font-size:0.875rem;font-weight:600;box-shadow:0 4px 6px -1px rgba(0,0,0,0.3),0 2px 4px -2px rgba(99,102,241,0.4);cursor:pointer;transition:transform 0.15s,background 0.15s;';
    inner.addEventListener('mouseenter', function() { inner.style.background = '#4f46e5'; inner.style.transform = 'scale(1.05)'; });
    inner.addEventListener('mouseleave', function() { inner.style.background = '#6366f1'; inner.style.transform = 'scale(1)'; });

    var icon = document.createElement('span');
    icon.textContent = '\u{1f4cb}';
    icon.style.fontSize = '1.125rem';
    inner.appendChild(icon);

    var labelText = document.createElement('span');
    labelText.className = 'vc-fab-label';
    inner.appendChild(labelText);

    inner.addEventListener('click', function() {
      inner.disabled = true;
      inner.style.opacity = '0.6';
      performVirtualTap().then(function() {
        inner.disabled = false;
        inner.style.opacity = '1';
      }).catch(function(err) {
        inner.disabled = false;
        inner.style.opacity = '1';
        if (typeof window.reportClientError === 'function') {
          window.reportClientError(err, 'virtual-card-sim.js:tap');
        }
      });
    });

    fab.appendChild(inner);

    var clearLink = document.createElement('a');
    clearLink.href = '/virtual';
    clearLink.textContent = 'Manage \u2192';
    clearLink.style.cssText = 'display:block;text-align:center;margin-top:0.25rem;font-size:0.625rem;color:#818cf8;text-decoration:none;opacity:0.7;';
    fab.appendChild(clearLink);

    document.body.appendChild(fab);
    updateFabLabel();
  }

  window._virtualSim = {
    isActive: function() { return !!virtualCard; },
    getCard: function() { return virtualCard ? { uid: virtualCard.uid, counter: virtualCard.counter, k1: virtualCard.k1, k2: virtualCard.k2 } : null; },
    tap: performVirtualTap,
    computeTap: computeTapParams,
    clear: function() { clearVC(); location.reload(); }
  };

  // _vcTap/_vcGetKeys: consumed by E2E VirtualProvider on any page (see virtual-card-widget.js)
  window._vcTap = function() {
    if (!virtualCard) return null;
    var result = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
    var counter = virtualCard.counter;
    virtualCard.counter++;
    saveVC(virtualCard);
    return { p: result.p, c: result.c, counter: counter };
  };
  window._vcGetKeys = function() {
    return virtualCard
      ? { uid: virtualCard.uid, k1: virtualCard.k1, k2: virtualCard.k2, counter: virtualCard.counter }
      : null;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addFloatingButton);
  } else {
    addFloatingButton();
  }
})();
