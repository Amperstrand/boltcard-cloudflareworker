// void.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
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

  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  function formatAmount(amount) {
    var abs = Math.abs(amount);
    var label = document.documentElement.dataset.currencyLabel || 'credits';
    return abs + ' ' + label;
  }

  function formatDate(epoch) {
    if (!epoch) return '';
    var d = new Date(epoch * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  var appState = 'idle';
  var nfcScanner = null;
  var lastP = null;
  var lastC = null;

  var cardInfo = document.getElementById('card-info');
  var cardBalance = document.getElementById('card-balance');
  var txnList = document.getElementById('txn-list');
  var txnItems = document.getElementById('txn-items');
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
        if (p && c) { lastP = p; lastC = c; await fetchTransactions(p, c); }
        else { appState = 'idle'; showResult('error', 'Invalid card', 'Missing p/c parameters'); }
       } catch(e) {
        if (typeof window.reportClientError === 'function') window.reportClientError(e, 'void.js:card-read');
        appState = 'idle';
        showResult('error', 'Error', e.message);
      }
    }
  });

  nfcTapBtn.addEventListener('click', function() { clearResult(); nfcScanner.scan(); });
  logoutBtn.addEventListener('click', operatorLogout);

  if (!browserSupportsNfc()) {
    nfcTapBtn.textContent = 'NFC NOT AVAILABLE — use Chrome on Android or USB reader';
    nfcTapBtn.disabled = true;
    nfcTapBtn.classList.add('opacity-50');
  } else {
    canAutoStartNfc().then(function(granted) {
      if (granted) {
        window.addEventListener('load', function() { nfcScanner.scan(); });
      }
      // If not granted, the nfc-tap-btn click handler provides the user gesture
    });
  }

  function renderTransactionList(transactions) {
    txnItems.replaceChildren();
    if (!transactions || transactions.length === 0) {
      var emptyEl = document.createElement('p');
      emptyEl.className = 'text-gray-500 text-sm text-center py-4';
      emptyEl.textContent = 'No recent charges to void';
      txnItems.appendChild(emptyEl);
      return;
    }

    transactions.forEach(function(txn) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 hover:border-red-500/50 hover:bg-gray-750 transition-colors';

      var leftDiv = document.createElement('div');
      var amountEl = document.createElement('span');
      amountEl.className = 'text-white font-bold text-sm';
      amountEl.textContent = '-' + formatAmount(txn.amount);

      var noteEl = document.createElement('span');
      noteEl.className = 'text-gray-500 text-xs ml-2';
      noteEl.textContent = txn.note || '';

      leftDiv.appendChild(amountEl);
      leftDiv.appendChild(noteEl);

      var timeEl = document.createElement('span');
      timeEl.className = 'text-gray-500 text-xs';
      timeEl.textContent = formatDate(txn.created_at);

      btn.appendChild(leftDiv);
      btn.appendChild(timeEl);

      btn.addEventListener('click', function() { submitVoid(txn.id, txn.amount); });
      txnItems.appendChild(btn);
    });
  }

  async function submitVoid(transactionId, originalAmount) {
    if (!lastP || !lastC) { showResult('error', 'No card', 'Tap a card first'); return; }
    appState = 'processing';
    try {
      var resp = await fetch('/operator/void/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: lastP, c: lastC, transactionId: transactionId }),
      });
      var data = await resp.json();
      if (resp.ok && data.success) {
        cardBalance.textContent = data.balance || 0;
        showResult('success', 'Charge voided', 'Voided ' + formatAmount(originalAmount) + '. Balance: ' + data.balance);
        await fetchTransactions(lastP, lastC);
      } else {
        showResult('error', 'Void failed', data.error || data.reason || 'Unknown error');
      }
     } catch(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'void.js:network');
      showResult('error', 'Network error', e.message);
    }
    appState = 'idle';
  }

  async function fetchTransactions(p, c) {
    try {
      var resp = await fetch('/operator/void/transactions?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
      var data = await resp.json();
      if (resp.ok) {
        cardBalance.textContent = data.balance || 0;
        cardInfo.classList.remove('hidden');
        txnList.classList.remove('hidden');
        renderTransactionList(data.transactions);
        appState = 'idle';
      } else {
        appState = 'idle';
        showResult('error', 'Read failed', data.error || data.reason || 'Could not read card');
      }
     } catch(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'void.js:network');
      appState = 'idle';
      showResult('error', 'Network error', e.message);
    }
  }
})();
