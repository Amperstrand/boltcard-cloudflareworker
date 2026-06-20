// card-dashboard.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner, stateLabel, stateColor, provenanceLabel, provenanceColor)

var lastP = null;
var lastC = null;
var cardLoaded = false;
var lastLoadTime = null;
var deferredPrompt = null;
var staleTimer = null;

var STORAGE_KEY = 'boltcard_params';

// ─── Currency formatting ───

var currencyLabel = 'credits';
var currencyDecimals = 0;
var previousBalance = null;

function animateBalance(element, fromValue, toValue) {
  var from = (typeof fromValue === 'number') ? fromValue : parseInt(fromValue, 10);
  var to = (typeof toValue === 'number') ? toValue : parseInt(toValue, 10);
  if (!Number.isFinite(from)) from = 0;
  if (!Number.isFinite(to)) to = 0;
  if (from === to) {
    element.textContent = formatBalance(to);
    return;
  }
  var duration = 500;
  var start = null;
  function step(ts) {
    if (!start) start = ts;
    var elapsed = ts - start;
    var progress = Math.min(elapsed / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = Math.round(from + (to - from) * eased);
    element.textContent = formatBalance(current);
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

function formatBalance(raw) {
  if (!raw && raw !== 0) return '0 ' + currencyLabel;
  var value = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (!Number.isFinite(value)) return '0 ' + currencyLabel;
  var divisor = Math.pow(10, currencyDecimals);
  var display = (value / divisor).toFixed(currencyDecimals);
  var parts = display.split('.');
  var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  var formatted = currencyDecimals > 0 ? whole + '.' + parts[1] : whole;
  return formatted + ' ' + currencyLabel;
}

// ─── localStorage persistence ───

function saveCardParams(p, c) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ p: p, c: c, savedAt: Date.now() }));
  } catch (e) {}
}

function loadSavedParams() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (data && data.p && data.c) return data;
  } catch (e) {}
  return null;
}

function clearSavedParams() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

// ─── Install prompt ───

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredPrompt = e;
  if (cardLoaded) {
    document.getElementById('install-banner').classList.remove('hidden');
  }
});

document.getElementById('btn-install').addEventListener('click', function() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function() {
      deferredPrompt = null;
      document.getElementById('install-banner').classList.add('hidden');
    });
  }
});

// ─── Offline detection ───

function updateOnlineStatus() {
  var offline = document.getElementById('offline-banner');
  if (!navigator.onLine) {
    offline.classList.remove('hidden');
  } else {
    offline.classList.add('hidden');
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ─── Stale data tracking ───

function updateStaleIndicator() {
  if (!lastLoadTime) return;
  var elapsed = Math.floor((Date.now() - lastLoadTime) / 1000);
  if (elapsed > 30) {
    var staleEl = document.getElementById('stale-time');
    if (elapsed < 60) staleEl.textContent = elapsed + 's ago';
    else if (elapsed < 3600) staleEl.textContent = Math.floor(elapsed / 60) + 'min ago';
    else staleEl.textContent = Math.floor(elapsed / 3600) + 'h ago';
    document.getElementById('stale-banner').classList.remove('hidden');
  }
}

staleTimer = setInterval(updateStaleIndicator, 10000);

document.getElementById('btn-refresh-stale').addEventListener('click', function() {
  if (lastP && lastC) showCardInfo(lastP, lastC);
});

// ─── Pull-to-refresh ───

(function() {
  var startY = 0;
  var pulling = false;
  var container = document.getElementById('pull-container');
  if (!container) return;

  container.addEventListener('touchstart', function(e) {
    if (window.scrollY === 0 && e.touches.length === 1) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  container.addEventListener('touchmove', function(e) {
    if (!pulling) return;
    var diff = e.touches[0].clientY - startY;
    if (diff > 60) {
      container.style.opacity = '0.7';
      container.style.transform = 'translateY(8px)';
    }
  }, { passive: true });

  container.addEventListener('touchend', function(e) {
    if (!pulling) return;
    pulling = false;
    var diff = e.changedTouches[0].clientY - startY;
    container.style.opacity = '';
    container.style.transform = '';
    if (diff > 60 && lastP && lastC) {
      showCardInfo(lastP, lastC);
    }
  }, { passive: true });
})();

// ─── Forget / Scan different card ───

document.getElementById('btn-forget').addEventListener('click', function() {
  clearSavedParams();
  window.location.href = '/card';
});

document.getElementById('btn-scan-different').addEventListener('click', function() {
  resetView();
  cardScanner.restart();
});

// ─── Formatters ───

function formatTime(iso) {
  if (!iso) return null;
  try {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

function relativeTime(iso) {
  if (!iso) return '';
  try {
    var now = Date.now();
    var then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    var diff = Math.floor((now - then) / 1000);
    if (diff < 0) return 'just now';
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 172800) return 'Yesterday';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return formatTime(iso);
  } catch (e) { return ''; }
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
    var icon, iconColor, label, labelBg;
    if (status === 'topup' || status === 'credit') {
      icon = '+'; iconColor = 'text-emerald-400'; label = status; labelBg = 'bg-emerald-900/40 text-emerald-400';
    } else if (status === 'payment' || status === 'debit') {
      icon = '\u2212'; iconColor = 'text-red-400'; label = status; labelBg = 'bg-red-900/40 text-red-400';
    } else if (status === 'refund' || status === 'void') {
      icon = '\u21A9'; iconColor = 'text-cyan-400'; label = status; labelBg = 'bg-cyan-900/40 text-cyan-400';
    } else if (status === 'read' || status === 'tap') {
      icon = '\u2022'; iconColor = 'text-gray-500'; label = status; labelBg = 'bg-gray-800 text-gray-500';
    } else if (status === 'completed') {
      icon = '\u2713'; iconColor = 'text-emerald-400'; label = status; labelBg = 'bg-emerald-900/40 text-emerald-400';
    } else if (status === 'failed') {
      icon = '\u2717'; iconColor = 'text-red-400'; label = status; labelBg = 'bg-red-900/40 text-red-400';
    } else {
      icon = '?'; iconColor = 'text-gray-500'; label = status; labelBg = 'bg-gray-800 text-gray-500';
    }
    var amt = item.amount_msat || item.amountMsat;
    var relTime = relativeTime(item.created_at || item.createdAt);

    var row = document.createElement('div');
    row.className = 'flex items-center gap-2 text-xs py-1.5 border-b border-gray-700/30 last:border-0';

    var iconSpan = document.createElement('span');
    iconSpan.className = iconColor + ' w-4 text-center font-bold text-sm';
    iconSpan.textContent = icon;
    row.appendChild(iconSpan);

    var pill = document.createElement('span');
    pill.className = labelBg + ' text-[10px] px-1.5 py-0.5 rounded-full font-medium';
    pill.textContent = label;
    row.appendChild(pill);

    if (item.note) {
      var noteSpan = document.createElement('span');
      noteSpan.className = 'text-gray-600 truncate max-w-[80px]';
      noteSpan.textContent = item.note;
      row.appendChild(noteSpan);
    }

    var spacer = document.createElement('span');
    spacer.className = 'flex-1';
    row.appendChild(spacer);

    if (amt) {
      var isCredit = status === 'topup' || status === 'credit' || status === 'refund' || status === 'void';
      var amtSpan = document.createElement('span');
      amtSpan.className = isCredit ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono';
      var prefix = isCredit ? '+' : '\u2212';
      amtSpan.textContent = prefix + formatBalance(amt);
      row.appendChild(amtSpan);
    }

    if (relTime) {
      var timeSpan = document.createElement('span');
      timeSpan.className = 'text-gray-600 text-[10px] w-16 text-right shrink-0';
      timeSpan.textContent = relTime;
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

    cardLoaded = true;
    lastLoadTime = Date.now();
    document.getElementById('stale-banner').classList.add('hidden');

    if (data.currencyLabel) currencyLabel = data.currencyLabel;
    if (data.currencyDecimals !== undefined) currencyDecimals = data.currencyDecimals;

    // Save params to localStorage for auto-load next time
    saveCardParams(p, c);

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

    var balEl = document.getElementById('card-balance');
    var newBalance = data.balance || 0;
    animateBalance(balEl, previousBalance, newBalance);
    previousBalance = newBalance;

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

    // Show install banner if prompt is available
    if (deferredPrompt) {
      document.getElementById('install-banner').classList.remove('hidden');
    }

    document.getElementById('card-info').focus();
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-dashboard.js:load-info');
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
  document.getElementById('saved-card').classList.add('hidden');
  lastP = null;
  lastC = null;
  lastLoadTime = null;
  if (staleTimer) { clearInterval(staleTimer); staleTimer = null; }
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

var nfcStartBtn = document.getElementById('nfc-start-btn');
if (nfcStartBtn) {
  nfcStartBtn.addEventListener('click', function() {
    nfcStartBtn.classList.add('hidden');
    cardScanner.scan();
  });
}

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
  btn.textContent = 'Terminating...';
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
      document.getElementById('btn-lock').textContent = 'Card Terminated';
      document.getElementById('btn-lock').classList.remove('hover:bg-red-800/50');
      document.getElementById('lock-status').classList.remove('hidden');
      document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
      document.getElementById('lock-status').textContent = 'Your card has been terminated.';
      var stateEl = document.getElementById('card-state');
      stateEl.textContent = stateLabel('terminated');
      stateEl.className = 'font-mono ' + stateColor('terminated');
    } else {
      document.getElementById('lock-status').classList.remove('hidden');
      document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
      document.getElementById('lock-status').textContent = data.reason || data.error || 'Terminate failed';
      btn.disabled = false;
  btn.textContent = 'Confirm Terminate';
    }
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-dashboard.js:terminate');
     document.getElementById('lock-status').classList.remove('hidden');
     document.getElementById('lock-status').className = 'mt-2 text-center text-sm text-red-400';
     document.getElementById('lock-status').textContent = 'Network error';
     btn.disabled = false;
     btn.textContent = 'Confirm Terminate';
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
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-dashboard.js:reactivate');
     document.getElementById('reactivate-scan-error').textContent = 'Network error';
     document.getElementById('reactivate-scan-error').classList.remove('hidden');
   }
}

(function init() {
  // Check URL params first
  var currentUrl = window.location.href;
  var params = extractParams(currentUrl);
  if (params) {
    showCardInfo(params.p, params.c);
    return;
  }

  // Check localStorage for saved card
  var saved = loadSavedParams();
  if (saved) {
    document.getElementById('saved-card').classList.remove('hidden');
    showCardInfo(saved.p, saved.c);
    return;
  }

  getNfcPermissionState().then(function(state) {
    if (state === 'granted') {
      cardScanner.scan();
    } else if (state === 'prompt') {
      var btn = document.getElementById('nfc-start-btn');
      if (btn) btn.classList.remove('hidden');
    } else {
      document.getElementById('nfc-unsupported').classList.remove('hidden');
    }
  });
})();
