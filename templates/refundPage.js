import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS } from "./browserNfc.js";

export function renderRefundPage({ host, currencyLabel }) {
  return renderTailwindPage({
    title: "Refund",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased flex flex-col",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content: rawHtml`
    <div class="flex items-center justify-between px-4 py-2 shrink-0 border-b border-gray-800">
      <span class="text-sm font-semibold text-emerald-500 tracking-widest">REFUND</span>
      <div class="flex items-center gap-3">
        <a href="/operator/topup" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">TOP-UP</a>
        <a href="/operator/pos" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">POS</a>
        <a href="/debug" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">DEBUG</a>
      </div>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center px-6">
      <p class="text-gray-500 text-sm mb-6">Tap card to check balance, then issue refund</p>

      <div id="card-info" class="hidden w-full max-w-xs bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6">
        <div class="text-center mb-4">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Current Balance</p>
          <div id="card-balance" class="text-5xl font-bold text-white">0</div>
          <div class="text-gray-500 text-sm">${currencyLabel || "credits"}</div>
        </div>
      </div>

      <div id="refund-options" class="hidden w-full max-w-xs space-y-3 mb-6">
        <button id="full-refund-btn" type="button" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded-xl transition-colors">
          FULL REFUND
        </button>
        <div class="flex items-center gap-2">
          <input type="number" id="partial-amount" placeholder="Partial amount" min="1"
            class="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-200 text-sm focus:border-emerald-500 focus:outline-none" />
          <button id="partial-refund-btn" type="button" class="bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2 px-4 rounded transition-colors text-sm">
            REFUND
          </button>
        </div>
      </div>

      <div id="nfc-btn-area" class="w-full max-w-xs mb-4">
        <button id="nfc-tap-btn" type="button" class="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-4 px-4 rounded-xl transition-colors text-lg">
          TAP CARD TO READ BALANCE
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

    <div class="shrink-0 px-4 py-2 border-t border-gray-800 flex justify-end">
      <button id="logout-btn" type="button" class="text-xs text-gray-600 hover:text-gray-400 transition-colors">LOGOUT</button>
    </div>

    <script>
      ${safe(BROWSER_NFC_HELPERS)}
      const API_HOST = ${jsString(host)};
      let appState = 'idle';
      let abortController = null;
      let currentReader = null;
      let lastP = null;
      let lastC = null;

      const cardInfo = document.getElementById('card-info');
      const cardBalance = document.getElementById('card-balance');
      const refundOptions = document.getElementById('refund-options');
      const fullRefundBtn = document.getElementById('full-refund-btn');
      const partialRefundBtn = document.getElementById('partial-refund-btn');
      const partialAmount = document.getElementById('partial-amount');
      const nfcTapBtn = document.getElementById('nfc-tap-btn');
      const resultBox = document.getElementById('result-box');
      const resultIcon = document.getElementById('result-icon');
      const resultTitle = document.getElementById('result-title');
      const resultMessage = document.getElementById('result-message');
      const logoutBtn = document.getElementById('logout-btn');

      fullRefundBtn.addEventListener('click', function() { submitRefund(true, 0); });
      partialRefundBtn.addEventListener('click', function() {
        const amt = parseInt(partialAmount.value, 10);
        if (!amt || amt <= 0) { showResult('error', 'Invalid amount', 'Enter a positive amount'); return; }
        submitRefund(false, amt);
      });
      nfcTapBtn.addEventListener('click', startNfcScan);
      logoutBtn.addEventListener('click', function() {
        fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
      });

      if (!browserSupportsNfc()) {
        nfcTapBtn.textContent = 'NFC NOT AVAILABLE — use Chrome on Android or USB reader';
        nfcTapBtn.disabled = true;
        nfcTapBtn.classList.add('opacity-50');
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

      function clearResult() { resultBox.className = 'hidden w-full max-w-xs rounded-xl border p-4 mb-4'; }

      async function submitRefund(fullRefund, amount) {
        if (!lastP || !lastC) { showResult('error', 'No card', 'Tap a card first'); return; }
        appState = 'processing';
        try {
          const body = { p: lastP, c: lastC, fullRefund: fullRefund };
          if (!fullRefund) body.amount = amount;
          const resp = await fetch('/operator/refund/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await resp.json();
          if (resp.ok && data.success) {
            cardBalance.textContent = data.balance || 0;
            partialAmount.value = '';
            showResult('success', 'Refund issued', 'Refunded ' + data.amount + '. Remaining: ' + data.balance);
          } else {
            showResult('error', 'Refund failed', data.error || data.reason || 'Unknown error');
          }
        } catch(e) {
          showResult('error', 'Network error', e.message);
        }
        appState = 'idle';
      }

      function stopNfc() {
        if (currentReader) { currentReader.onreading = null; currentReader.onreadingerror = null; currentReader = null; }
        if (abortController) { abortController.abort(); abortController = null; }
      }

      async function startNfcScan() {
        if (appState !== 'idle') return;
        appState = 'scanning';
        clearResult();
        abortController = new AbortController();
        currentReader = new NDEFReader();

        currentReader.onreading = async function(event) {
          stopNfc();
          const url = await extractNdefUrl(event.message.records, ['lnurlw://', 'https://']);
          if (!url) { appState = 'idle'; showResult('error', 'No card data', 'Could not read card'); return; }
          try {
            const parsed = new URL(url);
            const p = parsed.searchParams.get('p');
            const c = parsed.searchParams.get('c');
            if (p && c) {
              lastP = p; lastC = c;
              await fetchBalance(p, c);
            } else {
              appState = 'idle'; showResult('error', 'Invalid card', 'Missing p/c parameters');
            }
          } catch(e) { appState = 'idle'; showResult('error', 'Error', e.message); }
        };

        currentReader.onreadingerror = function() {
          stopNfc(); appState = 'idle'; showResult('error', 'NFC error', 'Try again');
        };

        try { await currentReader.scan({ signal: abortController.signal }); }
        catch(e) { if (e.name !== 'AbortError') { stopNfc(); appState = 'idle'; showResult('error', 'NFC error', e.message); } }
      }

      async function fetchBalance(p, c) {
        try {
          const resp = await fetch('/api/balance-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ p, c }),
          });
          const data = await resp.json();
          if (resp.ok) {
            cardBalance.textContent = data.balance || 0;
            cardInfo.classList.remove('hidden');
            refundOptions.classList.remove('hidden');
            appState = 'idle';
          } else {
            appState = 'idle';
            showResult('error', 'Read failed', data.error || data.reason || 'Could not read card');
          }
        } catch(e) {
          appState = 'idle';
          showResult('error', 'Network error', e.message);
        }
      }
    </script>
  `,
  });
}
