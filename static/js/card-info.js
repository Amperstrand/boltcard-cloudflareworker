// card-info.js — classic script (no import/export)
// Depends on: helpers.js (relativeTime, formatUnits, statusBadge)

/**
 * Render tap history into prefixed DOM elements.
 * @param {Array} taps - Array of tap objects with created_at, status, amount_msat, counter, note, balance_after
 * @param {string} prefix - Element ID prefix (e.g., 'priv', 'pub')
 */
function renderTapHistory(taps, prefix) {
  var section = document.getElementById(prefix + '-tap-history');
  var list = document.getElementById(prefix + '-tap-list');
  var countEl = document.getElementById(prefix + '-tap-count');
  if (!taps || taps.length === 0) {
    section.classList.remove('hidden');
    list.replaceChildren();
    countEl.textContent = '';
    document.getElementById(prefix + '-tap-empty').classList.remove('hidden');
    return;
  }
  document.getElementById(prefix + '-tap-empty').classList.add('hidden');
  countEl.textContent = taps.length + ' entries';
  var elements = [];
  for (var i = 0; i < taps.length; i++) {
    var t = taps[i];
    var time = relativeTime(t.created_at);
    var isTopup = t.status === 'topup';
    var isPayment = t.status === 'payment';

    var amountEl = null;
    if (isTopup && t.amount_msat) {
      amountEl = document.createElement('span');
      amountEl.className = 'font-mono text-emerald-400 font-bold';
      amountEl.textContent = '+' + formatUnits(t.amount_msat);
    } else if (isPayment && t.amount_msat) {
      amountEl = document.createElement('span');
      amountEl.className = 'font-mono text-orange-400 font-bold';
      amountEl.textContent = '-' + formatUnits(t.amount_msat);
    } else if (t.amount_msat) {
      amountEl = document.createElement('span');
      amountEl.className = 'font-mono text-gray-400';
      amountEl.textContent = formatUnits(t.amount_msat);
    }

    var detailParts = [];
    if (t.counter != null) detailParts.push('#' + String(t.counter));
    if (t.note) detailParts.push(t.note);
    if (t.balance_after != null && (isTopup || isPayment)) detailParts.push('bal: ' + String(t.balance_after));

    var outer = document.createElement('div');
    outer.className = 'py-2 border-b border-gray-700/50 last:border-0';
    var row = document.createElement('div');
    row.className = 'flex items-center justify-between';
    var left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    var timeSpan = document.createElement('span');
    timeSpan.className = 'text-gray-500 text-xs shrink-0';
    timeSpan.textContent = time;
    left.appendChild(timeSpan);
    left.appendChild(statusBadge(t.status));
    row.appendChild(left);
    if (amountEl) row.appendChild(amountEl);
    outer.appendChild(row);
    if (detailParts.length > 0) {
      var detailDiv = document.createElement('div');
      detailDiv.className = 'text-gray-500 text-[11px] mt-0.5 pl-1';
      detailDiv.textContent = detailParts.join(' \u00B7 ');
      outer.appendChild(detailDiv);
    }
    elements.push(outer);
  }
  list.replaceChildren.apply(list, elements);
  section.classList.remove('hidden');
}

/**
 * Build K0-K4 key rows as a DocumentFragment for appending to a tbody.
 * @param {string} k0-k4 - Hex key values
 * @returns {DocumentFragment}
 */
function buildKeysRows(k0, k1, k2, k3, k4) {
  var keys = [
    { label: 'K0', value: k0 },
    { label: 'K1', value: k1 },
    { label: 'K2', value: k2 },
    { label: 'K3', value: k3 },
    { label: 'K4', value: k4 }
  ];
  var fragment = document.createDocumentFragment();
  for (var i = 0; i < keys.length; i++) {
    var tr = document.createElement('tr');
    var td1 = document.createElement('td');
    td1.className = 'pr-3 text-gray-500';
    td1.textContent = keys[i].label;
    var td2 = document.createElement('td');
    td2.className = 'font-mono text-xs text-gray-400';
    td2.textContent = keys[i].value || '-';
    tr.appendChild(td1);
    tr.appendChild(td2);
    fragment.appendChild(tr);
  }
  return fragment;
}
