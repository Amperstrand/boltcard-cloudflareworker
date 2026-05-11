// menu-editor.js — classic script (no import/export)

(function() {
  var configEl = document.getElementById('menu-editor-config');
  var items = configEl ? JSON.parse(configEl.getAttribute('data-items') || '[]') : [];
  var terminalId = configEl ? configEl.getAttribute('data-terminal-id') : '';

  function render() {
    var list = document.getElementById('items-list');
    if (items.length === 0) {
      var p = document.createElement('p');
      p.className = 'text-gray-500 text-sm text-center py-4';
      p.textContent = 'No items. Click "Add Item" to start.';
      list.replaceChildren(p);
      return;
    }
    list.replaceChildren.apply(list, items.map(function(item, i) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg p-3';

      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.dataset.idx = i;
      nameInput.dataset.field = 'name';
      nameInput.value = item.name;
      nameInput.placeholder = 'Item name';
      nameInput.className = 'flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm focus:border-emerald-500 focus:outline-none';
      nameInput.addEventListener('input', function() {
        items[i].name = this.value;
      });
      row.appendChild(nameInput);

      var priceInput = document.createElement('input');
      priceInput.type = 'number';
      priceInput.dataset.idx = i;
      priceInput.dataset.field = 'price';
      priceInput.value = String(item.price);
      priceInput.placeholder = 'Price';
      priceInput.min = '0';
      priceInput.className = 'w-24 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm text-right focus:border-emerald-500 focus:outline-none';
      priceInput.addEventListener('input', function() {
        items[i].price = parseInt(this.value) || 0;
      });
      row.appendChild(priceInput);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '\u00D7';
      removeBtn.className = 'text-red-500 hover:text-red-400 text-lg font-bold px-1';
      removeBtn.addEventListener('click', function() { items.splice(i, 1); render(); });
      row.appendChild(removeBtn);

      return row;
    }));
  }

  document.getElementById('add-item-btn').addEventListener('click', function() {
    items.push({ name: '', price: 0 });
    render();
    var inputs = document.querySelectorAll('[data-field="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  document.getElementById('clear-btn').addEventListener('click', function() {
    if (items.length === 0) return;
    items = [];
    render();
  });

  document.getElementById('save-btn').addEventListener('click', function() {
    var valid = items.filter(function(i) { return i.name.trim(); });
    var status = document.getElementById('status');
    status.classList.remove('hidden');
    status.className = 'mt-4 text-center text-sm text-gray-400';
    status.textContent = 'Saving...';
    fetch('/operator/pos/menu?t=' + terminalId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: valid }),
    }).then(function(resp) {
      return resp.json().then(function(data) {
        if (resp.ok && data.success) {
          status.className = 'mt-4 text-center text-sm text-emerald-400';
          status.textContent = 'Saved ' + valid.length + ' items';
        } else {
          status.className = 'mt-4 text-center text-sm text-red-400';
          status.textContent = data.error || 'Save failed';
        }
      });
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'menu-editor.js:save');
      status.className = 'mt-4 text-center text-sm text-red-400';
      status.textContent = 'Network error: ' + e.message;
    });
  });

  render();
})();
