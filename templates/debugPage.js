import { rawHtml } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderDebugPage({ host }) {
  const content = rawHtml`
    <div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans selection:bg-blue-500/30">
      <main class="flex-grow max-w-5xl mx-auto w-full px-4 py-12 md:py-16 flex flex-col gap-10">
        <!-- Header Section -->
        <header class="flex flex-col gap-4">
          <div class="flex items-start justify-between flex-col sm:flex-row sm:items-center gap-4">
            <div>
              <h1 class="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
                Debug & Tools
              </h1>
              <p class="mt-3 text-lg text-gray-400 max-w-2xl">
                Operator dashboard for advanced card management, testing, and experimental features.
              </p>
            </div>
            <a href="/experimental/activate" class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 text-gray-300 hover:text-white hover:border-gray-600 transition-all text-sm font-medium shadow-sm whitespace-nowrap">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
              Back to Activate
            </a>
          </div>
        </header>

        <!-- Tools Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          
          <!-- Card 1 -->
          <a href="/experimental/nfc" class="group relative flex flex-col p-6 rounded-2xl bg-gray-900/80 border border-gray-800 hover:border-blue-500/50 hover:bg-gray-800/80 transition-all duration-300 shadow-sm hover:shadow-xl overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="flex items-start justify-between mb-4 relative z-10">
              <span class="text-3xl drop-shadow-md">🔧</span>
              <span class="text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium flex items-center gap-1">Open <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg></span>
            </div>
            <div class="relative z-10 flex-grow">
              <h2 class="text-xl font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">NFC Test Console</h2>
              <p class="text-gray-400 text-sm leading-relaxed">Tap a boltcard, inspect LNURLW payload, scan/paste bolt11, trigger callback.</p>
            </div>
          </a>

          <!-- Card 2 -->
          <a href="/experimental/analytics" class="group relative flex flex-col p-6 rounded-2xl bg-gray-900/80 border border-gray-800 hover:border-indigo-500/50 hover:bg-gray-800/80 transition-all duration-300 shadow-sm hover:shadow-xl overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="flex items-start justify-between mb-4 relative z-10">
              <span class="text-3xl drop-shadow-md">📊</span>
              <span class="text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium flex items-center gap-1">Open <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg></span>
            </div>
            <div class="relative z-10 flex-grow">
              <h2 class="text-xl font-bold text-white mb-2 group-hover:text-indigo-400 transition-colors">Analytics</h2>
              <p class="text-gray-400 text-sm leading-relaxed">Per-card tap history, payment analytics, balance tracking.</p>
            </div>
          </a>

          <!-- Card 3 -->
          <a href="/experimental/bulkwipe" class="group relative flex flex-col p-6 rounded-2xl bg-gray-900/80 border border-gray-800 hover:border-red-500/50 hover:bg-gray-800/80 transition-all duration-300 shadow-sm hover:shadow-xl overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="flex items-start justify-between mb-4 relative z-10">
              <span class="text-3xl drop-shadow-md">🗑️</span>
              <span class="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium flex items-center gap-1">Open <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg></span>
            </div>
            <div class="relative z-10 flex-grow">
              <h2 class="text-xl font-bold text-white mb-2 group-hover:text-red-400 transition-colors">Bulk Wipe</h2>
              <p class="text-gray-400 text-sm leading-relaxed">Batch wipe and reprogram cards via CSV.</p>
            </div>
          </a>

          <!-- Card 4 -->
          <a href="/pos" class="group relative flex flex-col p-6 rounded-2xl bg-gray-900/80 border border-gray-800 hover:border-green-500/50 hover:bg-gray-800/80 transition-all duration-300 shadow-sm hover:shadow-xl overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="flex items-start justify-between mb-4 relative z-10">
              <span class="text-3xl drop-shadow-md">🃏</span>
              <span class="text-green-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium flex items-center gap-1">Open <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg></span>
            </div>
            <div class="relative z-10 flex-grow">
              <h2 class="text-xl font-bold text-white mb-2 group-hover:text-green-400 transition-colors">POS Payment</h2>
              <p class="text-gray-400 text-sm leading-relaxed">Fakewallet POS — charge amount, tap card, instant payment.</p>
            </div>
          </a>

          <!-- Card 5 -->
          <a href="/experimental/activate" class="group relative flex flex-col p-6 rounded-2xl bg-gray-900/80 border border-gray-800 hover:border-amber-500/50 hover:bg-gray-800/80 transition-all duration-300 shadow-sm hover:shadow-xl overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="flex items-start justify-between mb-4 relative z-10">
              <span class="text-3xl drop-shadow-md">🔑</span>
              <span class="text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium flex items-center gap-1">Open <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg></span>
            </div>
            <div class="relative z-10 flex-grow">
              <h2 class="text-xl font-bold text-white mb-2 group-hover:text-amber-400 transition-colors">Card Activation</h2>
              <p class="text-gray-400 text-sm leading-relaxed">Program new cards, generate QR codes, manage card types.</p>
            </div>
          </a>

          <!-- Card 6 -->
          <a href="/login" class="group relative flex flex-col p-6 rounded-2xl bg-gray-900/80 border border-gray-800 hover:border-purple-500/50 hover:bg-gray-800/80 transition-all duration-300 shadow-sm hover:shadow-xl overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="flex items-start justify-between mb-4 relative z-10">
              <span class="text-3xl drop-shadow-md">🔐</span>
              <span class="text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium flex items-center gap-1">Open <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg></span>
            </div>
            <div class="relative z-10 flex-grow">
              <h2 class="text-xl font-bold text-white mb-2 group-hover:text-purple-400 transition-colors">NFC Login</h2>
              <p class="text-gray-400 text-sm leading-relaxed">Key recovery and card management via NFC tap.</p>
            </div>
          </a>

          <!-- Card 7 -->
          <a href="/identity" class="group relative flex flex-col p-6 rounded-2xl bg-gray-900/80 border border-gray-800 hover:border-pink-500/50 hover:bg-gray-800/80 transition-all duration-300 shadow-sm hover:shadow-xl overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="flex items-start justify-between mb-4 relative z-10">
              <span class="text-3xl drop-shadow-md">🪪</span>
              <span class="text-pink-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium flex items-center gap-1">Open <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg></span>
            </div>
            <div class="relative z-10 flex-grow">
              <h2 class="text-xl font-bold text-white mb-2 group-hover:text-pink-400 transition-colors">Identity Demo</h2>
              <p class="text-gray-400 text-sm leading-relaxed">Boltcard as identity — access control, profile verification.</p>
            </div>
          </a>

          <!-- Card 8 -->
          <a href="/2fa" class="group relative flex flex-col p-6 rounded-2xl bg-gray-900/80 border border-gray-800 hover:border-cyan-500/50 hover:bg-gray-800/80 transition-all duration-300 shadow-sm hover:shadow-xl overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="flex items-start justify-between mb-4 relative z-10">
              <span class="text-3xl drop-shadow-md">🛡️</span>
              <span class="text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium flex items-center gap-1">Open <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg></span>
            </div>
            <div class="relative z-10 flex-grow">
              <h2 class="text-xl font-bold text-white mb-2 group-hover:text-cyan-400 transition-colors">2FA Codes</h2>
              <p class="text-gray-400 text-sm leading-relaxed">NFC-based one-time password generation (TOTP + HOTP).</p>
            </div>
          </a>

        </div>

        <!-- Footer -->
        <footer class="mt-8 pt-6 border-t border-gray-800/50 text-center">
          <p class="text-sm text-gray-500 font-medium tracking-wide">Boltcard POC • Operator tools</p>
        </footer>
      </main>
    </div>
  `;
  
  return renderTailwindPage({ title: "Boltcard Debug & Tools", content });
}
