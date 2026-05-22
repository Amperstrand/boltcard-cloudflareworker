import { rawHtml, safe } from "../utils/rawTemplate.js";
import { getDeployRevision } from "../utils/deployInfo.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderIdentityPage({ host }: { host: string }): string {
  const pageTitle: string = "Boltcard Identity";
  const deployVersion: string = encodeURIComponent(getDeployRevision());
  const emojiOptions: string[] = ["👤", "😀", "😎", "🤖", "🧠", "🚀", "🦊", "🦄", "🐸", "🦉", "⚡", "🔥"];
  const emojiButtons: string = emojiOptions.map((emoji) => `
    <button type="button" data-emoji="${emoji}" class="identity-emoji-btn h-11 w-11 rounded-xl border border-gray-700 bg-gray-950/80 text-2xl transition hover:border-pink-400/60 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-500/30">
      ${emoji}
    </button>
  `).join("");
  
  const content: string = rawHtml`
    <div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-mono items-center relative overflow-hidden">
      
      <!-- Background decoration -->
      <div class="absolute inset-0 z-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800 via-gray-950 to-gray-950"></div>
      
      <div class="z-10 w-full max-w-md p-6 flex flex-col flex-grow">
        <!-- Header -->
          <header class="flex justify-between items-center mb-8 pt-4 gap-3">
            <div>
              <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                <span class="text-blue-500">🛡️</span> IDENTITY
              </h1>
              <p class="text-xs text-gray-500 uppercase tracking-widest mt-1">NFC Access Control + Profile Demo</p>
            </div>
            <div class="flex items-center gap-2">
              <a href="/debug" class="hidden sm:inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 transition hover:border-gray-600 hover:text-white">Debug</a>
              <div id="nfc-status" class="w-10 h-10 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center transition-all duration-300">
                <span class="text-gray-500">⚡</span>
              </div>
            </div>
          </header>

        <!-- Main Panel -->
        <main class="flex-grow flex flex-col justify-center items-center relative">
          <div id="card-panel" class="w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-8 shadow-2xl transition-all duration-500 relative overflow-hidden flex flex-col items-center text-center">
            
            <!-- Idle State -->
            <div id="state-idle" class="flex flex-col items-center w-full transition-opacity duration-300">
              <div class="w-24 h-24 rounded-full bg-gray-800/50 border border-gray-700 flex items-center justify-center mb-6 relative">
                <div class="absolute inset-0 rounded-full border-2 border-blue-500/30 animate-ping"></div>
                <span class="text-4xl">📳</span>
              </div>
              <h2 class="text-xl font-medium text-gray-200 mb-2">Tap Card to Authenticate</h2>
              <p class="text-sm text-gray-500">Present your Boltcard to the device reader</p>
              
              <p id="scan-hint" class="mt-6 text-xs text-blue-400/60 animate-pulse hidden">Scanning for card...</p>
              <button id="btn-scan" class="mt-8 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium tracking-wide transition-colors hidden shadow-lg shadow-blue-500/20">
                RESCAN
              </button>
              <p id="no-nfc-msg" class="mt-8 text-sm text-red-400/80 hidden">Web NFC is not supported on this device/browser. Use Chrome on Android.</p>
            </div>

            <!-- Scanning State -->
            <div id="state-scanning" class="flex flex-col items-center w-full hidden opacity-0 transition-opacity duration-300">
              <div class="w-24 h-24 mb-6 relative flex items-center justify-center">
                <div class="absolute inset-0 rounded-full border-t-2 border-blue-500 animate-spin"></div>
                <span class="text-2xl animate-pulse text-blue-400">⚡</span>
              </div>
              <h2 class="text-xl font-medium text-blue-400 mb-2">Reading...</h2>
              <p class="text-sm text-gray-500">Hold card steady against device</p>
            </div>

            <!-- Verified State -->
            <div id="state-verified" class="flex flex-col items-center w-full hidden opacity-0 transition-opacity duration-300">
              <div id="access-banner-success" class="absolute top-0 left-0 right-0 py-1 bg-emerald-500/20 border-b border-emerald-500/50 flex justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                <span class="text-xs font-bold text-emerald-400 tracking-widest animate-pulse">ACCESS GRANTED</span>
              </div>
              
              <div id="avatar-container" class="w-20 h-20 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 p-0.5 shadow-lg shadow-emerald-500/20 mt-6 mb-4">
                <div class="w-full h-full bg-gray-900 rounded-[10px] flex items-center justify-center text-4xl" id="profile-avatar">
                  👤
                </div>
              </div>
              
              <h2 id="profile-name" class="text-2xl font-bold text-white mb-1 tracking-tight">Operator</h2>
              <div class="flex gap-2 mb-6">
                <span id="profile-role" class="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 border border-gray-700">Role</span>
                <span id="profile-clearance" class="px-2 py-0.5 bg-emerald-900/30 rounded text-xs text-emerald-400 border border-emerald-800/50 font-bold">Level</span>
              </div>
              
              <div class="w-full space-y-3 text-left bg-gray-950/50 p-4 rounded-lg border border-gray-800/50">
                <div class="flex justify-between items-center border-b border-gray-800/50 pb-2">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Status</span>
                  <span class="text-sm font-medium text-emerald-400 flex items-center gap-1">VERIFIED <span class="text-xs">✓</span></span>
                </div>
                <div class="flex justify-between items-center border-b border-gray-800/50 pb-2">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Card UID</span>
                  <span id="profile-uid" class="text-sm font-mono text-gray-300">XX...XX</span>
                </div>
                <div class="flex justify-between items-center border-b border-gray-800/50 pb-2">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Department</span>
                  <span id="profile-dept" class="text-sm font-mono text-gray-300">Engineering</span>
                </div>
                <div class="flex justify-between items-center">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Time</span>
                  <span id="profile-time" class="text-sm font-mono text-gray-400">00:00:00</span>
                </div>
              </div>

              <div class="w-full mt-4 rounded-xl border border-pink-500/20 bg-pink-500/5 p-4 text-left">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-xs text-pink-300 uppercase tracking-[0.2em]">Avatar placeholder</p>
                    <h3 class="mt-1 text-sm font-semibold text-white">Choose the emoji that represents this card</h3>
                    <p class="mt-1 text-xs leading-5 text-gray-400">This is a lightweight stand-in for a future profile photo. It stays attached to this bolt card.</p>
                  </div>
                  <a id="identity-open-2fa" href="#" class="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20">
                    Open 2FA demo
                  </a>
                </div>
                <div id="emoji-picker" class="mt-4 grid grid-cols-6 gap-2">
                  ${emojiButtons}
                </div>
                <div class="mt-3 flex items-center justify-between gap-3">
                  <p id="emoji-save-status" class="text-xs text-gray-500">Pick an emoji to save it to this card profile.</p>
                  <button id="emoji-save-button" type="button" class="rounded-lg bg-pink-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-pink-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400">
                    Save avatar
                  </button>
                </div>
              </div>
               
              <button id="btn-reset" class="mt-6 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-sm font-medium transition-colors border border-gray-700 w-full">
                Verify Another Card
              </button>
            </div>

            <!-- Denied State -->
            <div id="state-denied" class="flex flex-col items-center w-full hidden opacity-0 transition-opacity duration-300">
              <div id="access-banner-error" class="absolute top-0 left-0 right-0 py-1 bg-red-500/20 border-b border-red-500/50 flex justify-center shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                <span class="text-xs font-bold text-red-400 tracking-widest animate-pulse">ACCESS DENIED</span>
              </div>
              
              <div class="w-20 h-20 rounded-full bg-red-500/10 border-2 border-red-500/50 flex items-center justify-center mt-6 mb-4 relative overflow-hidden">
                <div class="absolute inset-0 bg-red-500/20 animate-pulse"></div>
                <span class="text-3xl relative z-10">❌</span>
              </div>
              
              <h2 class="text-xl font-bold text-white mb-2 tracking-tight">Verification Failed</h2>
              
              <div class="w-full mt-4 space-y-3 text-left bg-gray-950/50 p-4 rounded-lg border border-red-900/30">
                <div class="flex justify-between items-center border-b border-gray-800/50 pb-2">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Status</span>
                  <span class="text-sm font-medium text-red-400">UNVERIFIED ✗</span>
                </div>
                <div class="flex justify-between items-center">
                  <span class="text-xs text-gray-500 uppercase tracking-wider">Reason</span>
                  <span id="error-reason" class="text-sm text-gray-300 text-right max-w-[60%] truncate">Card not recognized</span>
                </div>
              </div>
              
              <button id="btn-retry" class="mt-6 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-sm font-medium transition-colors border border-gray-700 w-full">
                Try Again
              </button>
            </div>
            
          </div>
        </main>

        <!-- Footer -->
        <footer class="mt-8 text-center pb-4">
          <div class="flex items-center justify-center gap-4 text-sm">
            <a href="/debug" class="text-gray-500 hover:text-gray-300 transition-colors inline-flex items-center gap-1">
              Debug tools <span>&rarr;</span>
            </a>
            <a href="/2fa" class="text-gray-500 hover:text-cyan-300 transition-colors inline-flex items-center gap-1">
              2FA demo <span>&rarr;</span>
            </a>
          </div>
        </footer>
      </div>
    </div>

    ${safe(rawHtml`<script src="/static/js/nfc.js?v=${deployVersion}"></script>`)}${safe(rawHtml`<script src="/static/js/identity.js?v=${deployVersion}"></script>`)}
  `;
  
  return renderTailwindPage({ title: pageTitle, content, csrf: true });
}
