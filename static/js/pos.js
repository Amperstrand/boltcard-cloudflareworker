// pos.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var posRoot = document.getElementById('pos-root');
  var CURRENCY_LABEL = posRoot ? posRoot.getAttribute('data-currency-label') || 'credits' : 'credits';

  // Result box helpers (inlined — same as operatorShared resultBoxHelpers)
  var resultBox = document.getElementById('result-box');
  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultMessage = document.getElementById('result-message');

  function showResult(kind, title, message) {
    resultBox.classList.remove('hidden');
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    if (kind === 'success') {
      resultBox.className = 'rounded-xl border p-3 mb-3 border-emerald-500/40 bg-emerald-900/20';
      resultIcon.textContent = '\u2713';
      resultIcon.className = 'text-xl leading-none text-emerald-400';
      resultTitle.className = 'font-bold text-sm text-emerald-300';
      resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
    } else {
      resultBox.className = 'rounded-xl border p-3 mb-3 border-red-500/40 bg-red-900/20';
      resultIcon.textContent = '\u2717';
      resultIcon.className = 'text-xl leading-none text-red-400';
      resultTitle.className = 'font-bold text-sm text-red-300';
      resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
    }
  }

  function clearResult() {
    resultBox.className = 'hidden rounded-xl border p-3 mb-3';
  }

  var amountInput = '0';
  var appState = 'idle';
  var posScanner = null;
  var autoChargeTimer = null;
  var chargeAmount = '0';
  var posMode = localStorage.getItem('pos_mode') || 'free';
  var terminalId = localStorage.getItem('terminal_id') || '';
  var menuData = { items: [] };
  var cart = [];

  posScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onError: function(err, phase) {
      if (appState !== 'scanning') return;
      stopScanning();
      setState('idle');
      if (phase === 'scan') showResult('error', 'NFC error', 'Try again');
      else if (phase !== 'permission') showResult('error', 'NFC error', err.message);
    },
    onTap: async function(data) {
      if (appState !== 'scanning') return;
      try {
        var nfcUrl = data.url;
        if (!nfcUrl) throw new Error('No URL on card');
        var parsed = new URL(nfcUrl);
        var p = parsed.searchParams.get('p');
        var c = parsed.searchParams.get('c');
        if (!p || !c) throw new Error('Card URL missing parameters');
        stopScanning();
        setState('processing');
        await directCharge(p, c);
       } catch (error) {
         if (typeof window.reportClientError === 'function') window.reportClientError(error, 'pos.js:nfc-tap');
         stopScanning();
         setState('failed');
         showResult('error', 'Payment failed', error.message);
       }
    }
  });

  if (!terminalId) {
    terminalId = crypto.randomUUID ? crypto.randomUUID() : ('t-' + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('terminal_id', terminalId);
  }
  document.getElementById('terminal-id').textContent = terminalId.slice(0, 8);

  var amountDisplay = document.getElementById('amount-display');
  var keypadButtons = Array.from(document.querySelectorAll('.keypad-btn'));
  var chargeButton = document.getElementById('charge-btn');
  var newSaleButton = document.getElementById('new-sale-btn');
  var modeToggle = document.getElementById('mode-toggle');
  var modeFree = document.getElementById('mode-free');
  var modeMenu = document.getElementById('mode-menu');
  var menuGrid = document.getElementById('menu-grid');
  var menuItems = document.getElementById('menu-items');
  var menuEmpty = document.getElementById('menu-empty');
  var menuEditBtn = document.getElementById('menu-edit-btn');
  var cartTotal = document.getElementById('cart-total');
  var cartCount = document.getElementById('cart-count');
  var cartBar = document.getElementById('cart-bar');
  var cartItemsEl = document.getElementById('cart-items');
  var cartClearBtn = document.getElementById('cart-clear-btn');
  var tapOverlay = document.getElementById('tap-overlay');
  var overlayAmount = document.getElementById('overlay-amount');
  var overlayStatus = document.getElementById('overlay-status');
  var overlayCancel = document.getElementById('overlay-cancel');

  document.getElementById('keypad').addEventListener('click', function(e) { var btn = e.target.closest('[data-key]'); if (btn) handleKeypadInput(btn.dataset.key); });
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
    if (firstDecimal !== -1) { next = next.slice(0, firstDecimal + 1) + next.slice(firstDecimal + 1).replace(/\./g, ''); }
    var parts = next.split('.');
    var whole = parts[0] || '0';
    var fraction = parts[1] || '';
    whole = whole.replace(/^0+(\d)/, '$1');
    if (whole === '') whole = '0';
    return parts.length > 1 ? whole + '.' + fraction : whole;
  }

  function amountIsZero(value) { var n = Number(normalizeAmount(value)); return !Number.isFinite(n) || n <= 0; }

  function formatAmount(value) {
    var normalized = normalizeAmount(value);
    var parts = normalized.split('.');
    var whole = parts[0] || '0';
    var fraction = parts[1];
    return (whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction !== undefined ? '.' + fraction : '')) + ' ' + CURRENCY_LABEL;
  }

  function formatDisplayOnly(value) {
    var normalized = normalizeAmount(value);
    var parts = normalized.split('.');
    var whole = parts[0] || '0';
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] !== undefined ? '.' + parts[1] : '');
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
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < menuData.items.length; i++) {
      (function(idx) {
        var item = menuData.items[idx];
        var cartItem = cart.find(function(c) { return c.name === item.name; });
        var qty = cartItem ? cartItem.qty : 0;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'relative bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 rounded-lg p-3 transition-colors text-left';

        if (qty > 0) {
          var badge = document.createElement('span');
          badge.className = 'absolute -top-1 -right-1 bg-emerald-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center';
          badge.textContent = qty;
          btn.appendChild(badge);
        }

        var nameDiv = document.createElement('div');
        nameDiv.className = 'font-semibold text-sm text-gray-200';
        nameDiv.textContent = item.name;
        btn.appendChild(nameDiv);

        var priceDiv = document.createElement('div');
        priceDiv.className = 'text-emerald-400 font-bold text-lg';
        priceDiv.textContent = String(item.price);
        btn.appendChild(priceDiv);

        btn.addEventListener('click', function() { addToCart(menuData.items[idx]); });
        fragment.appendChild(btn);
      })(i);
    }
    menuItems.replaceChildren(fragment);
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
      cartItemsEl.replaceChildren();
      return;
    }
    cartBar.classList.remove('hidden');
    var total = 0;
    var totalQty = 0;
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < cart.length; i++) {
      var c = cart[i];
      var subtotal = c.price * c.qty;
      total += subtotal;
      totalQty += c.qty;
      var row = document.createElement('div');
      row.className = 'flex justify-between text-xs text-gray-400';
      var labelSpan = document.createElement('span');
      labelSpan.textContent = c.name + ' x' + c.qty;
      row.appendChild(labelSpan);
      var valSpan = document.createElement('span');
      valSpan.textContent = String(subtotal);
      row.appendChild(valSpan);
      fragment.appendChild(row);
    }
    cartItemsEl.replaceChildren(fragment);
    cartTotal.textContent = total + ' ' + CURRENCY_LABEL;
    cartCount.textContent = totalQty + ' item' + (totalQty !== 1 ? 's' : '');
  }

  function getCartTotal() {
    var total = 0;
    for (var i = 0; i < cart.length; i++) { total += cart[i].price * cart[i].qty; }
    return total;
  }

  function setState(next) { appState = next; updateView(); }

  function updateView() {
    amountDisplay.textContent = formatDisplayOnly(amountInput);
    var totalForCharge = posMode === 'menu' ? getCartTotal() : parseInt(normalizeAmount(amountInput), 10) || 0;
    var overlayActive = appState === 'charging' || appState === 'scanning' || appState === 'processing';
    if (overlayActive) {
      tapOverlay.classList.add('visible');
      overlayAmount.textContent = (posMode === 'menu' ? getCartTotal() : formatDisplayOnly(chargeAmount)) + ' ' + CURRENCY_LABEL;
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
  function stopScanning() { posScanner.stop(); clearTimeout(autoChargeTimer); }

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

    try {
      await posScanner.scan();
      setState('scanning');
       } catch (error) {
         if (error.name !== 'AbortError') {
           if (typeof window.reportClientError === 'function') window.reportClientError(error, 'pos.js:nfc-scan');
           stopScanning();
           setState('idle');
           showResult('error', 'NFC error', error.message);
         }
       }
  }
})();
