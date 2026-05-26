// virtual-card.js — classic script (no import/export)
// Requires: aes-js CDN (https://cdn.jsdelivr.net/npm/aes-js@3.1.2/index.js)

(function() {
  // ─── Hex utilities ───

  function hexToBytes(hex) {
    if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error('Invalid hex string');
    }
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

  // ─── AES-ECB wrapper (using aes-js from CDN) ───

  function aesEcbEncrypt(key, plaintext) {
    var aes = new aesjs.ModeOfOperation.ecb(key);
    return new Uint8Array(aes.encrypt(plaintext));
  }

  // ─── CMAC primitives (ported from cryptoutils.ts) ───

  function xorArrays(a, b) {
    var result = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) {
      result[i] = a[i] ^ b[i];
    }
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
    if (result.carry) {
      subkey[subkey.length - 1] ^= 0x87;
    }
    return subkey;
  }

  // Single-block CMAC per RFC 4493 (message <= 16 bytes)
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

  // NTAG424 CM computation from ks (port of cryptoutils._computeCm)
  function computeCm(ks) {
    var zeroBlock = new Uint8Array(16);
    var Lprime = aesEcbEncrypt(ks, zeroBlock);
    var K1prime = generateSubkey(Lprime);
    var hk1 = generateSubkey(K1prime);
    var hashVal = new Uint8Array(hk1);
    hashVal[0] ^= 0x80;
    return aesEcbEncrypt(ks, hashVal);
  }

  // Extract odd-indexed bytes (positions 1,3,5,...,15)
  function extractOddBytes(cm) {
    return new Uint8Array([
      cm[1], cm[3], cm[5], cm[7],
      cm[9], cm[11], cm[13], cm[15]
    ]);
  }

  // Build NTAG424 verification data (port of cryptoutils.buildVerificationData)
  function buildVerificationData(uidBytes, ctr, k2Bytes) {
    var sv2 = new Uint8Array(16);
    sv2[0] = 0x3c;
    sv2[1] = 0xc3;
    sv2[2] = 0x00;
    sv2[3] = 0x01;
    sv2[4] = 0x00;
    sv2[5] = 0x80;
    sv2.set(uidBytes, 6);
    sv2[13] = ctr[2];
    sv2[14] = ctr[1];
    sv2[15] = ctr[0];
    var ks = computeAesCmac(sv2, k2Bytes);
    var cm = computeCm(ks);
    return extractOddBytes(cm);
  }

  // ─── Virtual tap (same algorithm as tests/testHelpers.ts virtualTap) ───

  function virtualTap(uidHex, counter, k1Hex, k2Hex) {
    var k1 = hexToBytes(k1Hex);
    var uid = hexToBytes(uidHex);

    // Build plaintext: [0xC7, uid(7 bytes), counter LE(3 bytes), padding(5 bytes)]
    var plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(uid, 1);
    plaintext[8] = counter & 0xff;
    plaintext[9] = (counter >> 8) & 0xff;
    plaintext[10] = (counter >> 16) & 0xff;

    // AES-ECB encrypt with K1 → p
    var encrypted = aesEcbEncrypt(k1, plaintext);
    var pHex = bytesToHex(encrypted);

    // Counter bytes for CMAC (big-endian)
    var ctrBytes = new Uint8Array([
      (counter >> 16) & 0xff,
      (counter >> 8) & 0xff,
      counter & 0xff
    ]);

    // Build verification data with K2 → c
    var ct = buildVerificationData(uid, ctrBytes, hexToBytes(k2Hex));
    var cHex = bytesToHex(ct);

    return { p: pHex, c: cHex };
  }

  // ─── Card state ───

  var virtualCard = {
    uid: null,
    k1: null,
    k2: null,
    counter: 0,
    created: false
  };

  // ─── DOM helpers ───

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function logStep(container, label, pass, detail) {
    var row = el('div', 'flex items-start gap-2 text-sm py-1');
    row.appendChild(el('span', pass ? 'text-emerald-400 font-bold shrink-0' : 'text-red-400 font-bold shrink-0', pass ? '\u2713' : '\u2717'));
    row.appendChild(el('span', 'text-gray-300', label));
    if (detail) {
      row.appendChild(el('span', 'text-gray-500 text-xs ml-1 font-mono', detail));
    }
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  function setStatus(msg, ok) {
    var box = document.getElementById('vc-status');
    box.textContent = msg;
    if (ok === true) {
      box.className = 'mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200';
    } else if (ok === false) {
      box.className = 'mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200';
    } else {
      box.className = 'mt-3 rounded-xl border border-gray-700 bg-gray-900/80 px-4 py-3 text-sm text-gray-400';
    }
    box.classList.remove('hidden');
  }

  function updateCardDisplay() {
    document.getElementById('vc-uid').textContent = virtualCard.uid ? virtualCard.uid.toUpperCase() : '--';
    document.getElementById('vc-counter').textContent = virtualCard.uid ? String(virtualCard.counter) : '--';
    document.getElementById('vc-k1').textContent = virtualCard.k1 ? virtualCard.k1.substring(0, 8) + '\u2026' : '--';
    document.getElementById('vc-k2').textContent = virtualCard.k2 ? virtualCard.k2.substring(0, 8) + '\u2026' : '--';
  }

  // ─── Create Virtual Card ───

  function createVirtualCard() {
    // Generate random 7-byte UID (14 hex chars)
    var uidBytes = new Uint8Array(7);
    crypto.getRandomValues(uidBytes);
    var uidHex = bytesToHex(uidBytes);

    var createBtn = document.getElementById('vc-create-btn');
    createBtn.disabled = true;
    createBtn.textContent = 'Creating\u2026';
    setStatus('Fetching keys for UID ' + uidHex.toUpperCase() + '\u2026', null);

    fetch('/api/debug/virtual-card-keys?uid=' + uidHex)
      .then(function(r) {
        if (!r.ok) throw new Error('Server returned ' + r.status);
        return r.json();
      })
      .then(function(data) {
        virtualCard.uid = data.uid;
        virtualCard.k1 = data.k1;
        virtualCard.k2 = data.k2;
        virtualCard.counter = 1;
        virtualCard.created = true;

        updateCardDisplay();
        document.getElementById('vc-tap-btn').classList.remove('hidden');
        document.getElementById('vc-tap-btn').disabled = false;
        document.getElementById('vc-auto-btn').classList.remove('hidden');
        document.getElementById('vc-auto-btn').disabled = false;
        document.getElementById('vc-tap-log').replaceChildren();

        setStatus('Virtual card created! UID: ' + virtualCard.uid.toUpperCase(), true);
        createBtn.textContent = 'Reset & Create New';
        createBtn.disabled = false;
      })
      .catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'virtual-card.js:create');
        setStatus('Failed to create card: ' + err.message, false);
        createBtn.textContent = 'Create Virtual Card';
        createBtn.disabled = false;
      });
  }

  // ─── Tap Virtual Card (generate p/c, query LNURLW) ───

  function tapVirtualCard() {
    if (!virtualCard.created) {
      setStatus('Create a virtual card first', false);
      return null;
    }

    var result = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
    var logEl = document.getElementById('vc-tap-log');

    logStep(logEl, 'Tap counter ' + virtualCard.counter, true,
      'p=' + result.p.substring(0, 8) + '\u2026 c=' + result.c.substring(0, 8) + '\u2026');

    virtualCard.counter++;
    updateCardDisplay();

    return result;
  }

  function tapAndQuery() {
    var tapResult = tapVirtualCard();
    if (!tapResult) return;

    var logEl = document.getElementById('vc-tap-log');
    logStep(logEl, 'Querying LNURLW endpoint\u2026', true);

    fetch('/?p=' + encodeURIComponent(tapResult.p) + '&c=' + encodeURIComponent(tapResult.c))
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.tag === 'withdrawRequest') {
          logStep(logEl, 'withdrawRequest received', true,
            'max=' + (json.maxWithdrawable / 1000) + ' sats');
        } else if (json.status === 'ERROR') {
          logStep(logEl, json.reason || 'Server error', false);
        } else {
          logStep(logEl, 'Unexpected: ' + (json.tag || json.status || 'unknown'), false);
        }
      })
      .catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'virtual-card.js:tap-query');
        logStep(logEl, 'Fetch error: ' + err.message, false);
      });
  }

  // ─── Auto-Test Lifecycle ───

  async function autoTestLifecycle() {
    if (!virtualCard.created) {
      setStatus('Create a virtual card first', false);
      return;
    }

    var autoBtn = document.getElementById('vc-auto-btn');
    var tapBtn = document.getElementById('vc-tap-btn');
    autoBtn.disabled = true;
    tapBtn.disabled = true;
    autoBtn.textContent = 'Running\u2026';

    var logEl = document.getElementById('vc-tap-log');
    logEl.replaceChildren();

    var BASE = window.location.origin;
    var allPassed = true;

    function step(label, pass, detail) {
      logStep(logEl, label, pass, detail);
      if (!pass) allPassed = false;
    }

    function doFetch(url, opts) {
      return fetch(url, opts).then(function(r) {
        return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data }; });
      });
    }

    try {
      // Step 1: Initial tap — discover card
      step('Step 1: Initial tap (discover card)', true);
      var t1 = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
      virtualCard.counter++;
      updateCardDisplay();

      var r1 = await doFetch(BASE + '/?p=' + encodeURIComponent(t1.p) + '&c=' + encodeURIComponent(t1.c));
      if (r1.ok && r1.data.tag === 'withdrawRequest') {
        step('  LNURLW withdrawRequest received', true,
          'max=' + (r1.data.maxWithdrawable / 1000) + ' sats');
      } else if (r1.data.status === 'ERROR') {
        step('  Card error: ' + (r1.data.reason || 'unknown'), false);
      } else {
        step('  Unexpected: ' + (r1.data.tag || r1.data.status || 'unknown'), false);
      }

      // Step 2: Top-up 10000 msat
      step('Step 2: Top-up 10000 msat', true);
      var t2 = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
      virtualCard.counter++;
      updateCardDisplay();

      var r2 = await doFetch(BASE + '/operator/topup/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: t2.p, c: t2.c, amount: 10000 })
      });
      if (r2.ok && (r2.data.success || r2.data.status === 'OK')) {
        step('  Top-up successful', true, 'balance: ' + (r2.data.balance != null ? r2.data.balance : '?'));
      } else {
        step('  Top-up failed: ' + (r2.data.reason || r2.data.error || 'unknown'), false);
      }

      // Step 3: POS charge 3000 msat
      step('Step 3: POS charge 3000 msat', true);
      var t3 = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
      virtualCard.counter++;
      updateCardDisplay();

      var r3 = await doFetch(BASE + '/operator/pos/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: t3.p, c: t3.c, amount: 3000 })
      });
      if (r3.ok && (r3.data.status === 'OK' || r3.data.success)) {
        step('  Charge successful', true, r3.data.reason || '');
      } else {
        step('  Charge failed: ' + (r3.data.reason || r3.data.error || 'unknown'), false);
      }

      // Step 4: Refund 3000 msat
      step('Step 4: Refund 3000 msat', true);
      var t4 = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
      virtualCard.counter++;
      updateCardDisplay();

      var r4 = await doFetch(BASE + '/operator/refund/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: t4.p, c: t4.c, amount: 3000 })
      });
      if (r4.ok && (r4.data.success || r4.data.status === 'OK')) {
        step('  Refund successful', true, r4.data.reason || '');
      } else {
        step('  Refund failed: ' + (r4.data.reason || r4.data.error || 'unknown'), false);
      }

      // Step 5: Balance check — should be 10000
      step('Step 5: Verify balance = 10000 msat', true);
      var t5 = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
      virtualCard.counter++;
      updateCardDisplay();

      var r5 = await doFetch(BASE + '/api/balance-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: t5.p, c: t5.c })
      });
      if (r5.ok && r5.data.balance !== undefined) {
        var balOk = r5.data.balance === 10000;
        step('  Balance: ' + r5.data.balance + ' msat', balOk,
          balOk ? 'correct' : 'expected 10000');
      } else {
        step('  Balance check failed: ' + (r5.data.reason || 'unknown'), false);
      }

      // Summary
      var summaryEl = el('div',
        'mt-3 pt-3 border-t border-gray-700/50 text-sm font-bold ' +
        (allPassed ? 'text-emerald-400' : 'text-amber-400'),
        allPassed ? '\u2713 All steps passed!' : '\u26A0 Some steps failed');
      logEl.appendChild(summaryEl);

      setStatus(allPassed ? 'Auto-test completed: all passed' : 'Auto-test completed: some failures', allPassed);

    } catch (err) {
      if (typeof window.reportClientError === 'function') window.reportClientError(err, 'virtual-card.js:auto-test');
      step('Unexpected error: ' + err.message, false);
      setStatus('Auto-test failed: ' + err.message, false);
    }

    autoBtn.textContent = 'Run Auto-Test';
    autoBtn.disabled = false;
    tapBtn.disabled = false;
  }

  // ─── Event listeners ───

  document.getElementById('vc-create-btn').addEventListener('click', function() {
    if (virtualCard.created) {
      // Reset state
      virtualCard = { uid: null, k1: null, k2: null, counter: 0, created: false };
      updateCardDisplay();
      document.getElementById('vc-tap-btn').classList.add('hidden');
      document.getElementById('vc-auto-btn').classList.add('hidden');
      document.getElementById('vc-tap-log').replaceChildren();
      document.getElementById('vc-status').classList.add('hidden');
      document.getElementById('vc-create-btn').textContent = 'Create Virtual Card';
    }
    createVirtualCard();
  });

  document.getElementById('vc-tap-btn').addEventListener('click', tapAndQuery);

  document.getElementById('vc-auto-btn').addEventListener('click', autoTestLifecycle);
})();
