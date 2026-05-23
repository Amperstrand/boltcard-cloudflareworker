import { rawHtml, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderTopupPage({ host, currencyLabel }: { host: string; currencyLabel?: string }): string {
  return renderTailwindPage({
    title: "Top-Up",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased flex flex-col",
    styles: [
      "body { background-color: #111827; color: #f3f4f6; }",
      "#wedge-input { caret-color: transparent; }",
    ].join("\n"),
    content: rawHtml`
    <div class="flex items-center justify-between px-4 py-2 shrink-0 border-b border-gray-800">
      <a href="/operator/pos" class="text-sm font-semibold text-emerald-500 tracking-widest hover:text-emerald-400 transition-colors">TOP-UP</a>
      <div class="flex items-center gap-3">
        <a href="/operator/refund" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">REFUND</a>
        <a href="/operator/pos" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">POS</a>
        <a href="/debug" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">DEBUG</a>
      </div>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center px-6">
      <p class="text-gray-500 text-sm mb-4">Enter amount, then tap card to credit</p>

      <div class="text-center mb-6">
        <div id="amount-display" class="text-6xl font-bold tracking-tight text-white leading-none">0</div>
        <div class="text-gray-500 text-sm mt-1">${currencyLabel || "credits"}</div>
      </div>

      <div id="keypad" class="grid grid-cols-3 gap-2 w-full max-w-xs mb-6">
        <button type="button" data-key="1" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">1</button>
        <button type="button" data-key="2" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">2</button>
        <button type="button" data-key="3" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">3</button>
        <button type="button" data-key="4" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">4</button>
        <button type="button" data-key="5" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">5</button>
        <button type="button" data-key="6" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">6</button>
        <button type="button" data-key="7" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">7</button>
        <button type="button" data-key="8" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">8</button>
        <button type="button" data-key="9" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">9</button>
        <button type="button" data-key="clear" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-sm font-semibold transition-colors">CLR</button>
        <button type="button" data-key="0" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">0</button>
        <button type="button" data-key="backspace" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">&larr;</button>
      </div>

      <div id="wedge-area" class="w-full max-w-xs mb-4 hidden">
        <input type="text" id="wedge-input" autocomplete="off" autofocus
          class="w-full bg-gray-800 border border-dashed border-gray-600 rounded-lg px-3 py-2 text-gray-400 text-sm text-center focus:outline-none focus:border-emerald-500"
          placeholder="Tap USB NFC reader or scan card..." />
        <p class="text-gray-600 text-xs text-center mt-1">USB NFC reader mode</p>
      </div>

      <div id="nfc-btn-area" class="w-full max-w-xs mb-4">
        <button id="nfc-tap-btn" type="button" class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 px-4 rounded-xl transition-colors text-lg">
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

    <div class="shrink-0 px-4 py-2 border-t border-gray-800 flex items-center justify-between">
      <button id="toggle-wedge" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">USB READER</button>
      <button id="logout-btn" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">LOGOUT</button>
    </div>

    ${staticScript("topup.js")}
  `,
  });
}
