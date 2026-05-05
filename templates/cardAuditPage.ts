import { rawHtml, safe } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderCardAuditPage(): string {
  const content: string = rawHtml`
  <div class="max-w-5xl w-full space-y-6">
    <div class="flex items-center justify-between border-b border-gray-700 pb-4">
      <h1 class="text-2xl md:text-3xl font-bold text-emerald-500 tracking-tight">CARD REGISTRY</h1>
      <span class="px-3 py-1 bg-emerald-500/10 text-emerald-500 text-sm font-mono rounded border border-emerald-500/20">AUDIT</span>
    </div>

    <div class="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <div class="flex flex-wrap gap-3 items-center">
        <p class="text-xs text-gray-500 uppercase tracking-wider font-bold">Filter</p>
        <button type="button" data-action="filter" data-filter="" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">ALL</button>
        <button type="button" data-action="filter" data-filter="active" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-emerald-400 hover:bg-gray-600 transition-colors">ACTIVE</button>
        <button type="button" data-action="filter" data-filter="discovered" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-blue-400 hover:bg-gray-600 transition-colors">DISCOVERED</button>
        <button type="button" data-action="filter" data-filter="pending" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-yellow-400 hover:bg-gray-600 transition-colors">PENDING</button>
        <button type="button" data-action="filter" data-filter="keys_delivered" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-cyan-400 hover:bg-gray-600 transition-colors">KEYS DELIVERED</button>
        <button type="button" data-action="filter" data-filter="wipe_requested" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-orange-400 hover:bg-gray-600 transition-colors">WIPE REQ</button>
        <button type="button" data-action="filter" data-filter="terminated" class="filter-btn px-3 py-1 text-xs rounded font-mono bg-gray-700 text-red-400 hover:bg-gray-600 transition-colors">TERMINATED</button>
        <button type="button" id="btn-repair" data-action="repair" class="px-3 py-1 text-xs rounded font-bold bg-amber-600 hover:bg-amber-500 text-white transition-colors">REPAIR INDEX</button>
        <button type="button" id="btn-refresh" data-action="refresh" class="px-3 py-1 text-xs rounded font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">REFRESH</button>
      </div>
    </div>

    <div id="batch-bar" class="hidden bg-gray-800 border border-cyan-700/50 rounded-lg p-3">
      <div class="flex flex-wrap items-center gap-3">
        <span id="batch-count" class="text-xs font-mono text-cyan-300">0 selected</span>
        <button type="button" data-action="select-all" class="px-3 py-1 text-xs rounded font-mono bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Select all</button>
        <button type="button" data-action="deselect-all" class="px-3 py-1 text-xs rounded font-mono bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Deselect all</button>
        <div class="ml-auto flex gap-2">
          <button type="button" id="btn-batch-terminate" data-action="batch-terminate" class="px-3 py-1.5 text-xs rounded font-bold bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled>Terminate</button>
          <button type="button" id="btn-batch-wipe" data-action="batch-wipe" class="px-3 py-1.5 text-xs rounded font-bold bg-orange-700 hover:bg-orange-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled>Wipe</button>
          <button type="button" id="btn-batch-activate" data-action="batch-activate" class="px-3 py-1.5 text-xs rounded font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled>Activate</button>
          <button type="button" id="btn-batch-reprovision" data-action="batch-reprovision" class="px-3 py-1.5 text-xs rounded font-bold bg-amber-700 hover:bg-amber-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed" disabled>Re-provision</button>
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
      <button type="button" data-action="load-more" class="px-4 py-2 text-sm rounded font-bold bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">Load More</button>
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

  ${safe('<script src="/static/js/nfc.js"></script>')}
  ${safe('<script src="/static/js/card-audit.js"></script>')}
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
