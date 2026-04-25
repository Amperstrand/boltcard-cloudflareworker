import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderMenuEditorPage({ host, terminalId, menu }) {
  const items = menu.items || [];
  const itemsJson = items.length > 0 ? JSON.stringify(items) : "[]";

  return renderTailwindPage({
    title: "Menu Editor",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content: rawHtml`
    <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800">
      <a href="/operator/pos" class="text-sm font-semibold text-emerald-500 tracking-widest hover:text-emerald-400 transition-colors">&larr; POS</a>
      <span class="text-xs text-gray-500 font-mono">${terminalId}</span>
    </div>

    <div class="max-w-lg mx-auto p-4">
      <h1 class="text-xl font-bold text-white mb-6">Menu Editor</h1>

      <div id="items-list" class="space-y-2 mb-4"></div>

      <button id="add-item-btn" type="button" class="w-full bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 rounded-lg py-3 text-gray-400 text-sm font-semibold transition-colors">
        + ADD ITEM
      </button>

      <div class="mt-6 flex gap-3">
        <button id="save-btn" type="button" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl transition-colors">
          SAVE MENU
        </button>
        <button id="clear-btn" type="button" class="bg-red-900/50 hover:bg-red-800/50 text-red-300 font-bold py-3 px-4 rounded-xl transition-colors">
          CLEAR ALL
        </button>
      </div>

      <div id="status" class="hidden mt-4 text-center text-sm"></div>
    </div>

    <script>
      let items = ${safe(itemsJson ? itemsJson.replace(/</g, '\\u003c') : '[]')};
      const terminalId = ${jsString(terminalId)};
      const API_HOST = ${jsString(host)};

      function render() {
        const list = document.getElementById('items-list');
        if (items.length === 0) {
          list.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">No items. Click "Add Item" to start.</p>';
          return;
        }
        list.innerHTML = items.map((item, i) =>
          '<div class="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg p-3">'
          + '<input type="text" data-idx="' + i + '" data-field="name" value="' + esc(item.name) + '" placeholder="Item name" '
          + 'class="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm focus:border-emerald-500 focus:outline-none" />'
          + '<input type="number" data-idx="' + i + '" data-field="price" value="' + esc(String(item.price)) + '" placeholder="Price" min="0" '
          + 'class="w-24 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-gray-200 text-sm text-right focus:border-emerald-500 focus:outline-none" />'
          + '<button type="button" data-remove="' + i + '" class="text-red-500 hover:text-red-400 text-lg font-bold px-1">&times;</button>'
          + '</div>'
        ).join('');

        list.querySelectorAll('input').forEach(inp => {
          inp.addEventListener('input', function() {
            items[parseInt(this.dataset.idx)][this.dataset.field] = this.dataset.field === 'price' ? parseInt(this.value) || 0 : this.value;
          });
        });
        list.querySelectorAll('[data-remove]').forEach(btn => {
          btn.addEventListener('click', function() { items.splice(parseInt(this.dataset.remove), 1); render(); });
        });
      }

      document.getElementById('add-item-btn').addEventListener('click', function() {
        items.push({ name: '', price: 0 });
        render();
        const inputs = document.querySelectorAll('[data-field="name"]');
        if (inputs.length) inputs[inputs.length - 1].focus();
      });

      document.getElementById('clear-btn').addEventListener('click', function() {
        if (items.length === 0) return;
        items = [];
        render();
      });

      document.getElementById('save-btn').addEventListener('click', async function() {
        const valid = items.filter(i => i.name.trim());
        const status = document.getElementById('status');
        status.classList.remove('hidden');
        status.className = 'mt-4 text-center text-sm text-gray-400';
        status.textContent = 'Saving...';
        try {
          const resp = await fetch('/operator/pos/menu?t=' + terminalId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: valid }),
          });
          const data = await resp.json();
          if (resp.ok && data.success) {
            status.className = 'mt-4 text-center text-sm text-emerald-400';
            status.textContent = 'Saved ' + valid.length + ' items';
          } else {
            status.className = 'mt-4 text-center text-sm text-red-400';
            status.textContent = data.error || 'Save failed';
          }
        } catch(e) {
          status.className = 'mt-4 text-center text-sm text-red-400';
          status.textContent = 'Network error: ' + e.message;
        }
      });

      render();
    </script>
  `,
  });
}
