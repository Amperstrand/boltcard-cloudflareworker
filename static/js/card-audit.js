// card-audit.js — classic script (no import/export)
// Depends on: nfc.js (esc, stateLabel, stateColor, provenanceLabel, provenanceColor)

var currentFilter = "";
var nextCursor = null;
var hasMore = false;
var allCards = [];
var selectedUids = new Set();

function _auditFormatTime(ts) {
  if (!ts) return '-';
  try {
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return '-'; }
}

function _updateBatchBar() {
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

function _toggleCard(uid) {
  if (selectedUids.has(uid)) {
    selectedUids.delete(uid);
  } else {
    selectedUids.add(uid);
  }
  _updateBatchBar();
}

function _loadCards(append) {
  if (!append) {
    nextCursor = null;
    hasMore = false;
    allCards = [];
    selectedUids.clear();
    _updateBatchBar();
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
    fetch(url).then(function(resp) {
      return resp.json().then(function(data) {
        document.getElementById('loading').classList.add('hidden');

        if (!resp.ok) {
          _showAuditError(data.reason || 'Failed to load cards');
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
        _renderCards();

        if (hasMore) {
          document.getElementById('load-more-container').classList.remove('hidden');
        } else {
          document.getElementById('load-more-container').classList.add('hidden');
        }
      });
    }).catch(function(err) {
      document.getElementById('loading').classList.add('hidden');
      _showAuditError('Failed to load card registry');
    });
  } catch (err) {
    document.getElementById('loading').classList.add('hidden');
    _showAuditError('Failed to load card registry');
  }
}

function _renderCards() {
  var list = document.getElementById('cards-list');
  var html = allCards.map(function(card) {
    var checked = selectedUids.has(card.uid) ? 'checked' : '';
    return '<div class="grid grid-cols-7 gap-2 px-4 py-3 text-sm hover:bg-gray-700/30 transition-colors">' +
      '<div class="w-5"><input type="checkbox" class="card-checkbox rounded" data-uid="' + esc(card.uid) + '" ' + checked + ' /></div>' +
      '<span class="font-mono text-gray-300 text-xs">' + esc(card.uid) + '</span>' +
      '<span class="font-mono ' + stateColor(card.state) + '">' + esc(card.state) + '</span>' +
      '<span class="font-mono text-xs ' + provenanceColor(card.keyProvenance) + '">' + esc(provenanceLabel(card.keyProvenance, true)) + '</span>' +
      '<span class="font-mono text-xs text-gray-400">' + esc(card.keyLabel || '-') + '</span>' +
      '<span class="text-xs text-gray-500">' + esc(_auditFormatTime(card.updatedAt)) + '</span>' +
      '<span class="text-right"><a href="/experimental/analytics?uid=' + encodeURIComponent(card.uid) + '" class="text-emerald-500 hover:text-emerald-400 text-xs">analytics</a></span>' +
      '</div>';
  }).join('');
  list.innerHTML = html;

  list.querySelectorAll('.card-checkbox').forEach(function(cb) {
    cb.addEventListener('change', function() {
      _toggleCard(this.getAttribute('data-uid'));
    });
  });
}

function _batchAction(action) {
  if (selectedUids.size === 0) return;
  var uids = Array.from(selectedUids);
  var btnMap = { terminate: 'btn-batch-terminate', wipe: 'btn-batch-wipe', activate: 'btn-batch-activate', reprovision: 'btn-batch-reprovision' };
  var btn = document.getElementById(btnMap[action]);
  var origText = btn.textContent;
  btn.textContent = 'Working...';
  btn.disabled = true;

  fetch('/operator/cards/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uids: uids, action: action }),
  }).then(function(resp) {
    return resp.json().then(function(data) {
      var resultDiv = document.getElementById('batch-result');
      var contentDiv = document.getElementById('batch-result-content');

      if (!resp.ok) {
        _showAuditError(data.reason || 'Batch action failed');
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
      _updateBatchBar();
      _loadCards(false);
      btn.textContent = origText;
      btn.disabled = selectedUids.size === 0;
    });
  }).catch(function(err) {
    _showAuditError('Batch action failed: ' + err.message);
    btn.textContent = origText;
    btn.disabled = selectedUids.size === 0;
  });
}

function _showAuditError(msg) {
  document.getElementById('error-display').classList.remove('hidden');
  document.getElementById('error-message').textContent = msg;
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var action = btn.getAttribute('data-action');
  switch (action) {
    case 'filter':
      currentFilter = btn.getAttribute('data-filter') || '';
      document.querySelectorAll('[data-action="filter"]').forEach(function(b) { b.classList.remove('ring-2', 'ring-emerald-500'); });
      btn.classList.add('ring-2', 'ring-emerald-500');
      _loadCards(false);
      break;
    case 'refresh':
      _loadCards(false);
      break;
    case 'load-more':
      _loadCards(true);
      break;
    case 'select-all':
      allCards.forEach(function(c) { selectedUids.add(c.uid); });
      _updateBatchBar();
      _renderCards();
      break;
    case 'deselect-all':
      selectedUids.clear();
      _updateBatchBar();
      _renderCards();
      break;
    case 'batch-terminate':
      _batchAction('terminate');
      break;
    case 'batch-wipe':
      _batchAction('wipe');
      break;
    case 'batch-activate':
      _batchAction('activate');
      break;
    case 'batch-reprovision':
      _batchAction('reprovision');
      break;
    case 'repair':
      _handleRepair(btn);
      break;
  }
});

document.getElementById('select-all-checkbox').addEventListener('change', function() {
  var checked = this.checked;
  allCards.forEach(function(c) {
    if (checked) selectedUids.add(c.uid);
    else selectedUids.delete(c.uid);
  });
  _updateBatchBar();
  _renderCards();
});

function _handleRepair(btn) {
  var origText = btn.textContent;
  btn.textContent = 'Scanning...';
  btn.disabled = true;
  document.getElementById('repair-result').classList.add('hidden');

  fetch('/operator/cards/repair', { method: 'POST' }).then(function(resp) {
    return resp.json().then(function(data) {
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
      if (data.repaired > 0) _loadCards(false);
      btn.textContent = origText;
      btn.disabled = false;
    });
  }).catch(function(err) {
    _showAuditError('Index repair failed: ' + err.message);
    btn.textContent = origText;
    btn.disabled = false;
  });
}

_loadCards(false);
