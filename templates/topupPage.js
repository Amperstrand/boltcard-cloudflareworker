import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS } from "./browserNfc.js";

export function renderTopupPage({ host, currencyLabel }) {
  return renderTailwindPage({
    title: "Top-Up",
    metaRobots: "noindex,nofollow",
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased flex flex-col",
    styles: [
      "body { background-color: #111827; color: #f3f4f6; }",
      "#wedge-input { caret-color: transparent; }",
    ].join("\n"),
    content: rawHtml`
    <div class="flex items-center justify-between px-4 py-2 shrink-0 border-b border-gray-800">
      <a href="/operator/pos" class="text-sm font-semibold text-emerald-500 tracking-widest hover:text-emerald-400 transition-colors">TOP-UP</a>
      <div class="flex items-center gap-3">
        <a href="/operator/refund" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">REFUND</a>
        <a href="/operator/pos" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">POS</a>
        <a href="/debug" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">DEBUG</a>
      </div>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center px-6">
      <p class="text-gray-500 text-sm mb-4">Enter amount, then tap card to credit</p>

      <div class="text-center mb-6">
        <div id="amount-display" class="text-6xl font-bold tracking-tight text-white leading-none">0</div>
        <div class="text-gray-500 text-sm mt-1">${currencyLabel || "credits"}</div>
      </div>

      <div id="keypad" class="grid grid-cols-3 gap-2 w-full max-w-xs mb-6">
        <button type="button" data-key="1" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">1</button>
        <button type="button" data-key="2" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">2</button>
        <button type="button" data-key="3" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">3</button>
        <button type="button" data-key="4" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">4</button>
        <button type="button" data-key="5" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">5</button>
        <button type="button" data-key="6" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">6</button>
        <button type="button" data-key="7" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">7</button>
        <button type="button" data-key="8" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">8</button>
        <button type="button" data-key="9" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">9</button>
        <button type="button" data-key="clear" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-sm font-semibold transition-colors">CLR</button>
        <button type="button" data-key="0" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">0</button>
        <button type="button" data-key="backspace" class="keypad-btn h-14 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors">&larr;</button>
      </div>

      <div id="wedge-area" class="w-full max-w-xs mb-4 hidden">
        <input type="text" id="wedge-input" autocomplete="off" autofocus
          class="w-full bg-gray-800 border border-dashed border-gray-600 rounded-lg px-3 py-2 text-gray-400 text-sm text-center focus:outline-none focus:border-emerald-500"
          placeholder="Tap USB NFC reader or scan card..." />
        <p class="text-gray-600 text-xs text-center mt-1">USB NFC reader mode</p>
      </div>

      <div id="nfc-btn-area" class="w-full max-w-xs mb-4">
        <button id="nfc-tap-btn" type="button" class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 px-4 rounded-xl transition-colors text-lg">
          TAP CARD TO TOP UP
        </button>
      </div>

      <div id="result-box" class="hidden w-full max-w-xs rounded-xl border p-4 mb-4">
        <div class="flex items-start gap-3">
          <div id="result-icon" class="text-2xl leading-none"></div>
          <div>
            <p id="result-title" class="font-bold text-sm"></p>
            <p id="result-message" class="text-xs mt-0.5"></p>
          </div>
        </div>
      </div>
    </div>

    <div class="shrink-0 px-4 py-2 border-t border-gray-800 flex items-center justify-between">
      <button id="toggle-wedge" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">USB READER</button>
      <button id="logout-btn" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">LOGOUT</button>
    </div>

    <script>
      ${safe(BROWSER_NFC_HELPERS)}
      const API_HOST = ${jsString(host)};
      let amountInput = '0';
      let appState = 'idle';
      let abortController = null;
      let currentReader = null;

      const amountDisplay = document.getElementById('amount-display');
      const keypad = document.getElementById('keypad');
      const nfcTapBtn = document.getElementById('nfc-tap-btn');
      const wedgeArea = document.getElementById('wedge-area');
      const wedgeInput = document.getElementById('wedge-input');
      const nfcBtnArea = document.getElementById('nfc-btn-area');
      const toggleWedge = document.getElementById('toggle-wedge');
      const logoutBtn = document.getElementById('logout-btn');
      const resultBox = document.getElementById('result-box');
      const resultIcon = document.getElementById('result-icon');
      const resultTitle = document.getElementById('result-title');
      const resultMessage = document.getElementById('result-message');

      keypad.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-key]');
        if (!btn) return;
        handleKeypad(btn.dataset.key);
      });

      nfcTapBtn.addEventListener('click', startNfcScan);
      toggleWedge.addEventListener('click', toggleWedgeMode);
      logoutBtn.addEventListener('click', function() {
        fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
      });
      wedgeInput.addEventListener('keydown', handleWedgeInput);

      if (!browserSupportsNfc()) {
        toggleWedgeMode();
        toggleWedge.classList.add('hidden');
      }

      function normalizeAmount(val) {
        if (!val || val === '.') return '0';
        let s = String(val).replace(/[^0-9]/g, '');
        if (s === '') s = '0';
        s = s.replace(/^0+(\\d)/, '$1');
        return s;
      }

      function formatDisplay(val) {
        const n = normalizeAmount(val);
        return n.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
      }

      function handleKeypad(key) {
        if (appState !== 'idle') return;
        if (key === 'backspace') {
          amountInput = amountInput.length > 1 ? amountInput.slice(0, -1) : '0';
        } else if (key === 'clear') {
          amountInput = '0';
        } else if (/^[0-9]$/.test(key)) {
          amountInput = amountInput === '0' ? key : amountInput + key;
        }
        amountInput = normalizeAmount(amountInput);
        updateView();
      }

      function toggleWedgeMode() {
        const isHidden = wedgeArea.classList.contains('hidden');
        wedgeArea.classList.toggle('hidden');
        nfcBtnArea.classList.toggle('hidden');
        if (isHidden) {
          wedgeInput.focus();
          toggleWedge.textContent = 'NFC TAP';
        } else {
          stopNfc();
          toggleWedge.textContent = 'USB READER';
        }
      }

      function handleWedgeInput(e) {
        if (e.key !== 'Enter') return;
        const val = wedgeInput.value.trim();
        if (!val) return;
        wedgeInput.value = '';

        try {
          const url = new URL(val);
          const p = url.searchParams.get('p');
          const c = url.searchParams.get('c');
          if (p && c) {
            submitTopup(p, c);
            return;
          }
        } catch(_) {}

        showResult('error', 'Invalid card read', 'USB reader must output a URL with p and c parameters');
      }

      function updateView() {
        amountDisplay.textContent = formatDisplay(amountInput);
        nfcTapBtn.disabled = appState !== 'idle' || amountInput === '0';
      }

      function showResult(kind, title, message) {
        resultBox.classList.remove('hidden');
        resultTitle.textContent = title;
        resultMessage.textContent = message;
        if (kind === 'success') {
          resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-emerald-500/40 bg-emerald-900/20';
          resultIcon.textContent = '\\u2713';
          resultIcon.className = 'text-2xl leading-none text-emerald-400';
          resultTitle.className = 'font-bold text-sm text-emerald-300';
          resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
        } else {
          resultBox.className = 'w-full max-w-xs rounded-xl border p-4 mb-4 border-red-500/40 bg-red-900/20';
          resultIcon.textContent = '\\u2717';
          resultIcon.className = 'text-2xl leading-none text-red-400';
          resultTitle.className = 'font-bold text-sm text-red-300';
          resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
        }
      }

      function clearResult() {
        resultBox.className = 'hidden w-full max-w-xs rounded-xl border p-4 mb-4';
      }

      async function submitTopup(p, c) {
        if (appState !== 'idle') return;
        const amount = parseInt(normalizeAmount(amountInput), 10);
        if (!amount || amount <= 0) {
          showResult('error', 'Invalid amount', 'Enter an amount first');
          return;
        }
        appState = 'processing';
        updateView();
        try {
          const resp = await fetch('/operator/topup/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ p: p, c: c, amount: amount }),
          });
          const data = await resp.json();
          if (resp.ok && data.success) {
            showResult('success', 'Top-up successful', 'New balance: ' + (data.balance !== undefined ? data.balance : 'unknown'));
            amountInput = '0';
            updateView();
          } else {
            showResult('error', 'Top-up failed', data.error || data.reason || 'Unknown error');
          }
        } catch(e) {
          showResult('error', 'Network error', e.message || 'Could not reach server');
        }
        appState = 'idle';
        updateView();
      }

      function stopNfc() {
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

      async function startNfcScan() {
        if (appState !== 'idle') return;
        appState = 'scanning';
        updateView();
        clearResult();

        abortController = new AbortController();
        currentReader = new NDEFReader();

        currentReader.onreading = async function(event) {
          stopNfc();
          const url = await extractNdefUrl(event.message.records, ['lnurlw://', 'https://']);
          if (!url) {
            appState = 'idle';
            updateView();
            showResult('error', 'No card data', 'Could not read card URL');
            return;
          }
          try {
            const parsed = new URL(url);
            const p = parsed.searchParams.get('p');
            const c = parsed.searchParams.get('c');
            if (p && c) {
              await submitTopup(p, c);
            } else {
              appState = 'idle';
              updateView();
              showResult('error', 'Invalid card data', 'Card URL missing p or c parameters');
            }
          } catch(e) {
            appState = 'idle';
            updateView();
            showResult('error', 'Card read error', e.message);
          }
        };

        currentReader.onreadingerror = function() {
          stopNfc();
          appState = 'idle';
          updateView();
          showResult('error', 'NFC error', 'Could not read card. Try again.');
        };

        try {
          await currentReader.scan({ signal: abortController.signal });
        } catch(e) {
          if (e.name !== 'AbortError') {
            stopNfc();
            appState = 'idle';
            updateView();
            showResult('error', 'NFC error', e.message);
          }
        }
      }

      updateView();
    </script>
  `,
  });
}
