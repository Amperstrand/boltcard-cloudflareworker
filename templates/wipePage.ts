import { rawHtml, safe, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderWipePage({ baseUrl, resetApiUrl }: { baseUrl: string; resetApiUrl: string }): string {
  return renderTailwindPage({
    title: "BoltCard Wipe Utility",
    csrf: true,
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased flex flex-col items-center",
    headScripts: '<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>',
    styles: [
      'body { background-color: #111827; color: #f3f4f6; }',
      '.qr-container { display: inline-block; padding: 10px; background: white; border-radius: 8px; margin-top: 10px; }',
      '.hidden { display: none !important; }',
    ].join('\n'),
    content: rawHtml`
        <div id="wipe-root" data-base-url="${safe(baseUrl)}" data-reset-api-url="${safe(resetApiUrl)}">
        <div class="max-w-4xl w-full space-y-8">
          
          <div class="flex items-center justify-between border-b border-gray-700 pb-4">
            <h1 class="text-2xl md:text-3xl font-bold text-red-500 tracking-tight">CARD DECOMMISSION</h1>
            <span class="px-3 py-1 bg-red-500/10 text-red-500 text-sm font-mono rounded border border-red-500/20">WIPE TOOL</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            <!-- Workflow 1: NFC Scan -->
            <div class="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl flex flex-col">
              <h2 class="text-xl font-bold text-gray-200 mb-4 border-b border-gray-700 pb-2">WORKFLOW 1: NFC SCAN</h2>
              <p class="text-sm text-gray-400 mb-6">Scan an existing BoltCard to read NDEF payload and extract its UID automatically.</p>
              
              <button id="btn-scan" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded transition-colors mb-6 shadow-[0_0_15px_rgba(37,99,235,0.2)] hidden">
                SCAN AGAIN
              </button>

              <div id="scan-status" class="text-sm font-mono text-gray-400 mb-4 hidden bg-black/30 p-3 rounded border border-gray-700">
                <div class="flex items-center space-x-2">
                  <div class="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
                  <span>Waiting for card tap...</span>
                </div>
              </div>
              <div id="scan-auto-hint" class="text-sm font-mono text-blue-400/60 mb-4 bg-black/20 p-3 rounded border border-blue-500/20">
                <div class="flex items-center space-x-2">
                  <div class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <span>Tap your card to auto-detect UID...</span>
                </div>
              </div>

              <div id="scan-results" class="hidden space-y-4 mb-6">
                <div>
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">UID (SerialNumber)</label>
                  <div id="scan-uid" class="font-mono text-amber-500 bg-gray-900 p-2 rounded border border-gray-700"></div>
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">NDEF URL Parameter p</label>
                  <div id="scan-p" class="font-mono text-xs text-gray-400 bg-gray-900 p-2 rounded border border-gray-700 break-all"></div>
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">NDEF URL Parameter c</label>
                  <div id="scan-c" class="font-mono text-xs text-gray-400 bg-gray-900 p-2 rounded border border-gray-700 break-all"></div>
                </div>
                <button id="btn-wipe-scanned" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded transition-colors mt-4">
                  GENERATE WIPE KEYS
                </button>
              </div>
            </div>

            <!-- Workflow 2: Manual Entry -->
            <div class="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl flex flex-col">
              <h2 class="text-xl font-bold text-gray-200 mb-4 border-b border-gray-700 pb-2">WORKFLOW 2: MANUAL ENTRY</h2>
              <p class="text-sm text-gray-400 mb-6">Manually input a 14-character hex UID to generate wipe keys.</p>
              
              <div class="mb-4">
                <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Card UID (Hex)</label>
                <input type="text" id="manual-uid" placeholder="e.g. 04a39493cc8680" class="w-full bg-gray-900 border border-gray-700 text-gray-200 font-mono p-3 rounded focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors uppercase" maxlength="14" />
              </div>

              <button id="btn-wipe-manual" class="w-full border-2 border-red-600 text-red-500 hover:bg-red-600 hover:text-white font-bold py-3 px-4 rounded transition-all mt-auto">
                GET WIPE KEYS
              </button>
            </div>

          </div>

          <!-- Output Section -->
          <div id="output-section" class="bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl hidden">
            <h2 class="text-xl font-bold text-gray-200 mb-4 border-b border-gray-700 pb-2 flex justify-between items-center">
              WIPE INSTRUCTIONS
              <span id="output-uid-badge" class="px-2 py-1 bg-gray-700 text-amber-500 text-xs font-mono rounded"></span>
            </h2>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <label class="block text-xs font-bold text-gray-500 uppercase mb-2">API Response (Wipe Keys)</label>
                <pre id="api-response" class="font-mono text-xs text-green-400 bg-gray-900 p-4 rounded border border-gray-700 overflow-x-auto min-h-[160px]"></pre>
              </div>
              
              <div class="flex flex-col items-center justify-center bg-gray-900 p-6 rounded border border-gray-700">
                <h3 class="text-sm font-bold text-gray-300 mb-4">RESET DEEP LINK</h3>
                <div id="qr-wipe" class="qr-container mb-4"></div>
                <a id="link-wipe-btn" href="#" class="w-full text-center bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded transition-colors mb-2">
                  OPEN RESET APP
                </a>
                <div class="w-full flex justify-between items-center bg-black/50 p-2 rounded">
                  <span id="link-wipe-text" class="font-mono text-xs text-gray-500 truncate mr-2"></span>
                  <button data-action="copy-wipe-link" class="text-amber-500 hover:text-amber-400 text-xs font-bold">COPY</button>
                </div>
              </div>
            </div>
          </div>
          
        </div>
        
        <div id="toast" class="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg transform translate-y-20 opacity-0 transition-all duration-300 font-medium z-50">
          Copied to clipboard
        </div>

        </div>

        ${staticScript("wipe.js")}
`,
  });
}
