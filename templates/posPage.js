import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS } from "./browserNfc.js";

export function renderPosPage({ host, currencyLabel }) {
  return renderTailwindPage({
    title: "POS",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased",
    styles: [
      "body { background-color: #111827; color: #f3f4f6; }",
      "#tap-overlay { transition: opacity 0.15s ease, visibility 0.15s ease; }",
      "#tap-overlay.visible { opacity: 1; visibility: visible; }",
      "#tap-overlay:not(.visible) { opacity: 0; visibility: hidden; pointer-events: none; }",
      "@keyframes pulse-ring { 0% { transform: scale(0.85); opacity: 0.8; } 100% { transform: scale(2); opacity: 0; } }",
      ".pulse-ring { animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }",
      "@keyframes nfc-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }",
      ".nfc-icon-bounce { animation: nfc-bounce 1.2s ease-in-out infinite; }",
    ].join("\n"),
    content: rawHtml`
    <div id="tap-overlay" class="fixed inset-0 z-50 flex flex-col bg-gray-900">
      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <span class="text-sm font-semibold text-emerald-500 tracking-widest">POS</span>
        <button id="overlay-cancel" type="button" class="text-sm font-semibold text-gray-500 hover:text-white transition-colors px-2 py-1">CANCEL</button>
      </div>
      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <div id="overlay-amount" class="text-5xl font-bold tracking-tight text-white leading-none mb-2">0</div>
        <div id="overlay-nfc-icon" class="nfc-icon-bounce inline-flex items-center justify-center w-20 h-20 rounded-full border-2 border-emerald-500/40 my-6 relative">
          <svg class="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/></svg>
          <div class="pulse-ring absolute inset-0 rounded-full border-2 border-emerald-500/30"></div>
        </div>
        <div id="overlay-status" class="text-lg font-bold text-emerald-400">TAP CARD TO PAY</div>
        <div id="overlay-help" class="text-sm text-gray-500 mt-2">Hold the boltcard against the back of your device</div>
      </div>
    </div>

    <div class="flex flex-col h-[100dvh]">
      <div class="flex items-center justify-between px-4 py-1.5 shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-emerald-500 tracking-widest">POS</span>
          <button id="mode-toggle" type="button" class="text-xs font-semibold bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-400 hover:text-white transition-colors">
            MENU
          </button>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-600">Terminal: <span id="terminal-id" class="text-gray-500 font-mono">---</span></span>
          <a href="/operator/topup" class="text-xs text-gray-600 hover:text-gray-300 transition-colors">TOP-UP</a>
          <a href="/operator/refund" class="text-xs text-gray-600 hover:text-gray-300 transition-colors">REFUND</a>
        </div>
      </div>

      <div id="mode-free" class="flex flex-col flex-1 min-h-0">
        <div class="text-center py-2 shrink-0">
          <div id="amount-display" class="text-5xl font-bold tracking-tight text-white leading-none">0</div>
        </div>
        <div id="keypad" class="flex-1 grid grid-cols-3 gap-1.5 px-3 min-h-0">
          <button type="button" data-key="1" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">1</button>
          <button type="button" data-key="2" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">2</button>
          <button type="button" data-key="3" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">3</button>
          <button type="button" data-key="4" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">4</button>
          <button type="button" data-key="5" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">5</button>
          <button type="button" data-key="6" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">6</button>
          <button type="button" data-key="7" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">7</button>
          <button type="button" data-key="8" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">8</button>
          <button type="button" data-key="9" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">9</button>
          <button type="button" data-key="clear" class="keypad-btn rounded-xl bg-gray-700 hover:bg-gray-600 active:bg-gray-500 border border-gray-600 text-gray-300 text-sm font-semibold transition-colors flex items-center justify-center">CLR</button>
          <button type="button" data-key="0" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">0</button>
          <button type="button" data-key="backspace" class="keypad-btn rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-white text-xl font-semibold transition-colors flex items-center justify-center">&larr;</button>
        </div>
      </div>

      <div id="mode-menu" class="hidden flex-col flex-1 min-h-0 overflow-hidden">
        <div class="text-center py-2 shrink-0">
          <div id="cart-total" class="text-5xl font-bold tracking-tight text-white leading-none">0</div>
          <div id="cart-count" class="text-gray-500 text-xs mt-1"></div>
        </div>
        <div id="menu-grid" class="flex-1 overflow-y-auto px-3 py-2">
          <div id="menu-empty" class="text-center py-8">
            <p class="text-gray-500 text-sm mb-2">No menu configured</p>
            <button id="menu-edit-btn" type="button" class="text-xs text-emerald-500 hover:text-emerald-400 transition-colors">Edit menu</button>
          </div>
          <div id="menu-items" class="grid grid-cols-2 gap-2"></div>
        </div>
        <div id="cart-bar" class="hidden px-3 py-2 border-t border-gray-800">
          <div id="cart-items" class="space-y-1 max-h-32 overflow-y-auto mb-2"></div>
          <button id="cart-clear-btn" type="button" class="text-xs text-gray-500 hover:text-red-400 transition-colors">CLEAR CART</button>
        </div>
      </div>

      <div class="shrink-0 px-3 pt-2 pb-3">
        <div id="result-box" class="hidden rounded-xl border p-3 mb-2">
          <div class="flex items-start gap-2">
            <div id="result-icon" class="text-xl leading-none"></div>
            <div>
              <p id="result-title" class="font-bold text-sm"></p>
              <p id="result-message" class="text-xs mt-0.5"></p>
            </div>
          </div>
        </div>
        <button id="charge-btn" type="button" class="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-400 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-xl transition-colors">
          CHARGE
        </button>
        <button id="new-sale-btn" type="button" class="hidden w-full bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-3 px-4 rounded-xl transition-colors mt-2">
          NEW SALE
        </button>
      </div>
    </div>

    <script>
      ${safe(BROWSER_NFC_HELPERS)}
      const API_HOST = ${jsString(host)};
      let amountInput = '0';
      let appState = 'idle';
      let currentReader = null;
      let autoChargeTimer = null;
      let chargeAmount = '0';
      let posMode = localStorage.getItem('pos_mode') || 'free';
      let terminalId = localStorage.getItem('terminal_id') || '';
      let menuData = { items: [] };
      let cart = [];

      if (!terminalId) {
        terminalId = crypto.randomUUID ? crypto.randomUUID() : ('t-' + Math.random().toString(36).slice(2, 10));
        localStorage.setItem('terminal_id', terminalId);
      }
      document.getElementById('terminal-id').textContent = terminalId.slice(0, 8);

      const amountDisplay = document.getElementById('amount-display');
      const keypadButtons = Array.from(document.querySelectorAll('.keypad-btn'));
      const chargeButton = document.getElementById('charge-btn');
      const newSaleButton = document.getElementById('new-sale-btn');
      const modeToggle = document.getElementById('mode-toggle');
      const modeFree = document.getElementById('mode-free');
      const modeMenu = document.getElementById('mode-menu');
      const menuGrid = document.getElementById('menu-grid');
      const menuItems = document.getElementById('menu-items');
      const menuEmpty = document.getElementById('menu-empty');
      const menuEditBtn = document.getElementById('menu-edit-btn');
      const cartTotal = document.getElementById('cart-total');
      const cartCount = document.getElementById('cart-count');
      const cartBar = document.getElementById('cart-bar');
      const cartItemsEl = document.getElementById('cart-items');
      const cartClearBtn = document.getElementById('cart-clear-btn');
      const resultBox = document.getElementById('result-box');
      const resultIcon = document.getElementById('result-icon');
      const resultTitle = document.getElementById('result-title');
      const resultMessage = document.getElementById('result-message');
      const tapOverlay = document.getElementById('tap-overlay');
      const overlayAmount = document.getElementById('overlay-amount');
      const overlayStatus = document.getElementById('overlay-status');
      const overlayCancel = document.getElementById('overlay-cancel');

      keypad.addEventListener('click', function(e) { var btn = e.target.closest('[data-key]'); if (btn) handleKeypadInput(btn.dataset.key); });
      chargeButton.addEventListener('click', startChargeFlow);
      newSaleButton.addEventListener('click', resetSale);
      overlayCancel.addEventListener('click', cancelCharge);
      modeToggle.addEventListener('click', toggleMode);
      cartClearBtn.addEventListener('click', clearCart);
      menuEditBtn.addEventListener('click', function() { window.location.href = '/operator/pos/menu'; });
      window.addEventListener('beforeunload', stopScanning);

      applyMode();
      loadMenu();
      updateView();

      function normalizeAmount(value) {
        if (!value || value === '.') return '0';
        var next = String(value).replace(/[^0-9.]/g, '');
        var firstDecimal = next.indexOf('.');
        if (firstDecimal !== -1) { next = next.slice(0, firstDecimal + 1) + next.slice(firstDecimal + 1).replace(/\\./g, ''); }
        var parts = next.split('.');
        var whole = parts[0] || '0';
        var fraction = parts[1] || '';
        whole = whole.replace(/^0+(\\d)/, '$1');
        if (whole === '') whole = '0';
        return parts.length > 1 ? whole + '.' + fraction : whole;
      }

      function amountIsZero(value) { var n = Number(normalizeAmount(value)); return !Number.isFinite(n) || n <= 0; }

      function formatAmount(value) {
        var normalized = normalizeAmount(value);
        var parts = normalized.split('.');
        var whole = parts[0] || '0';
        var fraction = parts[1];
        return (whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + (fraction !== undefined ? '.' + fraction : '')) + ' ' + ${jsString(currencyLabel || "credits")};
      }

      function formatDisplayOnly(value) {
        var normalized = normalizeAmount(value);
        var parts = normalized.split('.');
        var whole = parts[0] || '0';
        return whole.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + (parts[1] !== undefined ? '.' + parts[1] : '');
      }

      function toggleMode() {
        posMode = posMode === 'free' ? 'menu' : 'free';
        localStorage.setItem('pos_mode', posMode);
        applyMode();
        clearCart();
        amountInput = '0';
        clearResult();
        updateView();
      }

      function applyMode() {
        if (posMode === 'menu') {
          modeToggle.textContent = 'KEYPAD';
          modeFree.classList.add('hidden');
          modeFree.classList.remove('flex');
          modeMenu.classList.remove('hidden');
          modeMenu.classList.add('flex');
        } else {
          modeToggle.textContent = 'MENU';
          modeFree.classList.remove('hidden');
          modeFree.classList.add('flex');
          modeMenu.classList.add('hidden');
          modeMenu.classList.remove('flex');
        }
      }

      function loadMenu() {
        fetch('/api/pos/menu?t=' + terminalId).then(function(r) { return r.json(); }).then(function(data) {
          if (data.items && data.items.length > 0) {
            menuData = data;
            renderMenuItems();
          }
        }).catch(function() {});
      }

      function renderMenuItems() {
        if (!menuData.items || menuData.items.length === 0) {
          menuEmpty.classList.remove('hidden');
          menuItems.classList.add('hidden');
          return;
        }
        menuEmpty.classList.add('hidden');
        menuItems.classList.remove('hidden');
        var html = '';
        for (var i = 0; i < menuData.items.length; i++) {
          var item = menuData.items[i];
          var cartItem = cart.find(function(c) { return c.name === item.name; });
          var qty = cartItem ? cartItem.qty : 0;
          var badge = qty > 0 ? '<span class="absolute -top-1 -right-1 bg-emerald-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">' + qty + '</span>' : '';
          html += '<button type="button" data-item-idx="' + i + '" class="relative bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 rounded-lg p-3 transition-colors text-left">'
            + badge
            + '<div class="font-semibold text-sm text-gray-200">' + esc(item.name) + '</div>'
            + '<div class="text-emerald-400 font-bold text-lg">' + item.price + '</div>'
            + '</button>';
        }
        menuItems.innerHTML = html;
        menuItems.querySelectorAll('[data-item-idx]').forEach(function(btn) {
          btn.addEventListener('click', function() { addToCart(menuData.items[parseInt(btn.dataset.itemIdx)]); });
        });
      }

      function addToCart(item) {
        var existing = cart.find(function(c) { return c.name === item.name; });
        if (existing) { existing.qty++; }
        else { cart.push({ name: item.name, price: item.price, qty: 1 }); }
        renderMenuItems();
        renderCart();
        updateView();
      }

      function clearCart() { cart = []; renderMenuItems(); renderCart(); updateView(); }

      function renderCart() {
        if (cart.length === 0) {
          cartBar.classList.add('hidden');
          cartCount.textContent = '';
          return;
        }
        cartBar.classList.remove('hidden');
        var total = 0;
        var totalQty = 0;
        var html = '';
        for (var i = 0; i < cart.length; i++) {
          var c = cart[i];
          var subtotal = c.price * c.qty;
          total += subtotal;
          totalQty += c.qty;
          html += '<div class="flex justify-between text-xs text-gray-400"><span>' + esc(c.name) + ' x' + c.qty + '</span><span>' + subtotal + '</span></div>';
        }
        cartItemsEl.innerHTML = html;
        cartTotal.textContent = total + ' ' + ${jsString(currencyLabel || "credits")};
        cartCount.textContent = totalQty + ' item' + (totalQty !== 1 ? 's' : '');
      }

      function getCartTotal() {
        var total = 0;
        for (var i = 0; i < cart.length; i++) { total += cart[i].price * cart[i].qty; }
        return total;
      }

      function setState(next) { appState = next; updateView(); }

      function showResult(kind, title, message) {
        resultBox.classList.remove('hidden');
        resultTitle.textContent = title;
        resultMessage.textContent = message;
        if (kind === 'success') {
          resultBox.className = 'rounded-xl border p-3 mb-3 border-emerald-500/40 bg-emerald-900/20';
          resultIcon.textContent = '\\u2713';
          resultIcon.className = 'text-xl leading-none text-emerald-400';
          resultTitle.className = 'font-bold text-sm text-emerald-300';
          resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
        } else {
          resultBox.className = 'rounded-xl border p-3 mb-3 border-red-500/40 bg-red-900/20';
          resultIcon.textContent = '\\u2717';
          resultIcon.className = 'text-xl leading-none text-red-400';
          resultTitle.className = 'font-bold text-sm text-red-300';
          resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
        }
      }

      function clearResult() { resultBox.className = 'hidden rounded-xl border p-3 mb-3'; }

      function updateView() {
        amountDisplay.textContent = formatDisplayOnly(amountInput);
        var totalForCharge = posMode === 'menu' ? getCartTotal() : parseInt(normalizeAmount(amountInput), 10) || 0;
        var overlayActive = appState === 'charging' || appState === 'scanning' || appState === 'processing';
        if (overlayActive) {
          tapOverlay.classList.add('visible');
          overlayAmount.textContent = (posMode === 'menu' ? getCartTotal() : formatDisplayOnly(chargeAmount)) + ' ' + ${jsString(currencyLabel || "credits")};
        } else {
          tapOverlay.classList.remove('visible');
        }
        if (appState === 'charging' || appState === 'scanning') {
          overlayStatus.textContent = 'TAP CARD TO PAY';
          overlayStatus.className = 'text-lg font-bold text-emerald-400';
          overlayCancel.classList.remove('hidden');
        } else if (appState === 'processing') {
          overlayStatus.textContent = 'PROCESSING...';
          overlayStatus.className = 'text-lg font-bold text-amber-400';
          overlayCancel.classList.add('hidden');
        }
        var editingLocked = overlayActive;
        keypadButtons.forEach(function(b) { b.disabled = editingLocked; b.classList.toggle('opacity-40', editingLocked); });
        chargeButton.disabled = editingLocked || (posMode === 'menu' ? getCartTotal() <= 0 : amountIsZero(amountInput));
        newSaleButton.classList.toggle('hidden', !(appState === 'success' || appState === 'failed'));
        if (appState === 'idle' && !editingLocked) {
          var hasAmount = (posMode === 'menu' && getCartTotal() > 0) || (posMode === 'free' && !amountIsZero(amountInput));
          clearTimeout(autoChargeTimer);
          if (hasAmount && browserSupportsNfc()) {
            autoChargeTimer = setTimeout(function() { if (appState === 'idle') startChargeFlow(); }, 1000);
          }
        }
      }

      function handleKeypadInput(key) {
        if (appState !== 'idle') return;
        if (key === 'backspace') { amountInput = amountInput.length > 1 ? amountInput.slice(0, -1) : '0'; }
        else if (key === 'clear') { amountInput = '0'; }
        else if (key === '.') { if (!amountInput.includes('.')) amountInput += '.'; }
        else if (/^[0-9]$/.test(key)) { amountInput = amountInput === '0' ? key : amountInput + key; }
        amountInput = normalizeAmount(amountInput);
        clearResult();
        updateView();
      }

      function resetSale() { stopScanning(); amountInput = '0'; chargeAmount = '0'; clearCart(); clearResult(); setState('idle'); }
      function cancelCharge() { stopScanning(); setState('idle'); showResult('error', 'Cancelled', 'Charge cancelled'); }
      function stopScanning() { if (currentReader) { currentReader.onreading = null; currentReader.onreadingerror = null; currentReader = null; } clearTimeout(autoChargeTimer); }

      async function directCharge(p, c) {
        var amount = posMode === 'menu' ? getCartTotal() : parseInt(normalizeAmount(chargeAmount), 10);
        var items = posMode === 'menu' ? cart.map(function(c) { return { name: c.name, qty: c.qty, unitPrice: c.price }; }) : null;
        var resp = await fetch('/operator/pos/charge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: p, c: c, amount: amount, items: items, terminalId: terminalId }),
        });
        var data = await resp.json();
        if (resp.ok && data.success) {
          setState('success');
          showResult('success', 'Payment approved', (posMode === 'menu' ? getCartTotal() : formatDisplayOnly(chargeAmount)) + ' charged. Balance: ' + data.balance);
          if (posMode === 'menu') clearCart();
        } else {
          setState('failed');
          showResult('error', 'Payment failed', data.error || data.reason || 'Unknown error');
        }
      }

      async function startChargeFlow() {
        if (posMode === 'menu' && getCartTotal() <= 0) return;
        if (posMode === 'free' && amountIsZero(amountInput)) return;

        chargeAmount = posMode === 'menu' ? String(getCartTotal()) : normalizeAmount(amountInput);
        clearResult();
        stopScanning();
        setState('charging');

        currentReader = new NDEFReader();

        currentReader.onreading = async function(event) {
          if (appState !== 'scanning') return;
          try {
            var nfcUrl = await extractNdefUrl(event.message.records, ['lnurlw://', 'https://']);
            nfcUrl = normalizeBrowserNfcUrl(nfcUrl);
            if (!nfcUrl) throw new Error('No URL on card');
            var parsed = new URL(nfcUrl);
            var p = parsed.searchParams.get('p');
            var c = parsed.searchParams.get('c');
            if (!p || !c) throw new Error('Card URL missing parameters');
            stopScanning();
            setState('processing');
            await directCharge(p, c);
          } catch (error) {
            stopScanning();
            setState('failed');
            showResult('error', 'Payment failed', error.message);
          }
        };

        currentReader.onreadingerror = function() { stopScanning(); setState('idle'); showResult('error', 'NFC error', 'Try again'); };

        try { await currentReader.scan(); setState('scanning'); }
        catch (error) { if (error.name !== 'AbortError') { stopScanning(); setState('idle'); showResult('error', 'NFC error', error.message); } }
      }
    </script>
  `,
  });
}
