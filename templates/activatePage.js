import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS, BROWSER_VALIDATE_UID_HELPER } from "./browserNfc.js";

export function renderActivatePage({ apiUrl, programDeepLink, resetDeepLink, programUrl, resetUrl }) {
  return renderTailwindPage({
    title: "BoltCard Activate",
    csrf: true,
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased flex flex-col items-center",
    headScripts: '<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>',
    styles: [
      'body { background-color: #111827; color: #f3f4f6; }',
      '.qr-container { display: inline-block; padding: 10px; background: white; border-radius: 8px; margin-top: 10px; }',
    ].join('\n'),
    content: rawHtml`
        <div class="max-w-4xl w-full bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-6 md:p-8">
          
          <div class="flex items-center justify-between border-b border-gray-700 pb-4 mb-6">
            <h1 class="text-2xl md:text-3xl font-bold text-amber-500 tracking-tight">CARD ACTIVATION</h1>
            <span class="px-3 py-1 bg-amber-500/10 text-amber-500 text-sm font-mono rounded border border-amber-500/20">OPERATOR MODE</span>
          </div>

          <div class="mb-8 space-y-4">
            <div class="flex flex-wrap gap-3">
              <a href="/debug" class="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20">
                DEBUG & TOOLS
              </a>
              <a href="/debug#console" class="inline-flex items-center rounded border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/20">
                OPEN NFC TEST CONSOLE
              </a>
              <a href="/login" class="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20">
                NFC LOGIN DEMO
              </a>
              <a href="/identity" class="inline-flex items-center rounded border border-pink-500/30 bg-pink-500/10 px-4 py-2 text-sm font-semibold text-pink-300 transition hover:bg-pink-500/20">
                IDENTITY DEMO
              </a>
            </div>

            <h2 class="text-lg font-semibold text-gray-300">API CONFIGURATION</h2>
            <div class="bg-gray-900 rounded p-4 border border-gray-700 font-mono text-sm break-all flex justify-between items-center group">
              <span id="api-url" class="text-gray-400">${apiUrl}</span>
              <button onclick="copyText('api-url')" class="ml-4 text-gray-500 hover:text-amber-500 focus:outline-none transition-colors">
                COPY
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <!-- Program Withdraw Card -->
            <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 flex flex-col items-center">
              <h3 class="text-xl font-bold text-gray-200 mb-1">PROGRAM WITHDRAW</h3>
              <p class="text-xs text-green-400 mb-3 font-mono">Payment card (LNURL-withdraw)</p>
              <p class="text-sm text-gray-400 mb-4 text-center">Tap to pay — card holds sats</p>
              
              <div id="qr-program" class="qr-container mb-4"></div>
              
              <a href="${programDeepLink}" class="w-full text-center bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 px-4 rounded transition-colors mb-3 shadow-[0_0_15px_rgba(217,119,6,0.2)]">
                PROGRAM WITHDRAW CARD
              </a>
              
              <div class="w-full bg-black/50 rounded p-3 border border-gray-800 flex justify-between items-center group mt-auto">
                <span id="link-program" class="font-mono text-xs text-gray-500 truncate mr-2">${programDeepLink}</span>
                <button onclick="copyText('link-program')" class="text-gray-600 hover:text-amber-500 text-xs font-bold shrink-0 transition-colors">
                  COPY
                </button>
              </div>
            </div>

            <!-- Reset Card -->
            <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 flex flex-col items-center">
              <h3 class="text-xl font-bold text-gray-200 mb-1">RESET</h3>
              <p class="text-xs text-blue-400 mb-3 font-mono">Re-provision existing card</p>
              <p class="text-sm text-gray-400 mb-4 text-center">Wipe and re-key an active card</p>
              
              <div id="qr-reset" class="qr-container mb-4"></div>
              
              <a href="${resetDeepLink}" class="w-full text-center border-2 border-amber-600 text-amber-500 hover:bg-amber-600 hover:text-white font-bold py-3 px-4 rounded transition-all mb-3">
                RESET CARD
              </a>
              
              <div class="w-full bg-black/50 rounded p-3 border border-gray-800 flex justify-between items-center group mt-auto">
                <span id="link-reset" class="font-mono text-xs text-gray-500 truncate mr-2">${resetDeepLink}</span>
                <button onclick="copyText('link-reset')" class="text-gray-600 hover:text-amber-500 text-xs font-bold shrink-0 transition-colors">
                  COPY
                </button>
              </div>
            </div>
          </div>

          <!-- Program POS Card -->
          <div class="bg-gray-900 border border-purple-500/30 rounded-lg p-6 mb-8">
            <div class="flex items-center gap-3 mb-4">
              <h3 class="text-xl font-bold text-gray-200">PROGRAM POS CARD</h3>
              <span class="text-xs text-purple-400 font-mono border border-purple-500/30 rounded px-2 py-0.5">LNURL-PAY</span>
            </div>
            <p class="text-sm text-gray-400 mb-4">Customer taps merchant's card and pays — Lightning Address receives sats. Counter becomes order reference.</p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <div>
                <label class="block text-sm font-semibold text-gray-300 mb-2">Lightning Address</label>
                <input id="pos-lightning-address" type="text" value="test@getalby.com" placeholder="user@domain.com"
                  class="w-full bg-black/50 border border-gray-700 rounded px-3 py-2 text-gray-200 font-mono text-sm focus:border-purple-500 focus:outline-none" />
                
                <label class="block text-sm font-semibold text-gray-300 mt-4 mb-2">Amount (sats)</label>
                <input id="pos-amount" type="number" value="1" min="1"
                  class="w-full bg-black/50 border border-gray-700 rounded px-3 py-2 text-gray-200 font-mono text-sm focus:border-purple-500 focus:outline-none" />
                <p class="text-xs text-gray-500 mt-1">Fixed amount per tap. 1 sat for testing.</p>
              </div>

              <div class="flex flex-col items-center">
                <div id="qr-pos" class="qr-container mb-4"></div>
                <a id="pos-deeplink" href="#" class="w-full text-center bg-purple-700 hover:bg-purple-600 text-white font-bold py-3 px-4 rounded transition-colors mb-3">
                  PROGRAM POS CARD
                </a>
                <div class="w-full bg-black/50 rounded p-3 border border-gray-800 flex justify-between items-center group">
                  <span id="link-pos" class="font-mono text-xs text-gray-500 truncate mr-2"></span>
                  <button onclick="copyText('link-pos')" class="text-gray-600 hover:text-amber-500 text-xs font-bold shrink-0 transition-colors">COPY</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Program 2FA Card -->
          <div class="bg-gray-900 border border-emerald-500/30 rounded-lg p-6 mb-8">
            <div class="flex items-center gap-3 mb-4">
              <h3 class="text-xl font-bold text-gray-200">PROGRAM 2FA CARD</h3>
              <span class="text-xs text-emerald-400 font-mono border border-emerald-500/30 rounded px-2 py-0.5">TOTP + HOTP</span>
            </div>
            <p class="text-sm text-gray-400 mb-4">NFC tap provides time-based (TOTP) and counter-based (HOTP) one-time passwords. Tap card to phone, get codes on screen.</p>

            <div class="flex flex-col items-center">
              <div id="qr-2fa" class="qr-container mb-4"></div>
              <a id="2fa-deeplink" href="#" class="w-full text-center bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-3 px-4 rounded transition-colors mb-3">
                PROGRAM 2FA CARD
              </a>
              <div class="w-full bg-black/50 rounded p-3 border border-gray-800 flex justify-between items-center group">
                <span id="link-2fa" class="font-mono text-xs text-gray-500 truncate mr-2"></span>
                <button onclick="copyText('link-2fa')" class="text-gray-600 hover:text-amber-500 text-xs font-bold shrink-0 transition-colors">COPY</button>
              </div>
            </div>
          </div>

          <div class="border-t border-gray-700 pt-6">
            <h2 class="text-lg font-semibold text-gray-300 mb-4">JSON API</h2>
            <div class="space-y-4">
              <div class="bg-gray-900 border border-gray-800 rounded p-4">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs font-bold text-green-500 uppercase">Program Withdraw Card</span>
                  <button onclick="copyText('curl-program')" class="text-xs text-amber-500 hover:text-amber-400 font-bold">COPY</button>
                </div>
                <pre id="curl-program" class="font-mono text-xs text-green-400 overflow-x-auto">curl -X POST '${programUrl}' \
  -H "Content-Type: application/json" \
  -d '{"UID": "04a39493cc8680"}'</pre>
              </div>

              <div class="bg-gray-900 border border-gray-800 rounded p-4">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs font-bold text-purple-500 uppercase">Program POS Card</span>
                  <button onclick="copyText('curl-pos')" class="text-xs text-amber-500 hover:text-amber-400 font-bold">COPY</button>
                </div>
                <pre id="curl-pos" class="font-mono text-xs text-purple-400 overflow-x-auto">curl -X POST '${programUrl}&card_type=pos&lightning_address=user@domain.com' \
  -H "Content-Type: application/json" \
  -d '{"UID": "04a39493cc8680"}'</pre>
              </div>

              <div class="bg-gray-900 border border-gray-800 rounded p-4">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs font-bold text-emerald-500 uppercase">Program 2FA Card</span>
                  <button onclick="copyText('curl-2fa')" class="text-xs text-amber-500 hover:text-amber-400 font-bold">COPY</button>
                </div>
                <pre id="curl-2fa" class="font-mono text-xs text-emerald-400 overflow-x-auto">curl -X POST '${programUrl}&card_type=2fa' \
  -H "Content-Type: application/json" \
  -d '{"UID": "04a39493cc8680"}'</pre>
              </div>

              <div class="bg-gray-900 border border-gray-800 rounded p-4">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs font-bold text-blue-500 uppercase">Reset via LNURLW</span>
                  <button onclick="copyText('curl-reset')" class="text-xs text-amber-500 hover:text-amber-400 font-bold">COPY</button>
                </div>
                <pre id="curl-reset" class="font-mono text-xs text-blue-400 overflow-x-auto">curl -X POST '${resetUrl}' \
  -H "Content-Type: application/json" \
  -d '{"LNURLW": "lnurlw://..."}'</pre>
              </div>
            </div>
          </div>
          
        </div>
        
        <div id="toast" class="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg transform translate-y-20 opacity-0 transition-all duration-300 font-medium z-50">
          Copied to clipboard
        </div>

        <script>
          const posBaseUrl = ${jsString(apiUrl)};
          let posQr = null;

          function updatePosConfig() {
            const address = document.getElementById('pos-lightning-address').value.trim();
            const amount = parseInt(document.getElementById('pos-amount').value) || 1;
            const amountMsat = amount * 1000;
            const posUrl = posBaseUrl + '&card_type=pos&lightning_address=' + encodeURIComponent(address) + '&min_sendable=' + amountMsat + '&max_sendable=' + amountMsat;
            const deepLink = 'boltcard://program?url=' + encodeURIComponent(posUrl);

            const linkEl = document.getElementById('link-pos');
            linkEl.textContent = deepLink;

            const deeplinkEl = document.getElementById('pos-deeplink');
            deeplinkEl.href = deepLink;

            if (posQr) posQr.clear();
            posQr.makeCode(posUrl);
          }

          function setup2faConfig() {
            const twoFaUrl = posBaseUrl + '&card_type=2fa';
            const deepLink = 'boltcard://program?url=' + encodeURIComponent(twoFaUrl);

            document.getElementById('link-2fa').textContent = deepLink;
            document.getElementById('2fa-deeplink').href = deepLink;

            const qr2fa = new QRCode(document.getElementById("qr-2fa"), {
              text: twoFaUrl,
              width: 200, height: 200,
              colorDark: "#000000", colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.L
            });
          }

          document.addEventListener('DOMContentLoaded', () => {
            new QRCode(document.getElementById("qr-program"), {
              text: ${jsString(programUrl)},
              width: 200, height: 200,
              colorDark: "#000000", colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.L
            });

            new QRCode(document.getElementById("qr-reset"), {
              text: ${jsString(resetUrl)},
              width: 200, height: 200,
              colorDark: "#000000", colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.L
            });

            posQr = new QRCode(document.getElementById("qr-pos"), {
              text: "",
              width: 200, height: 200,
              colorDark: "#000000", colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.L
            });

            updatePosConfig();
            setup2faConfig();

            document.getElementById('pos-lightning-address').addEventListener('input', updatePosConfig);
            document.getElementById('pos-amount').addEventListener('input', updatePosConfig);
          });

          function copyText(elementId) {
            const el = document.getElementById(elementId);
            const text = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : el.innerText;
            navigator.clipboard.writeText(text).then(() => {
              showToast();
            }).catch(() => {});
          }

          function showToast() {
            const toast = document.getElementById('toast');
            toast.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(() => {
              toast.classList.add('translate-y-20', 'opacity-0');
            }, 2000);
          }
        </script>
`,
  });
}

export function renderActivateCardPage() {
  const content = rawHtml`
      <div class="max-w-3xl mx-auto p-4 md:p-8">
        <h1 class="text-3xl font-bold text-white mb-2">BoltCard Activation</h1>
        <p class="text-sm text-gray-400 mb-6">Enter your card's UID below or scan it with NFC to activate it with the fake wallet payment method.</p>

        <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-6 mb-6">
          <h2 class="text-xl font-bold text-gray-200 mb-4">Activate New Card</h2>

          <div id="nfc-section" class="mb-4">
            <div id="nfc-status" class="hidden rounded-lg px-4 py-3 text-sm mb-3"></div>
            <p id="nfc-scanning-hint" class="text-sm text-gray-500">Tap your card to auto-fill UID...</p>
          </div>

          <form id="activateForm" action="/experimental/activate/form" method="POST">
            <div class="mb-4">
              <label for="uid" class="block text-sm font-semibold text-gray-300 mb-2">Card UID (7 bytes, 14 hex characters):</label>
              <input type="text" id="uid" name="uid" placeholder="e.g., 04a39493cc8680" required
                     pattern="[0-9a-fA-F]{14}" title="UID must be exactly 14 hexadecimal characters"
                     class="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-gray-200 font-mono text-sm focus:border-cyan-500 focus:outline-none" />
            </div>

            <button type="submit" class="w-full rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-3 px-4 transition-colors">Activate Card with Fake Wallet</button>
          </form>

          <div id="result" class="mt-4 text-sm"></div>
        </div>

        <div class="text-center">
          <a href="/experimental/activate" class="text-xs text-gray-500 hover:text-cyan-300 transition">&larr; Back to card activation</a>
        </div>
      </div>

    <script>
      ${safe(BROWSER_VALIDATE_UID_HELPER)}
      ${safe(BROWSER_NFC_HELPERS)}

      var activateFormScanner = createNfcScanner({
        continuous: false,
        debounceMs: 0,
        onTap: function(data) {
          var nfcStatus = document.getElementById('nfc-status');
          var uidInput = document.getElementById('uid');
          nfcStatus.classList.remove('hidden');
          if (data.serial) {
            var formattedUid = data.serial;
            var validatedUid = validateUid(formattedUid);
            if (validatedUid) {
              uidInput.value = validatedUid;
              nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300';
              nfcStatus.textContent = 'Successfully scanned card UID: ' + validatedUid;
            } else {
              nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
              nfcStatus.textContent = 'Invalid UID format after processing. Expected 14 hex characters.';
            }
          } else {
            nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
            nfcStatus.textContent = 'Could not read UID from card. Please try again.';
          }
          var scanHint = document.getElementById('nfc-scanning-hint');
          if (scanHint) scanHint.textContent = 'Tap again to re-scan card';
        },
        onError: function(err, phase) {
          var nfcStatus = document.getElementById('nfc-status');
          if (phase !== 'permission') {
            nfcStatus.classList.remove('hidden');
            nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
            nfcStatus.textContent = 'Error: ' + err.message;
          }
        }
      });

      document.getElementById('activateForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var result = document.getElementById('result');
        var uidInput = document.getElementById('uid');
        var validatedUid = validateUid(uidInput.value.replace(/:/g, '').toLowerCase());

        if (!validatedUid) {
          result.className = 'mt-4 text-sm text-red-300';
          result.textContent = 'Error: UID must be exactly 7 bytes (14 hex characters)';
          return;
        }

        fetch('/experimental/activate/form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: validatedUid })
        }).then(function(r) { return r.json(); }).then(function(json) {
          if (json.status === 'OK') {
            result.className = 'mt-4 text-sm text-emerald-300';
            result.textContent = 'Card activated successfully! ' + (json.message || '');
          } else {
            result.className = 'mt-4 text-sm text-red-300';
            result.textContent = 'Error: ' + (json.reason || 'Unknown error');
          }
        }).catch(function(error) {
          result.className = 'mt-4 text-sm text-red-300';
          result.textContent = 'Error submitting form: ' + error.message;
        });
      });
    </script>
  `;

  return renderTailwindPage({ title: "BoltCard Activation", content, csrf: true });
}
