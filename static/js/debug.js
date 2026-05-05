// debug.js — classic script (no import/export)
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

  function updateScanBtn(state) {
    if (state === 'scanning') {
      scanBtn.textContent = 'Scanning\u2026';
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
      detailsBox.innerHTML = '<span class="text-gray-500">No LNURLW payload found.</span>';
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
          detailsBox.innerHTML =
            '<div class="space-y-1 text-sm">' +
            '<div><span class="font-semibold text-gray-100">Callback:</span> <span class="break-all font-mono text-xs text-cyan-300">' + esc(json.callback) + '</span></div>' +
            '<div><span class="font-semibold text-gray-100">K1:</span> <span class="break-all font-mono text-xs text-amber-300">' + esc(json.k1) + '</span></div>' +
            '<div><span class="font-semibold text-gray-100">Min:</span> ' + (json.minWithdrawable / 1000) + ' sats</div>' +
            '<div><span class="font-semibold text-gray-100">Max:</span> ' + (json.maxWithdrawable / 1000) + ' sats</div>' +
            '</div>';
          payBtn.classList.remove('hidden');
          payBtn.disabled = false;
          window._consoleCallbackUrl = json.callback;
          window._consoleK1 = json.k1;
        } else {
          detailsBox.textContent = 'The card did not return a withdrawRequest payload.';
        }
      }).catch(function(e) {
        detailsBox.textContent = 'Error fetching LNURLW response: ' + e.message;
      });
    }
  }

  function handleIdentifyTab(data) {
    var detailsBox = document.getElementById('identify-details');
    var rawBox = document.getElementById('identify-raw');

    if (!data.p || !data.c) {
      detailsBox.innerHTML = '<p class="text-gray-500">No card data available.</p>';
      rawBox.textContent = '--';
      return;
    }

    detailsBox.innerHTML = '<p class="text-gray-500 animate-pulse">Identifying\u2026</p>';
    fetch('/api/identify-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: data.p, c: data.c }),
    }).then(function(r) { return r.json(); }).then(function(json) {
      lastIdentifyData = json;
      rawBox.textContent = JSON.stringify(json, null, 2);

      if (json.status === 'ERROR') {
        detailsBox.innerHTML = '<p class="text-red-300">' + esc(json.reason || 'Identification failed') + '</p>';
        return;
      }

      if (json.matched) {
        var m = json.matched;
        detailsBox.innerHTML =
          '<div class="space-y-2 text-sm">' +
          '<div><span class="font-semibold text-gray-100">UID:</span> <span class="font-mono text-amber-300">' + esc(json.uid || '--') + '</span></div>' +
          '<div><span class="font-semibold text-gray-100">Counter:</span> <span class="font-mono text-cyan-300">' + esc(json.counter || '--') + '</span></div>' +
          '<div><span class="font-semibold text-gray-100">CMAC:</span> <span class="text-emerald-300">valid</span></div>' +
          '<div><span class="font-semibold text-gray-100">State:</span> ' + esc(m.card_state || '--') + '</div>' +
          '<div><span class="font-semibold text-gray-100">Method:</span> ' + esc(m.payment_method || '--') + '</div>' +
          '<div><span class="font-semibold text-gray-100">Version:</span> ' + esc(m.version != null ? m.version : '--') + '</div>' +
          '<div><span class="font-semibold text-gray-100">Source:</span> ' + (m.source === 'config' ? 'Known card' : 'Deterministic') + '</div>' +
          '</div>';

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
        detailsBox.innerHTML =
          '<div class="space-y-2 text-sm">' +
          '<div><span class="font-semibold text-gray-100">UID:</span> <span class="font-mono text-amber-300">' + esc(json.uid || '--') + '</span></div>' +
          '<div><span class="font-semibold text-gray-100">Counter:</span> <span class="font-mono text-cyan-300">' + esc(json.counter || '--') + '</span></div>' +
          '<div><span class="font-semibold text-gray-100">CMAC:</span> <span class="text-red-300">no match</span></div>' +
          '<div class="text-xs text-gray-500 mt-2">Tried ' + ((json.all_attempts && json.all_attempts.length) || 0) + ' key(s). None matched CMAC.</div>' +
          '</div>';

        setCardInfo({
          uid: json.uid,
          counter: json.counter,
          cmac: 'invalid',
        });
      }
    }).catch(function(err) {
      detailsBox.innerHTML = '<p class="text-red-300">Error: ' + esc(err.message) + '</p>';
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
      generateBtn.textContent = 'Generating\u2026';
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
            qrContainer.innerHTML = '';
            wipeQrCode = new QRCode(qrContainer, { text: deeplink, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });
            actionsDiv.classList.remove('hidden');
          } else {
            resultDiv.textContent = json.reason || 'Failed to generate wipe data.';
          }
        }).catch(function(err) {
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
      outputDiv.innerHTML = '<div class="text-center text-gray-500 py-4">Tap a card to load 2FA codes.</div>';
      return;
    }
    outputDiv.innerHTML = '<div class="text-center text-gray-500 py-4 animate-pulse">Loading\u2026</div>';
    fetch(BASE_URL + '/2fa?p=' + encodeURIComponent(data.p) + '&c=' + encodeURIComponent(data.c), {
      headers: { 'Accept': 'application/json' }
    })
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.totpCode) {
          outputDiv.innerHTML =
            '<div class="space-y-4 text-center">' +
            '<div><p class="text-xs text-gray-500 uppercase tracking-wider mb-1">TOTP</p>' +
            '<p class="text-2xl font-mono text-emerald-400">' + esc(json.totpCode) + '</p>' +
            '<p class="text-xs text-gray-500 mt-1">' + esc(String(json.totpSecondsRemaining)) + 's remaining</p></div>' +
            '<div><p class="text-xs text-gray-500 uppercase tracking-wider mb-1">HOTP</p>' +
            '<p class="text-2xl font-mono text-blue-400">' + esc(json.hotpCode) + '</p>' +
            '<p class="text-xs text-gray-500 mt-1">Counter: ' + esc(String(json.counterValue)) + '</p></div>' +
            '<p class="text-xs text-gray-500 font-mono">UID: ' + esc(json.maskedUid || json.uidHex || '--') + '</p>' +
            '</div>';
        } else {
          outputDiv.innerHTML = '<div class="text-center text-red-400 py-4">' + esc(json.reason || json.error || 'Error') + '</div>';
        }
      })
      .catch(function() { outputDiv.innerHTML = '<div class="text-center text-red-400 py-4">Error loading 2FA data.</div>'; });
  }

  function handleIdentityTab(data) {
    var outputDiv = document.getElementById('identity-output');
    if (!data.p || !data.c) {
      outputDiv.innerHTML = '<div class="text-center text-gray-500 py-4">Tap a card to verify identity.</div>';
      return;
    }
    outputDiv.innerHTML = '<div class="text-center text-gray-500 py-4 animate-pulse">Verifying\u2026</div>';
    fetch(BASE_URL + '/api/verify-identity?p=' + encodeURIComponent(data.p) + '&c=' + encodeURIComponent(data.c))
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (json.verified) {
          outputDiv.innerHTML =
            '<div class="rounded-xl border border-pink-500/20 bg-pink-500/5 p-4 mt-4">' +
            '<div class="flex items-center gap-3 mb-3"><div class="h-8 w-8 rounded-full bg-pink-500 flex items-center justify-center text-xl">' + esc(json.profile && json.profile.emoji || '?') + '</div>' +
            '<div><div class="font-bold text-white text-lg">' + esc(json.profile && json.profile.name || 'Unknown') + '</div>' +
            '<div class="text-xs text-gray-400">' + esc(json.profile && json.profile.role || '') + ' \u00b7 ' + esc(json.profile && json.profile.department || '') + '</div></div></div>' +
            '<div class="grid grid-cols-2 gap-2 text-sm"><div><span class="text-gray-500">UID:</span> <span class="font-mono text-amber-300">' + esc(json.uid || '--') + '</span></div>' +
            '<div><span class="text-gray-500">Clearance:</span> <span class="text-pink-300">' + esc(json.profile && json.profile.clearance || '--') + '</span></div></div>' +
            '</div>';
        } else {
          outputDiv.innerHTML =
            '<div class="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mt-4">' +
            '<p class="text-red-300">' + esc(json.reason || 'Not verified') + '</p></div>';
        }
      }).catch(function() { outputDiv.innerHTML = '<div class="text-center text-red-400 py-4">Error loading identity data.</div>'; });
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
    }).catch(function(err) { showPosStatus('Error: ' + err.message, false); });
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
})();
