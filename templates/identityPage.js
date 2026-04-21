import { rawHtml } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS } from "./browserNfc.js";

export function renderIdentityPage({ host }) {
  const pageTitle = "Boltcard Identity";
  
  const content = rawHtml`
    <div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-mono items-center relative overflow-hidden">
      
      <!-- Background decoration -->
      <div class="absolute inset-0 z-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800 via-gray-950 to-gray-950"></div>
      
      <div class="z-10 w-full max-w-md p-6 flex flex-col flex-grow">
        <!-- Header -->
        <header class="flex justify-between items-center mb-8 pt-4">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span class="text-blue-500">🛡️</span> IDENTITY
            </h1>
            <p class="text-xs text-gray-500 uppercase tracking-widest mt-1">NFC Access Control</p>
          </div>
          <div id="nfc-status" class="w-10 h-10 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center transition-all duration-300">
            <span class="text-gray-500">⚡</span>
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
              
              <button id="btn-scan" class="mt-8 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium tracking-wide transition-colors hidden shadow-lg shadow-blue-500/20">
                START SCAN
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
          <a href="/debug" class="text-sm text-gray-500 hover:text-gray-300 transition-colors inline-flex items-center gap-1">
            Back to debug tools <span>&rarr;</span>
          </a>
        </footer>
      </div>
    </div>

    <script>
      ${BROWSER_NFC_HELPERS}

      document.addEventListener('DOMContentLoaded', () => {
        const ui = {
          idle: document.getElementById('state-idle'),
          scanning: document.getElementById('state-scanning'),
          verified: document.getElementById('state-verified'),
          denied: document.getElementById('state-denied'),
          panel: document.getElementById('card-panel'),
          btnScan: document.getElementById('btn-scan'),
          btnRetry: document.getElementById('btn-retry'),
          btnReset: document.getElementById('btn-reset'),
          noNfcMsg: document.getElementById('no-nfc-msg'),
          nfcStatus: document.getElementById('nfc-status')
        };

        const profile = {
          avatar: document.getElementById('profile-avatar'),
          name: document.getElementById('profile-name'),
          role: document.getElementById('profile-role'),
          dept: document.getElementById('profile-dept'),
          clearance: document.getElementById('profile-clearance'),
          uid: document.getElementById('profile-uid'),
          time: document.getElementById('profile-time'),
          reason: document.getElementById('error-reason')
        };

        const AVATARS = ['👩‍💻', '👨‍🚀', '🦸‍♀️', '🥷', '🧙‍♂️', '🕵️‍♀️', '🧛‍♂️', '🤖'];
        const DEPTS = ['Engineering', 'Security', 'Operations', 'Command'];
        const ROLES = ['Administrator', 'Specialist', 'Technician', 'Director'];

        let appState = 'idle';
        let abortController = null;

        function setState(newState) {
          appState = newState;
          
          ['idle', 'scanning', 'verified', 'denied'].forEach(s => {
            ui[s].classList.add('hidden');
            ui[s].classList.remove('opacity-100');
            ui[s].classList.add('opacity-0');
          });
          
          ui.panel.className = 'w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-8 shadow-2xl transition-all duration-500 relative overflow-hidden flex flex-col items-center text-center';
          ui.nfcStatus.className = 'w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-300';
          ui.nfcStatus.innerHTML = '<span class="text-gray-500">⚡</span>';
          
          const target = ui[newState];
          target.classList.remove('hidden');
          
          void target.offsetWidth; // Reflow
          
          target.classList.remove('opacity-0');
          target.classList.add('opacity-100');

          if (newState === 'verified') {
            ui.panel.classList.replace('border-gray-800', 'border-emerald-500/50');
            ui.panel.classList.add('shadow-[0_0_30px_rgba(16,185,129,0.15)]');
            ui.nfcStatus.classList.add('bg-emerald-500/20', 'border-emerald-500/50');
            ui.nfcStatus.innerHTML = '<span class="text-emerald-400">✓</span>';
          } else if (newState === 'denied') {
            ui.panel.classList.replace('border-gray-800', 'border-red-500/50');
            ui.panel.classList.add('shadow-[0_0_30px_rgba(239,68,68,0.15)]');
            ui.nfcStatus.classList.add('bg-red-500/20', 'border-red-500/50');
            ui.nfcStatus.innerHTML = '<span class="text-red-400">✗</span>';
          } else if (newState === 'scanning') {
            ui.panel.classList.replace('border-gray-800', 'border-blue-500/50');
            ui.nfcStatus.classList.add('bg-blue-500/20', 'border-blue-500/50', 'animate-pulse');
            ui.nfcStatus.innerHTML = '<span class="text-blue-400">📳</span>';
          } else {
            ui.nfcStatus.classList.add('bg-gray-900', 'border-gray-800');
          }
        }

        function generateDeterministicProfile(uidHex) {
          const hex = (uidHex || "00000000").padEnd(8, '0');
          
          const p0 = parseInt(hex.substring(0, 2), 16) || 0;
          const p1 = parseInt(hex.substring(2, 4), 16) || 0;
          const p2 = parseInt(hex.substring(4, 6), 16) || 0;
          const p3 = parseInt(hex.substring(6, 8), 16) || 0;

          return {
            avatar: AVATARS[p0 % AVATARS.length],
            name: 'Operator-' + hex.substring(0, 4).toUpperCase(),
            role: ROLES[p3 % ROLES.length],
            dept: DEPTS[p1 % DEPTS.length],
            level: 'Level ' + ((p2 % 5) + 1)
          };
        }

        async function processNdefUrl(url) {
          setState('scanning');
          try {
            const parsed = new URL(url);
            const p = parsed.searchParams.get('p');
            const c = parsed.searchParams.get('c');

            if (!p || !c) {
              throw new Error('Invalid card payload');
            }

            const response = await fetch('/api/verify-identity?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
            const data = await response.json();

            if (data.verified) {
              const pData = generateDeterministicProfile(data.uid);
              profile.avatar.textContent = pData.avatar;
              profile.name.textContent = pData.name;
              profile.role.textContent = pData.role;
              profile.dept.textContent = pData.dept;
              profile.clearance.textContent = pData.level;
              profile.uid.textContent = data.maskedUid;
              
              const now = new Date();
              profile.time.textContent = now.toLocaleTimeString([], { hour12: false });
              
              setState('verified');
            } else {
              profile.reason.textContent = data.reason || 'Verification failed';
              setState('denied');
            }
          } catch (err) {
            console.error(err);
            profile.reason.textContent = err.message || 'Network error';
            setState('denied');
          }
        }

        async function startScan() {
          if (!browserSupportsNfc()) {
            alert('NFC not supported on this device');
            return;
          }

          if (abortController) {
            abortController.abort();
          }
          abortController = new AbortController();

          try {
            const ndef = new NDEFReader();
            await ndef.scan({ signal: abortController.signal });
            
            setState('scanning');
            
            ndef.onreadingerror = () => {
              profile.reason.textContent = 'Read error. Try again.';
              setState('denied');
            };

            ndef.onreading = event => {
              const url = extractNdefUrl(event.message);
              if (url) {
                processNdefUrl(url);
              } else {
                profile.reason.textContent = 'No NDEF URL found on card';
                setState('denied');
              }
            };
          } catch (error) {
            console.error('Scan error:', error);
            if (error.name !== 'AbortError') {
              profile.reason.textContent = error.message || 'Scan failed to start';
              setState('denied');
            }
          }
        }

        if (browserSupportsNfc()) {
          ui.btnScan.classList.remove('hidden');
          ui.btnScan.addEventListener('click', startScan);
        } else {
          ui.noNfcMsg.classList.remove('hidden');
        }

        ui.btnRetry.addEventListener('click', () => {
          setState('idle');
          if (browserSupportsNfc()) {
            startScan().catch(e => console.log('Auto-scan on retry failed', e));
          }
        });
        
        ui.btnReset.addEventListener('click', () => {
          setState('idle');
          if (browserSupportsNfc()) {
            startScan().catch(e => console.log('Auto-scan on reset failed', e));
          }
        });
      });
    </script>
  `;
  
  return renderTailwindPage({ title: pageTitle, content });
}
