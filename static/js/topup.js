// topup.js — classic script (no import/export)
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
      resultIcon.textContent = '\u2713';
      resultIcon.className = 'text-2xl leading-none text-emerald-400';
      resultTitle.className = 'font-bold text-sm text-emerald-300';
      resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
    } else {
      resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-red-500/40 bg-red-900/20';
      resultIcon.textContent = '\u2717';
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
    s = s.replace(/^0+(\d)/, '$1');
    return s;
  }

  function formatDisplay(val) {
    var n = normalizeAmount(val);
    return n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
      } catch(e) { appState = 'idle'; updateView(); showResult('error', 'Card read error', e.message); }
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
      showResult('error', 'Network error', e.message || 'Could not reach server');
    }
    appState = 'idle';
    updateView();
  }

  updateView();
})();
