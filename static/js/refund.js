// refund.js — classic script (no import/export)
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
      } catch(e) { appState = 'idle'; showResult('error', 'Error', e.message); }
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
      appState = 'idle';
      showResult('error', 'Network error', e.message);
    }
  }
})();
