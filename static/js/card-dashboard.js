// card-dashboard.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner, stateLabel, stateColor, provenanceLabel, provenanceColor)

var lastP = null;
var lastC = null;

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
    var p = document.createElement('p');
    p.className = 'text-gray-500 text-xs text-center';
    p.textContent = 'No activity';
    el.replaceChildren(p);
    return;
  }
  el.replaceChildren.apply(el, items.slice(0, 15).map(function(item) {
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

    var row = document.createElement('div');
    row.className = 'flex items-center gap-2 text-xs py-1.5 border-b border-gray-700/30 last:border-0';

    var iconSpan = document.createElement('span');
    iconSpan.className = color + ' w-4 text-center font-bold';
    iconSpan.textContent = icon;
    row.appendChild(iconSpan);

    var counterSpan = document.createElement('span');
    counterSpan.className = 'text-gray-400 font-mono w-12 text-[10px]';
    counterSpan.textContent = 'ctr ' + (item.counter || '-');
    row.appendChild(counterSpan);

    var statusSpan = document.createElement('span');
    statusSpan.className = color + ' flex-1';
    statusSpan.textContent = status;
    if (item.note) {
      var noteSpan = document.createElement('span');
      noteSpan.className = 'text-gray-600';
      noteSpan.textContent = ' (' + item.note + ')';
      statusSpan.appendChild(noteSpan);
    }
    row.appendChild(statusSpan);

    if (amt) {
      var amtSpan = document.createElement('span');
      amtSpan.className = 'text-gray-300 font-mono';
      amtSpan.textContent = formatBalance(amt);
      row.appendChild(amtSpan);
    }

    if (time) {
      var timeSpan = document.createElement('span');
      timeSpan.className = 'text-gray-600 text-[10px] w-28 text-right';
      timeSpan.textContent = time;
      row.appendChild(timeSpan);
    }

    return row;
  }));
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
      document.getElementById('scan-status').textContent = 'Ready \u2014 tap your card now...';
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
