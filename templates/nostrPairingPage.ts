import { rawHtml, staticScript } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderNostrPairingPage({ host }: { host: string }): string {
  const content = rawHtml`
    <div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-mono items-center relative overflow-hidden">
      <div class="absolute inset-0 z-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-orange-900 via-gray-950 to-gray-950"></div>

      <div class="z-10 w-full max-w-md p-6 flex flex-col flex-grow">
        <header class="flex justify-between items-center mb-8 pt-4 gap-3">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span class="text-orange-400">🔑</span> PAIR NOSTR
            </h1>
            <p class="text-xs text-gray-500 uppercase tracking-widest mt-1">Link bolt card to Nostr identity</p>
          </div>
          <a href="/credential" class="text-xs text-gray-400 hover:text-white transition-colors">← Credential</a>
        </header>

        <main class="flex-grow flex flex-col gap-6">
          <section class="w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-6 shadow-2xl">
            <h2 class="text-sm font-bold text-orange-400 uppercase tracking-widest mb-4">Step 1: Connect Nostr</h2>

            <div id="nip07-missing" class="hidden p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              No Nostr browser extension detected. Install <a href="https://getalby.com" target="_blank" class="underline">Alby</a> or <a href="https://github.com/fiatjaf/nos2x" target="_blank" class="underline">nos2x</a> to continue.
            </div>

            <div id="nip07-available">
              <button id="btn-connect-nostr" type="button" class="w-full px-4 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-semibold transition-colors shadow-lg shadow-orange-500/20">
                Connect Nostr Identity
              </button>
            </div>

            <div id="nostr-connected" class="hidden">
              <div class="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <span class="text-2xl">✓</span>
                <div class="flex-1 min-w-0">
                  <p class="text-xs text-gray-500 uppercase tracking-wider">Connected</p>
                  <p id="nostr-npub" class="text-sm font-mono text-emerald-400 break-all">—</p>
                </div>
              </div>
            </div>
          </section>

          <section class="w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-6 shadow-2xl">
            <h2 class="text-sm font-bold text-cyan-400 uppercase tracking-widest mb-4">Step 2: Tap Card</h2>

            <div id="pair-idle" class="flex flex-col items-center">
              <div class="w-20 h-20 rounded-full bg-gray-800/50 border border-gray-700 flex items-center justify-center mb-4 relative">
                <div class="absolute inset-0 rounded-full border-2 border-cyan-500/30 animate-ping"></div>
                <span class="text-3xl">📳</span>
              </div>
              <p class="text-sm text-gray-300 mb-2">Tap your bolt card to pair</p>
              <p id="scan-hint" class="text-xs text-cyan-400/60 animate-pulse hidden">Scanning...</p>
              <p id="no-nfc-msg" class="mt-4 text-sm text-red-400/80 hidden">Web NFC not supported. Use <a href="/virtual" class="text-indigo-400 underline">Virtual Card</a> instead.</p>
              <button id="btn-use-virtual" class="mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium transition-colors border border-gray-700 hidden">
                Use Virtual Card
              </button>
            </div>

            <div id="pair-loading" class="hidden flex flex-col items-center">
              <div class="w-16 h-16 mb-4 relative flex items-center justify-center">
                <div class="absolute inset-0 rounded-full border-t-2 border-cyan-500 animate-spin"></div>
                <span class="text-xl animate-pulse text-cyan-400">⚡</span>
              </div>
              <p class="text-sm text-cyan-400">Pairing...</p>
            </div>

            <div id="pair-success" class="hidden">
              <div class="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 mb-4">
                <span class="text-3xl">✅</span>
                <div>
                  <p class="text-sm font-bold text-emerald-400">Paired Successfully!</p>
                  <p class="text-xs text-gray-400 mt-1">Your card is now linked to your Nostr identity. Future credentials will include your npub.</p>
                </div>
              </div>
              <button id="btn-unpair" type="button" class="w-full px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-xs font-semibold transition-colors border border-red-500/30">
                Unpair Card
              </button>
              <a href="/credential" class="block mt-3 text-center text-xs text-gray-400 hover:text-white transition-colors">
                Try issuing a credential →
              </a>
            </div>

            <div id="pair-error" class="hidden flex flex-col items-center">
              <div class="w-16 h-16 rounded-full bg-red-500/10 border-2 border-red-500/50 flex items-center justify-center mb-4">
                <span class="text-2xl">❌</span>
              </div>
              <p class="text-sm font-medium text-red-400 mb-1">Pairing Failed</p>
              <p id="pair-error-msg" class="text-xs text-gray-500 text-center">—</p>
              <button id="btn-retry-pair" class="mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium transition-colors border border-gray-700">
                Try Again
              </button>
            </div>
          </section>

          <section class="w-full bg-gray-900/40 rounded-xl border border-gray-800/50 p-4">
            <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">How It Works</h3>
            <ol class="text-xs text-gray-500 leading-relaxed list-decimal list-inside space-y-1">
              <li>Connect your Nostr identity via browser extension (NIP-07)</li>
              <li>Tap your bolt card to prove possession</li>
              <li>Server links your card UID to your Nostr npub in KV</li>
              <li>Future credentials issued on card tap include your npub</li>
            </ol>
          </section>
        </main>

        <footer class="mt-8 text-center pb-4">
          <div class="flex items-center justify-center gap-4 text-sm">
            <a href="/credential" class="text-gray-500 hover:text-gray-300 transition-colors">Credential demo →</a>
            <a href="/identity" class="text-gray-500 hover:text-gray-300 transition-colors">Identity demo →</a>
          </div>
        </footer>
      </div>
    </div>

    ${staticScript("nostr-pairing.js")}
  `;

  return renderTailwindPage({ title: "Pair Nostr Identity", content, csrf: true });
}
