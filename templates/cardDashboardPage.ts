import { rawHtml, safe } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderCardDashboardPage(): string {
  const content: string = rawHtml`
  <main class="max-w-lg mx-auto">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-emerald-500 tracking-tight mb-2">MY CARD</h1>
      <p class="text-gray-400 text-sm">Tap your bolt card or paste your card URL</p>
    </div>

    <div id="scan-section" class="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6 text-center">
      <div id="scan-status" class="text-gray-400 text-sm">
        Hold your card to the back of your phone
      </div>
      <div id="scan-error" class="hidden bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs mt-3 p-2 rounded"></div>
      <div id="nfc-unsupported" class="hidden text-gray-500 text-xs mt-3">
        NFC not available on this device. Paste your card URL below.
      </div>
      <button id="btn-scan-again" type="button" class="hidden mt-4 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded text-sm transition-colors">
        SCAN AGAIN
      </button>
    </div>

    <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6">
      <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card URL</p>
      <div class="flex gap-2">
        <input type="text" id="url-input" placeholder="https://...?p=...&c=..." class="flex-1 bg-gray-900 border border-gray-700 text-gray-200 font-mono text-xs p-2 rounded focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors" />
        <button id="btn-load-url" type="button" class="bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold px-3 py-2 rounded text-xs transition-colors">
          LOAD
        </button>
      </div>
      <p id="url-error" class="hidden text-red-400 text-xs mt-2"></p>
    </div>

    <div id="loading" class="hidden text-center py-8">
      <div class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse mx-auto mb-3"></div>
      <p class="text-gray-400 text-sm">Loading card info...</p>
    </div>

    <div id="card-info" class="hidden" aria-live="polite">
      <div id="provenance-banner" class="hidden mb-4 bg-yellow-900/50 border border-yellow-600 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <span class="text-yellow-400 text-xl" aria-hidden="true">&#9888;&#65039;</span>
          <div>
            <p class="text-yellow-300 font-bold text-sm">Public Key Detected</p>
            <p class="text-yellow-200 text-xs mt-1">Your card is using publicly known keys. Anyone with the issuer key can clone your card. Re-program it with private keys for security.</p>
            <a id="activate-link" href="/experimental/activate" class="inline-block mt-3 bg-yellow-600 hover:bg-yellow-500 text-white font-bold px-4 py-2 rounded text-xs transition-colors">
              Re-program Card
            </a>
          </div>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Details</p>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-400">UID</span>
            <span id="card-uid" class="text-gray-200 font-mono"></span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-400">State</span>
            <span id="card-state" class="font-mono"></span>
          </div>
          <div id="method-row" class="flex justify-between hidden">
            <span class="text-gray-400">Type</span>
            <span id="card-method" class="text-gray-200 font-mono text-xs"></span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-400">Key Origin</span>
            <span id="card-provenance" class="font-mono"></span>
          </div>
          <div id="key-label-row" class="flex justify-between hidden">
            <span class="text-gray-400">Key Label</span>
            <span id="card-key-label" class="text-gray-200 font-mono"></span>
          </div>
          <div id="version-row" class="flex justify-between hidden">
            <span class="text-gray-400">Key Version</span>
            <span id="card-version" class="text-gray-200 font-mono"></span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-400">Balance</span>
            <span id="card-balance" class="text-emerald-400 font-bold"></span>
          </div>
          <div id="activated-row" class="flex justify-between hidden">
            <span class="text-gray-400">Activated</span>
            <span id="card-activated" class="text-gray-400 text-xs"></span>
          </div>
          <div id="first-seen-row" class="flex justify-between hidden">
            <span class="text-gray-400">First Seen</span>
            <span id="card-first-seen" class="text-gray-400 text-xs"></span>
          </div>
        </div>
      </div>

      <div id="analytics-section" class="hidden grid grid-cols-3 gap-3 mb-4">
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center">
          <div class="text-xs text-gray-500 uppercase">Total Spent</div>
          <div id="analytics-spent" class="text-sm font-bold text-red-400 mt-1">0</div>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center">
          <div class="text-xs text-gray-500 uppercase">Taps</div>
          <div id="analytics-taps" class="text-sm font-bold text-cyan-400 mt-1">0</div>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center">
          <div class="text-xs text-gray-500 uppercase">Success</div>
          <div id="analytics-rate" class="text-sm font-bold text-emerald-400 mt-1">-</div>
        </div>
      </div>

      <div id="history-section" class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Activity</p>
        <div id="history-list" class="space-y-1">
          <p class="text-gray-500 text-xs text-center">No activity</p>
        </div>
      </div>

  <div id="lock-section" class="hidden mb-4">
  <button id="btn-lock" type="button" class="w-full bg-red-900/50 hover:bg-red-800/50 border border-red-600/50 text-red-300 font-bold py-3 px-4 rounded-lg text-sm transition-colors">
  Terminate Card
  </button>
  <div id="lock-confirm" class="hidden bg-red-900/30 border border-red-600/50 rounded-lg p-4 mt-2">
  <p class="text-red-200 text-sm mb-3">This will permanently terminate your card. You will not be able to use it again. An operator can re-activate it later.</p>
  <div class="flex gap-2">
  <button id="btn-lock-confirm" type="button" class="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded text-sm transition-colors">Confirm Terminate</button>
             <button id="btn-lock-cancel" type="button" class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2 px-4 rounded text-sm transition-colors">Cancel</button>
           </div>
         </div>
         <div id="lock-status" class="hidden mt-2 text-center text-sm"></div>
       </div>

       <div id="reactivate-section" class="hidden mb-4">
         <div class="bg-amber-900/30 border border-amber-600/50 rounded-lg p-4 mb-3">
           <p class="text-amber-200 text-sm mb-1">This card is terminated.</p>
           <p class="text-amber-300/80 text-xs">Re-activating will generate new keys and advance to version <span id="reactivate-version">N+1</span>. You will need to write the new keys to your card via NFC.</p>
         </div>
         <div id="reactivate-scan" class="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
           <p class="text-gray-400 text-sm mb-3">Tap your card to verify ownership</p>
           <div id="reactivate-scan-status" class="text-gray-500 text-xs"></div>
           <div id="reactivate-scan-error" class="hidden text-red-400 text-xs mt-2"></div>
         </div>
         <div id="reactivate-status" class="hidden mt-2 text-center text-sm"></div>
         <div id="reactivate-success" class="hidden bg-emerald-900/30 border border-emerald-600/50 rounded-lg p-4 mt-3">
           <p class="text-emerald-200 text-sm mb-2">New keys generated (version <span id="reactivate-new-version"></span>)</p>
           <a id="reactivate-program-link" href="/experimental/activate" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded text-sm transition-colors">
             Program Card
           </a>
         </div>
       </div>

      <div class="mt-4 text-center">
        <button id="btn-refresh" type="button" class="text-gray-500 hover:text-gray-300 text-xs transition-colors">
          Refresh
        </button>
      </div>
    </div>

    <div id="error-display" class="hidden bg-red-900/50 border border-red-600 rounded-lg p-4 mt-4" role="alert">
      <p id="error-message" class="text-red-300 text-sm"></p>
      <button id="btn-retry" type="button" class="mt-2 text-red-400 hover:text-red-300 text-xs underline">Try again</button>
    </div>
  </main>


  ${safe('<script src="/static/js/helpers.js"></script>')}
  ${safe('<script src="/static/js/card-info.js"></script>')}
  ${safe('<script src="/static/js/card-dashboard.js"></script>')}
  `;

  return renderTailwindPage({
    title: "My Bolt Card",
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content,
  });
}
