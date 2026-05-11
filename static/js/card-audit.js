// card-audit.js — classic script (no import/export)
// Depends on: nfc.js (stateLabel, stateColor, provenanceLabel, provenanceColor)

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
       if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:load-cards');
       document.getElementById('loading').classList.add('hidden');
       _showAuditError('Failed to load card registry');
     });
   } catch (err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:load-cards');
     document.getElementById('loading').classList.add('hidden');
     _showAuditError('Failed to load card registry');
   }
 }

function _renderCards() {
  var list = document.getElementById('cards-list');
  list.replaceChildren.apply(list, allCards.map(function(card) {
    var row = document.createElement('div');
    row.className = 'grid grid-cols-7 gap-2 px-4 py-3 text-sm hover:bg-gray-700/30 transition-colors';

    var checkCell = document.createElement('div');
    checkCell.className = 'w-5';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'card-checkbox rounded';
    cb.setAttribute('data-uid', card.uid);
    cb.checked = selectedUids.has(card.uid);
    cb.addEventListener('change', function() {
      _toggleCard(this.getAttribute('data-uid'));
    });
    checkCell.appendChild(cb);
    row.appendChild(checkCell);

    var uidSpan = document.createElement('span');
    uidSpan.className = 'font-mono text-gray-300 text-xs';
    uidSpan.textContent = card.uid;
    row.appendChild(uidSpan);

    var stateSpan = document.createElement('span');
    stateSpan.className = 'font-mono ' + stateColor(card.state);
    stateSpan.textContent = card.state;
    row.appendChild(stateSpan);

    var provSpan = document.createElement('span');
    provSpan.className = 'font-mono text-xs ' + provenanceColor(card.keyProvenance);
    provSpan.textContent = provenanceLabel(card.keyProvenance, true);
    row.appendChild(provSpan);

    var labelSpan = document.createElement('span');
    labelSpan.className = 'font-mono text-xs text-gray-400';
    labelSpan.textContent = card.keyLabel || '-';
    row.appendChild(labelSpan);

    var timeSpan = document.createElement('span');
    timeSpan.className = 'text-xs text-gray-500';
    timeSpan.textContent = _auditFormatTime(card.updatedAt);
    row.appendChild(timeSpan);

    var linkCell = document.createElement('span');
    linkCell.className = 'text-right';
    var link = document.createElement('a');
    link.href = '/experimental/analytics?uid=' + encodeURIComponent(card.uid);
    link.className = 'text-emerald-500 hover:text-emerald-400 text-xs';
    link.textContent = 'analytics';
    linkCell.appendChild(link);
    row.appendChild(linkCell);

    return row;
  }));
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

      var wrapper = document.createElement('div');
      wrapper.className = 'space-y-1';

      var successP = document.createElement('p');
      successP.className = 'text-emerald-300 font-semibold';
      successP.textContent = succeeded + ' card(s) processed: ' + action;
      wrapper.appendChild(successP);

      if (skipped > 0) {
        var skipP = document.createElement('p');
        skipP.className = 'text-yellow-300';
        skipP.textContent = skipped + ' card(s) skipped';
        wrapper.appendChild(skipP);
        data.results.filter(function(r) { return r.status === 'skipped'; }).forEach(function(r) {
          var detail = document.createElement('p');
          detail.className = 'text-xs text-gray-500 ml-3';
          detail.textContent = r.uid + ': ' + r.reason;
          wrapper.appendChild(detail);
        });
      }
      if (failed > 0) {
        var failP = document.createElement('p');
        failP.className = 'text-red-300';
        failP.textContent = failed + ' card(s) failed';
        wrapper.appendChild(failP);
        data.errors.forEach(function(e) {
          var detail = document.createElement('p');
          detail.className = 'text-xs text-gray-500 ml-3';
          detail.textContent = e.uid + ': ' + e.error;
          wrapper.appendChild(detail);
        });
      }
      contentDiv.replaceChildren(wrapper);
      resultDiv.classList.remove('hidden');

      selectedUids.clear();
      _updateBatchBar();
      _loadCards(false);
      btn.textContent = origText;
      btn.disabled = selectedUids.size === 0;
    });
   }).catch(function(err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:batch-action');
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
        var errP = document.createElement('p');
        errP.className = 'text-red-300';
        errP.textContent = 'Repair failed: ' + (data.error || 'unknown error');
        contentDiv.replaceChildren(errP);
      } else {
        var wrapper = document.createElement('div');
        var mainP = document.createElement('p');
        mainP.className = 'text-amber-300';
        mainP.textContent = 'Scanned ';
        var strong1 = document.createElement('strong');
        strong1.textContent = data.scanned;
        mainP.appendChild(strong1);
        mainP.appendChild(document.createTextNode(' card(s), repaired '));
        var strong2 = document.createElement('strong');
        strong2.textContent = data.repaired;
        mainP.appendChild(strong2);
        wrapper.appendChild(mainP);

        if (data.errors && data.errors.length > 0) {
          var errHeader = document.createElement('p');
          errHeader.className = 'text-red-300 text-xs mt-1';
          errHeader.textContent = data.errors.length + ' error(s):';
          wrapper.appendChild(errHeader);
          data.errors.forEach(function(e) {
            var detail = document.createElement('p');
            detail.className = 'text-xs text-gray-500 ml-3';
            detail.textContent = e.uid + ': ' + e.error;
            wrapper.appendChild(detail);
          });
        }
        if (data.repaired === 0 && (!data.errors || data.errors.length === 0)) {
          var noneP = document.createElement('p');
          noneP.className = 'text-gray-400 text-xs mt-1';
          noneP.textContent = 'All index entries match DO state.';
          wrapper.appendChild(noneP);
        }
        contentDiv.replaceChildren(wrapper);
      }
      resultDiv.classList.remove('hidden');
      if (data.repaired > 0) _loadCards(false);
      btn.textContent = origText;
      btn.disabled = false;
    });
   }).catch(function(err) {
     if (typeof window.reportClientError === 'function') window.reportClientError(err, 'card-audit.js:repair-action');
     _showAuditError('Index repair failed: ' + err.message);
     btn.textContent = origText;
     btn.disabled = false;
   });
 }

_loadCards(false);
