import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderDebugConsolePage({ host, baseUrl }: { host: string; baseUrl: string }): string {
  const tabs: Array<{id: string; label: string; icon: string}> = [
    { id: "console", label: "Console", icon: "\u{1f527}" },
    { id: "identify", label: "Identify", icon: "\u{1f50d}" },
    { id: "wipe", label: "Wipe", icon: "\u{1f5d1}" },
    { id: "twofa", label: "2FA", icon: "\u{1f6e1}" },
    { id: "identity", label: "Identity", icon: "\u{1faa}" },
    { id: "pos", label: "POS", icon: "\u{1f3b4}" },
  ];

  const tabButtons: string = tabs.map((t: { id: string; label: string; icon: string }) =>
    `<button class="debug-tab ${t.id === 'console' ? 'active' : ''}" data-tab="${t.id}">${t.icon} ${t.label}</button>`
  ).join("");

  const content: string = rawHtml`
    <div id="debug-root" data-base-url="${jsString(baseUrl)}" data-host="${jsString(host)}" class="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <!-- Tab Bar -->
      <nav class="sticky top-0 z-50 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 px-3 py-2 shadow-lg">
        <div class="max-w-6xl mx-auto flex items-center gap-1 overflow-x-auto">
          <span class="text-xs font-bold text-gray-500 uppercase tracking-wider mr-2 whitespace-nowrap">DEBUG</span>
          ${safe(tabButtons)}
        </div>
      </nav>

      <main class="flex-1 max-w-6xl mx-auto w-full px-4 py-4 md:px-6 flex flex-col gap-4">

        <!-- Shared: Card Info Panel -->
        <div id="card-info-panel" class="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
          <div class="flex items-center gap-3 mb-3">
            <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Card Info</span>
            <button id="nfc-scan-btn" class="ml-auto rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-cyan-500/50 hover:text-cyan-300">Start NFC scan</button>
          </div>
          <div id="nfc-status" class="hidden text-xs text-gray-500 mb-2"></div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div class="text-xs text-gray-500 uppercase">UID</div>
              <div id="ci-uid" class="font-mono text-amber-300 truncate">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Counter</div>
              <div id="ci-counter" class="font-mono text-cyan-300">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Issuer</div>
              <div id="ci-issuer" class="font-mono text-purple-300 truncate text-xs">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Version</div>
              <div id="ci-version" class="font-mono text-gray-300">--</div>
            </div>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mt-2 pt-2 border-t border-gray-800/50">
            <div>
              <div class="text-xs text-gray-500 uppercase">State</div>
              <div id="ci-state" class="font-mono text-gray-300 text-xs">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Method</div>
              <div id="ci-method" class="font-mono text-gray-300 text-xs">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Fingerprint</div>
              <div id="ci-fingerprint" class="font-mono text-gray-300 text-xs truncate">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">CMAC</div>
              <div id="ci-cmac" class="font-mono text-xs">--</div>
            </div>
          </div>
          <!-- Manual URL input -->
          <div class="mt-3 pt-3 border-t border-gray-800/50">
            <div class="text-xs text-gray-500 uppercase tracking-wider mb-2">Or paste card URL</div>
            <div class="flex gap-2">
              <input type="text" id="manual-url" class="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-100 placeholder:text-gray-600 focus:border-cyan-500 focus:outline-none font-mono" placeholder="https://boltcardpoc.psbt.me/?p=XXX&c=YYY" />
              <button id="manual-load-btn" class="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-300 hover:border-cyan-500/50 hover:text-cyan-300 transition">Load</button>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div id="error-message" class="hidden rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"></div>

        <!-- Tab: Console -->
        <div class="debug-panel" id="panel-console">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">NDEF Payload</div>
            <div id="console-ndef" class="font-mono text-xs text-gray-300 break-all min-h-[1.5em]">${safe("Tap a card to inspect\u2026")}</div>
          </div>
          <div id="console-lnurlw" class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 mt-3">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">LNURLW Details</div>
            <div id="console-lnurlw-details" class="text-sm text-gray-400 min-h-[1.5em]">${safe("Waiting for NFC scan\u2026")}</div>
          </div>
          <div class="mt-3 flex flex-col gap-3 sm:flex-row">
            <input type="text" id="console-invoice" class="flex-1 rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none" placeholder="Paste BOLT11 invoice or scan QR" />
            <button id="console-pay-btn" class="hidden rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:bg-cyan-500/40 disabled:text-cyan-100 whitespace-nowrap">Pay</button>
          </div>
          <div id="console-payment-status" class="mt-3 hidden rounded-xl border px-4 py-3 text-sm font-semibold"></div>
          <pre id="console-json" class="mt-3 hidden max-h-96 overflow-auto rounded-xl border border-gray-800 bg-gray-950/80 p-4 text-xs leading-6 text-green-300"></pre>
          <button id="console-toggle-json" class="hidden mt-2 text-xs text-gray-500 hover:text-gray-300 transition">Show raw JSON</button>
        </div>

        <!-- Tab: Identify -->
        <div class="debug-panel hidden" id="panel-identify">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Card Identification</div>
            <div id="identify-details" class="text-sm text-gray-400 min-h-[3em]">${safe("Tap a card to identify it\u2026")}</div>
          </div>
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 mt-3">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Raw API Response</div>
            <pre id="identify-raw" class="text-xs text-green-300 max-h-48 overflow-auto min-h-[1.5em]">--</pre>
          </div>
        </div>

        <!-- Tab: Wipe -->
        <div class="debug-panel hidden" id="panel-wipe">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 text-center">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Single-Card Wipe</div>
            <p class="text-sm text-gray-400 mb-4">Tap a card, then generate a wipe deeplink + QR to reprogram it.</p>
            <div id="wipe-status" class="text-sm text-gray-500 mb-4">${safe("Waiting for card tap\u2026")}</div>
            <button id="wipe-generate-btn" class="hidden w-full rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Generate Wipe Data</button>
          </div>
          <div id="wipe-output" class="hidden rounded-xl border border-gray-800 bg-gray-900/80 p-4 mt-3">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Wipe Result</div>
            <div id="wipe-result" class="text-sm text-gray-400 min-h-[2em]">--</div>
          </div>
          <div id="wipe-actions" class="hidden mt-3 grid gap-3 sm:grid-cols-2">
            <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 text-center">
              <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Deeplink</div>
              <a id="wipe-deeplink" href="#" class="block break-all font-mono text-xs text-cyan-300 hover:text-cyan-200 mb-3">--</a>
              <button data-action="copy-wipe-deeplink" class="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-300 hover:border-gray-500 transition">Copy</button>
              <div id="wipe-copy-toast" class="translate-y-[-20px] opacity-0 transition-all duration-200 text-xs text-emerald-400 font-medium mt-2">Copied!</div>
            </div>
            <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 text-center">
              <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">QR Code</div>
              <div id="wipe-qr" class="flex justify-center"><div class="qr-container"></div></div>
            </div>
          </div>
        </div>

        <!-- Tab: 2FA -->
        <div class="debug-panel hidden" id="panel-twofa">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-8 text-center">
            <div class="text-2xl font-bold text-gray-400 mb-4">2FA Codes</div>
            <p class="text-sm text-gray-500">Tap a card to load TOTP + HOTP codes.</p>
            <div id="twofa-output" class="mt-4 text-left">--</div>
          </div>
        </div>

        <!-- Tab: Identity -->
        <div class="debug-panel hidden" id="panel-identity">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 text-center">
            <div class="text-2xl font-bold text-gray-400 mb-4">Identity Verification</div>
            <p class="text-sm text-gray-500">Tap a card to verify identity.</p>
            <div id="identity-output" class="mt-4 text-left">--</div>
          </div>
        </div>

        <!-- Tab: POS -->
        <div class="debug-panel hidden" id="panel-pos">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Quick Charge</div>
            <div class="flex gap-3">
              <input type="number" id="pos-amount" inputmode="numeric" min="1" class="flex-1 rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-green-500 focus:outline-none" placeholder="Amount" />
              <button id="pos-charge-btn" class="hidden rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">Charge</button>
            </div>
            <div id="pos-status" class="mt-3 hidden rounded-xl border px-4 py-3 text-sm font-semibold"></div>
          </div>
          <div class="mt-3 text-center">
            <a href="/operator/pos" class="text-xs text-gray-500 hover:text-cyan-300 transition">${safe("Open full POS terminal \u2192")}</a>
          </div>
        </div>

      </main>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
    ${safe('<script src="/static/js/nfc.js"></script>')}
    ${safe('<script src="/static/js/helpers.js"></script>')}
    ${safe('<script src="/static/js/card-info.js"></script>')}
    ${safe('<script src="/static/js/card-actions.js"></script>')}
    ${safe('<script src="/static/js/programming.js"></script>')}
    ${safe('<script src="/static/js/debug.js"></script>')}
  `;

  return renderTailwindPage({ title: "Debug Console", content, csrf: true });
}
