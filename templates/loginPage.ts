import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

interface LoginPageOptions {
  host: string;
  defaultProgrammingEndpoint: string;
}

export function renderLoginPage({ host, defaultProgrammingEndpoint }: LoginPageOptions): string {
  return renderTailwindPage({
    title: "NFC Login",
    csrf: true,
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased flex flex-col items-center justify-center",
    headScripts: '<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>',
    styles: [
      'body { background-color: #111827; color: #f3f4f6; }',
      '.qr-container { display: inline-block; padding: 10px; background: white; border-radius: 8px; margin-top: 10px; }',
      '.pulse-ring { animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }',
      '@keyframes pulse-ring { 0% { transform: scale(0.8); opacity: 1; } 80%, 100% { transform: scale(1.4); opacity: 0; } }',
    ].join('\n'),
    content: rawHtml`
    <div id="login-view" class="max-w-md w-full" data-api-host="${jsString(host)}" data-default-endpoint="${jsString(defaultProgrammingEndpoint)}">
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold text-emerald-500 tracking-tight mb-2">NFC LOGIN</h1>
        <p class="text-gray-400 text-sm">Tap your NTAG424 card to authenticate</p>
        <div class="flex items-center justify-center gap-4 mt-3">
          <a href="/pos" class="text-xs font-semibold text-gray-500 hover:text-emerald-400 transition-colors tracking-wide">POS &#8594;</a>
          <a href="/debug" class="text-xs font-semibold text-gray-500 hover:text-emerald-400 transition-colors tracking-wide">DEBUG &#8594;</a>
        </div>
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
          <button data-action="copy" data-copy-target="ndef-raw" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
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
          <button data-action="copy-all-keys" data-target="undep-keys" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY ALL</button>
        </div>
        <table class="w-full text-sm"><tbody id="undep-keys"></tbody></table>
      </div>

      <div class="bg-gray-800 border border-emerald-500/30 rounded-lg p-4 mb-4">
        <button id="undep-provision-btn" data-action="provision" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded transition-colors">
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
          <button data-action="copy-href" data-copy-target="undep-program-deeplink" class="w-full text-center text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
        </div>
      </div>

      <button data-action="rescan" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
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
          <button data-action="copy-wipe" data-target="pub" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY ALL</button>
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
          <button data-action="copy-href" data-copy-target="pub-wipe-deeplink" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider">NDEF URL</p>
          <button data-action="copy" data-copy-target="pub-ndef" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
        </div>
        <p id="pub-ndef" class="font-mono text-xs text-gray-400 break-all"></p>
      </div>

      <div id="public-error-box" class="hidden bg-red-900/30 border border-red-500/40 rounded-lg p-4 mb-4">
        <p id="public-error-msg" class="text-red-300 text-sm"></p>
      </div>

      <button data-action="rescan" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
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
          <button data-action="topup" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded transition-colors text-sm">
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
        <button data-action="copy-href" data-copy-target="priv-program-deeplink" class="w-full text-center text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
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
          <button data-action="copy-wipe" data-target="priv" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY ALL</button>
        </div>
        <table class="w-full text-sm"><tbody id="priv-keys"></tbody></table>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider">NDEF URL</p>
          <button data-action="copy" data-copy-target="priv-ndef" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
        </div>
        <p id="priv-ndef" class="font-mono text-xs text-gray-400 break-all"></p>
      </div>

      <div id="priv-terminated-banner" class="hidden bg-red-900/30 border border-red-500/40 rounded-lg p-4 mb-4">
        <p class="text-red-300 font-bold text-sm mb-1">Card has been wiped</p>
        <p class="text-red-200/70 text-xs mb-3">Previous version: <span id="priv-term-version" class="font-mono">1</span>. Re-provision to generate new keys.</p>
        <button id="priv-reprovision-btn" data-action="reprovision-private" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded transition-colors text-sm">
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
          <button data-action="copy-href" data-copy-target="priv-reprovision-deeplink" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
        </div>
      </div>

      <div id="priv-wipe-section" class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 hidden">
        <div class="flex justify-between items-center mb-3">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Card Actions</p>
          <span id="priv-wipe-version" class="text-xs text-gray-600 font-mono"></span>
        </div>
        <button id="priv-fetch-wipe-btn" data-action="fetch-wipe" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded transition-colors text-sm">
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
          <button data-action="copy-href" data-copy-target="priv-wipe-link" class="w-full text-center text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
          <div class="mt-3">
            <div class="flex justify-between items-center mb-1">
              <p class="text-xs text-gray-500">Wipe JSON (for key reset screen)</p>
              <button data-action="copy" data-copy-target="priv-wipe-json" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
            </div>
            <pre id="priv-wipe-json" class="font-mono text-[10px] text-gray-500 bg-gray-900 rounded p-2 overflow-x-auto"></pre>
          </div>
        </div>
      </div>

      <div id="private-error-box" class="hidden bg-red-900/30 border border-red-500/40 rounded-lg p-4 mb-4">
        <p id="private-error-msg" class="text-red-300 text-sm"></p>
      </div>

      <button data-action="rescan" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
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
        <button id="term-provision-btn" data-action="reprovision" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded transition-colors">
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
          <button data-action="copy-href" data-copy-target="term-program-deeplink" class="w-full text-center text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">
            COPY DEEPLINK
          </button>
        </div>
      </div>

      <button data-action="rescan" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
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
        <button id="wiped-confirm-btn" data-action="confirm-wiped" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded transition-colors mb-2">
          YES, THIS CARD HAS BEEN WIPED
        </button>
        <button data-action="show-view" data-view="login-view" class="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2 px-4 rounded transition-colors text-sm">
          CANCEL
        </button>
        <div id="wiped-confirm-status" class="hidden mt-3 text-center text-sm"></div>
      </div>

      <button data-action="rescan" class="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-3 px-4 rounded transition-colors text-sm">
        📱 TAP CARD TO SCAN AGAIN
      </button>
    </div>

    ${safe('<script src="/static/js/nfc.js"></script>')}
    ${safe('<script src="/static/js/helpers.js"></script>')}
    ${safe('<script src="/static/js/card-info.js"></script>')}
    ${safe('<script src="/static/js/card-actions.js"></script>')}
    ${safe('<script src="/static/js/programming.js"></script>')}
    ${safe('<script src="/static/js/login.js"></script>')}
`,
  });
}
