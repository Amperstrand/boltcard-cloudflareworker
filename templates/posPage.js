export function renderPosPage({ host }) {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Boltcard POS</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { background-color: #111827; color: #f3f4f6; }
      .amount-glow { text-shadow: 0 0 30px rgba(16, 185, 129, 0.16); }
    </style>
  </head>
  <body class="min-h-screen bg-gray-900 p-4 font-sans antialiased flex items-center justify-center">
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
          <p id="status-text" class="mt-3 text-sm text-gray-300">Ready to scan</p>
          <p id="status-help" class="mt-1 text-xs text-gray-500">Enter an amount, then tap CHARGE and present the card.</p>
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
      const API_HOST = "${host}";
      const decoder = new TextDecoder();
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
        whole = whole.replace(/^0+(\\d)/, '$1');
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
        const formattedWhole = whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
        return fraction !== undefined ? formattedWhole + '.' + fraction : formattedWhole;
      }

      function setState(nextState) {
        appState = nextState;
        updateView();
      }

      function setStatus(tone, title, helpText) {
        const toneMap = {
          ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
          scanning: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
          processing: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
          error: 'border-red-500/30 bg-red-500/10 text-red-400',
        };
        statusPill.className = 'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold border ' + (toneMap[tone] || toneMap.ready);
        statusPillText.textContent = title;
        statusText.textContent = helpText;
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

        const editingLocked = appState === 'charging' || appState === 'scanning' || appState === 'processing';
        keypadButtons.forEach(function(button) {
          button.disabled = editingLocked;
          button.classList.toggle('opacity-40', editingLocked);
          button.classList.toggle('cursor-not-allowed', editingLocked);
        });

        chargeButton.disabled = editingLocked || amountIsZero(amountInput);
        newSaleButton.classList.toggle('hidden', !(appState === 'success' || appState === 'failed'));

        if (!('NDEFReader' in window)) {
          chargeButton.disabled = true;
          setStatus('error', 'Unavailable', 'NFC not available on this device/browser. Use Chrome on Android.');
          statusHelp.textContent = 'Web NFC is required to scan a boltcard tap.';
          return;
        }

        if (appState === 'idle') {
          setStatus('ready', 'Ready', 'Ready to scan');
          statusHelp.textContent = 'Enter an amount, then tap CHARGE and present the card.';
        } else if (appState === 'charging' || appState === 'scanning') {
          setStatus('scanning', 'Scanning...', 'Tap your card...');
          statusHelp.textContent = 'Hold the boltcard against the back of your Android device.';
        } else if (appState === 'processing') {
          setStatus('processing', 'Processing', 'Processing payment...');
          statusHelp.textContent = 'Verifying the card and submitting the fakewallet payment.';
        } else if (appState === 'success') {
          setStatus('ready', 'Complete', 'Payment received');
          statusHelp.textContent = 'Tap NEW SALE to start another payment.';
        } else if (appState === 'failed') {
          setStatus('error', 'Failed', 'Payment failed');
          statusHelp.textContent = 'Tap NEW SALE to clear the result and start again.';
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
            if (record.recordType === 'url' || record.recordType === 'text') {
              const text = record.recordType === 'url'
                ? await new Response(record.data).text()
                : decoder.decode(record.data);
              if (text.toLowerCase().startsWith('lnurlw://') || text.toLowerCase().startsWith('https://')) {
                nfcUrl = text;
                break;
              }
            }
          }
          return nfcUrl;
        })();
      }

      function normalizeLnurlwUrl(rawUrl) {
        const trimmed = String(rawUrl || '').trim();
        if (!trimmed) throw new Error('No LNURL-withdraw URL found on card.');

        const httpsUrl = trimmed.toLowerCase().startsWith('lnurlw://')
          ? 'https://' + trimmed.slice('lnurlw://'.length)
          : trimmed.replace(/^http:\\/\\//i, 'https://');

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

        const callbackUrl = new URL(withdrawData.callback);
        callbackUrl.searchParams.set('pr', 'fakewallet');
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
        if (!('NDEFReader' in window)) {
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
  </body>
</html>`;
}
