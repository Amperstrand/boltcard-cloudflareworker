import { rawHtml, safe, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderBulkWipePage({ baseUrl, keyOptionsHtml }: { baseUrl: string; keyOptionsHtml: string }): string {
  return renderTailwindPage({
    title: "Bulk Card Wipe",
    csrf: true,
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased flex flex-col items-center",
    headScripts: '<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>',
    styles: [
      'body { background-color: #111827; color: #f3f4f6; }',
      '.qr-container { display: inline-block; padding: 10px; background: white; border-radius: 8px; margin-top: 10px; }',
      '.hidden { display: none !important; }',
    ].join('\n'),
    content: rawHtml`
        <div id="bulk-wipe-root" data-base-url="${safe(baseUrl)}">
        <div class="max-w-4xl w-full space-y-8">

          <div class="flex items-center justify-between border-b border-gray-700 pb-4">
            <h1 class="text-2xl md:text-3xl font-bold text-red-500 tracking-tight">BULK WIPE TOOL</h1>
            <span class="px-3 py-1 bg-red-500/10 text-red-500 text-sm font-mono rounded border border-red-500/20">MULTI-CARD</span>
          </div>

          <p class="text-sm text-gray-400">Wipe cards using known issuer keys or provide your own.</p>

          <!-- Tap-to-Detect Section -->
          <div class="bg-gray-800 border border-blue-500/30 rounded-lg p-6 shadow-xl">
            <h2 class="text-lg font-bold text-gray-200 mb-4 border-b border-gray-700 pb-2">TAP CARD TO AUTO-DETECT</h2>
            <p class="text-sm text-gray-400 mb-4">Tap a card to automatically identify its issuer key and version. This helps you find the right master secret without guessing.</p>

            <div id="detect-status" class="text-sm font-mono text-blue-400/60 mb-3 bg-black/20 p-3 rounded border border-blue-500/20">
              <div class="flex items-center space-x-2">
                <div class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>Tap your card to detect issuer key...</span>
              </div>
            </div>

            <div id="detect-result" class="hidden space-y-3 mb-4">
              <div class="grid grid-cols-2 gap-3 text-sm">
                <div><span class="text-gray-500">UID:</span> <span id="detect-uid" class="font-mono text-amber-400">-</span></div>
                <div><span class="text-gray-500">Version:</span> <span id="detect-version" class="font-mono text-emerald-400">-</span></div>
                <div class="col-span-2"><span class="text-gray-500">Issuer Key:</span> <span id="detect-label" class="font-mono text-gray-300">-</span></div>
              </div>
              <div class="flex gap-3">
                <button id="detect-wipe-this" class="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded transition-colors text-sm">
                  WIPE THIS CARD
                </button>
                <button id="detect-use-key" class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2 px-4 rounded transition-colors text-sm">
                  USE THIS KEY FOR BULK WIPE
                </button>
              </div>
            </div>

            <div id="detect-error" class="hidden bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm p-3 rounded font-mono mb-4">
            </div>
          </div>

          <!-- Section 1: Issuer Key Selection -->
          <div class="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl">
            <h2 class="text-lg font-bold text-gray-200 mb-4 border-b border-gray-700 pb-2">SELECT ISSUER KEY</h2>
            <div class="mb-2">
              <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Known Issuer Key</label>
              <select id="key-select" class="w-full bg-gray-900 border border-gray-700 text-gray-200 font-mono p-3 rounded focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors">
 ${safe(keyOptionsHtml)}                <option value="custom">Custom key...</option>
              </select>
            </div>
          </div>

          <!-- Section 2: Custom Key Input -->
          <div id="custom-key-section" class="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl hidden">
            <h2 class="text-lg font-bold text-gray-200 mb-4 border-b border-gray-700 pb-2">CUSTOM KEY</h2>
            <div>
              <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Issuer Key (32-char hex)</label>
              <input type="text" id="custom-key" placeholder="e.g. A1B2C3D4E5F60718293A4B5C6D7E8F90" class="w-full bg-gray-900 border border-gray-700 text-gray-200 font-mono p-3 rounded focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors uppercase" maxlength="32" />
            </div>
          </div>

          <!-- Section 3: UID Input -->
          <div class="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl">
            <h2 class="text-lg font-bold text-gray-200 mb-4 border-b border-gray-700 pb-2">CARD UID(S)</h2>
            <div>
              <label class="block text-xs font-bold text-gray-500 uppercase mb-2">One UID per line (14-char hex)</label>
              <textarea id="uid-input" rows="6" placeholder="040660fa967380 (one per line)" class="w-full bg-gray-900 border border-gray-700 text-gray-200 font-mono p-3 rounded focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors uppercase"></textarea>
            </div>
          </div>

          <!-- Section 4: Generate Button -->
          <button id="btn-generate" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded transition-colors shadow-[0_0_15px_rgba(220,38,38,0.2)]">
            GENERATE WIPE DATA
          </button>

          <!-- Inline error display -->
          <div id="error-msg" class="hidden bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded font-mono"></div>

          <!-- Section 5: Results -->
          <div id="results" class="space-y-6"></div>

          <!-- PR note -->
          <div class="text-center text-xs text-gray-500 border-t border-gray-800 pt-4">
            Don't see your issuer key? <a href="https://github.com/pn532/boltcard-cloudflareworker" class="text-amber-500 hover:text-amber-400 underline">Submit a pull request</a> with your key file.
          </div>

        </div>

          <div id="toast" class="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg transform translate-y-20 opacity-0 transition-all duration-300 font-medium z-50">
            Copied to clipboard
          </div>

        </div>
${staticScript("bulk-wipe.js")}
        ${staticScript("bulk-wipe.js")}
`,
  });
}
