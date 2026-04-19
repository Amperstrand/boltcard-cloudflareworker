import { getAnalytics } from "../replayProtection.js";
import { htmlResponse } from "../utils/responses.js";

export async function handleAnalyticsPage(request) {
  return htmlResponse(analyticsPageHtml);
}

export async function handleAnalyticsData(request, env) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");

  if (!uid) {
    return new Response(JSON.stringify({ error: "Missing uid parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const analytics = await getAnalytics(env, uid);
  return new Response(JSON.stringify(analytics), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function formatMsat(msat) {
  if (!msat || msat === 0) return "0 sats";
  const sats = msat / 1000;
  if (sats < 1) return msat + " msat";
  if (sats < 1000) return sats.toFixed(sats % 1 === 0 ? 0 : 3) + " sats";
  return (sats / 10000000).toFixed(8) + " BTC";
}

const analyticsPageHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bolt Card Analytics</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #111827; color: #f3f4f6; }
  </style>
</head>
<body class="min-h-screen p-4 md:p-8 font-sans antialiased">

  <div class="max-w-2xl mx-auto">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-emerald-500 tracking-tight mb-2">ANALYTICS</h1>
      <p class="text-gray-400 text-sm">Payment analytics for bolt cards</p>
    </div>

    <div class="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6">
      <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Lookup</p>
      <div class="flex gap-2">
        <input id="uid-input" type="text" placeholder="UID hex (e.g. 04996c6a926980)" class="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono text-gray-300 focus:border-emerald-500 focus:outline-none" />
        <button onclick="loadAnalytics()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded text-sm transition-colors">Load</button>
      </div>
      <p id="lookup-error" class="text-red-400 text-xs mt-2 hidden"></p>
    </div>

    <div id="analytics-content" class="hidden">
      <p class="text-xs text-gray-500 font-mono mb-4">UID: <span id="display-uid"></span></p>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Paid</p>
          <p id="stat-completed" class="text-lg font-bold text-emerald-400">0 sats</p>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Failed</p>
          <p id="stat-failed" class="text-lg font-bold text-red-400">0 sats</p>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Pending</p>
          <p id="stat-pending" class="text-lg font-bold text-yellow-400">0 sats</p>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Taps</p>
          <p id="stat-taps" class="text-lg font-bold text-gray-200">0</p>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Breakdown</p>
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-emerald-500"></span>
              <span class="text-sm text-gray-300">Completed</span>
            </div>
            <div class="flex items-center gap-3">
              <span id="breakdown-completed-count" class="text-xs text-gray-500">0 taps</span>
              <span id="breakdown-completed-amount" class="text-sm font-mono text-emerald-400">0 sats</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-red-500"></span>
              <span class="text-sm text-gray-300">Failed</span>
            </div>
            <div class="flex items-center gap-3">
              <span id="breakdown-failed-count" class="text-xs text-gray-500">0 taps</span>
              <span id="breakdown-failed-amount" class="text-sm font-mono text-red-400">0 sats</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-yellow-500"></span>
              <span class="text-sm text-gray-300">Pending</span>
            </div>
            <div class="flex items-center gap-3">
              <span id="breakdown-pending-count" class="text-xs text-gray-500">0 taps</span>
              <span id="breakdown-pending-amount" class="text-sm font-mono text-yellow-400">0 sats</span>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Success Rate</p>
        <div class="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
          <div id="success-bar" class="bg-emerald-500 h-4 rounded-full transition-all duration-500" style="width:0%"></div>
        </div>
        <p id="success-rate" class="text-sm text-gray-400 mt-2 text-center">-</p>
      </div>
    </div>

    <p class="text-center text-xs text-gray-600 mt-8">
      <a href="/login" class="text-gray-500 hover:text-emerald-400 transition-colors">NFC Login</a>
      <span class="mx-2">|</span>
      <a href="/" class="text-gray-500 hover:text-emerald-400 transition-colors">Home</a>
    </p>
  </div>

  <script>
    function formatMsat(msat) {
      if (!msat || msat === 0) return '0 sats';
      var sats = msat / 1000;
      if (sats < 1) return msat + ' msat';
      if (sats < 1000) return (sats % 1 === 0 ? sats : sats.toFixed(3)) + ' sats';
      return (sats / 1e8).toFixed(8) + ' BTC';
    }

    async function loadAnalytics() {
      var uid = document.getElementById('uid-input').value.trim().toLowerCase();
      var errEl = document.getElementById('lookup-error');
      errEl.classList.add('hidden');

      if (!uid || !/^[0-9a-f]{14}$/.test(uid)) {
        errEl.textContent = 'Invalid UID — must be 14 hex characters';
        errEl.classList.remove('hidden');
        return;
      }

      try {
        var resp = await fetch('/analytics/data?uid=' + uid);
        if (!resp.ok) {
          errEl.textContent = 'Failed to load analytics (HTTP ' + resp.status + ')';
          errEl.classList.remove('hidden');
          return;
        }
        var data = await resp.json();
        renderAnalytics(uid, data);
      } catch (e) {
        errEl.textContent = 'Error: ' + e.message;
        errEl.classList.remove('hidden');
      }
    }

    function renderAnalytics(uid, d) {
      document.getElementById('display-uid').textContent = uid.toUpperCase();
      document.getElementById('stat-completed').textContent = formatMsat(d.completedMsat || 0);
      document.getElementById('stat-failed').textContent = formatMsat(d.failedMsat || 0);
      document.getElementById('stat-pending').textContent = formatMsat(d.pendingMsat || 0);
      document.getElementById('stat-taps').textContent = d.totalTaps || 0;

      document.getElementById('breakdown-completed-count').textContent = (d.completedTaps || 0) + ' taps';
      document.getElementById('breakdown-completed-amount').textContent = formatMsat(d.completedMsat || 0);
      document.getElementById('breakdown-failed-count').textContent = (d.failedTaps || 0) + ' taps';
      document.getElementById('breakdown-failed-amount').textContent = formatMsat(d.failedMsat || 0);
      document.getElementById('breakdown-pending-count').textContent = (d.pendingTaps || 0) + ' taps';
      document.getElementById('breakdown-pending-amount').textContent = formatMsat(d.pendingMsat || 0);

      var total = d.totalTaps || 0;
      var completed = d.completedTaps || 0;
      var rate = total > 0 ? Math.round((completed / total) * 100) : 0;
      document.getElementById('success-bar').style.width = rate + '%';
      document.getElementById('success-rate').textContent = completed + ' / ' + total + ' (' + rate + '%)';

      document.getElementById('analytics-content').classList.remove('hidden');
    }

    var params = new URLSearchParams(window.location.search);
    var prefill = params.get('uid');
    if (prefill) {
      document.getElementById('uid-input').value = prefill;
      loadAnalytics();
    }
  </script>
</body>
</html>`;
