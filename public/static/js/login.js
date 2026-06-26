// login.js — classic script (no import/export)
// Depends on: nfc.js, helpers.js, card-info.js, card-actions.js, programming.js

(function() {
  // Read server config from data attributes
  var loginView = document.getElementById('login-view');
  var API_HOST = loginView ? loginView.getAttribute('data-api-host') : '';
  var DEFAULT_PROGRAMMING_ENDPOINT = loginView ? loginView.getAttribute('data-default-endpoint') : '';

  // State
  var loginTime = null;
  var timerInterval = null;
  var scanner = createNfcScanner({
    continuous: true,
    debounceMs: 3000,
    prefixes: ['lnurlw://', 'lnurlp://', 'https://'],
    onTap: function(tap) {
      clearErrors();
      var statusEl = document.getElementById('scan-status');
      if (tap.url) {
        showNdef(tap.url);
        statusEl.textContent = 'Card detected! Verifying...';
        try {
          var urlObj = new URL(tap.url);
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
                scanner.stop();
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
            showPersistentError('Card URL missing p/c parameters. Raw: ' + tap.url);
            statusEl.textContent = 'Invalid card. Tap to retry.';
          }
        } catch(e) {
          if (typeof window.reportClientError === 'function') window.reportClientError(e, 'login.js:parse-url');
          showPersistentError('Could not parse card URL: ' + e.message + '. Raw: ' + tap.url);
          statusEl.textContent = 'Parse error. Tap to retry.';
        }
      }
      if (!tap.url && tap.serial) {
        var uid = tap.serial;
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
              scanner.stop();
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
    },
    onError: function(error, phase) {
      if (typeof window.reportClientError === 'function') window.reportClientError(error, 'login.js:nfc-' + phase);
      var statusEl = document.getElementById('scan-status');
      if (phase === 'permission') {
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
      } else if (phase === 'scan') {
        if (scanner.isActive()) {
          statusEl.textContent = 'Read error. Tap card again.';
        } else {
          statusEl.textContent = 'NFC error';
          showPersistentError('NFC error: ' + error.message);
        }
      }
    },
    onStatus: function(status) {
      var statusEl = document.getElementById('scan-status');
      var indicatorEl = document.getElementById('nfc-indicator');
      if (status === 'scanning') {
        statusEl.textContent = 'Scanning... tap your card';
        indicatorEl.classList.remove('hidden');
      } else if (status === 'stopped') {
        indicatorEl.classList.add('hidden');
      }
    }
  });
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
    getNfcPermissionState().then(function(state) {
      if (state === 'granted') {
        scanner.scan();
      } else {
        var btn = document.getElementById('nfc-start-btn');
        if (btn) {
          btn.classList.remove('hidden');
          btn.addEventListener('click', function() {
            btn.classList.add('hidden');
            scanner.scan();
          });
        }
      }
    });
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

  function copyWipeJson(prefix) {
    navigator.clipboard.writeText(buildWipeJson(prefix + '-keys'));
  }

  function copyAllKeys(target) {
    var tbody = document.getElementById(target);
    if (!tbody) return;
    var cells = tbody.querySelectorAll('td:last-child');
    var vals = Array.from(cells).map(function(t) { return t.textContent.trim(); });
    var obj = {k0: vals[0] || '', k1: vals[1] || '', k2: vals[2] || '', k3: vals[3] || '', k4: vals[4] || ''};
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
  }

  function setCurrentProgrammingEndpoint(endpointUrl) {
    currentProgrammingEndpoint = endpointUrl || DEFAULT_PROGRAMMING_ENDPOINT;
  }

  function buildProgrammingEndpointUrl() {
    return currentProgrammingEndpoint || DEFAULT_PROGRAMMING_ENDPOINT;
  }

  function showUndeployedProgrammingInstructions(endpointUrl, deliveredAt) {
    var deeplink = buildProgrammingDeeplink(endpointUrl || buildProgrammingEndpointUrl());
    renderQrCode('qr-undep-program', deeplink);
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
      renderQrCode('qr-pub-wipe', buildWipeJson('pub-keys'));
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
      renderQrCode('qr-priv-program', privDeeplink);
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
        renderQrCode('qr-priv-wipe', result.data.wipeJson);
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
        renderQrCode('qr-term-program', deeplink);
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
        renderQrCode('qr-priv-reprovision', deeplink);
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
    scanner.scan();
  }
})();
