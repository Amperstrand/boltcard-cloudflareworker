import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS, BROWSER_VALIDATE_UID_HELPER } from "./browserNfc.js";

export function renderBulkWipePage({ baseUrl, keyOptionsHtml }) {
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

          <script>
  ${safe(BROWSER_VALIDATE_UID_HELPER)}
  ${safe(BROWSER_NFC_HELPERS)}

           const baseUrl = ${jsString(baseUrl)};

           // Tap-to-detect
           var detectScanner = null;
           var detectedUid = null;
           var detectedVersion = null;
           var detectedFingerprint = null;

           function initDetectScanner() {
             detectScanner = createNfcScanner({
               continuous: false,
               debounceMs: 0,
               onTap: async function(data) {
                 var url = data.url;
                 if (!url) {
                   document.getElementById('detect-error').textContent = 'No URL found on card. The card may not be programmed.';
                   document.getElementById('detect-error').classList.remove('hidden');
                   document.getElementById('detect-status').classList.add('hidden');
                   return;
                 }
                 try {
                   var parsed = new URL(url);
                   var p = parsed.searchParams.get('p');
                   var c = parsed.searchParams.get('c');
                   if (!p || !c) {
                     document.getElementById('detect-error').textContent = 'Card URL missing p/c parameters.';
                     document.getElementById('detect-error').classList.remove('hidden');
                     document.getElementById('detect-status').classList.add('hidden');
                     return;
                   }
                   document.getElementById('detect-status').querySelector('span').textContent = 'Identifying card...';
                   var resp = await fetch('/api/identify-issuer-key', {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ p: p, c: c })
                   });
                   var result = await resp.json();
                   document.getElementById('detect-status').classList.add('hidden');
                   if (result.matched) {
                     detectedUid = result.uid;
                     detectedVersion = result.version;
                     detectedFingerprint = result.issuerKeyFingerprint;
                     document.getElementById('detect-uid').textContent = result.uid.toUpperCase();
                     document.getElementById('detect-version').textContent = result.version;
                     document.getElementById('detect-label').textContent = result.issuerKeyLabel;
                     document.getElementById('detect-result').classList.remove('hidden');
                     document.getElementById('detect-error').classList.add('hidden');
                     var keySelect = document.getElementById('key-select');
                     var matchedOption = keySelect.querySelector('option[data-fingerprint="' + result.issuerKeyFingerprint + '"]');
                     if (matchedOption) {
                       keySelect.value = matchedOption.value;
                       keySelect.dispatchEvent(new Event('change'));
                     } else {
                       keySelect.value = 'custom';
                       keySelect.dispatchEvent(new Event('change'));
                       document.getElementById('custom-key').value = '';
                       document.getElementById('custom-key').focus();
                     }
                   } else {
                     document.getElementById('detect-error').textContent = 'Unknown issuer \u2014 this card was not provisioned with any of our known issuer keys. Switch to Custom key\u2026 and paste the master secret manually.';
                     document.getElementById('detect-error').classList.remove('hidden');
                     document.getElementById('detect-result').classList.add('hidden');
                     document.getElementById('key-select').value = 'custom';
                     document.getElementById('key-select').dispatchEvent(new Event('change'));
                     document.getElementById('custom-key').focus();
                   }
                 } catch (e) {
                   document.getElementById('detect-error').textContent = 'Error: ' + e.message;
                   document.getElementById('detect-error').classList.remove('hidden');
                   document.getElementById('detect-status').classList.add('hidden');
                 }
               },
               onError: function(err, phase) {
                 if (phase === 'permission') {
                   document.getElementById('detect-status').querySelector('span').textContent = 'NFC permission denied. Tap to retry.';
                 }
               },
               onStatus: function(status) {
                 var el = document.getElementById('detect-status');
                 if (status === 'scanning') {
                   el.classList.remove('hidden');
                   el.querySelector('span').textContent = 'Tap your card to detect issuer key...';
                 } else {
                   el.classList.add('hidden');
                 }
               }
             });
           }

           if (browserSupportsNfc()) {
             initDetectScanner();
             window.addEventListener('load', function() { detectScanner.scan(); });
           } else {
             document.getElementById('detect-status').querySelector('span').textContent = 'Web NFC not supported. Use Chrome on Android.';
             document.getElementById('detect-status').querySelector('div').className = 'w-2 h-2 bg-red-500 rounded-full';
           }

           document.getElementById('detect-wipe-this').addEventListener('click', function() {
             if (!detectedUid) return;
             document.getElementById('uid-input').value = detectedUid.toUpperCase();
             var keySelect = document.getElementById('key-select');
             if (keySelect.value !== 'custom') {
               var matchedOption = keySelect.querySelector('option[data-fingerprint="' + detectedFingerprint + '"]');
               if (matchedOption) keySelect.value = matchedOption.value;
             }
             document.getElementById('btn-generate').click();
           });

           document.getElementById('detect-use-key').addEventListener('click', function() {
             document.getElementById('uid-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
           });

          // Toggle custom key section
          document.getElementById('key-select').addEventListener('change', (e) => {
            const section = document.getElementById('custom-key-section');
            if (e.target.value === 'custom') {
              section.classList.remove('hidden');
            } else {
              section.classList.add('hidden');
            }
          });

          // Show inline error
          function showError(msg) {
            const el = document.getElementById('error-msg');
            el.textContent = msg;
            el.classList.remove('hidden');
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }

          function hideError() {
            document.getElementById('error-msg').classList.add('hidden');
          }

          // Toast
          function showToast() {
            const toast = document.getElementById('toast');
            toast.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(() => {
              toast.classList.add('translate-y-20', 'opacity-0');
            }, 2000);
          }

          // Copy helper
          function copyText(text) {
            navigator.clipboard.writeText(text).then(() => showToast()).catch(() => {});
          }

          // Generate button
          document.getElementById('btn-generate').addEventListener('click', async () => {
            hideError();
            const results = document.getElementById('results');
            results.innerHTML = '';

            // Get key
            const keySelect = document.getElementById('key-select');
            let key = keySelect.value;
            if (key === 'custom') {
              key = document.getElementById('custom-key').value.trim().toLowerCase();
              if (!key || !/^[0-9a-f]{32}$/.test(key)) {
                showError('Please enter a valid 32-character hex issuer key.');
                return;
              }
            }
            if (!key) {
              showError('Please select an issuer key.');
              return;
            }

            // Parse UIDs
            const raw = document.getElementById('uid-input').value;
            const uids = raw.split(/[\n\r]+/).map(u => u.trim().toLowerCase()).filter(u => u.length > 0);
            if (uids.length === 0) {
              showError('Please enter at least one card UID.');
              return;
            }

            // Validate UIDs
            const invalidUids = uids.filter(u => !validateUid(u));
            if (invalidUids.length > 0) {
              showError('Invalid UID format (must be 14 hex chars): ' + invalidUids.join(', '));
              return;
            }

            // Disable button
            const btn = document.getElementById('btn-generate');
            btn.disabled = true;
            btn.textContent = 'PROCESSING ' + uids.length + ' CARD(S)...';

            // Fetch wipe data for each UID
            for (const uid of uids) {
              try {
                const apiUrl = baseUrl + '/api/bulk-wipe-keys?uid=' + encodeURIComponent(uid) + '&key=' + encodeURIComponent(key);
                const resp = await fetch(apiUrl);
                if (!resp.ok) {
                  const errBody = await resp.text();
                  renderCardError(results, uid, 'Server error ' + resp.status + ': ' + errBody);
                  continue;
                }
                const data = await resp.json();
                renderCardResult(results, data);
              } catch (err) {
                renderCardError(results, uid, 'Fetch failed: ' + err.message);
              }
            }

            // Re-enable button
            btn.disabled = false;
            btn.textContent = 'GENERATE WIPE DATA';

            // Scroll to results
            if (results.children.length > 0) {
              results.children[0].scrollIntoView({ behavior: 'smooth' });
            }
          });

          function renderCardResult(container, data) {
            const uid = (data.uid || '').toUpperCase();
            const wipeJson = data.wipe_json || {};
            const wipeJsonStr = JSON.stringify(wipeJson);
            const resetLink = data.reset_deeplink || '';

            const card = document.createElement('div');
            card.className = 'bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl';
            card.innerHTML = \`
              <div class="flex items-center justify-between mb-4 border-b border-gray-700 pb-2">
                <h3 class="text-lg font-bold text-gray-200">UID: <span class="text-amber-500 font-mono">\${esc(uid)}</span></h3>
                <span class="px-2 py-1 bg-green-500/10 text-green-500 text-xs font-mono rounded border border-green-500/20">OK</span>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Wipe JSON</label>
                  <pre class="font-mono text-xs text-green-400 bg-gray-900 p-4 rounded border border-gray-700 overflow-x-auto min-h-[140px] mb-2">\${esc(JSON.stringify(wipeJson, null, 2))}</pre>
                  <button data-copy="\${encodeURIComponent(wipeJsonStr)}" class="copy-btn text-xs text-amber-500 hover:text-amber-400 font-bold">COPY JSON</button>
                </div>
                <div class="flex flex-col items-center">
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-2">QR Code</label>
                  <div id="qr-\${esc(data.uid)}" class="qr-container mb-4"></div>
                </div>
              </div>
              <div class="mt-4 bg-gray-900 rounded p-3 border border-gray-800">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs font-bold text-red-500 uppercase">Reset Deeplink</span>
                  <button data-copy="\${encodeURIComponent(resetLink)}" class="copy-btn text-xs text-amber-500 hover:text-amber-400 font-bold">COPY LINK</button>
                </div>
                <a href="\${esc(resetLink)}" class="text-blue-400 hover:text-blue-300 text-sm font-mono break-all underline">\${esc(resetLink)}</a>
              </div>
            \`;

            container.appendChild(card);

            const qrEl = card.querySelector('#qr-' + data.uid);
            if (qrEl && wipeJsonStr) {
              new QRCode(qrEl, {
                text: wipeJsonStr,
                width: 200,
                height: 200,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.L
              });
            }
          }

          function renderCardError(container, uid, msg) {
            const card = document.createElement('div');
            card.className = 'bg-gray-800 border border-red-500/30 rounded-lg p-6 shadow-xl';
            card.innerHTML = \`
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-lg font-bold text-gray-200">UID: <span class="text-amber-500 font-mono">\${esc(uid.toUpperCase())}</span></h3>
                <span class="px-2 py-1 bg-red-500/10 text-red-500 text-xs font-mono rounded border border-red-500/20">ERROR</span>
              </div>
              <p class="text-sm text-red-400 font-mono">\${esc(msg)}</p>
            \`;
            container.appendChild(card);
          }

          document.getElementById('results').addEventListener('click', (e) => {
            const btn = e.target.closest('.copy-btn');
            if (btn) {
              copyText(decodeURIComponent(btn.getAttribute('data-copy')));
            }
          });
        </script>
`,
  });
}
