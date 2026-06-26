// card-actions.js — classic script (no import/export)
// Depends on: helpers.js (reportClientError via window)

/**
 * Request wipe keys for a card via /login endpoint.
 * @param {string} apiHost - API base URL
 * @param {string} uid - Card UID hex
 * @param {Object} opts - { btnId, statusId, qrId, deeplinkId, jsonId, resultId }
 * @returns {Promise}
 */
function requestWipeKeys(apiHost, uid, opts) {
  if (!uid) return Promise.resolve();
  var btn = document.getElementById(opts.btnId);
  var status = document.getElementById(opts.statusId);
  btn.disabled = true;
  btn.textContent = 'FETCHING...';
  btn.classList.add('opacity-50');
  status.classList.remove('hidden');
  status.className = 'mt-3 text-center text-sm text-gray-400';
  status.textContent = 'Retrieving wipe keys...';

  return fetch(apiHost + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, action: 'request-wipe' }),
  }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok && result.data.success) {
      btn.textContent = 'WIPE KEYS RETRIEVED';
      btn.classList.remove('bg-red-600', 'hover:bg-red-500');
      btn.classList.add('bg-gray-600');
      status.className = 'mt-3 text-center text-sm text-emerald-400';
      status.textContent = 'Card is now pending wipe (v' + result.data.keyVersion + ')';
      if (opts.qrId && typeof QRCode !== 'undefined') {
        var qrEl = document.getElementById(opts.qrId);
        qrEl.replaceChildren();
        new QRCode(qrEl, { text: result.data.wipeJson, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
      }
      if (opts.deeplinkId) document.getElementById(opts.deeplinkId).href = result.data.wipeDeeplink;
      if (opts.jsonId) document.getElementById(opts.jsonId).textContent = result.data.wipeJson;
      if (opts.resultId) document.getElementById(opts.resultId).classList.remove('hidden');
      return result.data;
    } else {
      throw new Error(result.data.error || 'Failed to fetch wipe keys');
    }
  }).catch(function(e) {
    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'card-actions:request-wipe');
    status.className = 'mt-3 text-center text-sm text-red-400';
    status.textContent = 'Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'GET WIPE KEYS';
    btn.classList.remove('opacity-50');
    throw e;
  });
}

/**
 * Confirm a card has been physically wiped (terminate via /login).
 * @param {string} apiHost - API base URL
 * @param {string} uid - Card UID hex
 * @param {Object} opts - { btnId, statusId }
 * @returns {Promise<Object>} Termination result data
 */
function confirmWipedCard(apiHost, uid, opts) {
  if (!uid) return Promise.reject(new Error('No UID'));
  var btn = document.getElementById(opts.btnId);
  var status = document.getElementById(opts.statusId);
  btn.disabled = true;
  btn.textContent = 'TERMINATING...';
  btn.classList.add('opacity-50');
  status.classList.remove('hidden');
  status.className = 'mt-3 text-center text-sm text-gray-400';
  status.textContent = 'Terminating card...';

  return fetch(apiHost + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, action: 'terminate' }),
  }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok && result.data.success) {
      status.className = 'mt-3 text-center text-sm text-emerald-400';
      status.textContent = 'Card terminated. Ready for re-provision at version ' + (result.data.keyVersion || 2) + '.';
      btn.textContent = 'TERMINATED';
      btn.classList.remove('bg-red-600', 'hover:bg-red-500');
      btn.classList.add('bg-gray-600');
      return result.data;
    } else {
      throw new Error(result.data.error || 'Termination failed');
    }
  }).catch(function(e) {
    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'card-actions:confirm-wiped');
    status.className = 'mt-3 text-center text-sm text-red-400';
    status.textContent = 'Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
    btn.classList.remove('opacity-50');
    throw e;
  });
}

/**
 * Provision a card by posting to a programming endpoint.
 * @param {string} endpointUrl - The pull payment / boltcards endpoint URL
 * @param {string} uid - Card UID hex
 * @param {Object} opts - { btnId, statusId, successText }
 * @returns {Promise<Object>} Provisioning result
 */
function provisionCard(endpointUrl, uid, opts) {
  if (!uid) return Promise.reject(new Error('No UID'));
  var btn = document.getElementById(opts.btnId);
  var status = document.getElementById(opts.statusId);
  btn.disabled = true;
  btn.textContent = 'PROVISIONING...';
  btn.classList.add('opacity-50');
  status.classList.remove('hidden');
  status.className = 'mt-3 text-center text-sm text-gray-400';
  status.textContent = 'Writing keys to card...';

  return fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ UID: uid }),
  }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
  .then(function(result) {
    if (result.ok) {
      status.className = 'mt-3 text-center text-sm text-emerald-400';
      status.textContent = (opts.successText || 'Card provisioned!') + ' Version ' + (result.data.Version || 1) + '.';
      btn.textContent = 'PROVISIONED';
      btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
      btn.classList.add('bg-gray-600');
      return result.data;
    } else {
      throw new Error(result.data.error || 'Provisioning failed');
    }
  }).catch(function(e) {
    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'card-actions:provision');
    status.className = 'mt-3 text-center text-sm text-red-400';
    if (e.message.includes('active') || e.message.includes('Terminate')) {
      status.textContent = 'This card is already active and working. Wipe it first if you want to re-provision.';
    } else {
      status.textContent = 'Error: ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = opts.btnText || 'PROVISION AS WITHDRAW CARD';
    btn.classList.remove('opacity-50');
    throw e;
  });
}
