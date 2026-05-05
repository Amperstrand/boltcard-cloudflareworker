// menu-editor.js — classic script (no import/export)
// Depends on: nfc.js (esc)

(function() {
  var configEl = document.getElementById('menu-editor-config');
  var items = configEl ? JSON.parse(configEl.getAttribute('data-items') || '[]') : [];
  var terminalId = configEl ? configEl.getAttribute('data-terminal-id') : '';

  function render() {
    var list = document.getElementById('items-list');
    if (items.length === 0) {
      list.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">No items. Click "Add Item" to start.</p>';
      return;
    }
    list.innerHTML = items.map(function(item, i) {
      return '<div class="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg p-3">'
        + '<input type="text" data-idx="' + i + '" data-field="name" value="' + esc(item.name) + '" placeholder="Item name" '
        + 'class="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm focus:border-emerald-500 focus:outline-none" />'
        + '<input type="number" data-idx="' + i + '" data-field="price" value="' + esc(String(item.price)) + '" placeholder="Price" min="0" '
        + 'class="w-24 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm text-right focus:border-emerald-500 focus:outline-none" />'
        + '<button type="button" data-remove="' + i + '" class="text-red-500 hover:text-red-400 text-lg font-bold px-1">&times;</button>'
        + '</div>';
    }).join('');

    list.querySelectorAll('input').forEach(function(inp) {
      inp.addEventListener('input', function() {
        items[parseInt(this.dataset.idx)][this.dataset.field] = this.dataset.field === 'price' ? parseInt(this.value) || 0 : this.value;
      });
    });
    list.querySelectorAll('[data-remove]').forEach(function(btn) {
      btn.addEventListener('click', function() { items.splice(parseInt(this.dataset.remove), 1); render(); });
    });
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
      status.className = 'mt-4 text-center text-sm text-red-400';
      status.textContent = 'Network error: ' + e.message;
    });
  });

  render();
})();
