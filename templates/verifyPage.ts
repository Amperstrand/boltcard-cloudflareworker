import { rawHtml, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderVerifyPage({ host }: { host: string }): string {
  const pageTitle = "Verify Credential";

  const content = rawHtml`
    <div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-mono items-center relative overflow-hidden">

      <div class="absolute inset-0 z-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900 via-gray-950 to-gray-950"></div>

      <div class="z-10 w-full max-w-2xl p-6 flex flex-col flex-grow">
        <header class="flex justify-between items-center mb-8 pt-4 gap-3">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span class="text-cyan-400">&#x2705;</span>
              Verify Credential
            </h1>
            <p class="text-xs text-gray-500 mt-1">Third-party verification — no NFC card required</p>
          </div>
          <a href="/credential" class="text-xs text-gray-500 hover:text-purple-400 transition-colors whitespace-nowrap">&#8592; Issue</a>
        </header>

        <main class="flex flex-col gap-4 flex-grow">

          <section class="w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-6 shadow-2xl">
            <h2 class="text-sm font-bold text-cyan-400 uppercase tracking-widest mb-4">Paste Credential</h2>
            <p class="text-xs text-gray-500 mb-3">Paste a VC-JWT, Data Integrity proof, or SD-JWT below.</p>
            <textarea
              id="verify-input"
              rows="6"
              class="w-full text-xs font-mono text-gray-200 bg-gray-950/80 rounded-lg border border-gray-800 p-3 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/50 resize-y"
              placeholder="eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9...&#10;or {&quot;@context&quot;:[...],&quot;proof&quot;:{...}}&#10;oreyJ0eXAi...~eyJhbGci..."
              spellcheck="false"
              autocomplete="off"
            ></textarea>
            <div class="flex gap-2 mt-3">
              <button
                id="btn-verify"
                type="button"
                class="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-lg shadow-cyan-500/20">
                Verify
              </button>
              <button
                id="btn-clear"
                type="button"
                class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-semibold transition-colors border border-gray-700">
                Clear
              </button>
            </div>
          </section>

          <section id="result-section" class="w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-6 shadow-2xl hidden">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-sm font-bold uppercase tracking-widest" id="result-title">Result</h2>
              <span id="result-badge" class="text-xs font-bold px-3 py-1 rounded-full"></span>
            </div>

            <div id="result-details" class="space-y-3"></div>
          </section>

          <section class="w-full bg-gray-900/40 rounded-xl border border-gray-800/50 p-4">
            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">How Verification Works</h3>
            <div class="text-xs text-gray-500 leading-relaxed space-y-2">
              <p>This verifier checks the credential signature against the issuer's <code class="text-purple-400">did:key</code> identifier.</p>
              <p><strong class="text-gray-400">Supported formats:</strong></p>
              <ul class="list-disc list-inside ml-2 space-y-1">
                <li><strong class="text-gray-400">VC-JWT</strong> — Compact JWT (ES256 / EdDSA)</li>
                <li><strong class="text-gray-400">Data Integrity</strong> — JCS + Ed25519 proof block</li>
                <li><strong class="text-gray-400">SD-JWT</strong> — Selective disclosure (RFC 9901)</li>
              </ul>
              <p class="mt-2">No external DID resolver or blockchain lookup needed. The public key is embedded in the did:key identifier.</p>
            </div>
            <a href="/api/credential/issuer" class="mt-3 inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors">
              View issuer did:key &#8594;
            </a>
          </section>
        </main>

        <footer class="mt-8 text-center pb-4">
          <div class="flex items-center justify-center gap-3 flex-wrap text-sm">
            <a href="/credential" class="text-gray-500 hover:text-purple-400 transition-colors">Issue Credential</a>
            <span class="text-gray-700">&middot;</span>
            <a href="/pair-nostr" class="text-gray-500 hover:text-orange-400 transition-colors">Pair Nostr</a>
            <span class="text-gray-700">&middot;</span>
            <a href="/" class="text-gray-500 hover:text-gray-300 transition-colors">Home</a>
          </div>
        </footer>
      </div>
    </div>
    ${staticScript("verify.js")}
  `;

  return renderTailwindPage({ title: pageTitle, content, csrf: false });
}
