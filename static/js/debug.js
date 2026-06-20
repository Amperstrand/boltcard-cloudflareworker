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

    detailsBox.replaceChildren(_el('p', 'text-gray-500 animate-pulse', 'Identifying\u2026'));
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
    outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4 animate-pulse', 'Loading\u2026'));
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
    outputDiv.replaceChildren(_el('div', 'text-center text-gray-500 py-4 animate-pulse', 'Verifying\u2026'));
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
          _role.textContent = (json.profile && json.profile.role || '') + ' \u00b7 ' + (json.profile && json.profile.department || '');
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
    canAutoStartNfc().then(function(granted) {
      if (granted) nfcScanner.scan();
    });
  }
})();
