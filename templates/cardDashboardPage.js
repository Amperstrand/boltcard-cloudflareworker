import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import { BROWSER_NFC_HELPERS } from "./browserNfc.js";

export function renderCardDashboardPage() {
  const content = rawHtml`
  <main class="max-w-lg mx-auto">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-emerald-500 tracking-tight mb-2">MY CARD</h1>
      <p class="text-gray-400 text-sm">Tap your bolt card or paste your card URL</p>
    </div>

    <div id="scan-section" class="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6 text-center">
      <div id="scan-status" class="text-gray-400 text-sm">
        Hold your card to the back of your phone
      </div>
      <div id="scan-error" class="hidden bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs mt-3 p-2 rounded"></div>
      <div id="nfc-unsupported" class="hidden text-gray-500 text-xs mt-3">
        NFC not available on this device. Paste your card URL below.
      </div>
      <button id="btn-scan-again" type="button" class="hidden mt-4 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded text-sm transition-colors">
        SCAN AGAIN
      </button>
    </div>

    <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6">
      <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card URL</p>
      <div class="flex gap-2">
        <input type="text" id="url-input" placeholder="https://...?p=...&c=..." class="flex-1 bg-gray-900 border border-gray-700 text-gray-200 font-mono text-xs p-2 rounded focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors" />
        <button id="btn-load-url" type="button" class="bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold px-3 py-2 rounded text-xs transition-colors">
          LOAD
        </button>
      </div>
      <p id="url-error" class="hidden text-red-400 text-xs mt-2"></p>
    </div>

    <div id="loading" class="hidden text-center py-8">
      <div class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse mx-auto mb-3"></div>
      <p class="text-gray-400 text-sm">Loading card info...</p>
    </div>

    <div id="card-info" class="hidden" aria-live="polite">
      <div id="provenance-banner" class="hidden mb-4 bg-yellow-900/50 border border-yellow-600 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <span class="text-yellow-400 text-xl" aria-hidden="true">&#9888;&#65039;</span>
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
          <div id="method-row" class="flex justify-between hidden">
            <span class="text-gray-400">Type</span>
            <span id="card-method" class="text-gray-200 font-mono text-xs"></span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-400">Key Origin</span>
            <span id="card-provenance" class="font-mono"></span>
          </div>
          <div id="key-label-row" class="flex justify-between hidden">
            <span class="text-gray-400">Key Label</span>
            <span id="card-key-label" class="text-gray-200 font-mono"></span>
          </div>
          <div id="version-row" class="flex justify-between hidden">
            <span class="text-gray-400">Key Version</span>
            <span id="card-version" class="text-gray-200 font-mono"></span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-400">Balance</span>
            <span id="card-balance" class="text-emerald-400 font-bold"></span>
          </div>
          <div id="activated-row" class="flex justify-between hidden">
            <span class="text-gray-400">Activated</span>
            <span id="card-activated" class="text-gray-400 text-xs"></span>
          </div>
          <div id="first-seen-row" class="flex justify-between hidden">
            <span class="text-gray-400">First Seen</span>
            <span id="card-first-seen" class="text-gray-400 text-xs"></span>
          </div>
        </div>
      </div>

      <div id="analytics-section" class="hidden grid grid-cols-3 gap-3 mb-4">
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center">
          <div class="text-xs text-gray-500 uppercase">Total Spent</div>
          <div id="analytics-spent" class="text-sm font-bold text-red-400 mt-1">0</div>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center">
          <div class="text-xs text-gray-500 uppercase">Taps</div>
          <div id="analytics-taps" class="text-sm font-bold text-cyan-400 mt-1">0</div>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center">
          <div class="text-xs text-gray-500 uppercase">Success</div>
          <div id="analytics-rate" class="text-sm font-bold text-emerald-400 mt-1">-</div>
        </div>
      </div>

      <div id="history-section" class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Activity</p>
        <div id="history-list" class="space-y-1">
          <p class="text-gray-500 text-xs text-center">No activity</p>
        </div>
      </div>

       <div id="lock-section" class="hidden mb-4">
         <button id="btn-lock" type="button" class="w-full bg-red-900/50 hover:bg-red-800/50 border border-red-600/50 text-red-300 font-bold py-3 px-4 rounded-lg text-sm transition-colors">
           Lock Card
         </button>
         <div id="lock-confirm" class="hidden bg-red-900/30 border border-red-600/50 rounded-lg p-4 mt-2">
           <p class="text-red-200 text-sm mb-3">This will permanently lock your card. You will not be able to use it again. You can re-activate it later by tapping your card again.</p>
           <div class="flex gap-3">
             <button id="btn-lock-confirm" type="button" class="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded text-sm transition-colors">Confirm Lock</button>
             <button id="btn-lock-cancel" type="button" class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2 px-4 rounded text-sm transition-colors">Cancel</button>
           </div>
         </div>
         <div id="lock-status" class="hidden mt-2 text-center text-sm"></div>
       </div>

       <div id="reactivate-section" class="hidden mb-4">
         <div class="bg-amber-900/30 border border-amber-600/50 rounded-lg p-4 mb-3">
           <p class="text-amber-200 text-sm mb-1">This card is locked.</p>
           <p class="text-amber-300/80 text-xs">Re-activating will generate new keys and advance to version <span id="reactivate-version">N+1</span>. You will need to write the new keys to your card via NFC.</p>
         </div>
         <div id="reactivate-scan" class="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
           <p class="text-gray-400 text-sm mb-3">Tap your card to verify ownership</p>
           <div id="reactivate-scan-status" class="text-gray-500 text-xs"></div>
           <div id="reactivate-scan-error" class="hidden text-red-400 text-xs mt-2"></div>
         </div>
         <div id="reactivate-status" class="hidden mt-2 text-center text-sm"></div>
         <div id="reactivate-success" class="hidden bg-emerald-900/30 border border-emerald-600/50 rounded-lg p-4 mt-3">
           <p class="text-emerald-200 text-sm mb-2">New keys generated (version <span id="reactivate-new-version"></span>)</p>
           <a id="reactivate-program-link" href="/experimental/activate" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded text-sm transition-colors">
             Program Card
           </a>
         </div>
       </div>

      <div class="mt-4 text-center">
        <button id="btn-refresh" type="button" class="text-gray-500 hover:text-gray-300 text-xs transition-colors">
          Refresh
        </button>
      </div>
    </div>

    <div id="error-display" class="hidden bg-red-900/50 border border-red-600 rounded-lg p-4 mt-4" role="alert">
      <p id="error-message" class="text-red-300 text-sm"></p>
      <button id="btn-retry" type="button" class="mt-2 text-red-400 hover:text-red-300 text-xs underline">Try again</button>
    </div>
  </main>

  <script>
    ${BROWSER_NFC_HELPERS}

    var lastP = null;
    var lastC = null;

    function stateLabel(state) {
      var labels = {
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
      var colors = {
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
      var labels = {
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
      if (!msat || msat === 0) return '0 msat';
      if (msat >= 1000000) return (msat / 1000000).toFixed(3) + ' BTC';
      if (msat >= 1000) return (msat / 1000).toFixed(0) + ' sats';
      return msat + ' msat';
    }

    function formatTime(iso) {
      if (!iso) return null;
      try {
        var d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (e) { return iso; }
    }

    function renderHistory(items) {
      var el = document.getElementById('history-list');
      if (!items || items.length === 0) {
        el.innerHTML = '<p class="text-gray-500 text-xs text-center">No activity</p>';
        return;
      }
      el.innerHTML = items.slice(0, 15).map(function(item) {
        var status = item.status || 'unknown';
        var icon, color;
        if (status === 'completed') { icon = '\u2713'; color = 'text-emerald-400'; }
        else if (status === 'failed') { icon = '\u2717'; color = 'text-red-400'; }
        else if (status === 'topup') { icon = '+'; color = 'text-cyan-400'; }
        else if (status === 'payment') { icon = '\u2192'; color = 'text-amber-400'; }
        else if (status === 'read') { icon = '\u2022'; color = 'text-gray-500'; }
        else { icon = '?'; color = 'text-gray-500'; }
        var amt = item.amount_msat || item.amountMsat;
        var time = formatTime(item.created_at || item.createdAt);
        var note = item.note ? ' <span class="text-gray-600">(' + esc(item.note) + ')</span>' : '';
        return '<div class="flex items-center gap-2 text-xs py-1.5 border-b border-gray-700/30 last:border-0">' +
          '<span class="' + color + ' w-4 text-center font-bold">' + icon + '</span>' +
          '<span class="text-gray-400 font-mono w-12 text-[10px]">ctr ' + esc(item.counter || '-') + '</span>' +
          '<span class="' + color + ' flex-1">' + esc(status) + note + '</span>' +
          (amt ? '<span class="text-gray-300 font-mono">' + esc(formatBalance(amt)) + '</span>' : '') +
          (time ? '<span class="text-gray-600 text-[10px] w-28 text-right">' + esc(time) + '</span>' : '') +
          '</div>';
      }).join('');
    }

    function showLoading() {
      document.getElementById('loading').classList.remove('hidden');
      document.getElementById('card-info').classList.add('hidden');
      document.getElementById('error-display').classList.add('hidden');
    }

    function hideLoading() {
      document.getElementById('loading').classList.add('hidden');
    }

    async function showCardInfo(p, c) {
      lastP = p;
      lastC = c;
      document.getElementById('error-display').classList.add('hidden');
      showLoading();

      try {
        var resp = await fetch('/card/info?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
        var data = await resp.json();

        hideLoading();

        if (!resp.ok) {
          showError(data.reason || data.error || 'Failed to load card info');
          return;
        }

        document.getElementById('scan-section').classList.add('hidden');
        document.getElementById('card-info').classList.remove('hidden');

        document.getElementById('card-uid').textContent = data.maskedUid || data.uid;

        var stateEl = document.getElementById('card-state');
        stateEl.textContent = stateLabel(data.state);
        stateEl.className = 'font-mono ' + stateColor(data.state);

        var provEl = document.getElementById('card-provenance');
        provEl.textContent = provenanceLabel(data.keyProvenance);
        provEl.className = 'font-mono ' + provenanceColor(data.keyProvenance);

        if (data.keyLabel) {
          document.getElementById('key-label-row').classList.remove('hidden');
          document.getElementById('card-key-label').textContent = data.keyLabel;
        } else {
          document.getElementById('key-label-row').classList.add('hidden');
        }

        if (data.activeVersion && data.activeVersion > 1) {
          document.getElementById('version-row').classList.remove('hidden');
          document.getElementById('card-version').textContent = data.activeVersion;
        } else {
          document.getElementById('version-row').classList.add('hidden');
        }

        if (data.paymentMethodLabel) {
          document.getElementById('method-row').classList.remove('hidden');
          document.getElementById('card-method').textContent = data.paymentMethodLabel;
        } else {
          document.getElementById('method-row').classList.add('hidden');
        }

        document.getElementById('card-balance').textContent = formatBalance(data.balance);

        if (data.activatedAt) {
          var fmtAct = formatTime(data.activatedAt);
          if (fmtAct) {
            document.getElementById('activated-row').classList.remove('hidden');
            document.getElementById('card-activated').textContent = fmtAct;
          } else {
            document.getElementById('activated-row').classList.add('hidden');
          }
        } else {
          document.getElementById('activated-row').classList.add('hidden');
        }

        if (data.firstSeenAt) {
          var formattedFirstSeen = formatTime(data.firstSeenAt);
          if (formattedFirstSeen) {
            document.getElementById('first-seen-row').classList.remove('hidden');
            document.getElementById('card-first-seen').textContent = formattedFirstSeen;
          } else {
            document.getElementById('first-seen-row').classList.add('hidden');
          }
        } else {
          document.getElementById('first-seen-row').classList.add('hidden');
        }

        if (data.programmingRecommended) {
          document.getElementById('provenance-banner').classList.remove('hidden');
          if (data.uid) {
            document.getElementById('activate-link').href = '/experimental/activate?uid=' + encodeURIComponent(data.uid);
          }
        } else {
          document.getElementById('provenance-banner').classList.add('hidden');
        }

        if (data.analytics && data.analytics.totalTaps > 0) {
          document.getElementById('analytics-section').classList.remove('hidden');
          document.getElementById('analytics-spent').textContent = formatBalance(data.analytics.completedMsat || 0);
          document.getElementById('analytics-taps').textContent = data.analytics.totalTaps;
          var rate = data.analytics.totalTaps > 0 ? Math.round((data.analytics.completedTaps / data.analytics.totalTaps) * 100) : 0;
          document.getElementById('analytics-rate').textContent = rate + '%';
        } else {
          document.getElementById('analytics-section').classList.add('hidden');
        }

        renderHistory(data.history);

        var canLock = data.state === 'active' || data.state === 'discovered';
        if (canLock) {
          document.getElementById('lock-section').classList.remove('hidden');
        } else {
          document.getElementById('lock-section').classList.add('hidden');
        }
        document.getElementById('lock-confirm').classList.add('hidden');
        document.getElementById('lock-status').classList.add('hidden');

        var isTerminated = data.state === 'terminated';
        if (isTerminated && data.reactivationAvailable) {
          document.getElementById('reactivate-section').classList.remove('hidden');
          var nextVer = (data.currentVersion || 1) + 1;
          document.getElementById('reactivate-version').textContent = nextVer;
          document.getElementById('reactivate-success').classList.add('hidden');
          document.getElementById('reactivate-scan').classList.remove('hidden');
          document.getElementById('reactivate-scan-status').textContent = '';
          document.getElementById('reactivate-scan-error').classList.add('hidden');
        } else {
          document.getElementById('reactivate-section').classList.add('hidden');
        }

        var newUrl = window.location.pathname + '?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c);
        window.history.replaceState(null, '', newUrl);

        document.getElementById('card-info').focus();
      } catch (err) {
        hideLoading();
        showError('Failed to load card info. Please try again.');
      }
    }

    function showError(msg) {
      document.getElementById('error-display').classList.remove('hidden');
      document.getElementById('error-message').textContent = msg;
    }

    function resetView() {
      document.getElementById('scan-section').classList.remove('hidden');
      document.getElementById('card-info').classList.add('hidden');
      document.getElementById('error-display').classList.add('hidden');
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('scan-error').classList.add('hidden');
      lastP = null;
      lastC = null;
    }

    function extractParams(url) {
      try {
        var u = new URL(url);
        var p = u.searchParams.get('p');
        var c = u.searchParams.get('c');
        if (p && c) return { p: p, c: c };
      } catch (e) {}
      return null;
    }

    var cardScanner = createNfcScanner({
      continuous: false,
      debounceMs: 0,
      onStatus: function(status) {
        if (status === 'scanning') {
          document.getElementById('scan-status').textContent = 'Ready — tap your card now...';
        } else if (status === 'stopped') {
          document.getElementById('scan-status').textContent = 'Hold your card to the back of your phone';
        }
      },
      onError: function(err, phase) {
        var scanError = document.getElementById('scan-error');
        if (phase === 'permission') {
          document.getElementById('nfc-unsupported').classList.remove('hidden');
          scanError.classList.add('hidden');
        } else {
          scanError.textContent = 'NFC error: ' + (err.message || 'unknown');
          scanError.classList.remove('hidden');
        }
      },
      onTap: function(data) {
        if (!data.url) {
          var scanError = document.getElementById('scan-error');
          scanError.textContent = 'Card did not contain a valid bolt card URL';
          scanError.classList.remove('hidden');
          return;
        }
        var params = extractParams(data.url);
        if (params) {
          document.getElementById('scan-error').classList.add('hidden');
          showCardInfo(params.p, params.c);
        } else {
          var scanError = document.getElementById('scan-error');
          scanError.textContent = 'Card did not contain a valid bolt card URL';
          scanError.classList.remove('hidden');
        }
      }
    });

    document.getElementById('btn-scan-again').addEventListener('click', function() {
      resetView();
      cardScanner.restart();
    });

    document.getElementById('btn-load-url').addEventListener('click', function() {
      var input = document.getElementById('url-input').value.trim();
      var urlError = document.getElementById('url-error');
      urlError.classList.add('hidden');
      if (!input) {
        urlError.textContent = 'Please enter a card URL';
        urlError.classList.remove('hidden');
        return;
      }
      var params = extractParams(input);
      if (!params) {
        urlError.textContent = 'URL must contain p and c parameters';
        urlError.classList.remove('hidden');
        return;
      }
      resetView();
      showCardInfo(params.p, params.c);
    });

    document.getElementById('url-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') document.getElementById('btn-load-url').click();
    });

    document.getElementById('btn-refresh').addEventListener('click', function() {
      if (lastP && lastC) showCardInfo(lastP, lastC);
    });

    document.getElementById('btn-retry').addEventListener('click', function() {
      resetView();
      cardScanner.restart();
    });

    document.getElementById('btn-lock').addEventListener('click', function() {
      document.getElementById('lock-confirm').classList.remove('hidden');
    });

    document.getElementById('btn-lock-cancel').addEventListener('click', function() {
      document.getElementById('lock-confirm').classList.add('hidden');
    });

    document.getElementById('btn-lock-confirm').addEventListener('click', async function() {
      if (!lastP || !lastC) return;
      var btn = document.getElementById('btn-lock-confirm');
      btn.disabled = true;
      btn.textContent = 'Locking...';
      try {
        var resp = await fetch('/api/card/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: lastP, c: lastC }),
        });
        var data = await resp.json();
        if (resp.ok && data.success) {
          document.getElementById('lock-confirm').classList.add('hidden');
          document.getElementById('btn-lock').disabled = true;
          document.getElementById('btn-lock').textContent = 'Card Locked';
          document.getElementById('btn-lock').classList.remove('hover:bg-red-800/50');
          document.getElementById('lock-status').classList.remove('hidden');
          document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
          document.getElementById('lock-status').textContent = 'Your card has been locked.';
          var stateEl = document.getElementById('card-state');
          stateEl.textContent = stateLabel('terminated');
          stateEl.className = 'font-mono ' + stateColor('terminated');
        } else {
          document.getElementById('lock-status').classList.remove('hidden');
          document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
          document.getElementById('lock-status').textContent = data.reason || data.error || 'Lock failed';
          btn.disabled = false;
          btn.textContent = 'Confirm Lock';
        }
      } catch (err) {
        document.getElementById('lock-status').classList.remove('hidden');
        document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
        document.getElementById('lock-status').textContent = 'Network error';
        btn.disabled = false;
        btn.textContent = 'Confirm Lock';
      }
    });

    var reactivateScanner = null;

    function startReactivateScan() {
      if (reactivateScanner) {
        reactivateScanner.restart();
      } else if (browserSupportsNfc()) {
        reactivateScanner = createNfcScanner({
          continuous: false,
          debounceMs: 0,
          onStatus: function(status) {
            if (status === 'scanning') {
              document.getElementById('reactivate-scan-status').textContent = 'Tap your card now...';
            }
          },
          onError: function(err, phase) {
            var el = document.getElementById('reactivate-scan-error');
            if (phase === 'permission') {
              el.textContent = 'NFC not available. Use an operator to re-provision.';
            } else {
              el.textContent = 'NFC error: ' + (err.message || 'unknown');
            }
            el.classList.remove('hidden');
          },
          onTap: function(data) {
            if (!data.url) {
              document.getElementById('reactivate-scan-error').textContent = 'Card did not contain a valid URL';
              document.getElementById('reactivate-scan-error').classList.remove('hidden');
              return;
            }
            var params = extractParams(data.url);
            if (params) {
              document.getElementById('reactivate-scan-error').classList.add('hidden');
              document.getElementById('reactivate-scan-status').textContent = 'Verifying...';
              submitReactivate(params.p, params.c);
            } else {
              document.getElementById('reactivate-scan-error').textContent = 'Invalid card URL';
              document.getElementById('reactivate-scan-error').classList.remove('hidden');
            }
          }
        });
        reactivateScanner.scan();
      } else {
        document.getElementById('reactivate-scan-status').textContent = 'NFC not available on this device. Ask an operator to re-provision your card.';
      }
    }

    async function submitReactivate(p, c) {
      try {
        var resp = await fetch('/api/card/reactivate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p: p, c: c }),
        });
        var data = await resp.json();
        if (resp.ok && data.success) {
          document.getElementById('reactivate-scan').classList.add('hidden');
          document.getElementById('reactivate-success').classList.remove('hidden');
          document.getElementById('reactivate-new-version').textContent = data.version;
          if (data.uid) {
            document.getElementById('reactivate-program-link').href = '/experimental/activate?uid=' + encodeURIComponent(data.uid);
          }
        } else {
          document.getElementById('reactivate-scan-status').textContent = '';
          document.getElementById('reactivate-scan-error').textContent = data.reason || data.error || 'Re-activation failed';
          document.getElementById('reactivate-scan-error').classList.remove('hidden');
        }
      } catch (err) {
        document.getElementById('reactivate-scan-error').textContent = 'Network error';
        document.getElementById('reactivate-scan-error').classList.remove('hidden');
      }
    }

    (function init() {
      var currentUrl = window.location.href;
      var params = extractParams(currentUrl);
      if (params) {
        showCardInfo(params.p, params.c);
        return;
      }

      if (browserSupportsNfc()) {
        cardScanner.scan();
      } else {
        document.getElementById('nfc-unsupported').classList.remove('hidden');
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
