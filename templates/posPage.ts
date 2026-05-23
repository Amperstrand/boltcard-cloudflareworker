import { rawHtml, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderPosPage({ host, currencyLabel }: { host: string; currencyLabel?: string }): string {
  return renderTailwindPage({
    title: "POS",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased",
    styles: [
      "body { background-color: #111827; color: #f3f4f6; }",
      "#tap-overlay { transition: opacity 0.15s ease, visibility 0.15s ease; }",
      "#tap-overlay.visible { opacity: 1; visibility: visible; }",
      "#tap-overlay:not(.visible) { opacity: 0; visibility: hidden; pointer-events: none; }",
      "@keyframes pulse-ring { 0% { transform: scale(0.85); opacity: 0.8; } 100% { transform: scale(2); opacity: 0; } }",
      ".pulse-ring { animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }",
      "@keyframes nfc-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }",
      ".nfc-icon-bounce { animation: nfc-bounce 1.2s ease-in-out infinite; }",
    ].join("\n"),
    content: rawHtml`
    <div id="tap-overlay" class="fixed inset-0 z-50 flex flex-col bg-gray-900">
      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <span class="text-sm font-semibold text-emerald-500 tracking-widest">POS</span>
        <button id="overlay-cancel" type="button" class="text-sm font-semibold text-gray-500 hover:text-white transition-colors px-2 py-1">CANCEL</button>
      </div>
      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <div id="overlay-amount" class="text-5xl font-bold tracking-tight text-white leading-none mb-2">0</div>
        <div id="overlay-nfc-icon" class="nfc-icon-bounce inline-flex items-center justify-center w-20 h-20 rounded-full border-2 border-emerald-500/40 my-6 relative">
          <svg class="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/></svg>
          <div class="pulse-ring absolute inset-0 rounded-full border-2 border-emerald-500/30"></div>
        </div>
        <div id="overlay-status" class="text-lg font-bold text-emerald-400">TAP CARD TO PAY</div>
        <div id="overlay-help" class="text-sm text-gray-500 mt-2">Hold the boltcard against the back of your device</div>
      </div>
    </div>

    <div id="pos-root" data-currency-label="${currencyLabel || 'credits'}" class="flex flex-col h-[100dvh]">
      <div class="flex items-center justify-between px-4 py-1.5 shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-emerald-500 tracking-widest">POS</span>
          <button id="mode-toggle" type="button" class="text-xs font-semibold bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-400 hover:text-white transition-colors">
            MENU
          </button>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-600">Terminal: <span id="terminal-id" class="text-gray-500 font-mono">---</span></span>
          <a href="/operator/topup" class="text-xs text-gray-600 hover:text-gray-300 transition-colors">TOP-UP</a>
          <a href="/operator/refund" class="text-xs text-gray-600 hover:text-gray-300 transition-colors">REFUND</a>
        </div>
      </div>

      <div id="mode-free" class="flex flex-col flex-1 min-h-0">
        <div class="text-center py-2 shrink-0">
          <div id="amount-display" class="text-5xl font-bold tracking-tight text-white leading-none">0</div>
        </div>
        <div id="keypad" class="flex-1 grid grid-cols-3 gap-1.5 px-3 min-h-0">
          <button type="button" data-key="1" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">1</button>
          <button type="button" data-key="2" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">2</button>
          <button type="button" data-key="3" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">3</button>
          <button type="button" data-key="4" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">4</button>
          <button type="button" data-key="5" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">5</button>
          <button type="button" data-key="6" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">6</button>
          <button type="button" data-key="7" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">7</button>
          <button type="button" data-key="8" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">8</button>
          <button type="button" data-key="9" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">9</button>
          <button type="button" data-key="clear" class="keypad-btn rounded-xl bg-gray-700 hover:bg-gray-600 active:bg-gray-500 border border-gray-600 text-gray-300 text-sm font-semibold transition-colors flex items-center justify-center">CLR</button>
          <button type="button" data-key="0" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">0</button>
          <button type="button" data-key="backspace" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">&larr;</button>
        </div>
      </div>

      <div id="mode-menu" class="hidden flex-col flex-1 min-h-0 overflow-hidden">
        <div class="text-center py-2 shrink-0">
          <div id="cart-total" class="text-5xl font-bold tracking-tight text-white leading-none">0</div>
          <div id="cart-count" class="text-gray-500 text-xs mt-1"></div>
        </div>
        <div id="menu-grid" class="flex-1 overflow-y-auto px-3 py-2">
          <div id="menu-empty" class="text-center py-8">
            <p class="text-gray-500 text-sm mb-2">No menu configured</p>
            <button id="menu-edit-btn" type="button" class="text-xs text-emerald-500 hover:text-emerald-400 transition-colors">Edit menu</button>
          </div>
          <div id="menu-items" class="grid grid-cols-2 gap-2"></div>
        </div>
        <div id="cart-bar" class="hidden px-3 py-2 border-t border-gray-800">
          <div id="cart-items" class="space-y-1 max-h-32 overflow-y-auto mb-2"></div>
          <button id="cart-clear-btn" type="button" class="text-xs text-gray-500 hover:text-red-400 transition-colors">CLEAR CART</button>
        </div>
      </div>

      <div class="shrink-0 px-3 pt-2 pb-3">
        <div id="result-box" class="hidden rounded-xl border p-3 mb-2">
          <div class="flex items-start gap-2">
            <div id="result-icon" class="text-xl leading-none"></div>
            <div>
              <p id="result-title" class="font-bold text-sm"></p>
              <p id="result-message" class="text-xs mt-0.5"></p>
            </div>
          </div>
        </div>
        <button id="charge-btn" type="button" class="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-400 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-xl transition-colors">
          CHARGE
        </button>
        <button id="new-sale-btn" type="button" class="hidden w-full bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-3 px-4 rounded-xl transition-colors mt-2">
          NEW SALE
        </button>
      </div>
    </div>

    ${staticScript("pos.js")}
  `,
  });
}
