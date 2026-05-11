// login.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, extractNdefUrl, normalizeBrowserNfcUrl, normalizeNfcSerial)

(function() {
  // Read server config from data attributes
  var loginView = document.getElementById('login-view');
  var API_HOST = loginView ? loginView.getAttribute('data-api-host') : '';
  var DEFAULT_PROGRAMMING_ENDPOINT = loginView ? loginView.getAttribute('data-default-endpoint') : '';

  // State
  var loginTime = null;
  var timerInterval = null;
  var nfcAbortController = null;
  var lastNfcReadTime = 0;
  var currentUid = null;
  var currentProgrammingEndpoint = DEFAULT_PROGRAMMING_ENDPOINT;
  var currentUndeployedUid = null;
  var currentTerminatedUid = null;

  // Event delegation for data-action buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    switch (action) {
      case 'rescan': rescanCard(); break;
      case 'copy': copyElementText(btn.getAttribute('data-copy-target')); break;
      case 'copy-href': copyElementHref(btn.getAttribute('data-copy-target')); break;
      case 'copy-wipe': copyWipeJson(btn.getAttribute('data-target')); break;
      case 'copy-all-keys': copyAllKeys(btn.getAttribute('data-target')); break;
      case 'provision': provisionCard(); break;
      case 'reprovision': reprovisionCard(); break;
      case 'reprovision-private': reprovisionPrivateCard(); break;
      case 'fetch-wipe': fetchWipeKeys(); break;
      case 'topup': topUpBalance(); break;
      case 'confirm-wiped': confirmWipedCard(); break;
      case 'show-view': hideAllViews(); document.getElementById(btn.getAttribute('data-view')).classList.remove('hidden'); break;
    }
  });

  function copyElementText(id) {
    var el = document.getElementById(id);
    if (el) navigator.clipboard.writeText(el.textContent);
  }

  function copyElementHref(id) {
    var el = document.getElementById(id);
    if (el) navigator.clipboard.writeText(el.href);
  }

  if (!browserSupportsNfc()) {
    document.getElementById('nfc-not-supported').classList.remove('hidden');
    document.getElementById('nfc-ready').classList.add('hidden');
  } else {
    startNfc();
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

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(function() {
      if (loginTime) {
        document.getElementById('priv-timer').textContent = formatDuration(Date.now() - loginTime);
      }
    }, 1000);
  }

  function hideAllViews() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('undeployed-view').classList.add('hidden');
    document.getElementById('public-view').classList.add('hidden');
    document.getElementById('private-view').classList.add('hidden');
    document.getElementById('terminated-view').classList.add('hidden');
    document.getElementById('wiped-detection-view').classList.add('hidden');
  }

  function showPersistentError(msg) {
    var privView = document.getElementById('private-view');
    var pubView = document.getElementById('public-view');
    if (!privView.classList.contains('hidden')) {
      document.getElementById('private-error-msg').textContent = msg;
      document.getElementById('private-error-box').classList.remove('hidden');
    } else if (!pubView.classList.contains('hidden')) {
      document.getElementById('public-error-msg').textContent = msg;
      document.getElementById('public-error-box').classList.remove('hidden');
    } else {
      document.getElementById('error-msg').textContent = msg;
      document.getElementById('error-box').classList.remove('hidden');
    }
  }

  function clearErrors() {
    document.getElementById('error-box').classList.add('hidden');
    document.getElementById('public-error-box').classList.add('hidden');
    document.getElementById('private-error-box').classList.add('hidden');
  }

  function showNdef(url) {
    document.getElementById('ndef-raw').textContent = url;
    document.getElementById('last-ndef').classList.remove('hidden');
  }

  function typeBadgeClass(cardType) {
    return 'px-3 py-1 rounded text-xs font-bold border ' +
      (cardType === 'lnurlpay' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
       cardType === 'twofactor' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
       'bg-amber-500/10 text-amber-400 border-amber-500/30');
  }

  function wipeJson(prefix) {
    var cells = document.querySelectorAll('#' + prefix + '-keys td:last-child');
    var vals = Array.from(cells).map(function(t) { return t.textContent.trim(); });
    return JSON.stringify({
      k0: vals[0] || '', k1: vals[1] || '', k2: vals[2] || '',
      k3: vals[3] || '', k4: vals[4] || '',
      action: 'wipe', version: '1'
    }, null, 2);
  }

  function copyWipeJson(prefix) {
    navigator.clipboard.writeText(wipeJson(prefix));
  }

  function copyAllKeys(target) {
    var tbody = document.getElementById(target);
    if (!tbody) return;
    var cells = tbody.querySelectorAll('td:last-child');
    var vals = Array.from(cells).map(function(t) { return t.textContent.trim(); });
    var obj = {k0: vals[0] || '', k1: vals[1] || '', k2: vals[2] || '', k3: vals[3] || '', k4: vals[4] || ''};
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
  }

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

  function setCurrentProgrammingEndpoint(endpointUrl) {
    currentProgrammingEndpoint = endpointUrl || DEFAULT_PROGRAMMING_ENDPOINT;
  }

  function buildProgrammingEndpointUrl() {
    return currentProgrammingEndpoint || DEFAULT_PROGRAMMING_ENDPOINT;
  }

  function buildProgrammingDeeplink(endpointUrl) {
    return 'boltcard://program?url=' + encodeURIComponent(endpointUrl);
  }

  function showUndeployedProgrammingInstructions(endpointUrl, deliveredAt) {
    var deeplink = buildProgrammingDeeplink(endpointUrl || buildProgrammingEndpointUrl());
    var qrEl = document.getElementById('qr-undep-program');
    qrEl.replaceChildren();
    new QRCode(qrEl, { text: deeplink, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
    document.getElementById('undep-program-deeplink').href = deeplink;
    if (deliveredAt) {
      document.getElementById('undep-keys-delivered-time').textContent = 'Keys generated ' + relativeTime(Math.floor(deliveredAt / 1000)) + '.';
    } else {
      document.getElementById('undep-keys-delivered-time').textContent = '';
    }
    document.getElementById('undep-program-section').classList.remove('hidden');
    document.getElementById('undep-provision-btn').parentElement.classList.add('hidden');
  }

  function hideUndeployedProgrammingInstructions() {
    document.getElementById('undep-program-section').classList.add('hidden');
    document.getElementById('undep-provision-btn').parentElement.classList.remove('hidden');
  }

  function provisionCard() {
    if (!currentUndeployedUid) return;
    var btn = document.getElementById('undep-provision-btn');
    var status = document.getElementById('undep-provision-status');
    btn.disabled = true;
    btn.textContent = 'PROVISIONING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Writing keys to card...';

    var endpoint = buildProgrammingEndpointUrl();
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UID: currentUndeployedUid }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card provisioned! Version ' + (result.data.Version || 1) + '. Tap again to activate.';
        btn.textContent = 'PROVISIONED';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-600');
        showUndeployedProgrammingInstructions(endpoint, Date.now());
      } else {
        throw new Error(result.data.error || 'Provisioning failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:provision');
      status.className = 'mt-3 text-center text-sm text-red-400';
      if (e.message.includes('active') || e.message.includes('Terminate')) {
        status.textContent = 'This card is already active and working. Wipe it first if you want to re-provision.';
      } else {
        status.textContent = 'Error: ' + e.message;
      }
      btn.disabled = false;
      btn.textContent = 'PROVISION AS WITHDRAW CARD';
      btn.classList.remove('opacity-50');
    });
  }

  function showUndeployedCard(result) {
    clearErrors();
    hideAllViews();
    currentUndeployedUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    document.getElementById('undep-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('undep-version').textContent = result.keyVersion || 1;
    document.getElementById('undep-state').textContent = result.cardState || 'new';
    document.getElementById('undep-keys').replaceChildren(buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4));
    var btn = document.getElementById('undep-provision-btn');
    btn.disabled = false;
    btn.textContent = 'PROVISION AS WITHDRAW CARD';
    btn.classList.remove('opacity-50', 'bg-gray-600');
    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    document.getElementById('undep-provision-status').classList.add('hidden');
    if (result.awaitingProgramming) {
      showUndeployedProgrammingInstructions(result.programmingEndpoint, result.keysDeliveredAt);
    } else {
      hideUndeployedProgrammingInstructions();
    }
    document.getElementById('undeployed-view').classList.remove('hidden');
  }

  function showPublicCard(result) {
    clearErrors();
    hideAllViews();
    var cardType = result.cardType || 'unknown';
    var typeLabels = { fakewallet: 'WITHDRAW', lnurlpay: 'POS', twofactor: '2FA' };

    document.getElementById('pub-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('pub-card-type-badge').textContent = typeLabels[cardType] || cardType.toUpperCase();
    document.getElementById('pub-card-type-badge').className = typeBadgeClass(cardType);
    document.getElementById('pub-version').textContent = result.keyVersion || '-';
    document.getElementById('pub-state').textContent = result.cardState || '-';
    document.getElementById('pub-counter').textContent = result.counterValue;
    document.getElementById('pub-issuer').textContent = result.issuerKey || 'recovered';
    var cmacEl = document.getElementById('pub-cmac');
    cmacEl.textContent = result.cmacValid ? 'VERIFIED' : 'FAILED';
    cmacEl.className = result.cmacValid ? 'font-mono text-emerald-400' : 'font-mono text-red-400';
    document.getElementById('pub-keys').replaceChildren(buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4));
    document.getElementById('pub-ndef').textContent = result.ndef || '';
    document.getElementById('public-view').classList.remove('hidden');
    renderTapHistory(result.tapHistory || [], 'pub');
    var pubUid = result.uidHex;
    var pubKeys = [result.k0, result.k1, result.k2, result.k3, result.k4];
    if (pubKeys[0] && pubKeys[1] && pubKeys[2] && pubKeys[3] && pubKeys[4]) {
      var endpointUrl = API_HOST + '/api/keys?uid=' + pubUid + '&format=boltcard';
      document.getElementById('pub-wipe-deeplink').href = 'boltcard://reset?url=' + encodeURIComponent(endpointUrl);
      var qrEl = document.getElementById('qr-pub-wipe');
      qrEl.replaceChildren();
      new QRCode(qrEl, { text: wipeJson('pub'), width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
    }
  }

  function showPrivateCard(result) {
    clearErrors();
    hideAllViews();
    currentUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    var cardType = result.cardType || 'unknown';
    var typeLabels = { fakewallet: 'WITHDRAW', lnurlpay: 'POS', twofactor: '2FA' };

    document.getElementById('priv-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('priv-card-type-badge').textContent = typeLabels[cardType] || cardType.toUpperCase();
    document.getElementById('priv-card-type-badge').className = typeBadgeClass(cardType);
    document.getElementById('priv-version').textContent = result.keyVersion || '-';
    document.getElementById('priv-state').textContent = result.cardState || '-';
    document.getElementById('priv-counter').textContent = result.counterValue;
    if (result.balance !== undefined) {
      document.getElementById('priv-balance').textContent = result.balance;
    }
    document.getElementById('priv-issuer').textContent = result.issuerKey || 'current';
    document.getElementById('topup-amount').value = '';
    document.getElementById('topup-status').classList.add('hidden');
    var cmacEl = document.getElementById('priv-cmac');
    cmacEl.textContent = result.cmacValid ? 'VERIFIED' : 'FAILED';
    cmacEl.className = result.cmacValid ? 'font-mono text-emerald-400' : 'font-mono text-red-400';
    document.getElementById('priv-debug-issuer').textContent = '-';
    document.getElementById('priv-debug-version').textContent = '-';
    document.getElementById('priv-debug-versions').textContent = '-';
    if (result.debug) {
      document.getElementById('priv-debug-issuer').textContent = result.debug.issuerKey || '-';
      document.getElementById('priv-debug-version').textContent = result.debug.matchedVersion || '-';
      if (result.debug.versionsTried && result.debug.versionsTried.length > 0) {
        document.getElementById('priv-debug-versions').textContent = result.debug.versionsTried.map(function(v) {
          return 'v' + v.version + ':' + (v.cmac ? 'OK' : 'FAIL');
        }).join(', ');
      }
    }
    document.getElementById('priv-keys').replaceChildren(buildKeysRows(result.k0, result.k1, result.k2, result.k3, result.k4));
    document.getElementById('priv-ndef').textContent = result.ndef || '';
    var privProgrammingSection = document.getElementById('priv-awaiting-programming');
    var terminatedBanner = document.getElementById('priv-terminated-banner');
    var wipeSection = document.getElementById('priv-wipe-section');
    var reprovisionBtn = document.getElementById('priv-reprovision-btn');
    reprovisionBtn.disabled = false;
    reprovisionBtn.textContent = 'RE-PROVISION CARD';
    reprovisionBtn.classList.remove('opacity-50', 'bg-gray-600');
    reprovisionBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    document.getElementById('priv-reprovision-status').classList.add('hidden');
    document.getElementById('priv-reprovision-program').classList.add('hidden');
    if (result.cardState === 'keys_delivered' && result.programmingEndpoint) {
      var privProgramEndpoint = result.programmingEndpoint;
      var privDeeplink = 'boltcard://program?url=' + encodeURIComponent(privProgramEndpoint);
      var privQrEl = document.getElementById('qr-priv-program');
      privQrEl.replaceChildren();
      new QRCode(privQrEl, { text: privDeeplink, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
      document.getElementById('priv-program-deeplink').href = privDeeplink;
      if (result.keysDeliveredAt) {
        document.getElementById('priv-keys-delivered-time').textContent = 'Keys generated ' + relativeTime(Math.floor(result.keysDeliveredAt / 1000)) + '.';
      } else {
        document.getElementById('priv-keys-delivered-time').textContent = '';
      }
      privProgrammingSection.classList.remove('hidden');
      wipeSection.classList.add('hidden');
    } else {
      privProgrammingSection.classList.add('hidden');
    }

    if (result.cardState === 'terminated') {
      document.getElementById('priv-term-version').textContent = result.keyVersion || 1;
      terminatedBanner.classList.remove('hidden');
      wipeSection.classList.add('hidden');
    } else {
      terminatedBanner.classList.add('hidden');
    }

    document.getElementById('priv-wipe-version').textContent = 'v' + (result.keyVersion || 1);
    document.getElementById('priv-fetch-wipe-btn').disabled = false;
    document.getElementById('priv-fetch-wipe-btn').textContent = 'GET WIPE KEYS';
    document.getElementById('priv-fetch-wipe-btn').classList.remove('opacity-50', 'bg-gray-600');
    document.getElementById('priv-fetch-wipe-btn').classList.add('bg-red-600', 'hover:bg-red-500');
    document.getElementById('priv-wipe-status').classList.add('hidden');
    document.getElementById('priv-wipe-result').classList.add('hidden');
    if (result.cardState === 'active') {
      wipeSection.classList.remove('hidden');
    } else if (result.cardState === 'wipe_requested') {
      wipeSection.classList.remove('hidden');
      document.getElementById('priv-fetch-wipe-btn').textContent = 'WIPE KEYS ALREADY RETRIEVED';
      document.getElementById('priv-fetch-wipe-btn').disabled = true;
      document.getElementById('priv-fetch-wipe-btn').classList.remove('bg-red-600', 'hover:bg-red-500');
      document.getElementById('priv-fetch-wipe-btn').classList.add('bg-gray-600');
      var statusEl = document.getElementById('priv-wipe-status');
      statusEl.classList.remove('hidden');
      statusEl.className = 'mt-3 text-center text-sm text-amber-400';
      statusEl.textContent = 'Card is pending physical wipe. Tap card with blank NDEF to confirm.';
    } else {
      wipeSection.classList.add('hidden');
    }

    loginTime = Date.now();
    document.getElementById('priv-timer').textContent = '00:00:00';
    document.getElementById('private-view').classList.remove('hidden');
    renderTapHistory(result.tapHistory || [], 'priv');
    startTimer();
  }

  function showTerminatedCard(result) {
    clearErrors();
    hideAllViews();
    currentTerminatedUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    var prevVersion = result.keyVersion || 1;
    var nextVersion = prevVersion + 1;
    document.getElementById('term-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('term-prev-version').textContent = prevVersion;
    document.getElementById('term-next-version').textContent = nextVersion;
    document.getElementById('term-version').textContent = prevVersion;
    var btn = document.getElementById('term-provision-btn');
    btn.disabled = false;
    btn.textContent = 'RE-PROVISION AS WITHDRAW CARD (v' + nextVersion + ')';
    btn.classList.remove('opacity-50', 'bg-gray-600');
    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    document.getElementById('term-provision-status').classList.add('hidden');
    document.getElementById('term-program-section').classList.add('hidden');
    document.getElementById('terminated-view').classList.remove('hidden');
  }

  function showWipedCard(result) {
    clearErrors();
    hideAllViews();
    currentTerminatedUid = result.uidHex;
    setCurrentProgrammingEndpoint(result.programmingEndpoint);
    var version = result.keyVersion || 1;
    document.getElementById('wiped-uid-display').textContent = 'UID: ' + result.uidHex.toUpperCase();
    document.getElementById('wiped-version').textContent = version;
    document.getElementById('wiped-key-version').textContent = version;
    document.getElementById('wiped-next-version').textContent = version + 1;
    var btn = document.getElementById('wiped-confirm-btn');
    btn.disabled = false;
    btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
    btn.classList.remove('opacity-50', 'bg-gray-600');
    btn.classList.add('bg-red-600', 'hover:bg-red-500');
    document.getElementById('wiped-confirm-status').classList.add('hidden');
    document.getElementById('wiped-detection-view').classList.remove('hidden');
  }

  function confirmWipedCard() {
    var uid = currentTerminatedUid;
    if (!uid) return;
    var btn = document.getElementById('wiped-confirm-btn');
    var status = document.getElementById('wiped-confirm-status');
    btn.disabled = true;
    btn.textContent = 'TERMINATING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Terminating card...';

    fetch(API_HOST + '/login', {
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
        setTimeout(function() {
          showTerminatedCard({
            uidHex: uid,
            keyVersion: result.data.keyVersion || 2,
            cardState: 'terminated',
            programmingEndpoint: result.data.programmingEndpoint,
          });
        }, 1500);
      } else {
        throw new Error(result.data.error || 'Termination failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:terminate');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      btn.textContent = 'YES, THIS CARD HAS BEEN WIPED';
      btn.classList.remove('opacity-50');
    });
  }

  function fetchWipeKeys() {
    var uid = document.getElementById('priv-uid-display').textContent.replace('UID: ', '').toLowerCase();
    if (!uid) return;
    var btn = document.getElementById('priv-fetch-wipe-btn');
    var status = document.getElementById('priv-wipe-status');
    btn.disabled = true;
    btn.textContent = 'FETCHING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Retrieving wipe keys...';

    fetch(API_HOST + '/login', {
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
        var qrEl = document.getElementById('qr-priv-wipe');
        qrEl.replaceChildren();
        new QRCode(qrEl, { text: result.data.wipeJson, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
        document.getElementById('priv-wipe-link').href = result.data.wipeDeeplink;
        document.getElementById('priv-wipe-json').textContent = result.data.wipeJson;
        document.getElementById('priv-wipe-result').classList.remove('hidden');
      } else {
        throw new Error(result.data.error || 'Failed to fetch wipe keys');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:fetch-wipe-keys');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      btn.textContent = 'GET WIPE KEYS';
      btn.classList.remove('opacity-50');
    });
  }

  function topUpBalance() {
    var amountInput = document.getElementById('topup-amount');
    var statusEl = document.getElementById('topup-status');
    var amount = parseInt(amountInput.value, 10);
    if (!amount || amount <= 0) {
      statusEl.textContent = 'Enter a positive amount';
      statusEl.className = 'text-xs mt-2 text-red-400';
      statusEl.classList.remove('hidden');
      return;
    }
    statusEl.textContent = 'Processing...';
    statusEl.className = 'text-xs mt-2 text-gray-400';
    statusEl.classList.remove('hidden');

    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: currentUid, action: 'top-up', amount: amount }),
    }).then(function(resp) { return resp.json(); })
    .then(function(result) {
      if (result.success) {
        document.getElementById('priv-balance').textContent = result.balance;
        amountInput.value = '';
        statusEl.textContent = result.message;
        statusEl.className = 'text-xs mt-2 text-emerald-400';
      } else {
        statusEl.textContent = result.error || 'Top-up failed';
        statusEl.className = 'text-xs mt-2 text-red-400';
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:topup');
      statusEl.textContent = 'Error: ' + e.message;
      statusEl.className = 'text-xs mt-2 text-red-400';
    });
  }

  function autoConfirmWipe(result) {
    clearErrors();
    hideAllViews();
    showNdef('No NDEF record found. UID: ' + result.uidHex.toUpperCase());
    fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: result.uidHex, action: 'terminate' }),
    }).then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (data.success) {
        showTerminatedCard({
          uidHex: result.uidHex,
          keyVersion: data.keyVersion || (result.keyVersion + 1),
          cardState: 'terminated',
          programmingEndpoint: data.programmingEndpoint,
        });
      } else {
        showPersistentError('Failed to confirm wipe: ' + (data.error || 'unknown'));
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:confirm-wipe');
      showPersistentError('Wipe confirmation error: ' + e.message);
    });
  }

  function reprovisionCard() {
    if (!currentTerminatedUid) return;
    var btn = document.getElementById('term-provision-btn');
    var status = document.getElementById('term-provision-status');
    btn.disabled = true;
    btn.textContent = 'PROVISIONING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Generating new keys...';

    var endpoint = buildProgrammingEndpointUrl();
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UID: currentTerminatedUid }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Card re-provisioned at version ' + (result.data.Version || 2) + '!';
        btn.textContent = 'PROVISIONED';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-600');
        var deeplink = buildProgrammingDeeplink(endpoint);
        var qrEl = document.getElementById('qr-term-program');
        qrEl.replaceChildren();
        new QRCode(qrEl, { text: deeplink, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
        document.getElementById('term-program-deeplink').href = deeplink;
        document.getElementById('term-keys-delivered-time').textContent = 'Keys generated just now.';
        document.getElementById('term-program-section').classList.remove('hidden');
      } else {
        throw new Error(result.data.error || 'Provisioning failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:reprovision');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      var prevVersion = document.getElementById('term-version').textContent;
      btn.textContent = 'RE-PROVISION AS WITHDRAW CARD (v' + (parseInt(prevVersion) + 1) + ')';
      btn.classList.remove('opacity-50');
    });
  }

  function reprovisionPrivateCard() {
    var uid = document.getElementById('priv-uid-display').textContent.replace('UID: ', '').toLowerCase();
    if (!uid) return;
    var btn = document.getElementById('priv-reprovision-btn');
    var status = document.getElementById('priv-reprovision-status');
    btn.disabled = true;
    btn.textContent = 'PROVISIONING...';
    btn.classList.add('opacity-50');
    status.classList.remove('hidden');
    status.className = 'mt-3 text-center text-sm text-gray-400';
    status.textContent = 'Generating new keys...';

    var endpoint = buildProgrammingEndpointUrl();
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UID: uid }),
    }).then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
      if (result.ok) {
        status.className = 'mt-3 text-center text-sm text-emerald-400';
        status.textContent = 'Re-provisioned at version ' + (result.data.Version || 2) + '!';
        btn.textContent = 'PROVISIONED';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-600');
        var deeplink = buildProgrammingDeeplink(endpoint);
        var qrEl = document.getElementById('qr-priv-reprovision');
        qrEl.replaceChildren();
        new QRCode(qrEl, { text: deeplink, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
        document.getElementById('priv-reprovision-deeplink').href = deeplink;
        document.getElementById('priv-reprovision-program').classList.remove('hidden');
      } else {
        throw new Error(result.data.error || 'Provisioning failed');
      }
    }).catch(function(e) {
      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:reprovision-private');
      status.className = 'mt-3 text-center text-sm text-red-400';
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      btn.textContent = 'RE-PROVISION CARD';
      btn.classList.remove('opacity-50');
    });
  }

  function validateWithServer(p, c) {
    return fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: p, c: c }),
    }).then(function(resp) { return resp.json(); });
  }

  function validateUid(uid) {
    return fetch(API_HOST + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid }),
    }).then(function(resp) { return resp.json(); });
  }

  function rescanCard() {
    hideAllViews();
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('scan-status').textContent = 'Scanning... tap your card';
    lastNfcReadTime = 0;
    startNfc();
  }

  function scheduleNfcRestart() {
    setTimeout(function() {
      startNfc();
    }, 0);
  }

  function startNfc() {
    window._nfcPageHandler = true;
    if (window._nfcGateAbort) { window._nfcGateAbort.abort(); window._nfcGateAbort = null; }
    var statusEl = document.getElementById('scan-status');
    var indicatorEl = document.getElementById('nfc-indicator');

    if (nfcAbortController) {
      nfcAbortController.abort();
    }

    var abortController = new AbortController();
    nfcAbortController = abortController;

    try {
      var ndef = new NDEFReader();
      ndef.scan({ signal: abortController.signal }).then(function() {
        if (nfcAbortController !== abortController || abortController.signal.aborted) {
          return;
        }

        statusEl.textContent = 'Scanning... tap your card';
        indicatorEl.classList.remove('hidden');

        ndef.onreading = function(event) {
          try {
            var now = Date.now();
            if (now - lastNfcReadTime < 3000) return;
            lastNfcReadTime = now;

            clearErrors();

            var rawUrlP = extractNdefUrl(event.message.records, ['lnurlw://', 'lnurlp://', 'https://']);
            rawUrlP.then(function(rawUrl) {
              var foundUrl = Boolean(rawUrl);
              if (foundUrl) {
                var url = normalizeBrowserNfcUrl(rawUrl);

                showNdef(rawUrl);
                statusEl.textContent = 'Card detected! Verifying...';

                try {
                  var urlObj = new URL(url);
                  var p = urlObj.searchParams.get('p');
                  var c = urlObj.searchParams.get('c');
                  if (p && c) {
                    validateWithServer(p, c).then(function(result) {
                      if (result.success) {
                        if (!result.deployed && !result.public) {
                          showUndeployedCard(result);
                        } else if (result.public) {
                          showPublicCard(result);
                        } else {
                          showPrivateCard(result);
                        }
                      } else {
                        showPersistentError(result.error || result.reason || 'Authentication failed');
                        statusEl.textContent = 'Failed. Tap card to retry.';
                      }
                    }).catch(function(e) {
                      if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:validate-server');
                      showPersistentError('Validation error: ' + e.message);
                      statusEl.textContent = 'Error. Tap to retry.';
                    });
                  } else {
                    showPersistentError('Card URL missing p/c parameters. Raw: ' + rawUrl);
                    statusEl.textContent = 'Invalid card. Tap to retry.';
                  }
                } catch(e) {
                  if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:parse-url');
                  showPersistentError('Could not parse card URL: ' + e.message + '. Raw: ' + rawUrl);
                  statusEl.textContent = 'Parse error. Tap to retry.';
                }
              }

              if (!foundUrl && event.serialNumber) {
                var uid = normalizeNfcSerial(event.serialNumber);
                if (/^[0-9a-f]{14}$/.test(uid)) {
                  showNdef('No NDEF record found. UID: ' + uid.toUpperCase());
                  statusEl.textContent = 'Card detected! Reading UID...';
                  validateUid(uid).then(function(result) {
                    if (result.success) {
                      if (result.deployed) {
                        if (result.cardState === 'terminated') {
                          showTerminatedCard(result);
                        } else if (result.cardState === 'wipe_requested') {
                          autoConfirmWipe(result);
                        } else if (result.cardState === 'active') {
                          showWipedCard(result);
                        } else {
                          showPrivateCard(result);
                        }
                      } else {
                        showUndeployedCard(result);
                      }
                    } else {
                      showPersistentError(result.error || result.reason || 'UID lookup failed');
                      statusEl.textContent = 'Failed. Tap card to retry.';
                    }
                  }).catch(function(e) {
                    if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:uid-lookup');
                    showPersistentError('UID lookup error: ' + e.message);
                    statusEl.textContent = 'Error. Tap to retry.';
                  });
                }
              }
            });
          } finally {
            if (!abortController.signal.aborted) {
              var cardShown = document.getElementById('login-view').classList.contains('hidden');
              if (cardShown) {
                abortController.abort();
                nfcAbortController = null;
              } else {
                scheduleNfcRestart();
              }
            }
          }
        };

        ndef.onreadingerror = function() {
          if (abortController.signal.aborted) {
            return;
          }
          statusEl.textContent = 'Read error. Tap card again.';
          scheduleNfcRestart();
        };
      }).catch(function(error) {
        if (typeof window.reportClientError === 'function') window.reportClientError(error, 'login.js:nfc-onreadingerror');
        if (nfcAbortController === abortController) {
          nfcAbortController = null;
          indicatorEl.classList.add('hidden');
        }
        if (error.name === 'AbortError') {
          return;
        }
        if (error.name === 'NotAllowedError') {
          statusEl.textContent = 'NFC permission denied';
          showPersistentError('NFC permission was denied. Refresh the page and allow NFC access.');
        } else if (error.name === 'NotSupportedError') {
          statusEl.textContent = 'NFC not available';
          showPersistentError('NFC is not available on this device. Use Chrome 89+ on Android.');
        } else {
          statusEl.textContent = 'NFC error';
          showPersistentError('NFC error: ' + error.message);
        }
      });
    } catch (error) {
      if (typeof window.reportClientError === 'function') window.reportClientError(error, 'login.js:nfc-scan');
      if (nfcAbortController === abortController) {
        nfcAbortController = null;
        indicatorEl.classList.add('hidden');
      }
      if (error.name === 'AbortError') {
        return;
      }
      if (error.name === 'NotAllowedError') {
        statusEl.textContent = 'NFC permission denied';
        showPersistentError('NFC permission was denied. Refresh the page and allow NFC access.');
      } else if (error.name === 'NotSupportedError') {
        statusEl.textContent = 'NFC not available';
        showPersistentError('NFC is not available on this device. Use Chrome 89+ on Android.');
      } else {
        statusEl.textContent = 'NFC error';
        showPersistentError('NFC error: ' + error.message);
      }
    }
  }
})();
