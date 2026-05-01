import { rawHtml, safe } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { CARD_STATE_HELPERS, ESC_HELPER } from "./browserNfc.js";

export function renderCardAuditPage() {
  const content = rawHtml`
  <div class="max-w-5xl w-full space-y-6">
    <div class="flex items-center justify-between border-b border-gray-700 pb-4">
      <h1 class="text-2xl md:text-3xl font-bold text-emerald-500 tracking-tight">CARD REGISTRY</h1>
      <span class="px-3 py-1 bg-emerald-500/10 text-emerald-500 text-sm font-mono rounded border border-emerald-500/20">AUDIT</span>
    </div>

    <div class="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <div class="flex flex-wrap gap-3 items-center">
        <p class="text-xs text-gray-500 uppercase tracking-wider font-bold">Filter</p>
        <button type="button" data-filter="" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">ALL</button>
        <button type="button" data-filter="active" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-emerald-400 hover:bg-gray-600 transition-colors">ACTIVE</button>
        <button type="button" data-filter="discovered" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-blue-400 hover:bg-gray-600 transition-colors">DISCOVERED</button>
        <button type="button" data-filter="pending" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-yellow-400 hover:bg-gray-600 transition-colors">PENDING</button>
        <button type="button" data-filter="keys_delivered" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-cyan-400 hover:bg-gray-600 transition-colors">KEYS DELIVERED</button>
        <button type="button" data-filter="wipe_requested" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-orange-400 hover:bg-gray-600 transition-colors">WIPE REQ</button>
        <button type="button" data-filter="terminated" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-red-400 hover:bg-gray-600 transition-colors">TERMINATED</button>
        <button type="button" id="btn-repair" class="px-3 py-1 text-xs rounded font-bold bg-amber-600 hover:bg-amber-500 text-white transition-colors">REPAIR INDEX</button>
        <button type="button" id="btn-refresh" class="px-3 py-1 text-xs rounded font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">REFRESH</button>
      </div>
    </div>

    <div id="batch-bar" class="hidden bg-gray-800 border border-cyan-700/50 rounded-lg p-3">
      <div class="flex flex-wrap items-center gap-3">
        <span id="batch-count" class="text-xs font-mono text-cyan-300">0 selected</span>
        <button type="button" id="btn-select-all" class="px-3 py-1 text-xs rounded font-mono bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Select all</button>
        <button type="button" id="btn-deselect-all" class="px-3 py-1 text-xs rounded font-mono bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Deselect all</button>
        <div class="ml-auto flex gap-2">
          <button type="button" id="btn-batch-terminate" class="px-3 py-1.5 text-xs rounded font-bold bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled>Terminate</button>
          <button type="button" id="btn-batch-wipe" class="px-3 py-1.5 text-xs rounded font-bold bg-orange-700 hover:bg-orange-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled>Wipe</button>
          <button type="button" id="btn-batch-activate" class="px-3 py-1.5 text-xs rounded font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled>Activate</button>
          <button type="button" id="btn-batch-reprovision" class="px-3 py-1.5 text-xs rounded font-bold bg-amber-700 hover:bg-amber-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled>Re-provision</button>
        </div>
      </div>
    </div>

    <div id="loading" class="hidden text-center py-8">
      <div class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse mx-auto mb-3"></div>
      <p class="text-gray-400 text-sm">Loading card registry...</p>
    </div>

    <div id="cards-table" class="hidden bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div class="grid grid-cols-7 gap-2 px-4 py-3 bg-gray-900/50 text-xs text-gray-500 uppercase tracking-wider font-bold border-b border-gray-700">
        <div class="w-5"><input type="checkbox" id="select-all-checkbox" class="rounded" /></div>
        <div>UID</div>
        <div>State</div>
        <div>Provenance</div>
        <div>Label</div>
        <div>Updated</div>
        <div class="text-right">Actions</div>
      </div>
      <div id="cards-list" class="divide-y divide-gray-700/50"></div>
    </div>

    <div id="no-cards" class="hidden text-center py-8 text-gray-500 text-sm">
      No cards found in registry. Cards will appear here after they are tapped or provisioned.
    </div>

    <div id="load-more-container" class="hidden text-center py-4">
      <button type="button" id="btn-load-more" class="px-4 py-2 text-sm rounded font-bold bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">Load More</button>
    </div>

    <div id="batch-result" class="hidden bg-gray-800 border border-gray-700 rounded-lg p-4">
      <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Batch Result</div>
      <div id="batch-result-content" class="text-sm text-gray-300"></div>
    </div>

    <div id="repair-result" class="hidden bg-gray-800 border border-amber-700/50 rounded-lg p-4">
      <div class="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">Index Repair</div>
      <div id="repair-result-content" class="text-sm text-gray-300"></div>
    </div>

    <div id="error-display" class="hidden bg-red-900/50 border border-red-600 rounded-lg p-4" role="alert">
      <p id="error-message" class="text-red-300 text-sm"></p>
    </div>

    <div class="text-center text-xs text-gray-600">
      <p>Card data indexed from Durable Object state transitions. May lag up to 60 seconds due to KV eventual consistency.</p>
    </div>
  </div>

  <script>
    var currentFilter = "";
    var nextCursor = null;
    var hasMore = false;
    var allCards = [];
    var selectedUids = new Set();

    ${ESC_HELPER}

    ${CARD_STATE_HELPERS}

    function formatTime(ts) {
      if (!ts) return '-';
      try {
        var d = new Date(ts);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (e) { return '-'; }
    }

    function updateBatchBar() {
      var bar = document.getElementById('batch-bar');
      var count = selectedUids.size;
      document.getElementById('batch-count').textContent = count + ' selected';
      document.getElementById('btn-batch-terminate').disabled = count === 0;
      document.getElementById('btn-batch-wipe').disabled = count === 0;
      document.getElementById('btn-batch-activate').disabled = count === 0;
      document.getElementById('btn-batch-reprovision').disabled = count === 0;
      if (count > 0) {
        bar.classList.remove('hidden');
      } else {
        bar.classList.add('hidden');
      }
      document.getElementById('select-all-checkbox').checked = allCards.length > 0 && selectedUids.size === allCards.length;
    }

    function toggleCard(uid) {
      if (selectedUids.has(uid)) {
        selectedUids.delete(uid);
      } else {
        selectedUids.add(uid);
      }
      updateBatchBar();
    }

    async function loadCards(append) {
      if (!append) {
        nextCursor = null;
        hasMore = false;
        allCards = [];
        selectedUids.clear();
        updateBatchBar();
        document.getElementById('loading').classList.remove('hidden');
        document.getElementById('cards-table').classList.add('hidden');
        document.getElementById('no-cards').classList.add('hidden');
        document.getElementById('error-display').classList.add('hidden');
        document.getElementById('batch-result').classList.add('hidden');
      }

      try {
        var url = '/operator/cards/data?limit=100';
        if (currentFilter) url += '&state=' + encodeURIComponent(currentFilter);
        if (append && nextCursor) url += '&cursor=' + encodeURIComponent(nextCursor);
        var resp = await fetch(url);
        var data = await resp.json();

        document.getElementById('loading').classList.add('hidden');

        if (!resp.ok) {
          showError(data.reason || 'Failed to load cards');
          return;
        }

        var cards = data.cards || [];
        allCards = append ? allCards.concat(cards) : cards;
        hasMore = !!data.cursor;
        nextCursor = data.cursor || null;

        if (!append && cards.length === 0) {
          document.getElementById('no-cards').classList.remove('hidden');
          document.getElementById('load-more-container').classList.add('hidden');
          return;
        }

        document.getElementById('cards-table').classList.remove('hidden');
        renderCards();

        if (hasMore) {
          document.getElementById('load-more-container').classList.remove('hidden');
        } else {
          document.getElementById('load-more-container').classList.add('hidden');
        }
      } catch (err) {
        document.getElementById('loading').classList.add('hidden');
        showError('Failed to load card registry');
      }
    }

    function renderCards() {
      var list = document.getElementById('cards-list');
      var html = allCards.map(function(card) {
        var checked = selectedUids.has(card.uid) ? 'checked' : '';
        return '<div class="grid grid-cols-7 gap-2 px-4 py-3 text-sm hover:bg-gray-700/30 transition-colors">' +
          '<div class="w-5"><input type="checkbox" class="card-checkbox rounded" data-uid="' + esc(card.uid) + '" ' + checked + ' /></div>' +
          '<span class="font-mono text-gray-300 text-xs">' + esc(card.uid) + '</span>' +
          '<span class="font-mono ' + stateColor(card.state) + '">' + esc(card.state) + '</span>' +
          '<span class="font-mono text-xs ' + provenanceColor(card.keyProvenance) + '">' + esc(provenanceLabel(card.keyProvenance, true)) + '</span>' +
          '<span class="font-mono text-xs text-gray-400">' + esc(card.keyLabel || '-') + '</span>' +
          '<span class="text-xs text-gray-500">' + esc(formatTime(card.updatedAt)) + '</span>' +
          '<span class="text-right"><a href="/experimental/analytics?uid=' + encodeURIComponent(card.uid) + '" class="text-emerald-500 hover:text-emerald-400 text-xs">analytics</a></span>' +
          '</div>';
      }).join('');
      list.innerHTML = html;

      list.querySelectorAll('.card-checkbox').forEach(function(cb) {
        cb.addEventListener('change', function() {
          toggleCard(this.getAttribute('data-uid'));
        });
      });
    }

    async function batchAction(action) {
      if (selectedUids.size === 0) return;
      var uids = Array.from(selectedUids);
      var btnMap = { terminate: 'btn-batch-terminate', wipe: 'btn-batch-wipe', activate: 'btn-batch-activate', reprovision: 'btn-batch-reprovision' };
      var btn = document.getElementById(btnMap[action]);
      var origText = btn.textContent;
      btn.textContent = 'Working...';
      btn.disabled = true;

      try {
        var resp = await fetch('/operator/cards/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uids: uids, action: action }),
        });
        var data = await resp.json();

        var resultDiv = document.getElementById('batch-result');
        var contentDiv = document.getElementById('batch-result-content');

        if (!resp.ok) {
          showError(data.reason || 'Batch action failed');
          return;
        }

        var succeeded = data.results.filter(function(r) { return r.status !== 'skipped'; }).length;
        var skipped = data.results.filter(function(r) { return r.status === 'skipped'; }).length;
        var failed = (data.errors || []).length;

        var html = '<div class="space-y-1">' +
          '<p class="text-emerald-300 font-semibold">' + succeeded + ' card(s) processed: ' + esc(action) + '</p>';
        if (skipped > 0) {
          html += '<p class="text-yellow-300">' + skipped + ' card(s) skipped</p>';
          data.results.filter(function(r) { return r.status === 'skipped'; }).forEach(function(r) {
            html += '<p class="text-xs text-gray-500 ml-3">' + esc(r.uid) + ': ' + esc(r.reason) + '</p>';
          });
        }
        if (failed > 0) {
          html += '<p class="text-red-300">' + failed + ' card(s) failed</p>';
          data.errors.forEach(function(e) {
            html += '<p class="text-xs text-gray-500 ml-3">' + esc(e.uid) + ': ' + esc(e.error) + '</p>';
          });
        }
        html += '</div>';
        contentDiv.innerHTML = html;
        resultDiv.classList.remove('hidden');

        selectedUids.clear();
        updateBatchBar();
        loadCards(false);
      } catch (err) {
        showError('Batch action failed: ' + err.message);
      } finally {
        btn.textContent = origText;
        btn.disabled = selectedUids.size === 0;
      }
    }

    function showError(msg) {
      document.getElementById('error-display').classList.remove('hidden');
      document.getElementById('error-message').textContent = msg;
    }

    document.querySelectorAll('.filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        currentFilter = this.getAttribute('data-filter');
        document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('ring-2', 'ring-emerald-500'); });
        this.classList.add('ring-2', 'ring-emerald-500');
        loadCards(false);
      });
    });

    document.getElementById('btn-refresh').addEventListener('click', function() { loadCards(false); });
    document.getElementById('btn-load-more').addEventListener('click', function() { loadCards(true); });

    document.getElementById('select-all-checkbox').addEventListener('change', function() {
      var checked = this.checked;
      allCards.forEach(function(c) {
        if (checked) selectedUids.add(c.uid);
        else selectedUids.delete(c.uid);
      });
      updateBatchBar();
      renderCards();
    });

    document.getElementById('btn-select-all').addEventListener('click', function() {
      allCards.forEach(function(c) { selectedUids.add(c.uid); });
      updateBatchBar();
      renderCards();
    });

    document.getElementById('btn-deselect-all').addEventListener('click', function() {
      selectedUids.clear();
      updateBatchBar();
      renderCards();
    });

    document.getElementById('btn-batch-terminate').addEventListener('click', function() { batchAction('terminate'); });
    document.getElementById('btn-batch-wipe').addEventListener('click', function() { batchAction('wipe'); });
    document.getElementById('btn-batch-activate').addEventListener('click', function() { batchAction('activate'); });
    document.getElementById('btn-batch-reprovision').addEventListener('click', function() { batchAction('reprovision'); });

    document.getElementById('btn-repair').addEventListener('click', async function() {
      var btn = document.getElementById('btn-repair');
      var origText = btn.textContent;
      btn.textContent = 'Scanning...';
      btn.disabled = true;
      document.getElementById('repair-result').classList.add('hidden');

      try {
        var resp = await fetch('/operator/cards/repair', { method: 'POST' });
        var data = await resp.json();
        var resultDiv = document.getElementById('repair-result');
        var contentDiv = document.getElementById('repair-result-content');

        if (!resp.ok) {
          contentDiv.innerHTML = '<p class="text-red-300">Repair failed: ' + esc(data.error || 'unknown error') + '</p>';
        } else {
          var html = '<p class="text-amber-300">Scanned <strong>' + data.scanned + '</strong> card(s), repaired <strong>' + data.repaired + '</strong></p>';
          if (data.errors && data.errors.length > 0) {
            html += '<p class="text-red-300 text-xs mt-1">' + data.errors.length + ' error(s):</p>';
            data.errors.forEach(function(e) {
              html += '<p class="text-xs text-gray-500 ml-3">' + esc(e.uid) + ': ' + esc(e.error) + '</p>';
            });
          }
          if (data.repaired === 0 && (!data.errors || data.errors.length === 0)) {
            html += '<p class="text-gray-400 text-xs mt-1">All index entries match DO state.</p>';
          }
          contentDiv.innerHTML = html;
        }
        resultDiv.classList.remove('hidden');
        if (data.repaired > 0) loadCards(false);
      } catch (err) {
        showError('Index repair failed: ' + err.message);
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    });

    loadCards(false);
  </script>
  `;

  return renderTailwindPage({
    title: "Card Registry",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased flex flex-col items-center",
    styles: [
      'body { background-color: #111827; color: #f3f4f6; }',
      '.hidden { display: none !important; }',
    ].join('\n'),
    content,
  });
}
