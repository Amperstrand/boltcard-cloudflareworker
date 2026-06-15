import { rawHtml, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderReconciliationPage({ host, currencyLabel }: { host: string; currencyLabel?: string }): string {
  return renderTailwindPage({
    title: "Reconciliation",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased flex flex-col",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content: rawHtml`
    <div class="flex items-center justify-between px-4 py-2 shrink-0 border-b border-gray-800">
      <span class="text-sm font-semibold text-emerald-500 tracking-widest">RECONCILIATION</span>
      <div class="flex items-center gap-3">
        <a href="/operator/pos" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">POS</a>
        <a href="/operator/refund" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">REFUND</a>
        <a href="/operator/topup" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">TOP-UP</a>
      </div>
    </div>

    <div class="flex-1 flex flex-col px-4 py-6 max-w-lg mx-auto w-full">
      <div id="loading" class="flex-1 flex items-center justify-center">
        <p class="text-gray-500 text-sm">Loading...</p>
      </div>

      <div id="content" class="hidden flex-1 flex flex-col gap-6">
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Top-ups</p>
            <p id="topup-count" class="text-sm text-gray-400">0</p>
            <p id="topup-total" class="text-xl font-bold text-emerald-400">0 ${currencyLabel || "credits"}</p>
          </div>
          <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Charges</p>
            <p id="charge-count" class="text-sm text-gray-400">0</p>
            <p id="charge-total" class="text-xl font-bold text-blue-400">0 ${currencyLabel || "credits"}</p>
          </div>
          <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Refunds</p>
            <p id="refund-count" class="text-sm text-gray-400">0</p>
            <p id="refund-total" class="text-xl font-bold text-amber-400">0 ${currencyLabel || "credits"}</p>
          </div>
          <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Voids</p>
            <p id="void-count" class="text-sm text-gray-400">0</p>
            <p id="void-total" class="text-xl font-bold text-red-400">0 ${currencyLabel || "credits"}</p>
          </div>
        </div>

        <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-2">
          <div class="flex justify-between items-center">
            <span class="text-sm text-gray-400">Outstanding Balance</span>
            <span id="outstanding-balance" class="text-lg font-bold text-white">0</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-sm text-gray-400">Net Cash In</span>
            <span id="net-cash-in" class="text-lg font-bold text-emerald-400">0</span>
          </div>
          <div class="flex justify-between items-center pt-2 border-t border-gray-700">
            <span class="text-sm text-gray-400">Variance</span>
            <span id="variance" class="text-lg font-bold text-gray-400">0</span>
          </div>
        </div>

        <p id="as-of" class="text-xs text-gray-600 text-center -mt-3"></p>

        <div>
          <p class="text-sm font-semibold text-gray-400 mb-2">Per-Shift Breakdown</p>
          <div id="shift-table-wrap" class="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-gray-700 text-gray-500">
                  <th class="px-3 py-2 text-left">Shift</th>
                  <th class="px-3 py-2 text-left">Started</th>
                  <th class="px-3 py-2 text-right">Topups</th>
                  <th class="px-3 py-2 text-right">Charges</th>
                  <th class="px-3 py-2 text-right">Refunds</th>
                </tr>
              </thead>
              <tbody id="shift-tbody"></tbody>
            </table>
            <p id="no-shifts" class="hidden text-gray-600 text-xs text-center py-4">No shifts recorded</p>
          </div>
        </div>
      </div>

      <div id="error-box" class="hidden flex-1 flex items-center justify-center">
        <p id="error-message" class="text-red-400 text-sm"></p>
      </div>
    </div>

    <div class="shrink-0 px-4 py-2 border-t border-gray-800 flex items-center justify-between">
      <button id="refresh-btn" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">REFRESH</button>
      <button id="logout-btn" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">LOGOUT</button>
    </div>

    ${staticScript("reconciliation.js")}
  `,
  });
}
