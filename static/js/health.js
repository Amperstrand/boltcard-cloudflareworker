// health.js — classic script (no import/export)

(function() {
  var loadingEl = document.getElementById('loading');
  var contentEl = document.getElementById('content');
  var errorBox = document.getElementById('error-box');
  var errorMessage = document.getElementById('error-message');
  var refreshBtn = document.getElementById('refresh-btn');
  var logoutBtn = document.getElementById('logout-btn');
  var lastUpdatedEl = document.getElementById('last-updated');

  var statusBadge = document.getElementById('status-badge');
  var kvStatus = document.getElementById('kv-status');
  var doStatus = document.getElementById('do-status');
  var versionEl = document.getElementById('version');
  var responseTimeEl = document.getElementById('response-time');

  var cardTotal = document.getElementById('card-total');
  var cardActive = document.getElementById('card-active');
  var cardDiscovered = document.getElementById('card-discovered');
  var cardPending = document.getElementById('card-pending');
  var cardKeysDelivered = document.getElementById('card-keys-delivered');
  var cardTerminated = document.getElementById('card-terminated');

  var finTopupCount = document.getElementById('fin-topup-count');
  var finTopupTotal = document.getElementById('fin-topup-total');
  var finChargeCount = document.getElementById('fin-charge-count');
  var finChargeTotal = document.getElementById('fin-charge-total');
  var finRefundCount = document.getElementById('fin-refund-count');
  var finRefundTotal = document.getElementById('fin-refund-total');
  var finVoidCount = document.getElementById('fin-void-count');
  var finVoidTotal = document.getElementById('fin-void-total');
  var finOutstanding = document.getElementById('fin-outstanding');
  var finNetCash = document.getElementById('fin-net-cash');

  var eventsTbody = document.getElementById('events-tbody');
  var noEvents = document.getElementById('no-events');

  var refreshTimer = null;
  var firstLoad = true;
  var REFRESH_INTERVAL = 30000;

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
    return Number(n || 0).toLocaleString();
  }

  function formatClock(ms) {
    var d = new Date(ms);
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
    return h + ':' + m + ':' + s;
  }

  function relativeTime(epochSec) {
    var now = Math.floor(Date.now() / 1000);
    var diff = now - epochSec;
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function setStatusBadge(overall) {
    var label, cls;
    if (overall === 'healthy') {
      label = 'HEALTHY';
      cls = 'px-3 py-1 rounded-full text-xs font-semibold bg-emerald-900/50 border border-emerald-700 text-emerald-400';
    } else if (overall === 'degraded') {
      label = 'DEGRADED';
      cls = 'px-3 py-1 rounded-full text-xs font-semibold bg-amber-900/50 border border-amber-700 text-amber-400';
    } else {
      label = 'DOWN';
      cls = 'px-3 py-1 rounded-full text-xs font-semibold bg-red-900/50 border border-red-700 text-red-400';
    }
    statusBadge.textContent = label;
    statusBadge.className = cls;
  }

  function renderSystemIndicator(el, status) {
    if (status === 'ok') {
      el.textContent = '\u2713 OK';
      el.className = 'text-lg font-bold text-emerald-400';
    } else {
      el.textContent = '\u2717 ERROR';
      el.className = 'text-lg font-bold text-red-400';
    }
  }

  function actionLabel(action) {
    var labels = {
      topup: 'Top-up',
      charge: 'Charge',
      refund: 'Refund',
      void: 'Void',
      terminate: 'Terminate',
      wipe: 'Wipe',
      activate: 'Activate'
    };
    return labels[action] || action;
  }

  function actionColor(action) {
    var colors = {
      topup: 'text-emerald-400',
      charge: 'text-blue-400',
      refund: 'text-amber-400',
      void: 'text-red-400',
      terminate: 'text-red-400',
      wipe: 'text-orange-400',
      activate: 'text-cyan-400'
    };
    return colors[action] || 'text-gray-300';
  }

  function renderData(data) {
    var sys = data.system || {};
    setStatusBadge(sys.overall || 'down');
    renderSystemIndicator(kvStatus, sys.kv);
    renderSystemIndicator(doStatus, sys.durableObject);

    versionEl.textContent = data.version || '\u2014';
    if (data.responseTimeMs != null) {
      responseTimeEl.textContent = data.responseTimeMs + ' ms';
    }

    var c = data.cards || {};
    cardTotal.textContent = formatNum(c.total);
    cardActive.textContent = formatNum(c.active);
    cardDiscovered.textContent = formatNum(c.discovered);
    cardPending.textContent = formatNum(c.pending);
    cardKeysDelivered.textContent = formatNum(c.keys_delivered);
    cardTerminated.textContent = formatNum(c.terminated);

    var f = data.financials || {};
    finTopupCount.textContent = formatNum(f.topupCount);
    finTopupTotal.textContent = formatNum(f.topupTotal);
    finChargeCount.textContent = formatNum(f.chargeCount);
    finChargeTotal.textContent = formatNum(f.chargeTotal);
    finRefundCount.textContent = formatNum(f.refundCount);
    finRefundTotal.textContent = formatNum(f.refundTotal);
    finVoidCount.textContent = formatNum(f.voidCount);
    finVoidTotal.textContent = formatNum(f.voidTotal);
    finOutstanding.textContent = formatNum(f.outstandingBalance);
    finNetCash.textContent = formatNum(f.netCashIn);

    eventsTbody.replaceChildren();
    var events = data.recentEvents || [];
    if (events.length === 0) {
      noEvents.classList.remove('hidden');
    } else {
      noEvents.classList.add('hidden');
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var tr = document.createElement('tr');
        tr.className = 'border-b border-gray-700/50 text-gray-300';

        var tdTime = document.createElement('td');
        tdTime.className = 'px-3 py-2';
        tdTime.textContent = ev.timestamp ? relativeTime(ev.timestamp) : '\u2014';

        var tdAction = document.createElement('td');
        tdAction.className = 'px-3 py-2 font-semibold ' + actionColor(ev.action);
        tdAction.textContent = actionLabel(ev.action);

        var tdUid = document.createElement('td');
        tdUid.className = 'px-3 py-2 font-mono text-gray-500';
        tdUid.textContent = ev.uid ? ev.uid.slice(0, 8) : '\u2014';

        var tdAmount = document.createElement('td');
        tdAmount.className = 'px-3 py-2 text-right';
        if (ev.details && ev.details.amount != null) {
          tdAmount.textContent = formatNum(ev.details.amount);
        } else {
          tdAmount.textContent = '\u2014';
        }

        tr.appendChild(tdTime);
        tr.appendChild(tdAction);
        tr.appendChild(tdUid);
        tr.appendChild(tdAmount);
        eventsTbody.appendChild(tr);
      }
    }

    lastUpdatedEl.textContent = 'Updated ' + formatClock(Date.now());
    showContent();
  }

  async function loadData() {
    if (firstLoad) {
      showLoading();
    }
    try {
      var resp = await fetch('/operator/health/data');
      if (!resp.ok) {
        showError('Failed to load data (HTTP ' + resp.status + ')');
        return;
      }
      var data = await resp.json();
      renderData(data);
      firstLoad = false;
    } catch (e) {
      showError('Network error: ' + (e.message || 'Could not reach server'));
    }
  }

  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadData, REFRESH_INTERVAL);
  }

  refreshBtn.addEventListener('click', loadData);
  logoutBtn.addEventListener('click', operatorLogout);

  loadData();
  startAutoRefresh();
})();
