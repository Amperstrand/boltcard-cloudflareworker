// helpers.js — classic script (no import/export)

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text != null ? String(text) : '';
}

function showEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function toggleEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('hidden');
}

function formatDuration(ms) {
  var totalSec = Math.floor(ms / 1000);
  var h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  var m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  var s = String(totalSec % 60).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

function relativeTime(unixSeconds) {
  var diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

function formatUnits(value) {
  if (!value || value === 0) return '';
  return Number(value).toLocaleString();
}

function statusBadge(status) {
  var map = {
    read:        'bg-sky-500/10 text-sky-400 border-sky-500/30',
    provisioned: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    activated:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    wipe_requested: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    terminated:  'bg-red-500/10 text-red-400 border-red-500/30',
    completed:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    failed:      'bg-red-500/10 text-red-400 border-red-500/30',
    pending:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    paying:      'bg-blue-500/10 text-blue-400 border-blue-500/30',
    expired:     'bg-gray-600/10 text-gray-400 border-gray-500/30',
    topup:       'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    payment:     'bg-orange-500/10 text-orange-400 border-orange-500/30',
  };
  var labels = { topup: 'TOP UP', payment: 'PAYMENT' };
  var cls = map[status] || map.pending;
  var label = labels[status] || status;
  var span = document.createElement('span');
  span.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold border ' + cls;
  span.textContent = label;
  return span;
}
