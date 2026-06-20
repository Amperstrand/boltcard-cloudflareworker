import { rawHtml, safe, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderVirtualCardPage(): string {
  const content: string = rawHtml`
  <main class="max-w-lg mx-auto">
    <div class="text-center mb-6">
      <h1 class="text-2xl font-bold text-indigo-400 tracking-tight mb-1">Virtual Card</h1>
      <p class="text-gray-500 text-sm">Simulate a bolt card without physical NFC hardware</p>
    </div>

    <div id="vc-banner" class="hidden mb-4 bg-indigo-900/30 border border-indigo-500/30 rounded-xl p-4">
      <div class="flex items-start gap-3">
        <span class="text-indigo-400 text-xl">\u{1f4cb}</span>
        <div>
          <p class="text-indigo-300 font-bold text-sm">Simulation mode active</p>
          <p class="text-indigo-200/70 text-xs mt-1">A floating "Virtual Tap" button appears on all pages. Press it to simulate tapping your card.</p>
        </div>
      </div>
    </div>

    <div id="vc-no-card" class="bg-gray-800 border border-gray-700 rounded-2xl p-6 text-center">
      <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
        <span class="text-3xl">\u{1f4cb}</span>
      </div>
      <h2 class="text-lg font-bold text-gray-100 mb-2">No Virtual Card</h2>
      <p class="text-gray-500 text-sm mb-6">Create a virtual NTAG424 card to experience the full app. Your card will be stored in this browser's local storage.</p>
      <button id="vc-create-btn" type="button" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        Create Virtual Card
      </button>
      <div id="vc-create-status" class="hidden mt-3 text-sm"></div>
    </div>

    <div id="vc-card-details" class="hidden bg-gray-800 border border-gray-700 rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-gray-100">Your Virtual Card</h2>
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
          <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
          Active
        </span>
      </div>

      <div class="space-y-3 text-sm mb-6">
        <div class="flex justify-between items-center py-2 border-b border-gray-700/50">
          <span class="text-gray-500">UID</span>
          <span id="vc-uid" class="font-mono text-amber-300 text-xs">--</span>
        </div>
        <div class="flex justify-between items-center py-2 border-b border-gray-700/50">
          <span class="text-gray-500">Counter</span>
          <span id="vc-counter" class="font-mono text-cyan-300">--</span>
        </div>
        <div class="flex justify-between items-center py-2 border-b border-gray-700/50">
          <span class="text-gray-500">K1 (Encryption)</span>
          <span id="vc-k1" class="font-mono text-purple-300 text-xs">--</span>
        </div>
        <div class="flex justify-between items-center py-2 border-b border-gray-700/50">
          <span class="text-gray-500">K2 (MAC)</span>
          <span id="vc-k2" class="font-mono text-purple-300 text-xs">--</span>
        </div>
        <div class="flex justify-between items-center py-2">
          <span class="text-gray-500">Created</span>
          <span id="vc-created" class="text-gray-400 text-xs">--</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 mb-4">
        <a href="/card" class="text-center bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors">
          Card Dashboard
        </a>
        <a href="/operator/topup" class="text-center bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-colors">
          Top Up
        </a>
        <a href="/operator/pos" class="text-center bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors">
          POS Terminal
        </a>
        <a href="/operator/refund" class="text-center bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors">
          Refund Desk
        </a>
        <a href="/login" class="text-center bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors">
          NFC Login
        </a>
        <a href="/identity" class="text-center bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors">
          Identity
        </a>
      </div>

      <button id="vc-tap-btn" type="button" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-sm transition-colors mb-3">
        Tap Virtual Card
      </button>

      <button id="vc-delete-btn" type="button" class="w-full bg-red-900/50 hover:bg-red-800/50 text-red-300 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors border border-red-700/50">
        Delete Virtual Card
      </button>
      <div id="vc-delete-confirm" class="hidden mt-3 bg-red-900/30 border border-red-600/40 rounded-xl p-4">
        <p class="text-red-200 text-sm mb-3">This will remove the virtual card from this browser. Any balance on the card will remain in the server but you won't be able to access it without the keys.</p>
        <div class="flex gap-2">
          <button id="vc-delete-confirm-btn" type="button" class="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-xl text-xs transition-colors">Confirm Delete</button>
          <button id="vc-delete-cancel" type="button" class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2 px-4 rounded-xl text-xs transition-colors">Cancel</button>
        </div>
      </div>
    </div>

    <div class="mt-6 bg-gray-800/50 border border-gray-700/50 rounded-2xl p-4">
      <h3 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">How It Works</h3>
      <ol class="space-y-2 text-xs text-gray-400">
        <li class="flex gap-2"><span class="text-indigo-400 font-bold">1.</span><span>Create a virtual card — keys are generated server-side and stored in your browser's localStorage.</span></li>
        <li class="flex gap-2"><span class="text-indigo-400 font-bold">2.</span><span>Navigate to any NFC page. A floating "Virtual Tap" button will appear.</span></li>
        <li class="flex gap-2"><span class="text-indigo-400 font-bold">3.</span><span>Press the button to simulate tapping your card. Real AES-ECB/CMAC encryption is used.</span></li>
        <li class="flex gap-2"><span class="text-indigo-400 font-bold">4.</span><span>The page responds exactly as if you tapped a physical card.</span></li>
      </ol>
    </div>
  </main>

  <script src="https://cdn.jsdelivr.net/npm/aes-js@3.1.2/index.js"></script>

  ${staticScript("helpers.js")}
  ${staticScript("virtual-card-page.js")}
  `;

  return renderTailwindPage({
    title: "Virtual Card",
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content,
  });
}
