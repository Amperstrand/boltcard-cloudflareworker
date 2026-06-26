// virtual-card-widget.js — unified virtual card simulator
// Consolidates crypto + UI from virtual-card.js, virtual-card-page.js, virtual-card-sim.js
// Requires: aes-js CDN (loaded by template)

(function() {
  var VC_KEY = 'virtual_boltcard';

  // ─── Crypto primitives (ported from cryptoutils.ts, single canonical copy) ───

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

  // ─── localStorage persistence ───

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

  // ─── State ───

  var virtualCard = loadVC();

  // ─── DOM helpers ───

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function $(id) { return document.getElementById(id); }

  function showView(viewId) {
    ['vc-no-card', 'vc-card-details'].forEach(function(id) {
      var e = $(id);
      if (e) e.classList.add('hidden');
    });
    var target = $(viewId);
    if (target) target.classList.remove('hidden');
  }

  function setStatus(msg, ok) {
    var box = $('vc-status');
    if (!box) return;
    box.textContent = msg;
    if (ok === true) {
      box.className = 'block rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200';
    } else if (ok === false) {
      box.className = 'block rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200';
    } else {
      box.className = 'block rounded-xl border border-gray-700 bg-gray-900/80 px-4 py-3 text-sm text-gray-400';
    }
    box.classList.remove('hidden');
  }

  function updateCardDisplay() {
    if (!virtualCard) return;
    $('vc-uid').textContent = virtualCard.uid.toUpperCase();
    $('vc-counter').textContent = String(virtualCard.counter);
    $('vc-k1-full').textContent = virtualCard.k1;
    $('vc-k2-full').textContent = virtualCard.k2;
    var created = virtualCard.createdAt
      ? new Date(virtualCard.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '--';
    $('vc-created').textContent = created;
  }

  // ─── Tap log ───

  function clearLog() {
    var logEl = $('vc-tap-log');
    if (!logEl) return;
    logEl.replaceChildren();
    logEl.appendChild(el('div', 'text-gray-600 text-xs italic text-center py-4', 'No taps yet.'));
  }

  function logStep(label, pass, detail) {
    var logEl = $('vc-tap-log');
    if (!logEl) return;

    var placeholder = logEl.querySelector('.italic');
    if (placeholder) logEl.replaceChildren();

    var row = el('div', 'flex items-start gap-2 py-1.5 border-b border-gray-700/30 last:border-0');
    row.appendChild(el('span', pass ? 'text-emerald-400 font-bold shrink-0' : (pass === false ? 'text-red-400 font-bold shrink-0' : 'text-indigo-400 font-bold shrink-0'),
      pass === true ? '\u2713' : (pass === false ? '\u2717' : '\u2192')));
    row.appendChild(el('span', 'text-gray-300 flex-1', label));
    if (detail) {
      row.appendChild(el('span', 'text-gray-500 text-xs ml-1 font-mono break-all', detail));
    }
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function logTapHeader(counter) {
    var logEl = $('vc-tap-log');
    if (!logEl) return;
    var placeholder = logEl.querySelector('.italic');
    if (placeholder) logEl.replaceChildren();

    var header = el('div', 'flex items-center gap-2 pt-2 pb-1 mt-1 border-t border-gray-700/50');
    header.appendChild(el('span', 'text-cyan-400 font-bold text-xs', '#' + counter));
    header.appendChild(el('span', 'text-gray-500 text-xs', new Date().toLocaleTimeString()));
    logEl.appendChild(header);
  }

  // ─── Create card ───

  function createCard() {
    var btn = $('vc-create-btn');
    var status = $('vc-create-status');
    btn.disabled = true;
    btn.textContent = 'Creating\u2026';
    status.className = 'mt-3 text-sm text-gray-400';
    status.textContent = 'Generating random UID and fetching keys\u2026';
    status.classList.remove('hidden');

    var uidBytes = new Uint8Array(7);
    crypto.getRandomValues(uidBytes);
    var uidHex = bytesToHex(uidBytes);

    fetch('/api/vc/keys?uid=' + uidHex)
      .then(function(r) {
        if (!r.ok) throw new Error('Server returned ' + r.status);
        return r.json();
      })
      .then(function(data) {
        virtualCard = {
          uid: data.uid,
          k1: data.k1,
          k2: data.k2,
          version: data.version || 1,
          counter: 1,
          createdAt: Date.now()
        };
        saveVC(virtualCard);
        updateCardDisplay();
        showView('vc-card-details');
        setStatus('Virtual card created! UID: ' + virtualCard.uid.toUpperCase(), true);
        status.classList.add('hidden');
        btn.textContent = 'Create Virtual Card';
        btn.disabled = false;
        clearLog();
      })
      .catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'virtual-card-widget.js:create');
        status.className = 'mt-3 text-sm text-red-400';
        status.textContent = 'Failed: ' + err.message;
        btn.textContent = 'Create Virtual Card';
        btn.disabled = false;
      });
  }

  // ─── Generate tap params ───

  function generateTap() {
    if (!virtualCard) return null;
    var result = virtualTap(virtualCard.uid, virtualCard.counter, virtualCard.k1, virtualCard.k2);
    var counter = virtualCard.counter;
    virtualCard.counter++;
    saveVC(virtualCard);
    updateCardDisplay();

    var lastParams = $('vc-last-params');
    if (lastParams) {
      lastParams.textContent = 'p=' + result.p.substring(0, 12) + '\u2026 c=' + result.c.substring(0, 8) + '\u2026';
    }

    return { p: result.p, c: result.c, counter: counter };
  }

  function getAmount() {
    var input = $('vc-amount');
    if (!input || !input.value) return null;
    var val = parseInt(input.value, 10);
    if (isNaN(val) || val <= 0) return null;
    return val;
  }

  function doFetch(url, opts) {
    return fetch(url, opts).then(function(r) {
      return r.text().then(function(text) {
        try {
          return { ok: r.ok, status: r.status, data: JSON.parse(text) };
        } catch (e) {
          return { ok: false, status: r.status, data: { error: 'Non-JSON response (status ' + r.status + ')' } };
        }
      });
    });
  }

  // ─── Tap destinations ───

  function simulateTap() {
    if (!virtualCard) { setStatus('Create a virtual card first', false); return; }

    var dest = $('vc-destination') ? $('vc-destination').value : 'lnurlw';
    var tap = generateTap();
    if (!tap) return;

    logTapHeader(tap.counter);
    logStep('Destination: ' + dest, null);

    var BASE = window.location.origin;

    if (dest === 'lnurlw') {
      logStep('Querying LNURLW\u2026', null);
      doFetch(BASE + '/?p=' + encodeURIComponent(tap.p) + '&c=' + encodeURIComponent(tap.c))
        .then(function(r) {
          if (r.ok && r.data.tag === 'withdrawRequest') {
            logStep('withdrawRequest received', true, 'max=' + (r.data.maxWithdrawable / 1000) + ' sats');
            postTapResult({ success: true, destination: dest, response: r.data });
          } else if (r.data.status === 'ERROR') {
            logStep('Error: ' + (r.data.reason || 'unknown'), false);
            postTapResult({ success: false, destination: dest, error: r.data.reason });
          } else {
            logStep('Unexpected: ' + (r.data.tag || r.data.status || 'unknown'), false);
            postTapResult({ success: false, destination: dest, error: 'unexpected response' });
          }
        })
        .catch(function(err) {
          logStep('Fetch error: ' + err.message, false);
          postTapResult({ success: false, destination: dest, error: err.message });
        });

    } else if (dest === 'topup') {
      var amt = getAmount();
      if (!amt) { setStatus('Enter a valid amount in msat', false); return; }
      logStep('Top-up ' + amt + ' msat\u2026', null);
      doFetch(BASE + '/operator/topup/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: amt })
      }).then(function(r) {
        if (r.ok && (r.data.success || r.data.status === 'OK')) {
          logStep('Top-up successful', true, 'balance: ' + (r.data.balance != null ? r.data.balance : '?'));
          postTapResult({ success: true, destination: dest, response: r.data });
        } else {
          logStep('Top-up failed: ' + (r.data.reason || r.data.error || 'unknown'), false);
          postTapResult({ success: false, destination: dest, error: r.data.reason });
        }
      }).catch(function(err) {
        logStep('Fetch error: ' + err.message, false);
      });

    } else if (dest === 'pos') {
      var amt = getAmount();
      if (!amt) { setStatus('Enter a valid amount in msat', false); return; }
      logStep('POS charge ' + amt + ' msat\u2026', null);
      doFetch(BASE + '/operator/pos/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: amt })
      }).then(function(r) {
        if (r.ok && (r.data.status === 'OK' || r.data.success)) {
          logStep('Charge successful', true, r.data.reason || '');
          postTapResult({ success: true, destination: dest, response: r.data });
        } else {
          logStep('Charge failed: ' + (r.data.reason || r.data.error || 'unknown'), false);
          postTapResult({ success: false, destination: dest, error: r.data.reason });
        }
      }).catch(function(err) {
        logStep('Fetch error: ' + err.message, false);
      });

    } else if (dest === 'refund') {
      var amt = getAmount();
      if (!amt) { setStatus('Enter a valid amount in msat', false); return; }
      logStep('Refund ' + amt + ' msat\u2026', null);
      doFetch(BASE + '/operator/refund/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: tap.p, c: tap.c, amount: amt })
      }).then(function(r) {
        if (r.ok && (r.data.success || r.data.status === 'OK')) {
          logStep('Refund successful', true, r.data.reason || '');
          postTapResult({ success: true, destination: dest, response: r.data });
        } else {
          logStep('Refund failed: ' + (r.data.reason || r.data.error || 'unknown'), false);
          postTapResult({ success: false, destination: dest, error: r.data.reason });
        }
      }).catch(function(err) {
        logStep('Fetch error: ' + err.message, false);
      });

    } else if (dest === 'balance') {
      logStep('Checking balance\u2026', null);
      doFetch(BASE + '/api/balance-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: tap.p, c: tap.c })
      }).then(function(r) {
        if (r.ok && r.data.balance !== undefined) {
          logStep('Balance: ' + r.data.balance + ' msat', true);
          postTapResult({ success: true, destination: dest, response: r.data });
        } else {
          logStep('Balance check failed: ' + (r.data.reason || 'unknown'), false);
          postTapResult({ success: false, destination: dest, error: r.data.reason });
        }
      }).catch(function(err) {
        logStep('Fetch error: ' + err.message, false);
      });

    } else if (dest === 'cardinfo') {
      logStep('Fetching card info\u2026', null);
      doFetch(BASE + '/card/info?p=' + encodeURIComponent(tap.p) + '&c=' + encodeURIComponent(tap.c))
        .then(function(r) {
          if (r.ok && r.data.state) {
            logStep('State: ' + r.data.state, true,
              'balance: ' + (r.data.balance != null ? r.data.balance : '?') + ' msat');
            var stateBadge = $('vc-state-text');
            if (stateBadge) stateBadge.textContent = r.data.state;
            postTapResult({ success: true, destination: dest, response: r.data });
          } else {
            logStep('Card info failed: ' + (r.data.reason || r.data.error || 'unknown'), false);
            postTapResult({ success: false, destination: dest, error: r.data.reason });
          }
        })
        .catch(function(err) {
          logStep('Fetch error: ' + err.message, false);
        });
    }
  }

  function postTapResult(result) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(Object.assign({ source: 'virtual-card-widget', type: 'tap' }, result), '*');
    }
  }

  // ─── Auto-test lifecycle ───

  function autoTest() {
    if (!virtualCard) { setStatus('Create a virtual card first', false); return; }

    var autoBtn = $('vc-auto-btn');
    var tapBtn = $('vc-tap-btn');
    autoBtn.disabled = true;
    tapBtn.disabled = true;
    autoBtn.textContent = 'Running\u2026';

    clearLog();
    var BASE = window.location.origin;
    var allPassed = true;

    function step(label, pass, detail) {
      logStep(label, pass, detail);
      if (!pass) allPassed = false;
    }

    (async function() {
      try {
        step('Step 1: Initial tap (discover card)', null);
        var t1 = generateTap();
        var r1 = await doFetch(BASE + '/?p=' + encodeURIComponent(t1.p) + '&c=' + encodeURIComponent(t1.c));
        if (r1.ok && r1.data.tag === 'withdrawRequest') {
          step('  withdrawRequest received', true, 'max=' + (r1.data.maxWithdrawable / 1000) + ' sats');
        } else if (r1.data.status === 'ERROR') {
          step('  Error: ' + (r1.data.reason || 'unknown'), false);
        } else {
          step('  Unexpected response', false);
        }

        step('Step 2: Top-up 10000 msat', null);
        var t2 = generateTap();
        var r2 = await doFetch(BASE + '/operator/topup/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: t2.p, c: t2.c, amount: 10000 })
        });
        if (r2.ok && (r2.data.success || r2.data.status === 'OK')) {
          step('  Top-up successful', true, 'balance: ' + (r2.data.balance != null ? r2.data.balance : '?'));
        } else {
          step('  Top-up failed: ' + (r2.data.reason || r2.data.error || 'unknown'), false);
        }

        step('Step 3: POS charge 3000 msat', null);
        var t3 = generateTap();
        var r3 = await doFetch(BASE + '/operator/pos/charge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: t3.p, c: t3.c, amount: 3000 })
        });
        if (r3.ok && (r3.data.status === 'OK' || r3.data.success)) {
          step('  Charge successful', true);
        } else {
          step('  Charge failed: ' + (r3.data.reason || r3.data.error || 'unknown'), false);
        }

        step('Step 4: Refund 3000 msat', null);
        var t4 = generateTap();
        var r4 = await doFetch(BASE + '/operator/refund/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: t4.p, c: t4.c, amount: 3000 })
        });
        if (r4.ok && (r4.data.success || r4.data.status === 'OK')) {
          step('  Refund successful', true);
        } else {
          step('  Refund failed: ' + (r4.data.reason || r4.data.error || 'unknown'), false);
        }

        step('Step 5: Verify balance = 10000 msat', null);
        var t5 = generateTap();
        var r5 = await doFetch(BASE + '/api/balance-check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: t5.p, c: t5.c })
        });
        if (r5.ok && r5.data.balance !== undefined) {
          var balOk = r5.data.balance === 10000;
          step('  Balance: ' + r5.data.balance + ' msat', balOk, balOk ? 'correct' : 'expected 10000');
        } else {
          step('  Balance check failed', false);
        }

        var logEl = $('vc-tap-log');
        var summary = el('div',
          'flex items-center gap-2 pt-3 mt-2 border-t border-gray-700/50 text-sm font-bold ' +
          (allPassed ? 'text-emerald-400' : 'text-amber-400'),
          allPassed ? '\u2713 All steps passed!' : '\u26a0 Some steps failed');
        logEl.appendChild(summary);

        setStatus(allPassed ? 'Auto-test completed: all passed' : 'Auto-test completed: some failures', allPassed);
      } catch (err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'virtual-card-widget.js:auto-test');
        step('Unexpected error: ' + err.message, false);
        setStatus('Auto-test failed: ' + err.message, false);
      }

      autoBtn.textContent = 'Auto-Test';
      autoBtn.disabled = false;
      tapBtn.disabled = false;
    })();
  }

  // ─── Destination change handler ───

  function onDestinationChange() {
    var dest = $('vc-destination');
    if (!dest) return;
    var amountRow = $('vc-amount-row');
    var amountInput = $('vc-amount');
    var needsAmount = ['topup', 'pos', 'refund'].indexOf(dest.value) !== -1;
    if (amountRow) {
      amountRow.classList.toggle('hidden', !needsAmount);
    }
    if (amountInput && !needsAmount) {
      amountInput.value = '';
    }
  }

  // ─── Copy to clipboard ───

  function copyText(targetId) {
    var e = $(targetId);
    if (!e) return;
    var text = e.textContent || '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() {
        flashCopyButton(targetId);
      }).catch(function() {});
    } else {
      var range = document.createRange();
      range.selectNodeContents(e);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand('copy'); flashCopyButton(targetId); } catch (e2) {}
      sel.removeAllRanges();
    }
  }

  function flashCopyButton(targetId) {
    document.querySelectorAll('.vc-copy-btn').forEach(function(btn) {
      if (btn.getAttribute('data-target') === targetId) {
        var original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('text-emerald-400');
        setTimeout(function() {
          btn.textContent = original;
          btn.classList.remove('text-emerald-400');
        }, 1200);
      }
    });
  }

  // ─── Keys toggle ───

  function toggleKeys() {
    var content = $('vc-keys-content');
    var chevron = $('vc-keys-chevron');
    if (!content) return;
    var isHidden = content.classList.contains('hidden');
    content.classList.toggle('hidden', !isHidden);
    if (chevron) {
      chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    }
  }

  // ─── Init ───

  function init() {
    if (virtualCard) {
      updateCardDisplay();
      showView('vc-card-details');
    } else {
      showView('vc-no-card');
    }

    var createBtn = $('vc-create-btn');
    if (createBtn) createBtn.addEventListener('click', createCard);

    var tapBtn = $('vc-tap-btn');
    if (tapBtn) tapBtn.addEventListener('click', simulateTap);

    var autoBtn = $('vc-auto-btn');
    if (autoBtn) autoBtn.addEventListener('click', autoTest);

    var dest = $('vc-destination');
    if (dest) dest.addEventListener('change', onDestinationChange);

    var keysToggle = $('vc-keys-toggle');
    if (keysToggle) keysToggle.addEventListener('click', toggleKeys);

    var clearLogBtn = $('vc-clear-log');
    if (clearLogBtn) clearLogBtn.addEventListener('click', clearLog);

    document.querySelectorAll('.vc-copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        copyText(btn.getAttribute('data-target'));
      });
    });

    var deleteBtn = $('vc-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function() {
        $('vc-delete-confirm').classList.remove('hidden');
      });
    }

    var resetBtn = $('vc-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        clearVC();
        virtualCard = null;
        clearLog();
        showView('vc-no-card');
        $('vc-delete-confirm').classList.add('hidden');
      });
    }

    var deleteCancel = $('vc-delete-cancel');
    if (deleteCancel) {
      deleteCancel.addEventListener('click', function() {
        $('vc-delete-confirm').classList.add('hidden');
      });
    }

    var deleteConfirm = $('vc-delete-confirm-btn');
    if (deleteConfirm) {
      deleteConfirm.addEventListener('click', function() {
        clearVC();
        location.reload();
      });
    }
  }

  // Expose for E2E testing
  window._vcTap = function() {
    if (!virtualCard) return null;
    return generateTap();
  };
  window._vcGetKeys = function() {
    return virtualCard
      ? { uid: virtualCard.uid, k1: virtualCard.k1, k2: virtualCard.k2, counter: virtualCard.counter }
      : null;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
