import { rawHtml } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS } from "./browserNfc.js";

export function renderPosPage({ host }) {
  return renderTailwindPage({
    title: "Boltcard POS",
    metaRobots: "noindex,nofollow",
    bodyClass: "min-h-screen bg-gray-900 p-4 font-sans antialiased flex items-center justify-center",
    styles: [
      "body { background-color: #111827; color: #f3f4f6; }",
      ".amount-glow { text-shadow: 0 0 30px rgba(16, 185, 129, 0.16); }",
      "#tap-overlay { transition: opacity 0.2s ease, visibility 0.2s ease; }",
      "#tap-overlay.visible { opacity: 1; visibility: visible; }",
      "#tap-overlay:not(.visible) { opacity: 0; visibility: hidden; }",
      "@keyframes pulse-ring { 0% { transform: scale(0.8); opacity: 1; } 100% { transform: scale(2.2); opacity: 0; } }",
      ".pulse-ring { animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }",
      "@keyframes nfc-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }",
      ".nfc-icon-bounce { animation: nfc-bounce 1.2s ease-in-out infinite; }",
    ].join("\n"),
    content: rawHtml`
    <div id="tap-overlay" class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-900/98 backdrop-blur-sm">
      <div class="text-center px-6">
        <div id="overlay-amount" class="amount-glow text-7xl font-bold tracking-tight text-white leading-none mb-3">0</div>
        <div class="text-sm uppercase tracking-[0.35em] text-gray-500 mb-10">units</div>
        <div id="overlay-nfc-icon" class="nfc-icon-bounce inline-flex items-center justify-center w-24 h-24 rounded-full border-2 border-emerald-500/40 mb-6 relative">
          <svg class="w-12 h-12 text-emerald-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/></svg>
          <div class="pulse-ring absolute inset-0 rounded-full border-2 border-emerald-500/30"></div>
        </div>
        <div id="overlay-status" class="text-xl font-bold text-emerald-400 mb-2">TAP CARD TO PAY</div>
        <div id="overlay-help" class="text-sm text-gray-400">Hold the boltcard against the back of your device</div>
      </div>
    </div>

    <div class="w-full max-w-sm">
      <div class="text-center mb-6">
        <h1 class="text-3xl font-bold text-emerald-500 tracking-tight mb-2">BOLTCARD POS</h1>
        <p class="text-sm text-gray-500">Tap to receive a fakewallet payment</p>
      </div>

      <div class="bg-gray-800 border border-gray-700 shadow-xl rounded-2xl p-5">
        <div class="border-b border-gray-700 pb-5 mb-5 text-center">
          <div id="amount-display" class="amount-glow text-6xl font-bold tracking-tight text-white leading-none min-h-[4.5rem] flex items-end justify-center">0</div>
          <div class="mt-2 text-sm uppercase tracking-[0.35em] text-gray-500">units</div>
        </div>

        <div id="keypad" class="grid grid-cols-3 gap-3 mb-5">
          <button type="button" data-key="1" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">1</button>
          <button type="button" data-key="2" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">2</button>
          <button type="button" data-key="3" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">3</button>
          <button type="button" data-key="4" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">4</button>
          <button type="button" data-key="5" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">5</button>
          <button type="button" data-key="6" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">6</button>
          <button type="button" data-key="7" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">7</button>
          <button type="button" data-key="8" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">8</button>
          <button type="button" data-key="9" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">9</button>
          <button type="button" data-key="." class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">.</button>
          <button type="button" data-key="0" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">0</button>
          <button type="button" data-key="backspace" class="keypad-btn rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-white text-2xl font-semibold py-4 transition-colors">⌫</button>
        </div>

        <button id="charge-btn" type="button" class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-4 px-4 rounded-xl transition-colors shadow-[0_0_20px_rgba(16,185,129,0.18)] mb-4">
          CHARGE
        </button>

        <div class="rounded-xl border border-gray-700 bg-gray-900/70 p-4 mb-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs uppercase tracking-[0.25em] text-gray-500">NFC</span>
            <span id="status-pill" class="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              <span class="inline-block h-2 w-2 rounded-full bg-current"></span>
              <span id="status-pill-text">Ready</span>
            </span>
          </div>
        </div>

        <div id="result-box" class="hidden rounded-xl border p-4 mb-4">
          <div class="flex items-start gap-3">
            <div id="result-icon" class="text-2xl leading-none">✓</div>
            <div>
              <p id="result-title" class="font-bold text-sm"></p>
              <p id="result-message" class="text-sm mt-1"></p>
            </div>
          </div>
        </div>

        <button id="new-sale-btn" type="button" class="hidden w-full bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-3 px-4 rounded-xl transition-colors">
          NEW SALE
        </button>
      </div>
    </div>

    <script>
      ${BROWSER_NFC_HELPERS}
      const API_HOST = "${host}";
      let amountInput = '0';
      let appState = 'idle';
      let currentReader = null;
      let abortController = null;
      let chargeAmount = '0';

      const amountDisplay = document.getElementById('amount-display');
      const keypad = document.getElementById('keypad');
      const keypadButtons = Array.from(document.querySelectorAll('.keypad-btn'));
      const chargeButton = document.getElementById('charge-btn');
      const newSaleButton = document.getElementById('new-sale-btn');
      const statusText = document.getElementById('status-text');
      const statusHelp = document.getElementById('status-help');
      const statusPill = document.getElementById('status-pill');
      const statusPillText = document.getElementById('status-pill-text');
      const resultBox = document.getElementById('result-box');
      const resultIcon = document.getElementById('result-icon');
      const resultTitle = document.getElementById('result-title');
      const resultMessage = document.getElementById('result-message');
      const tapOverlay = document.getElementById('tap-overlay');
      const overlayAmount = document.getElementById('overlay-amount');
      const overlayStatus = document.getElementById('overlay-status');
      const overlayHelp = document.getElementById('overlay-help');
      const overlayNfcIcon = document.getElementById('overlay-nfc-icon');

      keypad.addEventListener('click', function(event) {
        const button = event.target.closest('[data-key]');
        if (!button) return;
        handleKeypadInput(button.dataset.key);
      });

      chargeButton.addEventListener('click', startChargeFlow);
      newSaleButton.addEventListener('click', resetSale);
      window.addEventListener('beforeunload', stopScanning);

      updateView();

      function normalizeAmount(value) {
        if (!value || value === '.') return '0';
        let next = String(value).replace(/[^0-9.]/g, '');
        const firstDecimal = next.indexOf('.');
        if (firstDecimal !== -1) {
          next = next.slice(0, firstDecimal + 1) + next.slice(firstDecimal + 1).replace(/\./g, '');
        }

        let parts = next.split('.');
        let whole = parts[0] || '0';
        let fraction = parts[1] || '';
        whole = whole.replace(/^0+(\d)/, '$1');
        if (whole === '') whole = '0';
        return parts.length > 1 ? whole + '.' + fraction : whole;
      }

      function amountIsZero(value) {
        const numeric = Number(normalizeAmount(value));
        return !Number.isFinite(numeric) || numeric <= 0;
      }

      function formatAmount(value) {
        const normalized = normalizeAmount(value);
        const parts = normalized.split('.');
        const whole = parts[0] || '0';
        const fraction = parts[1];
        const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return fraction !== undefined ? formattedWhole + '.' + fraction : formattedWhole;
      }

      function setState(nextState) {
        appState = nextState;
        updateView();
      }

      function setStatus(tone, title) {
        const toneMap = {
          ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
          scanning: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
          processing: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
          error: 'border-red-500/30 bg-red-500/10 text-red-400',
        };
        statusPill.className = 'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold border ' + (toneMap[tone] || toneMap.ready);
        statusPillText.textContent = title;
      }

      function showResult(kind, title, message) {
        resultBox.classList.remove('hidden');
        resultTitle.textContent = title;
        resultMessage.textContent = message;

        if (kind === 'success') {
          resultBox.className = 'rounded-xl border p-4 mb-4 border-emerald-500/40 bg-emerald-900/20';
          resultIcon.textContent = '✓';
          resultIcon.className = 'text-2xl leading-none text-emerald-400';
          resultTitle.className = 'font-bold text-sm text-emerald-300';
          resultMessage.className = 'text-sm mt-1 text-emerald-100/90';
        } else {
          resultBox.className = 'rounded-xl border p-4 mb-4 border-red-500/40 bg-red-900/20';
          resultIcon.textContent = '✗';
          resultIcon.className = 'text-2xl leading-none text-red-400';
          resultTitle.className = 'font-bold text-sm text-red-300';
          resultMessage.className = 'text-sm mt-1 text-red-100/90';
        }
      }

      function clearResult() {
        resultBox.className = 'hidden rounded-xl border p-4 mb-4';
        resultBox.classList.add('hidden');
      }

      function updateView() {
        amountDisplay.textContent = formatAmount(amountInput);

        const overlayActive = appState === 'charging' || appState === 'scanning' || appState === 'processing';
        if (overlayActive) {
          tapOverlay.classList.add('visible');
          overlayAmount.textContent = formatAmount(chargeAmount);
        } else {
          tapOverlay.classList.remove('visible');
        }

        if (appState === 'charging' || appState === 'scanning') {
          overlayStatus.textContent = 'TAP CARD TO PAY';
          overlayStatus.className = 'text-xl font-bold text-emerald-400 mb-2';
          overlayHelp.textContent = 'Hold the boltcard against the back of your device';
          overlayNfcIcon.classList.remove('hidden');
        } else if (appState === 'processing') {
          overlayStatus.textContent = 'PROCESSING...';
          overlayStatus.className = 'text-xl font-bold text-amber-400 mb-2';
          overlayHelp.textContent = 'Verifying card and submitting payment';
          overlayNfcIcon.classList.add('hidden');
        }

        const editingLocked = overlayActive;
        keypadButtons.forEach(function(button) {
          button.disabled = editingLocked;
          button.classList.toggle('opacity-40', editingLocked);
          button.classList.toggle('cursor-not-allowed', editingLocked);
        });

        chargeButton.disabled = editingLocked || amountIsZero(amountInput);
        newSaleButton.classList.toggle('hidden', !(appState === 'success' || appState === 'failed'));

        if (!browserSupportsNfc()) {
          chargeButton.disabled = true;
          setStatus('error', 'Unavailable');
          return;
        }

        if (appState === 'idle') {
          setStatus('ready', 'Ready');
        } else if (appState === 'charging' || appState === 'scanning') {
          setStatus('scanning', 'Scanning...');
        } else if (appState === 'processing') {
          setStatus('processing', 'Processing');
        } else if (appState === 'success') {
          setStatus('ready', 'Complete');
        } else if (appState === 'failed') {
          setStatus('error', 'Failed');
        }
      }

      function handleKeypadInput(key) {
        if (appState !== 'idle') return;

        if (key === 'backspace') {
          amountInput = amountInput.length > 1 ? amountInput.slice(0, -1) : '0';
          if (amountInput === '' || amountInput === '-') amountInput = '0';
          if (amountInput.endsWith('.')) amountInput = amountInput.slice(0, -1);
          if (amountInput === '') amountInput = '0';
        } else if (key === '.') {
          if (!amountInput.includes('.')) {
            amountInput += amountInput === '0' ? '.' : '.';
          }
        } else if (/^[0-9]$/.test(key)) {
          if (amountInput === '0') {
            amountInput = key;
          } else {
            amountInput += key;
          }
        }

        amountInput = normalizeAmount(amountInput);
        clearResult();
        updateView();
      }

      function resetSale() {
        stopScanning();
        amountInput = '0';
        chargeAmount = '0';
        clearResult();
        setState('idle');
      }

      function stopScanning() {
        if (currentReader) {
          currentReader.onreading = null;
          currentReader.onreadingerror = null;
          currentReader = null;
        }
        if (abortController) {
          abortController.abort();
          abortController = null;
        }
      }

      function extractTapUrl(message) {
        return (async function() {
          let nfcUrl = null;
          for (const record of message.records) {
            nfcUrl = await extractNdefUrl(message.records, ['lnurlw://', 'https://']);
            break;
          }
          return nfcUrl;
        })();
      }

      function normalizeLnurlwUrl(rawUrl) {
        const trimmed = String(rawUrl || '').trim();
        if (!trimmed) throw new Error('No LNURL-withdraw URL found on card.');

        const httpsUrl = trimmed.toLowerCase().startsWith('lnurlw://')
          ? 'https://' + trimmed.slice('lnurlw://'.length)
          : trimmed.replace(/^http:\/\//i, 'https://');

        const parsed = new URL(httpsUrl);
        const p = parsed.searchParams.get('p');
        const c = parsed.searchParams.get('c');

        if (p && c) {
          const workerUrl = new URL(API_HOST + '/');
          workerUrl.searchParams.set('p', p);
          workerUrl.searchParams.set('c', c);
          return workerUrl.toString();
        }

        return parsed.toString();
      }

      async function fetchJson(url) {
        let response;
        try {
          response = await fetch(url, { headers: { Accept: 'application/json' } });
        } catch (error) {
          throw new Error('Network error, please try again');
        }

        let payload;
        try {
          payload = await response.json();
        } catch (error) {
          throw new Error('Network error, please try again');
        }

        if (!response.ok) {
          throw new Error(payload.reason || payload.message || 'Payment failed');
        }

        return payload;
      }

      async function processPayment(nfcUrl) {
        const withdrawRequestUrl = normalizeLnurlwUrl(nfcUrl);
        const withdrawData = await fetchJson(withdrawRequestUrl);

        if (withdrawData.tag !== 'withdrawRequest' || !withdrawData.callback || !withdrawData.k1) {
          throw new Error('Invalid withdraw response from card');
        }

        const invoiceResp = await fetchJson(API_HOST + '/api/fake-invoice?amount=' + encodeURIComponent(chargeAmount));
        if (!invoiceResp.pr) {
          throw new Error('Failed to generate invoice');
        }

        const callbackUrl = new URL(withdrawData.callback);
        callbackUrl.searchParams.set('pr', invoiceResp.pr);
        callbackUrl.searchParams.set('k1', withdrawData.k1);
        callbackUrl.searchParams.set('amount', chargeAmount);

        const paymentData = await fetchJson(callbackUrl.toString());

        if (paymentData.status !== 'OK') {
          throw new Error(paymentData.reason || paymentData.message || 'Payment failed');
        }

        return paymentData;
      }

      function handleRecoverableError(message) {
        stopScanning();
        setState('idle');
        showResult('error', 'Unable to charge', message);
      }

      async function startChargeFlow() {
        if (!browserSupportsNfc()) {
          handleRecoverableError('NFC not available on this device/browser. Use Chrome on Android.');
          return;
        }

        if (amountIsZero(amountInput)) {
          return;
        }

        chargeAmount = normalizeAmount(amountInput);
        clearResult();
        stopScanning();
        setState('charging');

        abortController = new AbortController();
        currentReader = new NDEFReader();

        currentReader.onreading = async function(event) {
          if (appState !== 'scanning') return;

          try {
            const nfcUrl = await extractTapUrl(event.message);
            if (!nfcUrl) {
              throw new Error('No LNURL-withdraw URL found on card.');
            }

            stopScanning();
            setState('processing');
            await processPayment(nfcUrl);
            setState('success');
            showResult('success', 'Payment approved', 'Payment of ' + formatAmount(chargeAmount) + ' units received!');
          } catch (error) {
            const message = error && error.message ? error.message : 'Payment failed';
            stopScanning();
            setState('failed');
            showResult('error', 'Payment failed', message);
          }
        };

        currentReader.onreadingerror = function() {
          handleRecoverableError('Error reading NFC card. Please try again.');
        };

        try {
          await currentReader.scan({ signal: abortController.signal });
          setState('scanning');
        } catch (error) {
          if (error && error.name === 'AbortError') {
            return;
          }
          handleRecoverableError(error && error.message ? error.message : 'NFC scan error, please try again');
        }
      }
    </script>
`,
  });
}
