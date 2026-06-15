import { rawHtml, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderHealthPage(): string {
  return renderTailwindPage({
    title: "System Health",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased flex flex-col",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content: rawHtml`
    <div class="flex items-center justify-between px-4 py-2 shrink-0 border-b border-gray-800">
      <span class="text-sm font-semibold text-emerald-500 tracking-widest">SYSTEM HEALTH</span>
      <div class="flex items-center gap-3">
        <a href="/operator/pos" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">POS</a>
        <a href="/operator/topup" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">TOP-UP</a>
        <a href="/operator/refund" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">REFUND</a>
        <a href="/operator/reconciliation" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">RECON</a>
        <a href="/operator/cards" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">CARDS</a>
      </div>
    </div>

    <div class="flex-1 flex flex-col px-4 py-6 max-w-2xl mx-auto w-full">
      <div id="loading" class="flex-1 flex items-center justify-center">
        <p class="text-gray-500 text-sm">Loading...</p>
      </div>

      <div id="content" class="hidden flex-1 flex flex-col gap-6">
        <div class="flex items-center justify-between">
          <h1 class="text-xl font-bold text-white">System Health</h1>
          <span id="status-badge" class="px-3 py-1 rounded-full text-xs font-semibold bg-gray-700 text-gray-400">CHECKING</span>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">KV Store</p>
            <p id="kv-status" class="text-lg font-bold text-gray-400">&mdash;</p>
          </div>
          <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Durable Object</p>
            <p id="do-status" class="text-lg font-bold text-gray-400">&mdash;</p>
          </div>
          <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Version</p>
            <p id="version" class="text-sm font-mono font-bold text-gray-400">&mdash;</p>
            <p id="response-time" class="text-xs text-gray-500 mt-1">&mdash; ms</p>
          </div>
        </div>

        <div>
          <p class="text-sm font-semibold text-gray-400 mb-2">Card Overview</p>
          <div class="grid grid-cols-3 gap-3">
            <div class="bg-gray-800 border border-gray-700 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Total</p>
              <p id="card-total" class="text-2xl font-bold text-white">0</p>
            </div>
            <div class="bg-gray-800 border border-gray-700 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Active</p>
              <p id="card-active" class="text-2xl font-bold text-emerald-400">0</p>
            </div>
            <div class="bg-gray-800 border border-gray-700 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Discovered</p>
              <p id="card-discovered" class="text-2xl font-bold text-blue-400">0</p>
            </div>
            <div class="bg-gray-800 border border-gray-700 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Pending</p>
              <p id="card-pending" class="text-2xl font-bold text-amber-400">0</p>
            </div>
            <div class="bg-gray-800 border border-gray-700 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Keys Sent</p>
              <p id="card-keys-delivered" class="text-2xl font-bold text-cyan-400">0</p>
            </div>
            <div class="bg-gray-800 border border-gray-700 rounded-xl p-3 text-center">
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Terminated</p>
              <p id="card-terminated" class="text-2xl font-bold text-red-400">0</p>
            </div>
          </div>
        </div>

        <div>
          <p class="text-sm font-semibold text-gray-400 mb-2">Financial Summary</p>
          <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-2">
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-400">Top-ups</span>
              <span><span id="fin-topup-count" class="text-sm text-gray-500">0</span><span class="text-gray-600 mx-1">\u00d7</span><span id="fin-topup-total" class="text-base font-bold text-emerald-400">0</span></span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-400">Charges</span>
              <span><span id="fin-charge-count" class="text-sm text-gray-500">0</span><span class="text-gray-600 mx-1">\u00d7</span><span id="fin-charge-total" class="text-base font-bold text-blue-400">0</span></span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-400">Refunds</span>
              <span><span id="fin-refund-count" class="text-sm text-gray-500">0</span><span class="text-gray-600 mx-1">\u00d7</span><span id="fin-refund-total" class="text-base font-bold text-amber-400">0</span></span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-400">Voids</span>
              <span><span id="fin-void-count" class="text-sm text-gray-500">0</span><span class="text-gray-600 mx-1">\u00d7</span><span id="fin-void-total" class="text-base font-bold text-red-400">0</span></span>
            </div>
            <div class="flex justify-between items-center pt-2 border-t border-gray-700">
              <span class="text-sm text-gray-400">Outstanding Balance</span>
              <span id="fin-outstanding" class="text-base font-bold text-white">0</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-400">Net Cash In</span>
              <span id="fin-net-cash" class="text-base font-bold text-emerald-400">0</span>
            </div>
          </div>
        </div>

        <div>
          <p class="text-sm font-semibold text-gray-400 mb-2">Recent Activity</p>
          <div class="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-gray-700 text-gray-500">
                  <th class="px-3 py-2 text-left">Time</th>
                  <th class="px-3 py-2 text-left">Action</th>
                  <th class="px-3 py-2 text-left">UID</th>
                  <th class="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody id="events-tbody"></tbody>
            </table>
            <p id="no-events" class="hidden text-gray-600 text-xs text-center py-4">No recent activity</p>
          </div>
        </div>
      </div>

      <div id="error-box" class="hidden flex-1 flex items-center justify-center">
        <p id="error-message" class="text-red-400 text-sm"></p>
      </div>
    </div>

    <div class="shrink-0 px-4 py-2 border-t border-gray-800 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span id="last-updated" class="text-xs text-gray-600">&mdash;</span>
        <span class="text-xs text-gray-700">Auto-refresh: 30s</span>
      </div>
      <div class="flex items-center gap-3">
        <button id="refresh-btn" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">REFRESH</button>
        <button id="logout-btn" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">LOGOUT</button>
      </div>
    </div>

    ${staticScript("health.js")}
    `,
  });
}
