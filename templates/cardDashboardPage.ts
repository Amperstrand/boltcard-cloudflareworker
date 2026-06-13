import { rawHtml, safe, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderCardDashboardPage(): string {
  const content: string = rawHtml`
  <main class="max-w-lg mx-auto" id="pull-container" style="overscroll-behavior-y:contain">

    ${safe(walletAppStyles())}

    <div id="install-banner" class="hidden mb-4 bg-emerald-900/30 border border-emerald-500/30 rounded-lg p-3 flex items-center justify-between">
      <span class="text-emerald-200 text-sm">Install this app for quick access</span>
      <button id="btn-install" type="button" class="bg-emerald-600 text-white px-3 py-1 rounded text-sm font-bold">Install</button>
    </div>

    <div id="offline-banner" class="hidden mb-3 bg-amber-900/30 border border-amber-500/30 rounded-lg p-2 text-center">
      <span class="text-amber-300 text-xs">Offline — showing last known balance</span>
    </div>

    <div id="saved-card" class="hidden mb-4 bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center justify-between">
      <span class="text-gray-300 text-xs">Card saved — auto-loaded</span>
      <div class="flex items-center gap-3">
        <button id="btn-scan-different" type="button" class="text-emerald-400 text-xs hover:text-emerald-300">Scan different card</button>
        <button id="btn-forget" type="button" class="text-gray-500 text-xs hover:text-gray-300">Remove</button>
      </div>
    </div>

    <div id="scan-section" class="bg-gray-800 border border-gray-700 rounded-2xl p-8 mb-6 text-center">
      <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
        <svg class="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714a2.25 2.25 0 0 0 .659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a2.25 2.25 0 0 1-1.591.659H9.061a2.25 2.25 0 0 1-1.591-.659L5 14.5m14 0V17a2.25 2.25 0 0 1-2.25 2.25H7.25A2.25 2.25 0 0 1 5 17v-2.5" />
        </svg>
      </div>
      <h1 class="text-xl font-bold text-gray-100 tracking-tight mb-1">Tap Your Card</h1>
      <div id="scan-status" class="text-gray-400 text-sm mt-2">
        Hold your card to the back of your phone
      </div>
      <div id="scan-error" class="hidden bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs mt-3 p-2 rounded-lg"></div>
      <div id="nfc-unsupported" class="hidden text-gray-500 text-xs mt-3">
        NFC not available on this device. Paste your card URL below.
      </div>
      <button id="btn-scan-again" type="button" class="hidden mt-4 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl text-sm transition-colors">
        SCAN AGAIN
      </button>
    </div>

    <div class="bg-gray-800 border border-gray-700 rounded-2xl p-4 mb-6">
      <div class="flex gap-2">
        <input type="text" id="url-input" placeholder="Paste card URL (https://...?p=...&c=...)" class="flex-1 bg-gray-900 border border-gray-700 text-gray-200 font-mono text-xs p-2.5 rounded-xl focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors" />
        <button id="btn-load-url" type="button" class="bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors whitespace-nowrap">
          LOAD
        </button>
      </div>
      <p id="url-error" class="hidden text-red-400 text-xs mt-2"></p>
    </div>

    <div id="loading" class="hidden text-center py-12">
      <div class="w-3 h-3 bg-emerald-500 rounded-full animate-pulse mx-auto mb-3"></div>
      <p class="text-gray-400 text-sm">Loading card info...</p>
    </div>

    <div id="card-info" class="hidden" aria-live="polite">

      <div id="stale-banner" class="hidden mb-3 bg-gray-700/50 border border-gray-600 rounded-lg p-2 text-center">
        <span class="text-gray-400 text-xs">Last updated <span id="stale-time"></span></span>
        <button id="btn-refresh-stale" type="button" class="text-emerald-400 text-xs ml-2 underline">Refresh</button>
      </div>

      <div id="provenance-banner" class="hidden mb-4 bg-yellow-900/50 border border-yellow-600/50 rounded-2xl p-4">
        <div class="flex items-start gap-3">
          <span class="text-yellow-400 text-xl mt-0.5" aria-hidden="true">&#9888;&#65039;</span>
          <div>
            <p class="text-yellow-300 font-bold text-sm">Public Key Detected</p>
            <p class="text-yellow-200/80 text-xs mt-1">Your card is using publicly known keys. Anyone with the issuer key can clone your card. Re-program it with private keys for security.</p>
            <a id="activate-link" href="/experimental/activate" class="inline-block mt-3 bg-yellow-600 hover:bg-yellow-500 text-white font-bold px-4 py-2 rounded-xl text-xs transition-colors">
              Re-program Card
            </a>
          </div>
        </div>
      </div>

      <!-- Balance Hero -->
      <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-800 via-gray-800 to-emerald-900/30 border border-gray-700/80 p-6 mb-4">
        <div class="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full -translate-y-8 translate-x-8"></div>
        <div class="absolute bottom-0 left-0 w-24 h-24 bg-emerald-500/3 rounded-full translate-y-6 -translate-x-6"></div>
        <div class="relative">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-gray-500 uppercase tracking-widest font-medium">Balance</span>
            <span id="card-state-badge" class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gray-700/60 text-gray-400 border border-gray-600/50">
              <span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
              <span id="card-state">--</span>
            </span>
          </div>
          <div id="card-balance" class="text-5xl font-extrabold text-emerald-400 tracking-tight mt-1 mb-2" style="font-feature-settings: 'tnum'; line-height:1.1">--</div>
          <div class="flex items-center gap-3 mt-3">
            <div class="flex items-center gap-1.5 text-xs text-gray-500">
              <svg class="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
              <span id="card-uid" class="font-mono">--</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="grid grid-cols-3 gap-2 mb-4">
        <a href="/operator/topup" class="flex flex-col items-center gap-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-emerald-500/30 rounded-2xl py-3.5 px-2 transition-all group">
          <div class="w-9 h-9 rounded-full bg-emerald-500/10 group-hover:bg-emerald-500/20 flex items-center justify-center transition-colors">
            <span class="text-emerald-400 text-lg font-bold leading-none">&uarr;</span>
          </div>
          <span class="text-[11px] font-semibold text-gray-400 group-hover:text-emerald-300 transition-colors">Top Up</span>
        </a>
        <div class="flex flex-col items-center gap-1.5">
          <button id="btn-lock" type="button" class="w-full flex flex-col items-center gap-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-red-500/30 rounded-2xl py-3.5 px-2 transition-all group">
            <div class="w-9 h-9 rounded-full bg-red-500/10 group-hover:bg-red-500/20 flex items-center justify-center transition-colors">
              <svg class="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
            </div>
            <span class="text-[11px] font-semibold text-gray-400 group-hover:text-red-300 transition-colors">Lock Card</span>
          </button>
        </div>
        <button id="btn-refresh" type="button" class="flex flex-col items-center gap-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-cyan-500/30 rounded-2xl py-3.5 px-2 transition-all group">
          <div class="w-9 h-9 rounded-full bg-cyan-500/10 group-hover:bg-cyan-500/20 flex items-center justify-center transition-colors">
            <svg class="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
          </div>
          <span class="text-[11px] font-semibold text-gray-400 group-hover:text-cyan-300 transition-colors">Refresh</span>
        </button>
      </div>

      <!-- Card Details (collapsible) -->
      <details class="mb-4 group">
        <summary class="bg-gray-800 border border-gray-700 rounded-2xl p-4 cursor-pointer hover:bg-gray-750 transition-colors list-none flex items-center justify-between">
          <span class="text-xs text-gray-500 uppercase tracking-widest font-medium">Card Details</span>
          <svg class="w-4 h-4 text-gray-600 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
        </summary>
        <div class="bg-gray-800 border border-t-0 border-gray-700 rounded-b-2xl -mt-1 pt-1 p-4 space-y-2.5 text-sm">
          <div id="method-row" class="flex justify-between hidden">
            <span class="text-gray-500">Type</span>
            <span id="card-method" class="text-gray-200 font-mono text-xs"></span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">Key Origin</span>
            <span id="card-provenance" class="font-mono text-xs"></span>
          </div>
          <div id="key-label-row" class="flex justify-between hidden">
            <span class="text-gray-500">Key Label</span>
            <span id="card-key-label" class="text-gray-200 font-mono text-xs"></span>
          </div>
          <div id="version-row" class="flex justify-between hidden">
            <span class="text-gray-500">Key Version</span>
            <span id="card-version" class="text-gray-200 font-mono text-xs"></span>
          </div>
          <div id="activated-row" class="flex justify-between hidden">
            <span class="text-gray-500">Activated</span>
            <span id="card-activated" class="text-gray-400 text-xs"></span>
          </div>
          <div id="first-seen-row" class="flex justify-between hidden">
            <span class="text-gray-500">First Seen</span>
            <span id="card-first-seen" class="text-gray-400 text-xs"></span>
          </div>
        </div>
      </details>

      <!-- Analytics -->
      <div id="analytics-section" class="hidden grid grid-cols-3 gap-2 mb-4">
        <div class="bg-gray-800 border border-gray-700 rounded-2xl p-3.5 text-center">
          <div class="text-[10px] text-gray-500 uppercase tracking-wider">Total Spent</div>
          <div id="analytics-spent" class="text-sm font-bold text-red-400 mt-1.5">0</div>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-2xl p-3.5 text-center">
          <div class="text-[10px] text-gray-500 uppercase tracking-wider">Taps</div>
          <div id="analytics-taps" class="text-sm font-bold text-cyan-400 mt-1.5">0</div>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-2xl p-3.5 text-center">
          <div class="text-[10px] text-gray-500 uppercase tracking-wider">Success</div>
          <div id="analytics-rate" class="text-sm font-bold text-emerald-400 mt-1.5">-</div>
        </div>
      </div>

      <!-- History -->
      <div id="history-section" class="bg-gray-800 border border-gray-700 rounded-2xl p-4 mb-4">
        <div class="flex items-center justify-between mb-3">
          <p class="text-xs text-gray-500 uppercase tracking-widest font-medium">Activity</p>
          <span class="text-[10px] text-gray-600">Last 15</span>
        </div>
        <div id="history-list" class="space-y-0.5">
          <p class="text-gray-500 text-xs text-center py-4">No activity</p>
        </div>
      </div>

      <!-- Lock Section -->
      <div id="lock-section" class="hidden mb-4">
        <div id="lock-confirm" class="hidden bg-red-900/20 border border-red-600/40 rounded-2xl p-4">
          <p class="text-red-200 text-sm mb-4">This will permanently terminate your card. You will not be able to use it again. An operator can re-activate it later.</p>
          <div class="flex gap-2">
            <button id="btn-lock-confirm" type="button" class="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 px-4 rounded-xl text-sm transition-colors">Confirm Terminate</button>
            <button id="btn-lock-cancel" type="button" class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2.5 px-4 rounded-xl text-sm transition-colors">Cancel</button>
          </div>
        </div>
        <div id="lock-status" class="hidden mt-2 text-center text-sm"></div>
      </div>

      <!-- Reactivate Section -->
      <div id="reactivate-section" class="hidden mb-4">
        <div class="bg-amber-900/20 border border-amber-600/40 rounded-2xl p-4 mb-3">
          <p class="text-amber-200 text-sm mb-1">This card is terminated.</p>
          <p class="text-amber-300/70 text-xs">Re-activating will generate new keys and advance to version <span id="reactivate-version">N+1</span>. You will need to write the new keys to your card via NFC.</p>
        </div>
        <div id="reactivate-scan" class="bg-gray-800 border border-gray-700 rounded-2xl p-4 text-center">
          <p class="text-gray-400 text-sm mb-3">Tap your card to verify ownership</p>
          <div id="reactivate-scan-status" class="text-gray-500 text-xs"></div>
          <div id="reactivate-scan-error" class="hidden text-red-400 text-xs mt-2"></div>
        </div>
        <div id="reactivate-status" class="hidden mt-2 text-center text-sm"></div>
        <div id="reactivate-success" class="hidden bg-emerald-900/20 border border-emerald-600/40 rounded-2xl p-4 mt-3">
          <p class="text-emerald-200 text-sm mb-2">New keys generated (version <span id="reactivate-new-version"></span>)</p>
          <a id="reactivate-program-link" href="/experimental/activate" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors">
            Program Card
          </a>
        </div>
      </div>

    </div>

    <div id="error-display" class="hidden bg-red-900/30 border border-red-600/50 rounded-2xl p-4 mt-4" role="alert">
      <p id="error-message" class="text-red-300 text-sm"></p>
      <button id="btn-retry" type="button" class="mt-2 text-red-400 hover:text-red-300 text-xs underline">Try again</button>
    </div>
  </main>

  ${staticScript("helpers.js")}
  ${staticScript("card-info.js")}
  ${staticScript("card-dashboard.js")}
  ${staticScript("sw-register.js")}
  `;

  return renderTailwindPage({
    title: "My Bolt Card",
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content,
  });
}

function walletAppStyles(): string {
  return rawHtml`<style>
    /* State badge colors — driven by JS setting class on #card-state child */
    /* Active */
    #card-state-badge:has(.text-emerald-400) {
      background: rgba(16,185,129,0.12);
      border-color: rgba(16,185,129,0.3);
      color: #34d399;
    }
    #card-state-badge:has(.text-emerald-400) .state-dot { background: #10b981; }
    /* Terminated */
    #card-state-badge:has(.text-red-400) {
      background: rgba(239,68,68,0.12);
      border-color: rgba(239,68,68,0.3);
      color: #f87171;
    }
    #card-state-badge:has(.text-red-400) .state-dot { background: #ef4444; }
    /* Discovered */
    #card-state-badge:has(.text-blue-400) {
      background: rgba(59,130,246,0.12);
      border-color: rgba(59,130,246,0.3);
      color: #60a5fa;
    }
    #card-state-badge:has(.text-blue-400) .state-dot { background: #3b82f6; }
    /* Pending */
    #card-state-badge:has(.text-yellow-400) {
      background: rgba(234,179,8,0.12);
      border-color: rgba(234,179,8,0.3);
      color: #facc15;
    }
    #card-state-badge:has(.text-yellow-400) .state-dot { background: #eab308; }
    /* Keys delivered */
    #card-state-badge:has(.text-cyan-400) {
      background: rgba(168,85,247,0.12);
      border-color: rgba(168,85,247,0.3);
      color: #c084fc;
    }
    #card-state-badge:has(.text-cyan-400) .state-dot { background: #a855f7; }
    /* Wipe requested */
    #card-state-badge:has(.text-orange-400) {
      background: rgba(249,115,22,0.12);
      border-color: rgba(249,115,22,0.3);
      color: #fb923c;
    }
    #card-state-badge:has(.text-orange-400) .state-dot { background: #f97316; }

    /* Balance number formatting */
    #card-balance { font-variant-numeric: tabular-nums; }

    /* Rounded card details panel */
    details[open] > summary {
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }

    /* Pull-to-refresh visual feedback */
    #pull-container { transition: opacity 0.15s, transform 0.15s; }
  </style>`;
}
