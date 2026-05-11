// analytics.js — classic script (no import/export)
// No external dependencies

var UID_REGEX = /^[0-9a-f]{14}$/;

function _analyticsValidateUid(uid) {
  if (!uid || typeof uid !== 'string') return null;
  var normalized = uid.toLowerCase();
  if (!UID_REGEX.test(normalized)) return null;
  return normalized;
}

function _formatMsat(msat) {
  if (!msat || msat === 0) return '0 sats';
  var sats = msat / 1000;
  if (sats < 1) return msat + ' msat';
  if (sats < 1000) return (sats % 1 === 0 ? sats : sats.toFixed(3)) + ' sats';
  return (sats / 1e8).toFixed(8) + ' BTC';
}

function _loadAnalytics() {
  var uid = document.getElementById('uid-input').value.trim().toLowerCase();
  var normalizedUid = _analyticsValidateUid(uid);
  var errEl = document.getElementById('lookup-error');
  errEl.classList.add('hidden');

  if (!normalizedUid) {
    errEl.textContent = 'Invalid UID — must be 14 hex characters';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    fetch('/analytics/data?uid=' + normalizedUid).then(function(resp) {
      if (!resp.ok) {
        errEl.textContent = 'Failed to load analytics (HTTP ' + resp.status + ')';
        errEl.classList.remove('hidden');
        return;
      }
      return resp.json().then(function(data) {
        _renderAnalytics(normalizedUid, data);
       });
     }).catch(function(e) {
       if (typeof window.reportClientError === 'function') window.reportClientError(e, 'analytics.js:load-data');
       errEl.textContent = 'Error: ' + e.message;
       errEl.classList.remove('hidden');
     });
   } catch (e) {
     if (typeof window.reportClientError === 'function') window.reportClientError(e, 'analytics.js:load-data');
     errEl.textContent = 'Error: ' + e.message;
     errEl.classList.remove('hidden');
   }
 }

function _renderAnalytics(uid, d) {
  document.getElementById('display-uid').textContent = uid.toUpperCase();
  document.getElementById('stat-completed').textContent = _formatMsat(d.completedMsat || 0);
  document.getElementById('stat-failed').textContent = _formatMsat(d.failedMsat || 0);
  document.getElementById('stat-pending').textContent = _formatMsat(d.pendingMsat || 0);
  document.getElementById('stat-taps').textContent = d.totalTaps || 0;

  document.getElementById('breakdown-completed-count').textContent = (d.completedTaps || 0) + ' taps';
  document.getElementById('breakdown-completed-amount').textContent = _formatMsat(d.completedMsat || 0);
  document.getElementById('breakdown-failed-count').textContent = (d.failedTaps || 0) + ' taps';
  document.getElementById('breakdown-failed-amount').textContent = _formatMsat(d.failedMsat || 0);
  document.getElementById('breakdown-pending-count').textContent = (d.pendingTaps || 0) + ' taps';
  document.getElementById('breakdown-pending-amount').textContent = _formatMsat(d.pendingMsat || 0);

  var total = d.totalTaps || 0;
  var completed = d.completedTaps || 0;
  var rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  document.getElementById('success-bar').style.width = rate + '%';
  document.getElementById('success-rate').textContent = completed + ' / ' + total + ' (' + rate + '%)';

  document.getElementById('analytics-content').classList.remove('hidden');
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action="load-analytics"]');
  if (btn) _loadAnalytics();
});

var _analyticsParams = new URLSearchParams(window.location.search);
var _analyticsPrefill = _analyticsParams.get('uid');
if (_analyticsPrefill) {
  document.getElementById('uid-input').value = _analyticsPrefill;
  _loadAnalytics();
}
