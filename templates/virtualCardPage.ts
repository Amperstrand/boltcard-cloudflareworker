import { rawHtml, safe, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderVirtualCardContent(opts?: { embed?: boolean }): string {
  const embed = opts?.embed === true;

  return rawHtml`
    <!-- ═══════════════ NO CARD STATE ═══════════════ -->

    <div id="vc-no-card" class="bg-gray-800 border border-gray-700 rounded-2xl p-6 text-center">
      <div class="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center">
        <svg class="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776"/>
        </svg>
      </div>
      <h2 class="text-lg font-bold text-gray-100 mb-2">No Virtual Card</h2>
      <p class="text-gray-500 text-sm mb-6">Create a virtual NTAG424 card to simulate taps with real AES-ECB/CMAC encryption. Keys are generated server-side and stored in your browser.</p>
      <button id="vc-create-btn" type="button" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        Create Virtual Card
      </button>
      <div id="vc-create-status" class="hidden mt-3 text-sm"></div>
    </div>

    <!-- ═══════════════ CARD DETAILS STATE ═══════════════ -->

    <div id="vc-card-details" class="hidden space-y-4">

      <!-- ──── Visual Card ──── -->
      <div id="vc-card-visual" class="relative rounded-2xl p-5 overflow-hidden" style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 35%, #4c1d95 70%, #5b21b6 100%);">
        <div class="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/5"></div>
        <div class="absolute -bottom-12 -left-4 w-24 h-24 rounded-full bg-white/5"></div>

        <div class="relative flex items-start justify-between mb-4">
          <div class="flex items-center gap-2">
            <div class="w-9 h-7 rounded-md bg-gradient-to-br from-yellow-400/80 to-yellow-600/80 flex items-center justify-center shadow-inner">
              <div class="grid grid-cols-3 gap-px w-5 h-4">
                <div class="bg-yellow-900/40 rounded-sm"></div><div class="bg-yellow-900/40 rounded-sm"></div><div class="bg-yellow-900/40 rounded-sm"></div>
                <div class="bg-yellow-900/40 rounded-sm"></div><div class="bg-yellow-900/40 rounded-sm col-span-1"></div><div class="bg-yellow-900/40 rounded-sm"></div>
                <div class="bg-yellow-900/40 rounded-sm"></div><div class="bg-yellow-900/40 rounded-sm"></div><div class="bg-yellow-900/40 rounded-sm"></div>
              </div>
            </div>
            <span class="text-indigo-200/60 text-[10px] font-semibold uppercase tracking-widest">NTAG424</span>
          </div>
          <span id="vc-state-badge" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span id="vc-state-text">Active</span>
          </span>
        </div>

        <div class="relative mb-3">
          <div class="text-indigo-300/50 text-[10px] font-bold uppercase tracking-wider mb-1">Card UID</div>
          <div id="vc-uid" class="font-mono text-xl text-white tracking-wider break-all">--</div>
        </div>

        <div class="relative flex items-center gap-6">
          <div>
            <div class="text-indigo-300/50 text-[10px] font-bold uppercase tracking-wider mb-0.5">Counter</div>
            <div id="vc-counter" class="font-mono text-lg text-cyan-300 font-bold">--</div>
          </div>
          <div>
            <div class="text-indigo-300/50 text-[10px] font-bold uppercase tracking-wider mb-0.5">Version</div>
            <div id="vc-version" class="font-mono text-lg text-purple-300 font-bold">1</div>
          </div>
          <div>
            <div class="text-indigo-300/50 text-[10px] font-bold uppercase tracking-wider mb-0.5">Created</div>
            <div id="vc-created" class="text-indigo-200/70 text-xs">--</div>
          </div>
        </div>
      </div>

      <!-- ──── Keys (collapsible) ──── -->
      <div class="bg-gray-800 border border-gray-700 rounded-2xl overflow-hidden">
        <button id="vc-keys-toggle" type="button" class="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-750 transition-colors">
          <span class="flex items-center gap-2">
            <svg class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H7.5v-3l1.615-1.615c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"/></svg>
            Encryption Keys
          </span>
          <svg id="vc-keys-chevron" class="w-4 h-4 text-gray-500 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
        </button>
        <div id="vc-keys-content" class="hidden px-4 pb-4 space-y-3 border-t border-gray-700/50">
          <div class="pt-3">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">K1 (Encryption)</span>
              <button type="button" class="vc-copy-btn text-xs text-indigo-400 hover:text-indigo-300 transition-colors" data-target="vc-k1-full">Copy</button>
            </div>
            <div id="vc-k1-full" class="font-mono text-xs text-purple-300 bg-gray-900/60 rounded-lg p-2 break-all select-all">--</div>
          </div>
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">K2 (MAC / CMAC)</span>
              <button type="button" class="vc-copy-btn text-xs text-indigo-400 hover:text-indigo-300 transition-colors" data-target="vc-k2-full">Copy</button>
            </div>
            <div id="vc-k2-full" class="font-mono text-xs text-purple-300 bg-gray-900/60 rounded-lg p-2 break-all select-all">--</div>
          </div>
          <div class="pt-2 border-t border-gray-700/50">
            <div class="text-xs text-gray-500">Last tap generated: <span id="vc-last-params" class="font-mono text-gray-400">none yet</span></div>
          </div>
        </div>
      </div>

      <!-- ──── Tap Simulator ──── -->
      <div class="bg-gray-800 border border-gray-700 rounded-2xl p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-gray-300">Tap Simulator</h3>
          <span class="text-[10px] text-gray-500 uppercase tracking-wider">Real AES-ECB + CMAC</span>
        </div>

        <div>
          <label for="vc-destination" class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Destination</label>
          <select id="vc-destination" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors">
            <option value="lnurlw">LNURL Withdraw (card tap entry)</option>
            <option value="topup">Top-up Desk</option>
            <option value="pos">POS Charge</option>
            <option value="refund">Refund Desk</option>
            <option value="balance">Balance Check</option>
            <option value="cardinfo">Card Info / Status</option>
          </select>
        </div>

        <div id="vc-amount-row" class="hidden">
          <label for="vc-amount" class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Amount (msat)</label>
          <input id="vc-amount" type="number" min="1" placeholder="e.g. 10000" class="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors" />
        </div>

        <div class="flex gap-2 pt-1">
          <button id="vc-tap-btn" type="button" class="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
            Simulate Tap
          </button>
          <button id="vc-auto-btn" type="button" class="px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
            Auto-Test
          </button>
        </div>

        <div id="vc-status" class="hidden rounded-xl border px-4 py-3 text-sm font-semibold"></div>
      </div>

      <!-- ──── Tap History Log ──── -->
      <div class="bg-gray-800 border border-gray-700 rounded-2xl p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-gray-300">Tap History</h3>
          <button id="vc-clear-log" type="button" class="text-xs text-gray-500 hover:text-gray-400 transition-colors">Clear</button>
        </div>
        <div id="vc-tap-log" class="max-h-96 overflow-y-auto space-y-1 text-sm">
          <div class="text-gray-600 text-xs italic text-center py-4">No taps yet. Create a card and simulate a tap above.</div>
        </div>
      </div>

      ${embed ? "" : safe(rawHtml`
      <div class="grid grid-cols-3 gap-2">
        <a href="/card" class="text-center bg-gray-800 hover:bg-gray-750 text-gray-300 font-semibold py-2.5 px-2 rounded-xl text-xs transition-colors border border-gray-700">
          Card Dashboard
        </a>
        <a href="/operator/topup" class="text-center bg-gray-800 hover:bg-gray-750 text-gray-300 font-semibold py-2.5 px-2 rounded-xl text-xs transition-colors border border-gray-700">
          Top Up
        </a>
        <a href="/operator/pos" class="text-center bg-gray-800 hover:bg-gray-750 text-gray-300 font-semibold py-2.5 px-2 rounded-xl text-xs transition-colors border border-gray-700">
          POS Terminal
        </a>
        <a href="/operator/refund" class="text-center bg-gray-800 hover:bg-gray-750 text-gray-300 font-semibold py-2.5 px-2 rounded-xl text-xs transition-colors border border-gray-700">
          Refund Desk
        </a>
        <a href="/login" class="text-center bg-gray-800 hover:bg-gray-750 text-gray-300 font-semibold py-2.5 px-2 rounded-xl text-xs transition-colors border border-gray-700">
          NFC Login
        </a>
        <a href="/identity" class="text-center bg-gray-800 hover:bg-gray-750 text-gray-300 font-semibold py-2.5 px-2 rounded-xl text-xs transition-colors border border-gray-700">
          Identity
        </a>
      </div>

      <div class="flex gap-2">
        <button id="vc-reset-btn" type="button" class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold py-2.5 px-4 rounded-xl text-xs transition-colors border border-gray-600">
          New Card
        </button>
        <button id="vc-delete-btn" type="button" class="flex-1 bg-red-900/30 hover:bg-red-800/40 text-red-400 font-semibold py-2.5 px-4 rounded-xl text-xs transition-colors border border-red-800/40">
          Delete Virtual Card
        </button>
      </div>
      <div id="vc-delete-confirm" class="hidden bg-red-900/20 border border-red-700/40 rounded-xl p-4">
        <p class="text-red-300/80 text-sm mb-3">This removes the virtual card from this browser. Server-side balance remains but is inaccessible without the keys.</p>
        <div class="flex gap-2">
          <button id="vc-delete-confirm-btn" type="button" class="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-xl text-xs transition-colors">Confirm Delete</button>
          <button id="vc-delete-cancel" type="button" class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2 px-4 rounded-xl text-xs transition-colors">Cancel</button>
        </div>
      </div>
      `)}
    </div>
  `;
}

export function renderVirtualCardPage(opts?: { embed?: boolean }): string {
  const embed = opts?.embed === true;

  const content: string = rawHtml`
  <main class="${embed ? "max-w-xl" : "max-w-lg"} mx-auto${embed ? "" : " pb-8"}">

    ${embed ? "" : safe(rawHtml`
    <div class="text-center mb-6">
      <h1 class="text-2xl font-bold text-indigo-400 tracking-tight mb-1">Virtual Card</h1>
      <p class="text-gray-500 text-sm">Simulate a bolt card without physical NFC hardware</p>
    </div>
    `)}

    ${safe(renderVirtualCardContent({ embed }))}

    ${embed ? "" : safe(rawHtml`
    <div class="mt-6 bg-gray-800/50 border border-gray-700/50 rounded-2xl p-4">
      <h3 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">How It Works</h3>
      <ol class="space-y-2 text-xs text-gray-400">
        <li class="flex gap-2"><span class="text-indigo-400 font-bold">1.</span><span>Create a virtual card — keys are generated server-side and stored in your browser's localStorage.</span></li>
        <li class="flex gap-2"><span class="text-indigo-400 font-bold">2.</span><span>Choose a destination (LNURL withdraw, top-up, POS, etc.) and click "Simulate Tap".</span></li>
        <li class="flex gap-2"><span class="text-indigo-400 font-bold">3.</span><span>Real AES-ECB encryption and AES-CMAC authentication are computed in your browser — identical to a physical NTAG424 tap.</span></li>
        <li class="flex gap-2"><span class="text-indigo-400 font-bold">4.</span><span>The tap history log shows each tap's parameters and the server's response.</span></li>
        <li class="flex gap-2"><span class="text-indigo-400 font-bold">5.</span><span>On NFC pages (top-up, POS, refund), a floating "Virtual Tap" button also appears for inline testing.</span></li>
      </ol>
    </div>
    `)}
  </main>

  <script src="https://cdn.jsdelivr.net/npm/aes-js@3.1.2/index.js"></script>

  ${staticScript("helpers.js")}
  ${staticScript("csrf.js")}
  ${staticScript("virtual-card-widget.js")}
  `;

  if (embed) {
    // Embed mode: skip pageShell to avoid loading virtual-card-sim.js (FAB) inside iframe
    return rawHtml`<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Virtual Card</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>body { background-color: #111827; color: #f3f4f6; margin: 0; }</style>
  </head>
  <body class="p-3 font-sans antialiased">
${safe(content)}
  </body>
</html>`;
  }

  return renderTailwindPage({
    title: "Virtual Card",
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content,
  });
}
