import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS, BROWSER_VALIDATE_UID_HELPER } from "./browserNfc.js";

export function renderDebugConsolePage({ host, baseUrl }) {
  const tabs = [
    { id: "console", label: "Console", icon: "\u{1f527}" },
    { id: "identify", label: "Identify", icon: "\u{1f50d}" },
    { id: "wipe", label: "Wipe", icon: "\u{1f5d1}" },
    { id: "twofa", label: "2FA", icon: "\u{1f6e1}" },
    { id: "identity", label: "Identity", icon: "\u{1faa}" },
    { id: "pos", label: "POS", icon: "\u{1f3b4}" },
  ];

  const tabButtons = tabs.map(t =>
    `<button class="debug-tab ${t.id === 'console' ? 'active' : ''}" data-tab="${t.id}">${t.icon} ${t.label}</button>`
  ).join("");

  const content = rawHtml`
    <div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <!-- Tab Bar -->
      <nav class="sticky top-0 z-50 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 px-3 py-2 shadow-lg">
        <div class="max-w-6xl mx-auto flex items-center gap-1 overflow-x-auto">
          <span class="text-xs font-bold text-gray-500 uppercase tracking-wider mr-2 whitespace-nowrap">\u{1f527}</span>
          ${safe(tabButtons)}
        </div>
      </nav>

      <main class="flex-1 max-w-6xl mx-auto w-full px-4 py-4 md:px-6 flex flex-col gap-4">

        <!-- Shared: Card Info Panel -->
        <div id="card-info-panel" class="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
          <div class="flex items-center gap-3 mb-3">
            <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Card Info</span>
            <button id="nfc-scan-btn" class="ml-auto rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-cyan-500/50 hover:text-cyan-300">Start NFC scan</button>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div class="text-xs text-gray-500 uppercase">UID</div>
              <div id="ci-uid" class="font-mono text-amber-300 truncate">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Counter</div>
              <div id="ci-counter" class="font-mono text-cyan-300">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Issuer</div>
              <div id="ci-issuer" class="font-mono text-purple-300 truncate text-xs">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Version</div>
              <div id="ci-version" class="font-mono text-gray-300">--</div>
            </div>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mt-2 pt-2 border-t border-gray-800/50">
            <div>
              <div class="text-xs text-gray-500 uppercase">State</div>
              <div id="ci-state" class="font-mono text-gray-300 text-xs">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Method</div>
              <div id="ci-method" class="font-mono text-gray-300 text-xs">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">Fingerprint</div>
              <div id="ci-fingerprint" class="font-mono text-gray-300 text-xs truncate">--</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 uppercase">CMAC</div>
              <div id="ci-cmac" class="font-mono text-xs">--</div>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div id="error-message" class="hidden rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"></div>

        <!-- Tab: Console -->
        <div class="debug-panel" id="panel-console">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">NDEF Payload</div>
            <div id="console-ndef" class="font-mono text-xs text-gray-300 break-all min-h-[1.5em]">Tap a card to inspect\u2026</div>
          </div>
          <div id="console-lnurlw" class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 mt-3">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">LNURLW Details</div>
            <div id="console-lnurlw-details" class="text-sm text-gray-400 min-h-[1.5em]">Waiting for NFC scan\u2026</div>
          </div>
          <div class="mt-3 flex flex-col gap-3 sm:flex-row">
            <input type="text" id="console-invoice" class="flex-1 rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-cyan-500 focus:outline-none" placeholder="Paste BOLT11 invoice or scan QR" />
            <button id="console-pay-btn" class="hidden rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:bg-cyan-500/40 disabled:text-cyan-100 whitespace-nowrap">Pay</button>
          </div>
          <div id="console-payment-status" class="mt-3 hidden rounded-xl border px-4 py-3 text-sm font-semibold"></div>
          <pre id="console-json" class="mt-3 hidden max-h-96 overflow-auto rounded-xl border border-gray-800 bg-gray-950/80 p-4 text-xs leading-6 text-green-300"></pre>
          <button id="console-toggle-json" class="hidden mt-2 text-xs text-gray-500 hover:text-gray-300 transition">Show raw JSON</button>
        </div>

        <!-- Tab: Identify -->
        <div class="debug-panel hidden" id="panel-identify">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Card Identification</div>
            <div id="identify-details" class="text-sm text-gray-400 min-h-[3em]">Tap a card to identify it\u2026</div>
          </div>
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 mt-3">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Raw API Response</div>
            <pre id="identify-raw" class="text-xs text-green-300 max-h-48 overflow-auto min-h-[1.5em]">--</pre>
          </div>
        </div>

        <!-- Tab: Wipe -->
        <div class="debug-panel hidden" id="panel-wipe">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 text-center">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Single-Card Wipe</div>
            <p class="text-sm text-gray-400 mb-4">Tap a card, then generate a wipe deeplink + QR to reprogram it.</p>
            <div id="wipe-status" class="text-sm text-gray-500 mb-4">Waiting for card tap\u2026</div>
            <button id="wipe-generate-btn" class="hidden w-full rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Generate Wipe Data</button>
          </div>
          <div id="wipe-output" class="hidden rounded-xl border border-gray-800 bg-gray-900/80 p-4 mt-3">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Wipe Result</div>
            <div id="wipe-result" class="text-sm text-gray-400 min-h-[2em]">--</div>
          </div>
          <div id="wipe-actions" class="hidden mt-3 grid gap-3 sm:grid-cols-2">
            <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 text-center">
              <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Deeplink</div>
              <a id="wipe-deeplink" href="#" class="block break-all font-mono text-xs text-cyan-300 hover:text-cyan-200 mb-3">--</a>
              <button onclick="navigator.clipboard.writeText(document.getElementById('wipe-deeplink').href).then(function(){var t=document.getElementById('wipe-copy-toast');t.classList.remove('translate-y-20','opacity-0');setTimeout(function(){t.classList.add('translate-y-20','opacity-0')},2000)})" class="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-300 hover:border-gray-500 transition">Copy</button>
              <div id="wipe-copy-toast" class="translate-y-[-20px] opacity-0 transition-all duration-200 text-xs text-emerald-400 font-medium mt-2">Copied!</div>
            </div>
            <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 text-center">
              <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">QR Code</div>
              <div id="wipe-qr" class="flex justify-center"><div class="qr-container"></div></div>
            </div>
          </div>
        </div>

        <!-- Tab: 2FA -->
        <div class="debug-panel hidden" id="panel-twofa">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-8 text-center">
            <div class="text-2xl font-bold text-gray-400 mb-4">2FA Codes</div>
            <p class="text-sm text-gray-500">Tap a card to load TOTP + HOTP codes.</p>
            <div id="twofa-output" class="mt-4 text-left">--</div>
          </div>
        </div>

        <!-- Tab: Identity -->
        <div class="debug-panel hidden" id="panel-identity">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4 text-center">
            <div class="text-2xl font-bold text-gray-400 mb-4">Identity Verification</div>
            <p class="text-sm text-gray-500">Tap a card to verify identity.</p>
            <div id="identity-output" class="mt-4 text-left">--</div>
          </div>
        </div>

        <!-- Tab: POS -->
        <div class="debug-panel hidden" id="panel-pos">
          <div class="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Quick Charge</div>
            <div class="flex gap-3">
              <input type="number" id="pos-amount" inputmode="numeric" min="1" class="flex-1 rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-green-500 focus:outline-none" placeholder="Amount" />
              <button id="pos-charge-btn" class="hidden rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">Charge</button>
            </div>
            <div id="pos-status" class="mt-3 hidden rounded-xl border px-4 py-3 text-sm font-semibold"></div>
          </div>
          <div class="mt-3 text-center">
            <a href="/operator/pos" class="text-xs text-gray-500 hover:text-cyan-300 transition">Open full POS terminal \u2192</a>
          </div>
        </div>

      </main>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
    <script>
      ${safe(BROWSER_NFC_HELPERS)}
      ${safe(BROWSER_VALIDATE_UID_HELPER)}

      var BASE_URL = ${jsString(baseUrl)};
      var HOST = ${jsString(host)};
      var lastP = null;
      var lastC = null;
      var lastIdentifyData = null;
      var wipeQrCode = null;
      var nfcScanner = null;

      var scanBtn = document.getElementById('nfc-scan-btn');
      var errorBox = document.getElementById('error-message');

      function showError(msg) {
        errorBox.textContent = msg;
        errorBox.classList.remove('hidden');
      }
      function clearError() {
        errorBox.textContent = '';
        errorBox.classList.add('hidden');
      }

      function updateScanBtn(state) {
        if (state === 'scanning') {
          scanBtn.textContent = 'Scanning\u2026';
          scanBtn.className = 'ml-auto rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-500/50';
        } else if (state === 'error') {
          scanBtn.textContent = 'Restart NFC scan';
          scanBtn.className = 'ml-auto rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:border-red-500/50';
        } else {
          scanBtn.textContent = 'Start NFC scan';
          scanBtn.className = 'ml-auto rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-cyan-500/50 hover:text-cyan-300';
        }
      }

      function setCardInfo(data) {
        document.getElementById('ci-uid').textContent = data.uid || '--';
        document.getElementById('ci-counter').textContent = data.counter || '--';
        document.getElementById('ci-issuer').textContent = data.issuer || '--';
        document.getElementById('ci-version').textContent = data.version != null ? data.version : '--';
        document.getElementById('ci-state').textContent = data.state || '--';
        document.getElementById('ci-method').textContent = data.method || '--';
        document.getElementById('ci-fingerprint').textContent = data.fingerprint || '--';
        document.getElementById('ci-cmac').textContent = data.cmac || '--';
        if (data.cmac === 'valid') {
          document.getElementById('ci-cmac').className = 'font-mono text-xs text-emerald-400';
        } else if (data.cmac === 'invalid') {
          document.getElementById('ci-cmac').className = 'font-mono text-xs text-red-400';
        } else {
          document.getElementById('ci-cmac').className = 'font-mono text-xs';
        }
      }

      function switchTab(tabId) {
        document.querySelectorAll('.debug-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tabId); });
        document.querySelectorAll('.debug-panel').forEach(function(p) { p.classList.toggle('hidden', p.id !== 'panel-' + tabId); });
      }

      function initTabs() {
        document.querySelectorAll('.debug-tab').forEach(function(t) {
          t.addEventListener('click', function() { switchTab(t.dataset.tab); });
        });
        var hash = location.hash.replace('#', '');
        if (hash && document.getElementById('panel-' + hash)) switchTab(hash);
      }

      function initNfc() {
        if (!browserSupportsNfc()) {
          updateScanBtn('error');
          scanBtn.textContent = 'Web NFC unavailable';
          scanBtn.disabled = true;
          return;
        }
        scanBtn.addEventListener('click', function() {
          clearError();
          if (nfcScanner) { nfcScanner.restart(); return; }
          nfcScanner = createNfcScanner({
            onTap: handleNfcTap,
            onError: function(err, phase) {
              if (phase === 'permission') {
                updateScanBtn('error');
                showError('NFC permission denied. Click the button to retry.');
              } else if (phase === 'scan') {
                showError('NFC read error: ' + err.message);
              } else {
                showError('Error: ' + err.message);
              }
            },
            onStatus: function(status) {
              if (status === 'scanning') updateScanBtn('scanning');
              else if (status === 'stopped') updateScanBtn('error');
              else if (status === 'starting') updateScanBtn('scanning');
            },
            debounceMs: 3000
          });
          nfcScanner.scan();
        });
      }

      function handleNfcTap(tap) {
        clearError();
        var uid = tap.serial || null;
        var nfcUrl = tap.url;
        var p = null, c = null;

        if (nfcUrl) {
          try {
            var u = new URL(nfcUrl);
            p = u.searchParams.get('p');
            c = u.searchParams.get('c');
          } catch (e) {}
        }

        lastP = p;
        lastC = c;

        var activePanel = document.querySelector('.debug-panel:not(.hidden)');
        if (!activePanel) return;
        var tabId = activePanel.id.replace('panel-', '');

        var handlers = {
          console: handleConsoleTab,
          identify: handleIdentifyTab,
          wipe: handleWipeTab,
          twofa: handleTwofaTab,
          identity: handleIdentityTab,
          pos: handlePosTab
        };
        if (handlers[tabId]) handlers[tabId]({ uid: uid, nfcUrl: nfcUrl, p: p, c: c });
      }

      function handleConsoleTab(data) {
        var ndefBox = document.getElementById('console-ndef');
        var detailsBox = document.getElementById('console-lnurlw-details');
        var payBtn = document.getElementById('console-pay-btn');
        var statusBox = document.getElementById('console-payment-status');

        if (!data.nfcUrl) {
          ndefBox.textContent = 'No NDEF records (blank or unprogrammed card)';
          detailsBox.innerHTML = '<span class="text-gray-500">No LNURLW payload found.</span>';
          payBtn.classList.add('hidden');
          statusBox.classList.add('hidden');
          return;
        }

        ndefBox.textContent = data.nfcUrl;
        payBtn.classList.add('hidden');
        statusBox.classList.add('hidden');

        if (data.nfcUrl.startsWith('https://')) {
          fetch(data.nfcUrl).then(function(r) { return r.json(); }).then(function(json) {
            if (json.tag === 'withdrawRequest') {
              detailsBox.innerHTML =
                '<div class="space-y-1 text-sm">' +
                '<div><span class="font-semibold text-gray-100">Callback:</span> <span class="break-all font-mono text-xs text-cyan-300">' + json.callback + '</span></div>' +
                '<div><span class="font-semibold text-gray-100">K1:</span> <span class="break-all font-mono text-xs text-amber-300">' + json.k1 + '</span></div>' +
                '<div><span class="font-semibold text-gray-100">Min:</span> ' + (json.minWithdrawable / 1000) + ' sats</div>' +
                '<div><span class="font-semibold text-gray-100">Max:</span> ' + (json.maxWithdrawable / 1000) + ' sats</div>' +
                '</div>';
              payBtn.classList.remove('hidden');
              payBtn.disabled = false;
              window._consoleCallbackUrl = json.callback;
              window._consoleK1 = json.k1;
            } else {
              detailsBox.textContent = 'The card did not return a withdrawRequest payload.';
            }
          }).catch(function(e) {
            detailsBox.textContent = 'Error fetching LNURLW response: ' + e.message;
          });
        }
      }

      function handleIdentifyTab(data) {
        var detailsBox = document.getElementById('identify-details');
        var rawBox = document.getElementById('identify-raw');

        if (!data.p || !data.c) {
          detailsBox.innerHTML = '<p class="text-gray-500">No card data available.</p>';
          rawBox.textContent = '--';
          return;
        }

        detailsBox.innerHTML = '<p class="text-gray-500 animate-pulse">Identifying\u2026</p>';
        fetch('/api/identify-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: data.p, c: data.c }),
        }).then(function(r) { return r.json(); }).then(function(json) {
          lastIdentifyData = json;
          rawBox.textContent = JSON.stringify(json, null, 2);

          if (json.status === 'ERROR') {
            detailsBox.innerHTML = '<p class="text-red-300">' + (json.reason || 'Identification failed') + '</p>';
            return;
          }

          if (json.matched) {
            var m = json.matched;
            detailsBox.innerHTML =
              '<div class="space-y-2 text-sm">' +
              '<div><span class="font-semibold text-gray-100">UID:</span> <span class="font-mono text-amber-300">' + (json.uid || '--') + '</span></div>' +
              '<div><span class="font-semibold text-gray-100">Counter:</span> <span class="font-mono text-cyan-300">' + (json.counter || '--') + '</span></div>' +
              '<div><span class="font-semibold text-gray-100">CMAC:</span> <span class="text-emerald-300">valid</span></div>' +
              '<div><span class="font-semibold text-gray-100">State:</span> ' + (m.card_state || '--') + '</div>' +
              '<div><span class="font-semibold text-gray-100">Method:</span> ' + (m.payment_method || '--') + '</div>' +
              '<div><span class="font-semibold text-gray-100">Version:</span> ' + (m.version != null ? m.version : '--') + '</div>' +
              '<div><span class="font-semibold text-gray-100">Source:</span> ' + (m.source === 'config' ? 'Known card' : 'Deterministic') + '</div>' +
              '</div>';

            setCardInfo({
              uid: json.uid,
              counter: json.counter,
              state: m.card_state,
              method: m.payment_method,
              issuer: m.issuerKeyFingerprint ? m.issuerKeyFingerprint.slice(0, 8) + '...' : '--',
              version: m.version != null ? m.version : '--',
              fingerprint: m.issuerKeyFingerprint || '--',
              cmac: 'valid',
            });
          } else {
            detailsBox.innerHTML =
              '<div class="space-y-2 text-sm">' +
              '<div><span class="font-semibold text-gray-100">UID:</span> <span class="font-mono text-amber-300">' + (json.uid || '--') + '</span></div>' +
              '<div><span class="font-semibold text-gray-100">Counter:</span> <span class="font-mono text-cyan-300">' + (json.counter || '--') + '</span></div>' +
              '<div><span class="font-semibold text-gray-100">CMAC:</span> <span class="text-red-300">no match</span></div>' +
              '<div class="text-xs text-gray-500 mt-2">Tried ' + ((json.all_attempts && json.all_attempts.length) || 0) + ' key(s). None matched CMAC.</div>' +
              '</div>';

            setCardInfo({
              uid: json.uid,
              counter: json.counter,
              cmac: 'invalid',
            });
          }
        }).catch(function(err) {
          detailsBox.innerHTML = '<p class="text-red-300">Error: ' + err.message + '</p>';
        });
      }

      function handleWipeTab(data) {
        var statusDiv = document.getElementById('wipe-status');
        var generateBtn = document.getElementById('wipe-generate-btn');
        var outputDiv = document.getElementById('wipe-output');
        var actionsDiv = document.getElementById('wipe-actions');

        if (!data.uid || data.uid === 'blank') {
          statusDiv.textContent = 'No card detected. Tap a card first.';
          generateBtn.classList.add('hidden');
          outputDiv.classList.add('hidden');
          actionsDiv.classList.add('hidden');
          return;
        }

        statusDiv.textContent = 'Card detected: ' + data.uid.toUpperCase();
        generateBtn.classList.remove('hidden');
        generateBtn.disabled = false;
        outputDiv.classList.add('hidden');
        actionsDiv.classList.add('hidden');

        generateBtn.onclick = function() {
          generateBtn.disabled = true;
          generateBtn.textContent = 'Generating\u2026';
          fetch(BASE_URL + '/wipe?uid=' + encodeURIComponent(data.uid))
            .then(function(r) { return r.json(); })
            .then(function(json) {
              outputDiv.classList.remove('hidden');
              var resultDiv = document.getElementById('wipe-result');

              if (json.reset_deeplink) {
                resultDiv.textContent = 'Keys generated successfully.';
                var deeplink = json.reset_deeplink;
                document.getElementById('wipe-deeplink').href = deeplink;
                document.getElementById('wipe-deeplink').textContent = deeplink;

                if (wipeQrCode) { wipeQrCode.clear(); wipeQrCode = null; }
                var qrContainer = document.getElementById('wipe-qr');
                qrContainer.innerHTML = '';
                wipeQrCode = new QRCode(qrContainer, { text: deeplink, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L });
                actionsDiv.classList.remove('hidden');
              } else {
                resultDiv.textContent = json.reason || 'Failed to generate wipe data.';
              }
            }).catch(function(err) {
              resultDiv.textContent = 'Error: ' + err.message;
            });
          generateBtn.textContent = 'Generate Wipe Data';
          generateBtn.disabled = false;
        };
      }

      function handleTwofaTab(data) {
        var outputDiv = document.getElementById('twofa-output');
        if (!data.p || !data.c) {
          outputDiv.innerHTML = '<div class="text-center text-gray-500 py-4">Tap a card to load 2FA codes.</div>';
          return;
        }
        outputDiv.innerHTML = '<div class="text-center text-gray-500 py-4 animate-pulse">Loading\u2026</div>';
        fetch(BASE_URL + '/2fa?p=' + encodeURIComponent(data.p) + '&c=' + encodeURIComponent(data.c))
          .then(function(r) { return r.text(); })
          .then(function(html) { outputDiv.innerHTML = html; })
          .catch(function() { outputDiv.innerHTML = '<div class="text-center text-red-400 py-4">Error loading 2FA page.</div>'; });
      }

      function handleIdentityTab(data) {
        var outputDiv = document.getElementById('identity-output');
        if (!data.p || !data.c) {
          outputDiv.innerHTML = '<div class="text-center text-gray-500 py-4">Tap a card to verify identity.</div>';
          return;
        }
        outputDiv.innerHTML = '<div class="text-center text-gray-500 py-4 animate-pulse">Verifying\u2026</div>';
        fetch(BASE_URL + '/api/verify-identity?p=' + encodeURIComponent(data.p) + '&c=' + encodeURIComponent(data.c))
          .then(function(r) { return r.json(); })
          .then(function(json) {
            if (json.verified) {
              outputDiv.innerHTML =
                '<div class="rounded-xl border border-pink-500/20 bg-pink-500/5 p-4 mt-4">' +
                '<div class="flex items-center gap-3 mb-3"><div class="h-8 w-8 rounded-full bg-pink-500 flex items-center justify-center text-xl">' + (json.profile && json.profile.emoji || '?') + '</div>' +
                '<div><div class="font-bold text-white text-lg">' + (json.profile && json.profile.name || 'Unknown') + '</div>' +
                '<div class="text-xs text-gray-400">' + (json.profile && json.profile.role || '') + ' \u00b7 ' + (json.profile && json.profile.department || '') + '</div></div></div>' +
                '<div class="grid grid-cols-2 gap-2 text-sm"><div><span class="text-gray-500">UID:</span> <span class="font-mono text-amber-300">' + (json.uid || '--') + '</span></div>' +
                '<div><span class="text-gray-500">Clearance:</span> <span class="text-pink-300">' + (json.profile && json.profile.clearance || '--') + '</span></div></div>' +
                '</div>';
            } else {
              outputDiv.innerHTML =
                '<div class="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mt-4">' +
                '<p class="text-red-300">' + (json.reason || 'Not verified') + '</p></div>';
            }
          }).catch(function() { outputDiv.innerHTML = '<div class="text-center text-red-400 py-4">Error loading identity data.</div>'; });
      }

      function handlePosTab(data) {
        var chargeBtn = document.getElementById('pos-charge-btn');
        var statusBox = document.getElementById('pos-status');

        if (!data.p || !data.c) {
          chargeBtn.classList.add('hidden');
          statusBox.classList.add('hidden');
          return;
        }

        chargeBtn.classList.remove('hidden');
        chargeBtn.disabled = false;
        statusBox.classList.add('hidden');
        document.getElementById('pos-amount').focus();
      }

      document.getElementById('pos-charge-btn').addEventListener('click', function() {
        if (!lastP || !lastC) return;
        var amount = parseInt(document.getElementById('pos-amount').value, 10);
        if (!amount || amount <= 0) { showPosStatus('Enter a valid amount', false); return; }
        var chargeBtn = document.getElementById('pos-charge-btn');
        chargeBtn.disabled = true;
        fetch(BASE_URL + '/operator/pos/charge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: lastP, c: lastC, amount: amount }),
        }).then(function(r) { return r.json(); }).then(function(json) {
          showPosStatus(json.reason || (json.status === 'OK' ? 'Charged ' + amount + ' credits' : 'Charge failed'), json.status === 'OK');
        }).catch(function(err) { showPosStatus('Error: ' + err.message, false); });
        chargeBtn.disabled = false;
      });

      function showPosStatus(msg, ok) {
        var statusBox = document.getElementById('pos-status');
        statusBox.textContent = msg;
        statusBox.className = ok
          ? 'mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200'
          : 'mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200';
        statusBox.classList.remove('hidden');
      }

      document.getElementById('console-toggle-json').addEventListener('click', function() {
        var jsonBox = document.getElementById('console-json');
        jsonBox.classList.toggle('hidden');
        this.textContent = jsonBox.classList.contains('hidden') ? 'Show raw JSON' : 'Hide raw JSON';
      });

      initTabs();
      initNfc();
    </script>
  `;

  return renderTailwindPage({ title: "Debug Console", content, csrf: true });
}
