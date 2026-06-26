import { rawHtml, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderCredentialPage({ host }: { host: string }): string {
  const pageTitle = "Verifiable Credential";

  const content = rawHtml`
    <div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-mono items-center relative overflow-hidden">

      <div class="absolute inset-0 z-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-900 via-gray-950 to-gray-950"></div>

      <div class="z-10 w-full max-w-md p-6 flex flex-col flex-grow">
        <header class="flex justify-between items-center mb-8 pt-4 gap-3">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span class="text-purple-400">🎫</span> CREDENTIAL
            </h1>
            <p class="text-xs text-gray-500 uppercase tracking-widest mt-1">W3C Verifiable Credential Demo</p>
          </div>
          <div class="flex items-center gap-2">
            <a href="/debug" class="hidden sm:inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 transition hover:border-gray-600 hover:text-white">Debug</a>
            <div id="nfc-status" class="w-10 h-10 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center transition-all duration-300">
              <span class="text-gray-500">⚡</span>
            </div>
          </div>
        </header>

        <main class="flex-grow flex flex-col gap-6">

          <!-- Issue Section -->
          <section class="w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-6 shadow-2xl">
            <h2 class="text-sm font-bold text-purple-400 uppercase tracking-widest mb-4">Issue Credential</h2>

            <div id="state-idle" class="flex flex-col items-center w-full transition-opacity duration-300">
              <div class="w-20 h-20 rounded-full bg-gray-800/50 border border-gray-700 flex items-center justify-center mb-4 relative">
                <div class="absolute inset-0 rounded-full border-2 border-purple-500/30 animate-ping"></div>
                <span class="text-3xl">📳</span>
              </div>
              <p class="text-sm font-medium text-gray-200 mb-1">Tap card to issue credential</p>
              <p class="text-xs text-gray-500">Present your Boltcard to receive a signed VC-JWT</p>
              <p id="scan-hint" class="mt-4 text-xs text-purple-400/60 animate-pulse hidden">Scanning for card...</p>
              <p id="no-nfc-msg" class="mt-4 text-sm text-red-400/80 hidden">Web NFC not supported. Use <a href="/virtual" class="text-indigo-400 underline">Virtual Card</a> instead.</p>
            </div>

            <div id="state-loading" class="flex flex-col items-center w-full hidden opacity-0 transition-opacity duration-300">
              <div class="w-16 h-16 mb-4 relative flex items-center justify-center">
                <div class="absolute inset-0 rounded-full border-t-2 border-purple-500 animate-spin"></div>
                <span class="text-xl animate-pulse text-purple-400">⚡</span>
              </div>
              <p class="text-sm text-purple-400">Issuing credential...</p>
            </div>

            <div id="state-issued" class="flex flex-col w-full hidden opacity-0 transition-opacity duration-300">
              <div class="flex items-center gap-2 mb-4">
                <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-xs font-bold text-emerald-400">
                  ✓ ISSUED
                </span>
                <span id="credential-alg" class="px-2 py-1 rounded-md bg-purple-500/20 border border-purple-500/40 text-xs font-bold text-purple-400">ES256</span>
                <span id="credential-time" class="text-xs text-gray-500"></span>
              </div>

              <div class="w-full space-y-2 text-left bg-gray-950/50 p-4 rounded-lg border border-gray-800/50 mb-4">
                <div class="flex justify-between items-center border-b border-gray-800/50 pb-2">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Name</span>
                  <span id="claim-name" class="text-sm font-mono text-gray-300">—</span>
                </div>
                <div class="flex justify-between items-center border-b border-gray-800/50 pb-2">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Role</span>
                  <span id="claim-role" class="text-sm font-mono text-gray-300">—</span>
                </div>
                <div class="flex justify-between items-center border-b border-gray-800/50 pb-2">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Department</span>
                  <span id="claim-dept" class="text-sm font-mono text-gray-300">—</span>
                </div>
                <div class="flex justify-between items-center border-b border-gray-800/50 pb-2">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Clearance</span>
                  <span id="claim-clearance" class="text-sm font-mono text-gray-300">—</span>
                </div>
                <div class="flex justify-between items-center">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Card UID</span>
                  <span id="claim-uid" class="text-sm font-mono text-gray-400">—</span>
                </div>
              </div>

              <div class="w-full mb-4">
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Issuer (did:key)</p>
                <p id="issuer-did" class="text-xs font-mono text-purple-400 break-all bg-gray-950/50 p-2 rounded border border-gray-800/50">—</p>
              </div>

              <div class="w-full mb-4">
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">VC-JWT</p>
                <pre id="vc-jwt-display" class="text-xs font-mono text-gray-300 break-all whitespace-pre-wrap bg-gray-950/50 p-3 rounded border border-gray-800/50 max-h-48 overflow-y-auto select-all">—</pre>
              </div>

              <div class="flex gap-2">
                <button id="btn-copy-jwt" type="button" class="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-lg shadow-purple-500/20">
                  Copy JWT
                </button>
                <button id="btn-toggle-alg" type="button" class="flex-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-semibold transition-colors border border-gray-700">
                  Re-issue as EdDSA
                </button>
                <button id="btn-reset" type="button" class="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-semibold transition-colors border border-gray-700">
                  Reset
                </button>
              </div>
            </div>

            <div id="state-error" class="flex flex-col items-center w-full hidden opacity-0 transition-opacity duration-300">
              <div class="w-16 h-16 rounded-full bg-red-500/10 border-2 border-red-500/50 flex items-center justify-center mb-4">
                <span class="text-2xl">❌</span>
              </div>
              <p class="text-sm font-medium text-red-400 mb-1">Failed to issue credential</p>
              <p id="error-msg" class="text-xs text-gray-500 text-center">—</p>
              <button id="btn-retry" class="mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium transition-colors border border-gray-700">
                Try Again
              </button>
            </div>
          </section>

          <!-- Verify Section -->
          <section class="w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-6 shadow-2xl">
            <h2 class="text-sm font-bold text-cyan-400 uppercase tracking-widest mb-4">Verify Credential</h2>
            <p class="text-xs text-gray-500 mb-3">Paste a VC-JWT to verify its signature and expiry.</p>
            <textarea
              id="verify-input"
              rows="4"
              class="w-full text-xs font-mono text-gray-200 bg-gray-950/80 rounded-lg border border-gray-800 p-3 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 resize-y"
              placeholder="eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9..."
              spellcheck="false"
              autocomplete="off"
            ></textarea>
            <button
              id="btn-verify-input"
              type="button"
              class="mt-3 w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-lg shadow-cyan-500/20"
            >
              Verify Credential
            </button>
            <div id="verify-result" class="mt-3 hidden">
              <div id="verify-status" class="text-sm font-bold mb-2">—</div>
              <div id="verify-details" class="text-xs text-gray-400"></div>
            </div>
          </section>

          <section class="w-full bg-gray-900/40 rounded-xl border border-gray-800/50 p-4">
            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">About</h3>
            <p class="text-xs text-gray-500 leading-relaxed">
              This demo issues W3C Verifiable Credentials (VCDM v2.0) as JWTs using native WebCrypto.
              Supports ES256 (P-256) and EdDSA (Ed25519) algorithms. The issuer identity is a self-contained
              <code class="text-purple-400">did:key</code> — no external DID resolver needed.
            </p>
          </section>
        </main>

        <footer class="mt-8 text-center pb-4">
          <div class="flex items-center justify-center gap-4 text-sm">
            <a href="/identity" class="text-gray-500 hover:text-gray-300 transition-colors inline-flex items-center gap-1">
              Identity demo <span>&rarr;</span>
            </a>
            <a href="/debug" class="text-gray-500 hover:text-gray-300 transition-colors inline-flex items-center gap-1">
              Debug tools <span>&rarr;</span>
            </a>
          </div>
        </footer>
      </div>
    </div>

    ${staticScript("credential.js")}
  `;

  return renderTailwindPage({ title: pageTitle, content, csrf: true });
}
