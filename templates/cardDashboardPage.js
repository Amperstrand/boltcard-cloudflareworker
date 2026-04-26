import { rawHtml, safe } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS } from "./browserNfc.js";

export function renderCardDashboardPage({ host } = {}) {
  const content = rawHtml`
  <div class="max-w-lg mx-auto">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-emerald-500 tracking-tight mb-2">MY CARD</h1>
      <p class="text-gray-400 text-sm">Tap your bolt card to see its status</p>
    </div>

    <div id="scan-section" class="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6 text-center">
      <div id="scan-status" class="text-gray-400 text-sm">
        Hold your card to the back of your phone, or enter your card URL below
      </div>
      <div id="scan-error" class="text-red-400 text-xs mt-2 hidden"></div>
    </div>

    <div id="card-info" class="hidden">
      <div id="provenance-banner" class="hidden mb-4 bg-yellow-900/50 border border-yellow-600 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <span class="text-yellow-400 text-xl">&#9888;&#65039;</span>
          <div>
            <p class="text-yellow-300 font-bold text-sm">Public Key Detected</p>
            <p class="text-yellow-200 text-xs mt-1">Your card is using publicly known keys. Anyone with the issuer key can clone your card. Re-program it with private keys for security.</p>
            <a id="activate-link" href="/experimental/activate" class="inline-block mt-3 bg-yellow-600 hover:bg-yellow-500 text-white font-bold px-4 py-2 rounded text-xs transition-colors">
              Re-program Card
            </a>
          </div>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Details</p>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-400">UID</span>
            <span id="card-uid" class="text-gray-200 font-mono"></span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-400">State</span>
            <span id="card-state" class="font-mono"></span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-400">Key Origin</span>
            <span id="card-provenance" class="font-mono"></span>
          </div>
          <div id="key-label-row" class="flex justify-between hidden">
            <span class="text-gray-400">Key Label</span>
            <span id="card-key-label" class="text-gray-200 font-mono"></span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-400">Balance</span>
            <span id="card-balance" class="text-emerald-400 font-bold"></span>
          </div>
        </div>
      </div>

      <div id="taps-section" class="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Recent Taps</p>
        <div id="taps-list" class="space-y-2">
          <p class="text-gray-500 text-xs text-center">No tap history</p>
        </div>
      </div>
    </div>

    <div id="error-display" class="hidden bg-red-900/50 border border-red-600 rounded-lg p-4 mt-4">
      <p id="error-message" class="text-red-300 text-sm"></p>
    </div>
  </div>

  <script>
    ${BROWSER_NFC_HELPERS}

    const host = ${safe(JSON.stringify(host || ""))};

    function stateLabel(state) {
      const labels = {
        'new': 'New',
        'pending': 'Pending',
        'discovered': 'Discovered',
        'keys_delivered': 'Keys Delivered',
        'active': 'Active',
        'wipe_requested': 'Wipe Requested',
        'terminated': 'Terminated',
        'legacy': 'Legacy',
      };
      return labels[state] || state;
    }

    function stateColor(state) {
      const colors = {
        'active': 'text-emerald-400',
        'discovered': 'text-blue-400',
        'pending': 'text-yellow-400',
        'keys_delivered': 'text-cyan-400',
        'terminated': 'text-red-400',
        'wipe_requested': 'text-orange-400',
      };
      return colors[state] || 'text-gray-300';
    }

    function provenanceLabel(provenance) {
      const labels = {
        'public_issuer': 'Public Key',
        'env_issuer': 'Private (Server)',
        'percard': 'Per-Card Import',
        'user_provisioned': 'User Provisioned',
        'unknown': 'Unknown',
      };
      return labels[provenance] || provenance || 'Unknown';
    }

    function provenanceColor(provenance) {
      if (provenance === 'public_issuer') return 'text-yellow-400';
      if (provenance === 'env_issuer') return 'text-emerald-400';
      return 'text-gray-300';
    }

    function formatBalance(msat) {
      if (msat >= 1000000) return (msat / 1000000).toFixed(3) + ' BTC';
      if (msat >= 1000) return (msat / 1000).toFixed(0) + ' sats';
      return msat + ' msat';
    }

    function renderTaps(taps) {
      const el = document.getElementById('taps-list');
      if (!taps || taps.length === 0) {
        el.innerHTML = '<p class="text-gray-500 text-xs text-center">No tap history</p>';
        return;
      }
      el.innerHTML = taps.map(t => {
        const statusColor = t.status === 'completed' ? 'text-emerald-400' : t.status === 'failed' ? 'text-red-400' : 'text-yellow-400';
        return '<div class="flex justify-between items-center text-xs">' +
          '<span class="text-gray-400 font-mono">ctr ' + esc(t.counter) + '</span>' +
          '<span class="' + statusColor + '">' + esc(t.status) + '</span>' +
          (t.amountMsat ? '<span class="text-gray-300">' + esc(formatBalance(t.amountMsat)) + '</span>' : '<span class="text-gray-600">-</span>') +
          '</div>';
      }).join('');
    }

    async function showCardInfo(p, c) {
      document.getElementById('error-display').classList.add('hidden');

      try {
        const resp = await fetch('/card/info?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
        const data = await resp.json();

        if (!resp.ok) {
          showError(data.reason || 'Failed to load card info');
          return;
        }

        document.getElementById('scan-section').classList.add('hidden');
        document.getElementById('card-info').classList.remove('hidden');

        document.getElementById('card-uid').textContent = data.maskedUid || data.uid;

        const stateEl = document.getElementById('card-state');
        stateEl.textContent = stateLabel(data.state);
        stateEl.className = 'font-mono ' + stateColor(data.state);

        const provEl = document.getElementById('card-provenance');
        provEl.textContent = provenanceLabel(data.keyProvenance);
        provEl.className = 'font-mono ' + provenanceColor(data.keyProvenance);

        if (data.keyLabel) {
          document.getElementById('key-label-row').classList.remove('hidden');
          document.getElementById('card-key-label').textContent = data.keyLabel;
        }

        document.getElementById('card-balance').textContent = formatBalance(data.balance);

        if (data.programmingRecommended) {
          document.getElementById('provenance-banner').classList.remove('hidden');
          if (data.uid) {
            document.getElementById('activate-link').href = '/experimental/activate?uid=' + encodeURIComponent(data.uid);
          }
        }

        renderTaps(data.recentTaps);
      } catch (err) {
        showError('Failed to load card info: ' + err.message);
      }
    }

    function showError(msg) {
      document.getElementById('error-display').classList.remove('hidden');
      document.getElementById('error-message').textContent = msg;
    }

    function browserSupportsNfc() {
      return 'NDEFReader' in window;
    }

    function extractParams(url) {
      try {
        const u = new URL(url);
        const p = u.searchParams.get('p');
        const c = u.searchParams.get('c');
        if (p && c) return { p, c };
      } catch (e) {}
      return null;
    }

    (async function init() {
      const currentUrl = window.location.href;
      const params = extractParams(currentUrl);
      if (params) {
        await showCardInfo(params.p, params.c);
        return;
      }

      if (!browserSupportsNfc()) return;

      try {
        const reader = new NDEFReader();
        await reader.scan();
        document.getElementById('scan-status').textContent = 'Ready — tap your card now...';

        reader.onreading = async (event) => {
          for (const record of event.message.records) {
            if (record.recordType === 'url' || record.recordType === 'text') {
              let url = '';
              if (record.recordType === 'url') {
                const textDecoder = new TextDecoder(record.encoding || 'utf-8');
                url = textDecoder.decode(record.data);
              } else {
                const textDecoder = new TextDecoder(record.encoding || 'utf-8');
                const text = textDecoder.decode(record.data);
                if (text.startsWith('http')) url = text;
              }
              if (url) {
                const params = extractParams(url);
                if (params) {
                  document.getElementById('scan-status').textContent = 'Card detected!';
                  await showCardInfo(params.p, params.c);
                  return;
                }
              }
            }
          }
          document.getElementById('scan-error').textContent = 'Card did not contain a valid bolt card URL';
          document.getElementById('scan-error').classList.remove('hidden');
        };

        reader.onerror = (event) => {
          document.getElementById('scan-error').textContent = 'NFC scan error: ' + (event.error?.message || 'unknown');
          document.getElementById('scan-error').classList.remove('hidden');
        };
      } catch (err) {
        document.getElementById('scan-status').textContent = 'NFC not available. Use card URL directly.';
      }
    })();
  </script>
  `;

  return renderTailwindPage({
    title: "My Bolt Card",
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content,
  });
}
