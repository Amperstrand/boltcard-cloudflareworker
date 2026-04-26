import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { CSRF_FETCH_HELPER } from "./browserNfc.js";

export function renderCardAuditPage() {
  const content = rawHtml`
  <div class="max-w-4xl w-full space-y-6">
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
        <button type="button" id="btn-refresh" class="ml-auto px-3 py-1 text-xs rounded font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">REFRESH</button>
      </div>
    </div>

    <div id="loading" class="hidden text-center py-8">
      <div class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse mx-auto mb-3"></div>
      <p class="text-gray-400 text-sm">Loading card registry...</p>
    </div>

    <div id="cards-table" class="hidden bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div class="grid grid-cols-6 gap-2 px-4 py-3 bg-gray-900/50 text-xs text-gray-500 uppercase tracking-wider font-bold border-b border-gray-700">
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

    <div id="error-display" class="hidden bg-red-900/50 border border-red-600 rounded-lg p-4" role="alert">
      <p id="error-message" class="text-red-300 text-sm"></p>
    </div>

    <div class="text-center text-xs text-gray-600">
      <p>Card data indexed from Durable Object state transitions. May lag up to 60 seconds due to KV eventual consistency.</p>
    </div>
  </div>

  <script>
    ${safe(CSRF_FETCH_HELPER)}

    var currentFilter = "";

    function stateColor(state) {
      var colors = {
        'active': 'text-emerald-400',
        'discovered': 'text-blue-400',
        'pending': 'text-yellow-400',
        'keys_delivered': 'text-cyan-400',
        'terminated': 'text-red-400',
        'wipe_requested': 'text-orange-400',
        'new': 'text-gray-400',
        'legacy': 'text-gray-500',
      };
      return colors[state] || 'text-gray-300';
    }

    function provenanceLabel(p) {
      var labels = {
        'public_issuer': 'Public',
        'env_issuer': 'Private',
        'percard': 'Per-Card',
        'user_provisioned': 'User',
        'unknown': 'Unknown',
      };
      return labels[p] || p || '-';
    }

    function provenanceColor(p) {
      if (p === 'public_issuer') return 'text-yellow-400';
      if (p === 'env_issuer') return 'text-emerald-400';
      return 'text-gray-400';
    }

    function formatTime(ts) {
      if (!ts) return '-';
      try {
        var d = new Date(ts);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (e) { return '-'; }
    }

    async function loadCards() {
      document.getElementById('loading').classList.remove('hidden');
      document.getElementById('cards-table').classList.add('hidden');
      document.getElementById('no-cards').classList.add('hidden');
      document.getElementById('error-display').classList.add('hidden');

      try {
        var url = '/operator/cards/data?limit=100';
        if (currentFilter) url += '&state=' + encodeURIComponent(currentFilter);
        var resp = await fetch(url);
        var data = await resp.json();

        document.getElementById('loading').classList.add('hidden');

        if (!resp.ok) {
          showError(data.reason || 'Failed to load cards');
          return;
        }

        var cards = data.cards || [];
        if (cards.length === 0) {
          document.getElementById('no-cards').classList.remove('hidden');
          return;
        }

        document.getElementById('cards-table').classList.remove('hidden');
        var list = document.getElementById('cards-list');
        list.innerHTML = cards.map(function(card) {
          return '<div class="grid grid-cols-6 gap-2 px-4 py-3 text-sm hover:bg-gray-700/30 transition-colors">' +
            '<span class="font-mono text-gray-300 text-xs">' + esc(card.uid) + '</span>' +
            '<span class="font-mono ' + stateColor(card.state) + '">' + esc(card.state) + '</span>' +
            '<span class="font-mono text-xs ' + provenanceColor(card.keyProvenance) + '">' + esc(provenanceLabel(card.keyProvenance)) + '</span>' +
            '<span class="font-mono text-xs text-gray-400">' + esc(card.keyLabel || '-') + '</span>' +
            '<span class="text-xs text-gray-500">' + esc(formatTime(card.updatedAt)) + '</span>' +
            '<span class="text-right"><a href="/experimental/analytics?uid=' + encodeURIComponent(card.uid) + '" class="text-emerald-500 hover:text-emerald-400 text-xs">analytics</a></span>' +
            '</div>';
        }).join('');
      } catch (err) {
        document.getElementById('loading').classList.add('hidden');
        showError('Failed to load card registry');
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
        loadCards();
      });
    });

    document.getElementById('btn-refresh').addEventListener('click', loadCards);

    loadCards();
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
