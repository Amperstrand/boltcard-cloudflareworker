import { rawHtml, safe } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderRefundPage({ host, currencyLabel }: { host: string; currencyLabel?: string }): string {
  return renderTailwindPage({
    title: "Refund",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased flex flex-col",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content: rawHtml`
    <div class="flex items-center justify-between px-4 py-2 shrink-0 border-b border-gray-800">
      <span class="text-sm font-semibold text-emerald-500 tracking-widest">REFUND</span>
      <div class="flex items-center gap-3">
        <a href="/operator/topup" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">TOP-UP</a>
        <a href="/operator/pos" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">POS</a>
        <a href="/debug" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">DEBUG</a>
      </div>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center px-6">
      <p class="text-gray-500 text-sm mb-6">Tap card to check balance, then issue refund</p>

      <div id="card-info" class="hidden w-full max-w-xs bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6">
        <div class="text-center mb-4">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Current Balance</p>
          <div id="card-balance" class="text-5xl font-bold text-white">0</div>
          <div class="text-gray-500 text-sm">${currencyLabel || "credits"}</div>
        </div>
      </div>

      <div id="refund-options" class="hidden w-full max-w-xs space-y-3 mb-6">
        <button id="full-refund-btn" type="button" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded-xl transition-colors">
          FULL REFUND
        </button>
        <div class="flex items-center gap-2">
          <input type="number" id="partial-amount" placeholder="Partial amount" min="1"
            class="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-200 text-sm focus:border-emerald-500 focus:outline-none" />
          <button id="partial-refund-btn" type="button" class="bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2 px-4 rounded transition-colors text-sm">
            REFUND
          </button>
        </div>
      </div>

      <div id="nfc-btn-area" class="w-full max-w-xs mb-4">
        <button id="nfc-tap-btn" type="button" class="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-4 px-4 rounded-xl transition-colors text-lg">
          SCANNING FOR CARD...
        </button>
      </div>

      <div id="result-box" class="hidden w-full max-w-xs rounded-xl border p-4 mb-4">
        <div class="flex items-start gap-3">
          <div id="result-icon" class="text-2xl leading-none"></div>
          <div>
            <p id="result-title" class="font-bold text-sm"></p>
            <p id="result-message" class="text-xs mt-0.5"></p>
          </div>
        </div>
      </div>
    </div>

    <div class="shrink-0 px-4 py-2 border-t border-gray-800 flex justify-end">
      <button id="logout-btn" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">LOGOUT</button>
    </div>

    ${safe('<script src="/static/js/nfc.js"></script>')}${safe('<script src="/static/js/refund.js"></script>')}
  `,
  });
}
