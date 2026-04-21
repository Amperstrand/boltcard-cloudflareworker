import { rawHtml } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS } from "./browserNfc.js";

export function renderLoginPage({ host, defaultProgrammingEndpoint }) {
  return renderTailwindPage({
    title: "NFC Login",
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased flex flex-col items-center justify-center",
    headScripts: '<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>',
    styles: [
      'body { background-color: #111827; color: #f3f4f6; }',
      '.qr-container { display: inline-block; padding: 10px; background: white; border-radius: 8px; margin-top: 10px; }',
      '.pulse-ring { animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }',
      '@keyframes pulse-ring { 0% { transform: scale(0.8); opacity: 1; } 80%, 100% { transform: scale(1.4); opacity: 0; } }',
    ].join('\n'),
    content: rawHtml`
    <div id="login-view" class="max-w-md w-full">
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold text-emerald-500 tracking-tight mb-2">NFC LOGIN</h1>
        <p class="text-gray-400 text-sm">Tap your NTAG424 card to authenticate</p>
        <a href="/pos" class="inline-block mt-3 text-xs font-semibold text-gray-500 hover:text-emerald-400 transition-colors tracking-wide">POS &#8594;</a>
      </div>

      <div class="bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-6">
        <div id="nfc-not-supported" class="hidden text-center py-8">
          <p class="text-red-400 font-semibold mb-2">Web NFC not supported</p>
          <p class="text-gray-500 text-xs">Use Chrome 89+ on Android. On desktop, scan the card with your phone and open the URL.</p>
        </div>

        <div id="nfc-ready" class="text-center">
          <div class="relative mx-auto w-32 h-32 rounded-full bg-emerald-600 flex items-center justify-center mb-4">
            <div class="pulse-ring absolute inset-0 rounded-full bg-emerald-500 opacity-30" id="pulse"></div>
            <svg class="w-12 h-12 text-white relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
          </div>
          <p id="scan-status" class="text-gray-400 text-sm">Starting NFC...</p>
          <p id="nfc-indicator" class="text-xs mt-2 hidden">
            <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1"></span>
            <span class="text-emerald-400">NFC active</span>
          </p>
        </div>
      </div>

      <div id="last-ndef" class="hidden bg-gray-800 border border-gray-700 rounded-lg p-4 mt-4">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Last NDEF Read</p>
          <button onclick="navigator.clipboard.writeText(document.getElementById('ndef-raw').textContent)" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
        </div>
        <p id="ndef-raw" class="font-mono text-xs text-gray-400 break-all"></p>
      </div>

      <div id="error-box" class="hidden bg-red-900/30 border border-red-500/40 rounded-lg p-4 mt-4">
        <p id="error-msg" class="text-red-300 text-sm"></p>
      </div>
    </div>

    <div id="undeployed-view" class="max-w-md w-full hidden">
      <div class="text-center mb-6">
        <div class="inline-flex items-center gap-2 bg-sky-500/10 border border-sky-500/30 rounded-full px-4 py-1 mb-2">
          <span class="text-sky-400 text-sm font-semibold">UNPROGRAMMED CARD</span>
        </div>
        <p class="text-gray-500 text-xs font-mono mt-2" id="undep-uid-display"></p>
      </div>

      <div class="bg-sky-900/30 border border-sky-500/40 rounded-lg p-4 mb-4">
        <p class="text-sky-300 font-bold text-sm mb-1">This card has not been programmed</p>
        <p class="text-sky-200/70 text-xs mb-2">Keys shown below are what would be written if this card were provisioned as a bolt card.</p>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Details</p>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-gray-500">Key Version</span><span id="undep-version" class="font-mono text-gray-300">1</span></div>
          <div class="flex justify-between"><span class="text-gray-500">State</span><span id="undep-state" class="font-mono text-gray-300">new</span></div>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex justify-between items-center mb-3">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Preview Keys</p>
          <button onclick="navigator.clipboard.writeText(JSON.stringify({k0:document.querySelector('#undep-keys tr:nth-child(1) td:last-child').textContent,k1:document.querySelector('#undep-keys tr:nth-child(2) td:last-child').textContent,k2:document.querySelector('#undep-keys tr:nth-child(3) td:last-child').textContent,k3:document.querySelector('#undep-keys tr:nth-child(4) td:last-child').textContent,k4:document.querySelector('#undep-keys tr:nth-child(5) td:last-child').textContent},null,2))" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY ALL</button>
        </div>
        <table class="w-full text-sm"><tbody id="undep-keys"></tbody></table>
      </div>

      <div class="bg-gray-800 border border-emerald-500/30 rounded-lg p-4 mb-4">
        <button id="undep-provision-btn" onclick="provisionCard()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded transition-colors">
          PROVISION AS WITHDRAW CARD
        </button>
        <div id="undep-provision-status" class="hidden mt-3 text-center text-sm"></div>
      </div>

      <div id="undep-program-section" class="hidden">
        <div class="bg-emerald-900/30 border border-emerald-500/40 rounded-lg p-4 mb-4">
          <p class="text-emerald-300 font-bold text-sm mb-1">Keys generated!</p>
          <p class="text-emerald-200/70 text-xs mb-1">Use the Bolt Card Programmer app to write these keys to your card.</p>
          <p id="undep-keys-delivered-time" class="text-gray-500 text-xs mb-3"></p>
          <div class="flex justify-center mb-3">
            <div id="qr-undep-program" class="qr-container"></div>
          </div>
          <a id="undep-program-deeplink" href="#" class="w-full block text-center bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded transition-colors mb-2">
            OPEN BOLT CARD PROGRAMMER
          </a>
          <button onclick="navigator.clipboard.writeText(document.getElementById('undep-program-deeplink').href)" class="w-full text-center text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
        </div>
      </div>

      <button onclick="rescanCard()" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
        📱 TAP CARD TO SCAN AGAIN
      </button>
    </div>

    <div id="public-view" class="max-w-md w-full hidden">
      <div class="text-center mb-6">
        <div class="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-1 mb-2">
          <span class="text-amber-400 text-sm font-semibold">🔑 KEYS RECOVERED</span>
        </div>
        <span id="pub-card-type-badge" class="px-3 py-1 rounded text-xs font-bold border bg-amber-500/10 text-amber-400 border-amber-500/30">WITHDRAW</span>
        <p class="text-gray-500 text-xs font-mono mt-2" id="pub-uid-display"></p>
      </div>

      <div class="bg-amber-900/30 border border-amber-500/40 rounded-lg p-4 mb-4">
        <p class="text-amber-300 font-bold text-sm mb-1">Public card</p>
        <p class="text-amber-200/70 text-xs mb-2">This card's keys are from a public dump.</p>
        <a href="/experimental/bulkwipe" class="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 text-sm font-semibold transition-colors">
          Go to Bulk Wipe Tool →
        </a>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Details</p>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-gray-500">Key Version</span><span id="pub-version" class="font-mono text-gray-300">-</span></div>
          <div class="flex justify-between"><span class="text-gray-500">State</span><span id="pub-state" class="font-mono text-gray-300">-</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Counter</span><span id="pub-counter" class="font-mono text-gray-300">0</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Source</span><span id="pub-issuer" class="font-mono text-gray-300 text-xs">-</span></div>
          <div class="flex justify-between"><span class="text-gray-500">CMAC</span><span id="pub-cmac" class="font-mono text-emerald-400">-</span></div>
        </div>
      </div>

      <div id="pub-tap-history" class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 hidden">
        <div class="flex justify-between items-center mb-3">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Tap History</p>
          <span id="pub-tap-count" class="text-xs text-gray-600"></span>
        </div>
        <div id="pub-tap-list" class="space-y-0 max-h-96 overflow-y-auto"></div>
        <p id="pub-tap-empty" class="text-gray-600 text-xs text-center py-4 hidden">No taps recorded yet</p>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex justify-between items-center mb-3">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Keys</p>
          <button onclick="copyWipeJson('pub')" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY ALL</button>
        </div>
        <table class="w-full text-sm"><tbody id="pub-keys"></tbody></table>
      </div>

      <div class="bg-gray-800 border border-amber-500/30 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Wipe via Bolt Card Programmer</p>
        <div class="flex flex-col items-center">
          <div id="qr-pub-wipe" class="qr-container mb-3"></div>
          <a id="pub-wipe-deeplink" href="#" class="w-full text-center bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded transition-colors mb-2">
            WIPE CARD (App Deeplink)
          </a>
          <button onclick="navigator.clipboard.writeText(document.getElementById('pub-wipe-deeplink').href)" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider">NDEF URL</p>
          <button onclick="navigator.clipboard.writeText(document.getElementById('pub-ndef').textContent)" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
        </div>
        <p id="pub-ndef" class="font-mono text-xs text-gray-400 break-all"></p>
      </div>

      <div id="public-error-box" class="hidden bg-red-900/30 border border-red-500/40 rounded-lg p-4 mb-4">
        <p id="public-error-msg" class="text-red-300 text-sm"></p>
      </div>

      <button onclick="rescanCard()" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
        📱 TAP CARD TO SCAN AGAIN
      </button>
    </div>

    <div id="private-view" class="max-w-md w-full hidden">
      <div class="text-center mb-6">
        <div class="inline-flex items-center gap-3 mb-2">
          <div class="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-4 py-1">
            <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span class="text-emerald-400 text-sm font-semibold">AUTHENTICATED</span>
          </div>
          <span id="priv-card-type-badge" class="px-3 py-1 rounded text-xs font-bold border bg-amber-500/10 text-amber-400 border-amber-500/30">WITHDRAW</span>
        </div>
        <p class="text-gray-500 text-xs font-mono" id="priv-uid-display"></p>
      </div>

      <div class="bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-8 mb-4">
        <div class="text-center">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">Session Duration</p>
          <div id="priv-timer" class="text-5xl font-mono text-gray-200 font-bold tracking-wider">00:00:00</div>
          <p class="text-xs text-gray-600 mt-3 font-mono">tap card again to reset</p>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Details</p>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-gray-500">Key Version</span><span id="priv-version" class="font-mono text-gray-300">-</span></div>
          <div class="flex justify-between"><span class="text-gray-500">State</span><span id="priv-state" class="font-mono text-gray-300">-</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Counter</span><span id="priv-counter" class="font-mono text-gray-300">0</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Balance</span><span id="priv-balance" class="font-mono text-emerald-400">0</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Issuer Key</span><span id="priv-issuer" class="font-mono text-gray-300 text-xs">-</span></div>
          <div class="flex justify-between"><span class="text-gray-500">CMAC</span><span id="priv-cmac" class="font-mono text-emerald-400">-</span></div>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Top Up Balance</p>
        <div class="flex gap-2">
          <input type="number" id="topup-amount" placeholder="Amount" min="1" class="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-200 text-sm focus:border-emerald-500 focus:outline-none" />
          <button onclick="topUpBalance()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded transition-colors text-sm">
            TOP UP
          </button>
        </div>
        <p id="topup-status" class="text-xs mt-2 hidden"></p>
      </div>

      <div id="priv-debug-section" class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <details>
          <summary class="text-xs text-gray-500 uppercase tracking-wider cursor-pointer">Debug Info</summary>
          <div class="mt-3 space-y-1 text-xs">
            <div class="flex justify-between"><span class="text-gray-500">Issuer Key</span><span id="priv-debug-issuer" class="font-mono text-gray-400">-</span></div>
            <div class="flex justify-between"><span class="text-gray-500">Matched Version</span><span id="priv-debug-version" class="font-mono text-gray-400">-</span></div>
            <div class="flex justify-between"><span class="text-gray-500">Versions Scanned</span><span id="priv-debug-versions" class="font-mono text-gray-400 text-right max-w-[200px] truncate">-</span></div>
          </div>
        </details>
      </div>

      <div id="priv-awaiting-programming" class="hidden bg-emerald-900/30 border border-emerald-500/40 rounded-lg p-4 mb-4">
        <p class="text-emerald-300 font-bold text-sm mb-1">Keys generated!</p>
        <p class="text-emerald-200/70 text-xs mb-1">Use the Bolt Card Programmer app to write these keys to your card.</p>
        <p id="priv-keys-delivered-time" class="text-gray-500 text-xs mb-3"></p>
        <div class="flex justify-center mb-3">
          <div id="qr-priv-program" class="qr-container"></div>
        </div>
        <a id="priv-program-deeplink" href="#" class="w-full block text-center bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded transition-colors mb-2">
          OPEN BOLT CARD PROGRAMMER
        </a>
        <button onclick="navigator.clipboard.writeText(document.getElementById('priv-program-deeplink').href)" class="w-full text-center text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
          COPY DEEPLINK
        </button>
      </div>

      <div id="priv-tap-history" class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 hidden">
        <div class="flex justify-between items-center mb-3">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Tap History</p>
          <span id="priv-tap-count" class="text-xs text-gray-600"></span>
        </div>
        <div id="priv-tap-list" class="space-y-0 max-h-96 overflow-y-auto"></div>
        <p id="priv-tap-empty" class="text-gray-600 text-xs text-center py-4 hidden">No taps recorded yet</p>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex justify-between items-center mb-3">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Keys</p>
          <button onclick="copyWipeJson('priv')" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY ALL</button>
        </div>
        <table class="w-full text-sm"><tbody id="priv-keys"></tbody></table>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider">NDEF URL</p>
          <button onclick="navigator.clipboard.writeText(document.getElementById('priv-ndef').textContent)" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
        </div>
        <p id="priv-ndef" class="font-mono text-xs text-gray-400 break-all"></p>
      </div>

      <div id="priv-terminated-banner" class="hidden bg-red-900/30 border border-red-500/40 rounded-lg p-4 mb-4">
        <p class="text-red-300 font-bold text-sm mb-1">Card has been wiped</p>
        <p class="text-red-200/70 text-xs mb-3">Previous version: <span id="priv-term-version" class="font-mono">1</span>. Re-provision to generate new keys.</p>
        <button id="priv-reprovision-btn" onclick="reprovisionPrivateCard()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded transition-colors text-sm">
          RE-PROVISION CARD
        </button>
        <div id="priv-reprovision-status" class="hidden mt-3 text-center text-sm"></div>
        <div id="priv-reprovision-program" class="hidden mt-3">
          <div class="flex justify-center mb-3">
            <div id="qr-priv-reprovision" class="qr-container"></div>
          </div>
          <a id="priv-reprovision-deeplink" href="#" class="w-full block text-center bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded transition-colors text-sm mb-2">
            OPEN BOLT CARD PROGRAMMER
          </a>
          <button onclick="navigator.clipboard.writeText(document.getElementById('priv-reprovision-deeplink').href)" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
        </div>
      </div>

      <div id="priv-wipe-section" class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 hidden">
        <div class="flex justify-between items-center mb-3">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Card Actions</p>
          <span id="priv-wipe-version" class="text-xs text-gray-600 font-mono"></span>
        </div>
        <button id="priv-fetch-wipe-btn" onclick="fetchWipeKeys()" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded transition-colors text-sm">
          GET WIPE KEYS
        </button>
        <div id="priv-wipe-status" class="hidden mt-3 text-center text-sm"></div>
        <div id="priv-wipe-result" class="hidden mt-4">
          <div class="bg-red-900/30 border border-red-500/40 rounded-lg p-3 mb-3">
            <p class="text-red-300 font-bold text-xs mb-1">Wipe keys retrieved — card is now pending wipe</p>
            <p class="text-red-200/70 text-xs">Use the Bolt Card Programmer app to wipe this card, or scan the QR below.</p>
          </div>
          <div class="flex justify-center mb-3">
            <div id="qr-priv-wipe" class="qr-container"></div>
          </div>
          <a id="priv-wipe-link" href="#" class="w-full block text-center bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-3 rounded transition-colors text-sm mb-2">
            WIPE CARD (App Deeplink)
          </a>
          <button onclick="navigator.clipboard.writeText(document.getElementById('priv-wipe-link').href)" class="w-full text-center text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
          <div class="mt-3">
            <div class="flex justify-between items-center mb-1">
              <p class="text-xs text-gray-500">Wipe JSON (for key reset screen)</p>
              <button onclick="navigator.clipboard.writeText(document.getElementById('priv-wipe-json').textContent)" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
            </div>
            <pre id="priv-wipe-json" class="font-mono text-[10px] text-gray-500 bg-gray-900 rounded p-2 overflow-x-auto"></pre>
          </div>
        </div>
      </div>

      <div id="private-error-box" class="hidden bg-red-900/30 border border-red-500/40 rounded-lg p-4 mb-4">
        <p id="private-error-msg" class="text-red-300 text-sm"></p>
      </div>

      <button onclick="rescanCard()" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
        📱 TAP CARD TO SCAN AGAIN
      </button>
    </div>

    <div id="terminated-view" class="max-w-md w-full hidden">
      <div class="text-center mb-6">
        <div class="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-full px-4 py-1 mb-2">
          <span class="text-red-400 text-sm font-semibold">CARD WIPED</span>
        </div>
        <p class="text-gray-500 text-xs font-mono mt-2" id="term-uid-display"></p>
      </div>

      <div class="bg-red-900/30 border border-red-500/40 rounded-lg p-4 mb-4">
        <p class="text-red-300 font-bold text-sm mb-1">This card has been wiped</p>
        <p class="text-red-200/70 text-xs mb-1">It was previously active at key version <span id="term-prev-version" class="font-mono">1</span>.</p>
        <p class="text-red-200/70 text-xs">Re-provisioning will generate new keys at version <span id="term-next-version" class="font-mono">2</span>.</p>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Details</p>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-gray-500">Previous Version</span><span id="term-version" class="font-mono text-gray-300">1</span></div>
          <div class="flex justify-between"><span class="text-gray-500">State</span><span class="font-mono text-red-400">terminated</span></div>
        </div>
      </div>

      <div class="bg-gray-800 border border-emerald-500/30 rounded-lg p-4 mb-4">
        <button id="term-provision-btn" onclick="reprovisionCard()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded transition-colors">
          RE-PROVISION AS WITHDRAW CARD
        </button>
        <div id="term-provision-status" class="hidden mt-3 text-center text-sm"></div>
      </div>

      <div id="term-program-section" class="hidden">
        <div class="bg-emerald-900/30 border border-emerald-500/40 rounded-lg p-4 mb-4">
          <p class="text-emerald-300 font-bold text-sm mb-1">New keys generated!</p>
          <p class="text-emerald-200/70 text-xs mb-1">Use the Bolt Card Programmer app to write these keys to your card.</p>
          <p id="term-keys-delivered-time" class="text-gray-500 text-xs mb-3"></p>
          <div class="flex justify-center mb-3">
            <div id="qr-term-program" class="qr-container"></div>
          </div>
          <a id="term-program-deeplink" href="#" class="w-full block text-center bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded transition-colors mb-2">
            OPEN BOLT CARD PROGRAMMER
          </a>
          <button onclick="navigator.clipboard.writeText(document.getElementById('term-program-deeplink').href)" class="w-full text-center text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
        </div>
      </div>

      <button onclick="rescanCard()" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
        📱 TAP CARD TO SCAN AGAIN
      </button>
    </div>

    <div id="wiped-detection-view" class="max-w-md w-full hidden">
      <div class="text-center mb-6">
        <div class="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-1 mb-2">
          <span class="text-amber-400 text-sm font-semibold">CARD APPEARS WIPED</span>
        </div>
        <p class="text-gray-500 text-xs font-mono mt-2" id="wiped-uid-display"></p>
      </div>

      <div class="bg-amber-900/30 border border-amber-500/40 rounded-lg p-4 mb-4">
        <p class="text-amber-300 font-bold text-sm mb-1">No NDEF record found on this card</p>
        <p class="text-amber-200/70 text-xs mb-1">This card is registered as <span class="text-amber-300 font-semibold">active</span> (version <span id="wiped-version" class="font-mono">1</span>) but has no NDEF data.</p>
        <p class="text-amber-200/70 text-xs">This usually means the card has been physically wiped or factory reset.</p>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Details</p>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-gray-500">Key Version</span><span id="wiped-key-version" class="font-mono text-gray-300">1</span></div>
          <div class="flex justify-between"><span class="text-gray-500">State in System</span><span class="font-mono text-amber-400">active</span></div>
          <div class="flex justify-between"><span class="text-gray-500">NDEF Found</span><span class="font-mono text-red-400">No</span></div>
        </div>
      </div>

      <div class="bg-gray-800 border border-red-500/30 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Confirm Card Wipe</p>
        <p class="text-gray-400 text-xs mb-3">Confirming will mark this card as terminated and prepare it for re-provisioning at version <span id="wiped-next-version" class="font-mono text-emerald-400">2</span>.</p>
        <button id="wiped-confirm-btn" onclick="confirmWipedCard()" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded transition-colors mb-2">
          YES, THIS CARD HAS BEEN WIPED
        </button>
        <button onclick="hideAllViews(); document.getElementById('login-view').classList.remove('hidden');" class="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2 px-4 rounded transition-colors text-sm">
          CANCEL
        </button>
        <div id="wiped-confirm-status" class="hidden mt-3 text-center text-sm"></div>
      </div>

      <button onclick="rescanCard()" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
        📱 TAP CARD TO SCAN AGAIN
      </button>
    </div>

  <script>
    ${BROWSER_NFC_HELPERS}
    let loginTime = null;
    let timerInterval = null;
    let nfcAbortController = null;
    let lastNfcReadTime = 0;
    const API_HOST = "${host}";
    const DEFAULT_PROGRAMMING_ENDPOINT = "${defaultProgrammingEndpoint}";
    let currentUid = null;
    let currentProgrammingEndpoint = DEFAULT_PROGRAMMING_ENDPOINT;

    if (!browserSupportsNfc()) {
      document.getElementById('nfc-not-supported').classList.remove('hidden');
      document.getElementById('nfc-ready').classList.add('hidden');
    } else {
      window.addEventListener('load', startNfc);
    }

    function formatDuration(ms) {
      const totalSec = Math.floor(ms / 1000);
      const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      return h + ':' + m + ':' + s;
    }

    function relativeTime(unixSeconds) {
      var diff = Math.floor(Date.now() / 1000) - unixSeconds;
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
      return new Date(unixSeconds * 1000).toLocaleDateString();
    }

    function formatUnits(value) {
      if (!value || value === 0) return '';
      return Number(value).toLocaleString();
    }

    function esc(s) {
      if (!s) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function statusBadge(status) {
      var map = {
        read:        'bg-sky-500/10 text-sky-400 border-sky-500/30',
        provisioned: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
        activated:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        wipe_requested: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        terminated:  'bg-red-500/10 text-red-400 border-red-500/30',
        completed:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        failed:      'bg-red-500/10 text-red-400 border-red-500/30',
        pending:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
        paying:      'bg-blue-500/10 text-blue-400 border-blue-500/30',
        expired:     'bg-gray-600/10 text-gray-400 border-gray-500/30',
        topup:       'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        payment:     'bg-orange-500/10 text-orange-400 border-orange-500/30',
      };
      var labels = { topup: 'TOP UP', payment: 'PAYMENT' };
      var cls = map[status] || map.pending;
      var label = labels[status] || status;
      return '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ' + cls + '">' + label + '</span>';
    }

    function renderTapHistory(taps, prefix) {
      var section = document.getElementById(prefix + '-tap-history');
      var list = document.getElementById(prefix + '-tap-list');
      var countEl = document.getElementById(prefix + '-tap-count');
      if (!taps || taps.length === 0) {
        section.classList.remove('hidden');
        list.innerHTML = '';
        countEl.textContent = '';
        document.getElementById(prefix + '-tap-empty').classList.remove('hidden');
        return;
      }
      document.getElementById(prefix + '-tap-empty').classList.add('hidden');
      countEl.textContent = taps.length + ' entries';
      var html = '';
      for (var i = 0; i < taps.length; i++) {
        var t = taps[i];
        var time = relativeTime(t.created_at);
        var isTopup = t.status === 'topup';
        var isPayment = t.status === 'payment';

        var amountHtml = '';
        if (isTopup && t.amount_msat) {
          amountHtml = '<span class="font-mono text-emerald-400 font-bold">+' + formatUnits(t.amount_msat) + '</span>';
        } else if (isPayment && t.amount_msat) {
          amountHtml = '<span class="font-mono text-orange-400 font-bold">-' + formatUnits(t.amount_msat) + '</span>';
        } else if (t.amount_msat) {
          amountHtml = '<span class="font-mono text-gray-400">' + formatUnits(t.amount_msat) + '</span>';
        }

        var detailParts = [];
        if (t.counter != null) detailParts.push('#' + t.counter);
        if (t.note) detailParts.push(esc(t.note));
        if (t.balance_after != null && (isTopup || isPayment)) detailParts.push('bal: ' + t.balance_after);

        html += '<div class="py-2 border-b border-gray-700/50 last:border-0">'
          + '<div class="flex items-center justify-between">'
          + '<div class="flex items-center gap-2">'
          + '<span class="text-gray-500 text-xs shrink-0">' + time + '</span>'
          + statusBadge(t.status)
          + '</div>'
          + amountHtml
          + '</div>'
          + (detailParts.length > 0
            ? '<div class="text-gray-500 text-[11px] mt-0.5 pl-1">' + detailParts.join(' · ') + '</div>'
            : '')
          + '</div>';
      }
      list.innerHTML = html;
      section.classList.remove('hidden');
    }

    function startTimer() {
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        if (loginTime) {
          document.getElementById('priv-timer').textContent = formatDuration(Date.now() - loginTime);
        }
      }, 1000);
    }

    function hideAllViews() {
      document.getElementById('login-view').classList.add('hidden');
      document.getElementById('undeployed-view').classList.add('hidden');
      document.getElementById('public-view').classList.add('hidden');
      document.getElementById('private-view').classList.add('hidden');
      document.getElementById('terminated-view').classList.add('hidden');
      document.getElementById('wiped-detection-view').classList.add('hidden');
    }

    function showPersistentError(msg) {
      const privView = document.getElementById('private-view');
      const pubView = document.getElementById('public-view');
      if (!privView.classList.contains('hidden')) {
        document.getElementById('private-error-msg').textContent = msg;
        document.getElementById('private-error-box').classList.remove('hidden');
      } else if (!pubView.classList.contains('hidden')) {
        document.getElementById('public-error-msg').textContent = msg;
        document.getElementById('public-error-box').classList.remove('hidden');
      } else {
        document.getElementById('error-msg').textContent = msg;
        document.getElementById('error-box').classList.remove('hidden');
      }
    }

    function clearErrors() {
      document.getElementById('error-box').classList.add('hidden');
      document.getElementById('public-error-box').classList.add('hidden');
      document.getElementById('private-error-box').classList.add('hidden');
    }

    function showNdef(url) {
      document.getElementById('ndef-raw').textContent = url;
      document.getElementById('last-ndef').classList.remove('hidden');
    }

    function typeBadgeClass(cardType) {
      return 'px-3 py-1 rounded text-xs font-bold border ' +
        (cardType === 'lnurlpay' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
         cardType === 'twofactor' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
         'bg-amber-500/10 text-amber-400 border-amber-500/30');
    }

    function wipeJson(prefix) {
      const cells = document.querySelectorAll('#' + prefix + '-keys td:last-child');
      const vals = [...cells].map(t => t.textContent.trim());
      return JSON.stringify({
        k0: vals[0] || '', k1: vals[1] || '', k2: vals[2] || '',
        k3: vals[3] || '', k4: vals[4] || '',
        action: 'wipe', version: '1'
      }, null, 2);
    }

    function copyWipeJson(prefix) {
      navigator.clipboard.writeText(wipeJson(prefix));
    }

    function buildKeysRows(k0, k1, k2, k3, k4) {
      return '<tr><td class="pr-3 text-gray-500">K0</td><td class="font-mono text-xs text-gray-400">' + (k0 || '-') + '</td></tr>' +
        '<tr><td class="pr-3 text-gray-500">K1</td><td class="font-mono text-xs text-gray-400">' + (k1 || '-') + '</td></tr>' +
        '<tr><td class="pr-3 text-gray-500">K2</td><td class="font-mono text-xs text-gray-400">' + (k2 || '-') + '</td></tr>' +
        '<tr><td class="pr-3 text-gray-500">K3</td><td class="font-mono text-xs text-gray-400">' + (k3 || '-') + '</td></tr>' +
        '<tr><td class="pr-3 text-gray-500">K4</td><td class="font-mono text-xs text-gray-400">' + (k4 || '-') + '</td></tr>';
    }

    function setCurrentProgrammingEndpoint(endpointUrl) {
      currentProgrammingEndpoint = endpointUrl || DEFAULT_PROGRAMMING_ENDPOINT;
    }

    function buildProgrammingEndpointUrl() {
      return currentProgrammingEndpoint || DEFAULT_PROGRAMMING_ENDPOINT;
    }

    function buildProgrammingDeeplink(endpointUrl) {
      return 'boltcard://program?url=' + encodeURIComponent(endpointUrl);
    }

    function showUndeployedProgrammingInstructions(endpointUrl, deliveredAt) {
      const deeplink = buildProgrammingDeeplink(endpointUrl || buildProgrammingEndpointUrl());
      const qrEl = document.getElementById('qr-undep-program');
      qrEl.innerHTML = '';
      new QRCode(qrEl, { text: deeplink, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
      document.getElementById('undep-program-deeplink').href = deeplink;
      if (deliveredAt) {
        document.getElementById('undep-keys-delivered-time').textContent = 'Keys generated ' + relativeTime(Math.floor(deliveredAt / 1000)) + '.';
      } else {
        document.getElementById('undep-keys-delivered-time').textContent = '';
      }
      document.getElementById('undep-program-section').classList.remove('hidden');
      document.getElementById('undep-provision-btn').parentElement.classList.add('hidden');
    }

    function hideUndeployedProgrammingInstructions() {
      document.getElementById('undep-program-section').classList.add('hidden');
      document.getElementById('undep-provision-btn').parentElement.classList.remove('hidden');
    }

    let currentUndeployedUid = null;
    let currentTerminatedUid = null;

    async function provisionCard() {
      if (!currentUndeployedUid) return;
      const btn = document.getElementById('undep-provision-btn');
      const status = document.getElementById('undep-provision-status');
      btn.disabled = true;
      btn.textContent = 'PROVISIONING...';
      btn.classList.add('opacity-50');
      status.classList.remove('hidden');
      status.className = 'mt-3 text-center text-sm text-gray-400';
      status.textContent = 'Writing keys to card...';

      try {
        const endpoint = buildProgrammingEndpointUrl();
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ UID: currentUndeployedUid }),
        });
        const data = await resp.json();
        if (resp.ok) {
          status.className = 'mt-3 text-center text-sm text-emerald-400';
          status.textContent = 'Card provisioned! Version ' + (data.Version || 1) + '. Tap again to activate.';
          btn.textContent = 'PROVISIONED';
          btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
          btn.classList.add('bg-gray-600');
          showUndeployedProgrammingInstructions(endpoint, Date.now());
        } else {
          throw new Error(data.error || 'Provisioning failed');
        }
      } catch (e) {
        status.className = 'mt-3 text-center text-sm text-red-400';
        if (e.message.includes('active') || e.message.includes('Terminate')) {
          status.textContent = 'This card is already active and working. Wipe it first if you want to re-provision.';
        } else {
          status.textContent = 'Error: ' + e.message;
        }
        btn.disabled = false;
        btn.textContent = 'PROVISION AS WITHDRAW CARD';
        btn.classList.remove('opacity-50');
      }
    }

    function showUndeployedCard(result) {
      clearErrors();
      hideAllViews();
      currentUndeployedUid = result.uidHex;
      setCurrentProgrammingEndpoint(result.programmingEndpoint);
      document.getElementById('undep-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
      document.getElementById('undep-version').textContent = result.keyVersion || 1;
      document.getElementById('undep-state').textContent = result.cardState || 'new';
      document.getElementById('undep-keys').innerHTML = buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4);
      const btn = document.getElementById('undep-provision-btn');
      btn.disabled = false;
      btn.textContent = 'PROVISION AS WITHDRAW CARD';
      btn.classList.remove('opacity-50', 'bg-gray-600');
      btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
      document.getElementById('undep-provision-status').classList.add('hidden');
      if (result.awaitingProgramming) {
        showUndeployedProgrammingInstructions(result.programmingEndpoint, result.keysDeliveredAt);
      } else {
        hideUndeployedProgrammingInstructions();
      }
      document.getElementById('undeployed-view').classList.remove('hidden');
    }

    function showPublicCard(result) {
      clearErrors();
      hideAllViews();
      const cardType = result.cardType || 'unknown';
      const typeLabels = { fakewallet: 'WITHDRAW', lnurlpay: 'POS', twofactor: '2FA' };

      document.getElementById('pub-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
      document.getElementById('pub-card-type-badge').textContent = typeLabels[cardType] || cardType.toUpperCase();
      document.getElementById('pub-card-type-badge').className = typeBadgeClass(cardType);
      document.getElementById('pub-version').textContent = result.keyVersion || '-';
      document.getElementById('pub-state').textContent = result.cardState || '-';
      document.getElementById('pub-counter').textContent = result.counterValue;
      document.getElementById('pub-issuer').textContent = result.issuerKey || 'recovered';
      const cmacEl = document.getElementById('pub-cmac');
      cmacEl.textContent = result.cmacValid ? 'VERIFIED' : 'FAILED';
      cmacEl.className = result.cmacValid ? 'font-mono text-emerald-400' : 'font-mono text-red-400';
      document.getElementById('pub-keys').innerHTML = buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4);
      document.getElementById('pub-ndef').textContent = result.ndef || '';
      document.getElementById('public-view').classList.remove('hidden');
      renderTapHistory(result.tapHistory || [], 'pub');
      const pubUid = result.uidHex;
      const pubKeys = [result.k0, result.k1, result.k2, result.k3, result.k4];
      if (pubKeys[0] && pubKeys[1] && pubKeys[2] && pubKeys[3] && pubKeys[4]) {
        const endpointUrl = API_HOST + '/api/keys?uid=' + pubUid + '&format=boltcard';
        document.getElementById('pub-wipe-deeplink').href = 'boltcard://reset?url=' + encodeURIComponent(endpointUrl);
        const qrEl = document.getElementById('qr-pub-wipe');
        qrEl.innerHTML = '';
        new QRCode(qrEl, { text: wipeJson('pub'), width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
      }
    }

    function showPrivateCard(result) {
      clearErrors();
      hideAllViews();
      currentUid = result.uidHex;
      setCurrentProgrammingEndpoint(result.programmingEndpoint);
      const cardType = result.cardType || 'unknown';
      const typeLabels = { fakewallet: 'WITHDRAW', lnurlpay: 'POS', twofactor: '2FA' };

      document.getElementById('priv-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
      document.getElementById('priv-card-type-badge').textContent = typeLabels[cardType] || cardType.toUpperCase();
      document.getElementById('priv-card-type-badge').className = typeBadgeClass(cardType);
      document.getElementById('priv-version').textContent = result.keyVersion || '-';
      document.getElementById('priv-state').textContent = result.cardState || '-';
      document.getElementById('priv-counter').textContent = result.counterValue;
      if (result.balance !== undefined) {
        document.getElementById('priv-balance').textContent = result.balance;
      }
      document.getElementById('priv-issuer').textContent = result.issuerKey || 'current';
      document.getElementById('topup-amount').value = '';
      document.getElementById('topup-status').classList.add('hidden');
      const cmacEl = document.getElementById('priv-cmac');
      cmacEl.textContent = result.cmacValid ? 'VERIFIED' : 'FAILED';
      cmacEl.className = result.cmacValid ? 'font-mono text-emerald-400' : 'font-mono text-red-400';
      document.getElementById('priv-debug-issuer').textContent = '-';
      document.getElementById('priv-debug-version').textContent = '-';
      document.getElementById('priv-debug-versions').textContent = '-';
      if (result.debug) {
        document.getElementById('priv-debug-issuer').textContent = result.debug.issuerKey || '-';
        document.getElementById('priv-debug-version').textContent = result.debug.matchedVersion || '-';
        if (result.debug.versionsTried && result.debug.versionsTried.length > 0) {
          document.getElementById('priv-debug-versions').textContent = result.debug.versionsTried.map(function(v) {
            return 'v' + v.version + ':' + (v.cmac ? 'OK' : 'FAIL');
          }).join(', ');
        }
      }
      document.getElementById('priv-keys').innerHTML = buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4);
      document.getElementById('priv-ndef').textContent = result.ndef || '';
      const privProgrammingSection = document.getElementById('priv-awaiting-programming');
      const terminatedBanner = document.getElementById('priv-terminated-banner');
      const wipeSection = document.getElementById('priv-wipe-section');
      const reprovisionBtn = document.getElementById('priv-reprovision-btn');
      reprovisionBtn.disabled = false;
      reprovisionBtn.textContent = 'RE-PROVISION CARD';
      reprovisionBtn.classList.remove('opacity-50', 'bg-gray-600');
      reprovisionBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
      document.getElementById('priv-reprovision-status').classList.add('hidden');
      document.getElementById('priv-reprovision-program').classList.add('hidden');
      if (result.cardState === 'keys_delivered' && result.programmingEndpoint) {
        const privProgramEndpoint = result.programmingEndpoint;
        const privDeeplink = 'boltcard://program?url=' + encodeURIComponent(privProgramEndpoint);
        const privQrEl = document.getElementById('qr-priv-program');
        privQrEl.innerHTML = '';
        new QRCode(privQrEl, { text: privDeeplink, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
        document.getElementById('priv-program-deeplink').href = privDeeplink;
        if (result.keysDeliveredAt) {
          document.getElementById('priv-keys-delivered-time').textContent = 'Keys generated ' + relativeTime(Math.floor(result.keysDeliveredAt / 1000)) + '.';
        } else {
          document.getElementById('priv-keys-delivered-time').textContent = '';
        }
        privProgrammingSection.classList.remove('hidden');
        wipeSection.classList.add('hidden');
      } else {
        privProgrammingSection.classList.add('hidden');
      }

      if (result.cardState === 'terminated') {
        document.getElementById('priv-term-version').textContent = result.keyVersion || 1;
        terminatedBanner.classList.remove('hidden');
        wipeSection.classList.add('hidden');
      } else {
        terminatedBanner.classList.add('hidden');
      }

      document.getElementById('priv-wipe-version').textContent = 'v' + (result.keyVersion || 1);
      document.getElementById('priv-fetch-wipe-btn').disabled = false;
      document.getElementById('priv-fetch-wipe-btn').textContent = 'GET WIPE KEYS';
      document.getElementById('priv-fetch-wipe-btn').classList.remove('opacity-50', 'bg-gray-600');
      document.getElementById('priv-fetch-wipe-btn').classList.add('bg-red-600', 'hover:bg-red-500');
      document.getElementById('priv-wipe-status').classList.add('hidden');
      document.getElementById('priv-wipe-result').classList.add('hidden');
      if (result.cardState === 'active') {
        wipeSection.classList.remove('hidden');
      } else if (result.cardState === 'wipe_requested') {
        wipeSection.classList.remove('hidden');
        document.getElementById('priv-fetch-wipe-btn').textContent = 'WIPE KEYS ALREADY RETRIEVED';
        document.getElementById('priv-fetch-wipe-btn').disabled = true;
        document.getElementById('priv-fetch-wipe-btn').classList.remove('bg-red-600', 'hover:bg-red-500');
        document.getElementById('priv-fetch-wipe-btn').classList.add('bg-gray-600');
        const statusEl = document.getElementById('priv-wipe-status');
        statusEl.classList.remove('hidden');
        statusEl.className = 'mt-3 text-center text-sm text-amber-400';
        statusEl.textContent = 'Card is pending physical wipe. Tap card with blank NDEF to confirm.';
      } else {
        wipeSection.classList.add('hidden');
      }

      loginTime = Date.now();
      document.getElementById('priv-timer').textContent = '00:00:00';
      document.getElementById('private-view').classList.remove('hidden');
      renderTapHistory(result.tapHistory || [], 'priv');
      startTimer();
    }

    function showTerminatedCard(result) {
      clearErrors();
      hideAllViews();
      currentTerminatedUid = result.uidHex;
      setCurrentProgrammingEndpoint(result.programmingEndpoint);
      const prevVersion = result.keyVersion || 1;
      const nextVersion = prevVersion + 1;
      document.getElementById('term-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
      document.getElementById('term-prev-version').textContent = prevVersion;
      document.getElementById('term-next-version').textContent = nextVersion;
      document.getElementById('term-version').textContent = prevVersion;
      const btn = document.getElementById('term-provision-btn');
      btn.disabled = false;
      btn.textContent = 'RE-PROVISION AS WITHDRAW CARD (v' + nextVersion + ')';
      btn.classList.remove('opacity-50', 'bg-gray-600');
      btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
      document.getElementById('term-provision-status').classList.add('hidden');
      document.getElementById('term-program-section').classList.add('hidden');
      document.getElementById('terminated-view').classList.remove('hidden');
    }

    function showWipedCard(result) {
      clearErrors();
      hideAllViews();
      currentTerminatedUid = result.uidHex;
      setCurrentProgrammingEndpoint(result.programmingEndpoint);
      const version = result.keyVersion || 1;
      document.getElementById('wiped-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
      document.getElementById('wiped-version').textContent = version;
      document.getElementById('wiped-key-version').textContent = version;
      document.getElementById('wiped-next-version').textContent = version + 1;
      const btn = document.getElementById('wiped-confirm-btn');
      btn.disabled = false;
      btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
      btn.classList.remove('opacity-50', 'bg-gray-600');
      btn.classList.add('bg-red-600', 'hover:bg-red-500');
      document.getElementById('wiped-confirm-status').classList.add('hidden');
      document.getElementById('wiped-detection-view').classList.remove('hidden');
    }

    async function confirmWipedCard() {
      const uid = currentTerminatedUid;
      if (!uid) return;
      const btn = document.getElementById('wiped-confirm-btn');
      const status = document.getElementById('wiped-confirm-status');
      btn.disabled = true;
      btn.textContent = 'TERMINATING...';
      btn.classList.add('opacity-50');
      status.classList.remove('hidden');
      status.className = 'mt-3 text-center text-sm text-gray-400';
      status.textContent = 'Terminating card...';

      try {
        const resp = await fetch(API_HOST + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: uid, action: 'terminate' }),
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
          status.className = 'mt-3 text-center text-sm text-emerald-400';
          status.textContent = 'Card terminated. Ready for re-provision at version ' + (data.keyVersion || 2) + '.';
          btn.textContent = 'TERMINATED';
          btn.classList.remove('bg-red-600', 'hover:bg-red-500');
          btn.classList.add('bg-gray-600');
          setTimeout(function() {
            showTerminatedCard({
              uidHex: uid,
              keyVersion: data.keyVersion || 2,
              cardState: 'terminated',
              programmingEndpoint: data.programmingEndpoint,
            });
          }, 1500);
        } else {
          throw new Error(data.error || 'Termination failed');
        }
      } catch (e) {
        status.className = 'mt-3 text-center text-sm text-red-400';
        status.textContent = 'Error: ' + e.message;
        btn.disabled = false;
        btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
        btn.classList.remove('opacity-50');
      }
    }

    async function fetchWipeKeys() {
      const uid = document.getElementById('priv-uid-display').textContent.replace('UID: ', '').toLowerCase();
      if (!uid) return;
      const btn = document.getElementById('priv-fetch-wipe-btn');
      const status = document.getElementById('priv-wipe-status');
      btn.disabled = true;
      btn.textContent = 'FETCHING...';
      btn.classList.add('opacity-50');
      status.classList.remove('hidden');
      status.className = 'mt-3 text-center text-sm text-gray-400';
      status.textContent = 'Retrieving wipe keys...';

      try {
        const resp = await fetch(API_HOST + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: uid, action: 'request-wipe' }),
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
          btn.textContent = 'WIPE KEYS RETRIEVED';
          btn.classList.remove('bg-red-600', 'hover:bg-red-500');
          btn.classList.add('bg-gray-600');
          status.className = 'mt-3 text-center text-sm text-emerald-400';
          status.textContent = 'Card is now pending wipe (v' + data.keyVersion + ')';
          const qrEl = document.getElementById('qr-priv-wipe');
          qrEl.innerHTML = '';
          new QRCode(qrEl, { text: data.wipeJson, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
          document.getElementById('priv-wipe-link').href = data.wipeDeeplink;
          document.getElementById('priv-wipe-json').textContent = data.wipeJson;
          document.getElementById('priv-wipe-result').classList.remove('hidden');
        } else {
          throw new Error(data.error || 'Failed to fetch wipe keys');
        }
      } catch (e) {
        status.className = 'mt-3 text-center text-sm text-red-400';
        status.textContent = 'Error: ' + e.message;
        btn.disabled = false;
        btn.textContent = 'GET WIPE KEYS';
        btn.classList.remove('opacity-50');
      }
    }

    async function topUpBalance() {
      const amountInput = document.getElementById('topup-amount');
      const statusEl = document.getElementById('topup-status');
      const amount = parseInt(amountInput.value, 10);
      if (!amount || amount <= 0) {
        statusEl.textContent = 'Enter a positive amount';
        statusEl.className = 'text-xs mt-2 text-red-400';
        statusEl.classList.remove('hidden');
        return;
      }
      statusEl.textContent = 'Processing...';
      statusEl.className = 'text-xs mt-2 text-gray-400';
      statusEl.classList.remove('hidden');

      try {
        const resp = await fetch(API_HOST + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: currentUid, action: 'top-up', amount }),
        });
        const result = await resp.json();
        if (result.success) {
          document.getElementById('priv-balance').textContent = result.balance;
          amountInput.value = '';
          statusEl.textContent = result.message;
          statusEl.className = 'text-xs mt-2 text-emerald-400';
        } else {
          statusEl.textContent = result.error || 'Top-up failed';
          statusEl.className = 'text-xs mt-2 text-red-400';
        }
      } catch(e) {
        statusEl.textContent = 'Error: ' + e.message;
        statusEl.className = 'text-xs mt-2 text-red-400';
      }
    }

    async function autoConfirmWipe(result) {
      clearErrors();
      hideAllViews();
      showNdef('No NDEF record found. UID: ' + result.uidHex.toUpperCase());
      try {
        const resp = await fetch(API_HOST + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: result.uidHex, action: 'terminate' }),
        });
        const data = await resp.json();
          if (data.success) {
            showTerminatedCard({
              uidHex: result.uidHex,
              keyVersion: data.keyVersion || (result.keyVersion + 1),
              cardState: 'terminated',
              programmingEndpoint: data.programmingEndpoint,
            });
        } else {
          showPersistentError('Failed to confirm wipe: ' + (data.error || 'unknown'));
        }
      } catch (e) {
        showPersistentError('Wipe confirmation error: ' + e.message);
      }
    }

    async function reprovisionCard() {
      if (!currentTerminatedUid) return;
      const btn = document.getElementById('term-provision-btn');
      const status = document.getElementById('term-provision-status');
      btn.disabled = true;
      btn.textContent = 'PROVISIONING...';
      btn.classList.add('opacity-50');
      status.classList.remove('hidden');
      status.className = 'mt-3 text-center text-sm text-gray-400';
      status.textContent = 'Generating new keys...';

      try {
        const endpoint = buildProgrammingEndpointUrl();
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ UID: currentTerminatedUid }),
        });
        const data = await resp.json();
        if (resp.ok) {
          status.className = 'mt-3 text-center text-sm text-emerald-400';
          status.textContent = 'Card re-provisioned at version ' + (data.Version || 2) + '!';
          btn.textContent = 'PROVISIONED';
          btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
          btn.classList.add('bg-gray-600');
          const deeplink = buildProgrammingDeeplink(endpoint);
          const qrEl = document.getElementById('qr-term-program');
          qrEl.innerHTML = '';
          new QRCode(qrEl, { text: deeplink, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
          document.getElementById('term-program-deeplink').href = deeplink;
          document.getElementById('term-keys-delivered-time').textContent = 'Keys generated just now.';
          document.getElementById('term-program-section').classList.remove('hidden');
        } else {
          throw new Error(data.error || 'Provisioning failed');
        }
      } catch (e) {
        status.className = 'mt-3 text-center text-sm text-red-400';
        status.textContent = 'Error: ' + e.message;
        btn.disabled = false;
        const prevVersion = document.getElementById('term-version').textContent;
        btn.textContent = 'RE-PROVISION AS WITHDRAW CARD (v' + (parseInt(prevVersion) + 1) + ')';
        btn.classList.remove('opacity-50');
      }
    }

    async function reprovisionPrivateCard() {
      const uid = document.getElementById('priv-uid-display').textContent.replace('UID: ', '').toLowerCase();
      if (!uid) return;
      const btn = document.getElementById('priv-reprovision-btn');
      const status = document.getElementById('priv-reprovision-status');
      btn.disabled = true;
      btn.textContent = 'PROVISIONING...';
      btn.classList.add('opacity-50');
      status.classList.remove('hidden');
      status.className = 'mt-3 text-center text-sm text-gray-400';
      status.textContent = 'Generating new keys...';

      try {
        const endpoint = buildProgrammingEndpointUrl();
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ UID: uid }),
        });
        const data = await resp.json();
        if (resp.ok) {
          status.className = 'mt-3 text-center text-sm text-emerald-400';
          status.textContent = 'Re-provisioned at version ' + (data.Version || 2) + '!';
          btn.textContent = 'PROVISIONED';
          btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
          btn.classList.add('bg-gray-600');
          const deeplink = buildProgrammingDeeplink(endpoint);
          const qrEl = document.getElementById('qr-priv-reprovision');
          qrEl.innerHTML = '';
          new QRCode(qrEl, { text: deeplink, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
          document.getElementById('priv-reprovision-deeplink').href = deeplink;
          document.getElementById('priv-reprovision-program').classList.remove('hidden');
        } else {
          throw new Error(data.error || 'Provisioning failed');
        }
      } catch (e) {
        status.className = 'mt-3 text-center text-sm text-red-400';
        status.textContent = 'Error: ' + e.message;
        btn.disabled = false;
        btn.textContent = 'RE-PROVISION CARD';
        btn.classList.remove('opacity-50');
      }
    }

    async function validateWithServer(p, c) {
      const resp = await fetch(API_HOST + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p, c }),
      });
      return resp.json();
    }

    async function validateUid(uid) {
      const resp = await fetch(API_HOST + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      return resp.json();
    }

    function rescanCard() {
      hideAllViews();
      document.getElementById('login-view').classList.remove('hidden');
      document.getElementById('scan-status').textContent = 'Scanning... tap your card';
      lastNfcReadTime = 0;
      startNfc();
    }

    function scheduleNfcRestart() {
      setTimeout(() => {
        startNfc().catch(() => {});
      }, 0);
    }

    async function startNfc() {
      const statusEl = document.getElementById('scan-status');
      const indicatorEl = document.getElementById('nfc-indicator');

      if (nfcAbortController) {
        nfcAbortController.abort();
      }

      const abortController = new AbortController();
      nfcAbortController = abortController;

      try {
        const ndef = new NDEFReader();
        await ndef.scan({ signal: abortController.signal });

        if (nfcAbortController !== abortController || abortController.signal.aborted) {
          return;
        }

        statusEl.textContent = 'Scanning... tap your card';
        indicatorEl.classList.remove('hidden');

        ndef.onreading = async (event) => {
          try {
            const now = Date.now();
            if (now - lastNfcReadTime < 3000) return;
            lastNfcReadTime = now;

            clearErrors();

            const rawUrl = await extractNdefUrl(event.message.records, ['lnurlw://', 'lnurlp://', 'https://']);
            const foundUrl = Boolean(rawUrl);
            if (foundUrl) {
              const url = normalizeBrowserNfcUrl(rawUrl);

              showNdef(rawUrl);
              statusEl.textContent = 'Card detected! Verifying...';

              try {
                const urlObj = new URL(url);
                const p = urlObj.searchParams.get('p');
                const c = urlObj.searchParams.get('c');
                if (p && c) {
                  const result = await validateWithServer(p, c);
                  if (result.success) {
                    if (!result.deployed && !result.public) {
                      showUndeployedCard(result);
                    } else if (result.public) {
                      showPublicCard(result);
                    } else {
                      showPrivateCard(result);
                    }
                  } else {
                    showPersistentError(result.error || result.reason || 'Authentication failed');
                    statusEl.textContent = 'Failed. Tap card to retry.';
                  }
                } else {
                  showPersistentError('Card URL missing p/c parameters. Raw: ' + rawUrl);
                  statusEl.textContent = 'Invalid card. Tap to retry.';
                }
              } catch(e) {
                showPersistentError('Could not parse card URL: ' + e.message + '. Raw: ' + rawUrl);
                statusEl.textContent = 'Parse error. Tap to retry.';
              }
            }

            if (!foundUrl && event.serialNumber) {
              const uid = normalizeNfcSerial(event.serialNumber);
              if (/^[0-9a-f]{14}$/.test(uid)) {
                showNdef('No NDEF record found. UID: ' + uid.toUpperCase());
                statusEl.textContent = 'Card detected! Reading UID...';
                try {
                  const result = await validateUid(uid);
                  if (result.success) {
                    if (result.deployed) {
                      if (result.cardState === 'terminated') {
                        showTerminatedCard(result);
                      } else if (result.cardState === 'wipe_requested') {
                        autoConfirmWipe(result);
                      } else if (result.cardState === 'active') {
                        showWipedCard(result);
                      } else {
                        showPrivateCard(result);
                      }
                    } else {
                      showUndeployedCard(result);
                    }
                  } else {
                    showPersistentError(result.error || result.reason || 'UID lookup failed');
                    statusEl.textContent = 'Failed. Tap card to retry.';
                  }
                } catch(e) {
                  showPersistentError('UID lookup error: ' + e.message);
                  statusEl.textContent = 'Error. Tap to retry.';
                }
              }
            }
          } finally {
            if (!abortController.signal.aborted) {
              const cardShown = document.getElementById('login-view').classList.contains('hidden');
              if (cardShown) {
                abortController.abort();
                nfcAbortController = null;
              } else {
                scheduleNfcRestart();
              }
            }
          }
        };

        ndef.onreadingerror = () => {
          if (abortController.signal.aborted) {
            return;
          }
          statusEl.textContent = 'Read error. Tap card again.';
          scheduleNfcRestart();
        };
      } catch (error) {
        if (nfcAbortController === abortController) {
          nfcAbortController = null;
          indicatorEl.classList.add('hidden');
        }
        if (error.name === 'AbortError') {
          return;
        }
        if (error.name === 'NotAllowedError') {
          statusEl.textContent = 'NFC permission denied';
          showPersistentError('NFC permission was denied. Refresh the page and allow NFC access.');
        } else if (error.name === 'NotSupportedError') {
          statusEl.textContent = 'NFC not available';
          showPersistentError('NFC is not available on this device. Use Chrome 89+ on Android.');
        } else {
          statusEl.textContent = 'NFC error';
          showPersistentError('NFC error: ' + error.message);
        }
      }
    }
  </script>
`,
  });
}
