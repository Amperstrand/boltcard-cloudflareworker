// reconciliation.js — classic script (no import/export)

(function() {
  var loadingEl = document.getElementById('loading');
  var contentEl = document.getElementById('content');
  var errorBox = document.getElementById('error-box');
  var errorMessage = document.getElementById('error-message');
  var refreshBtn = document.getElementById('refresh-btn');
  var logoutBtn = document.getElementById('logout-btn');

  var topupCount = document.getElementById('topup-count');
  var topupTotal = document.getElementById('topup-total');
  var chargeCount = document.getElementById('charge-count');
  var chargeTotal = document.getElementById('charge-total');
  var refundCount = document.getElementById('refund-count');
  var refundTotal = document.getElementById('refund-total');
  var voidCount = document.getElementById('void-count');
  var voidTotal = document.getElementById('void-total');
  var outstandingBalance = document.getElementById('outstanding-balance');
  var netCashIn = document.getElementById('net-cash-in');
  var shiftTbody = document.getElementById('shift-tbody');
  var noShifts = document.getElementById('no-shifts');

  function showLoading() {
    loadingEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    errorBox.classList.add('hidden');
  }

  function showContent() {
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
    errorBox.classList.add('hidden');
  }

  function showError(msg) {
    loadingEl.classList.add('hidden');
    contentEl.classList.add('hidden');
    errorBox.classList.remove('hidden');
    errorMessage.textContent = msg;
  }

  function formatNum(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatTime(ts) {
    var d = new Date(ts);
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  function renderData(data) {
    var t = data.venueTotals;
    topupCount.textContent = formatNum(t.topupCount);
    topupTotal.textContent = formatNum(t.topupTotal);
    chargeCount.textContent = formatNum(t.chargeCount);
    chargeTotal.textContent = formatNum(t.chargeTotal);
    refundCount.textContent = formatNum(t.refundCount);
    refundTotal.textContent = formatNum(t.refundTotal);
    voidCount.textContent = formatNum(t.voidCount);
    voidTotal.textContent = formatNum(t.voidTotal);
    outstandingBalance.textContent = formatNum(t.outstandingBalance);
    netCashIn.textContent = formatNum(t.netCashIn);

    shiftTbody.replaceChildren();
    var summaries = data.summaries || [];
    if (summaries.length === 0) {
      noShifts.classList.remove('hidden');
    } else {
      noShifts.classList.add('hidden');
      for (var i = 0; i < summaries.length; i++) {
        var s = summaries[i];
        var tr = document.createElement('tr');
        tr.className = 'border-b border-gray-700/50 text-gray-300';

        var tdId = document.createElement('td');
        tdId.className = 'px-3 py-2 font-mono';
        tdId.textContent = s.shiftId.slice(-8);

        var tdStarted = document.createElement('td');
        tdStarted.className = 'px-3 py-2';
        tdStarted.textContent = formatTime(s.startedAt);

        var tdTopups = document.createElement('td');
        tdTopups.className = 'px-3 py-2 text-right';
        tdTopups.textContent = String(s.topupCount);

        var tdCharges = document.createElement('td');
        tdCharges.className = 'px-3 py-2 text-right';
        tdCharges.textContent = String(s.chargeCount);

        var tdRefunds = document.createElement('td');
        tdRefunds.className = 'px-3 py-2 text-right';
        tdRefunds.textContent = String(s.refundCount);

        tr.appendChild(tdId);
        tr.appendChild(tdStarted);
        tr.appendChild(tdTopups);
        tr.appendChild(tdCharges);
        tr.appendChild(tdRefunds);
        shiftTbody.appendChild(tr);
      }
    }

    showContent();
  }

  async function loadData() {
    showLoading();
    try {
      var resp = await fetch('/operator/reconciliation/data');
      if (!resp.ok) {
        showError('Failed to load data (HTTP ' + resp.status + ')');
        return;
      }
      var data = await resp.json();
      renderData(data);
    } catch (e) {
      showError('Network error: ' + (e.message || 'Could not reach server'));
    }
  }

  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  refreshBtn.addEventListener('click', loadData);
  logoutBtn.addEventListener('click', operatorLogout);

  loadData();
})();
