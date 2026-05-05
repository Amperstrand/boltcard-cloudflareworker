// activate.js — classic script (no import/export)
// Depends on: nfc.js (esc, browserSupportsNfc, createNfcScanner)
// Used by both renderActivatePage() and renderActivateCardPage()

var UID_REGEX = /^[0-9a-f]{14}$/;

function validateUid(uid) {
  if (!uid || typeof uid !== 'string') return null;
  var normalized = uid.replace(/:/g, '').toLowerCase();
  if (!UID_REGEX.test(normalized)) return null;
  return normalized;
}

// --- Page 1: Activation page (QR codes, copy, toast) ---

(function initActivatePage() {
  var configEl = document.getElementById('activate-config');
  if (!configEl) return;

  var posBaseUrl = configEl.getAttribute('data-api-url') || '';
  var programUrl = configEl.getAttribute('data-program-url') || '';
  var resetUrl = configEl.getAttribute('data-reset-url') || '';
  var posQr = null;

  function updatePosConfig() {
    var address = document.getElementById('pos-lightning-address').value.trim();
    var amount = parseInt(document.getElementById('pos-amount').value) || 1;
    var amountMsat = amount * 1000;
    var posUrl = posBaseUrl + '&card_type=pos&lightning_address=' + encodeURIComponent(address) + '&min_sendable=' + amountMsat + '&max_sendable=' + amountMsat;
    var deepLink = 'boltcard://program?url=' + encodeURIComponent(posUrl);

    var linkEl = document.getElementById('link-pos');
    linkEl.textContent = deepLink;

    var deeplinkEl = document.getElementById('pos-deeplink');
    deeplinkEl.href = deepLink;

    if (posQr) posQr.clear();
    posQr.makeCode(posUrl);
  }

  function setup2faConfig() {
    var twoFaUrl = posBaseUrl + '&card_type=2fa';
    var deepLink = 'boltcard://program?url=' + encodeURIComponent(twoFaUrl);

    document.getElementById('link-2fa').textContent = deepLink;
    document.getElementById('2fa-deeplink').href = deepLink;

    var qr2fa = new QRCode(document.getElementById("qr-2fa"), {
      text: twoFaUrl,
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    new QRCode(document.getElementById("qr-program"), {
      text: programUrl,
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });

    new QRCode(document.getElementById("qr-reset"), {
      text: resetUrl,
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });

    posQr = new QRCode(document.getElementById("qr-pos"), {
      text: "",
      width: 200, height: 200,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.L
    });

    updatePosConfig();
    setup2faConfig();

    document.getElementById('pos-lightning-address').addEventListener('input', updatePosConfig);
    document.getElementById('pos-amount').addEventListener('input', updatePosConfig);
  });

  // Copy + toast for activation page
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-copy-id]');
    if (!btn) return;
    var elementId = btn.getAttribute('data-copy-id');
    var el = document.getElementById(elementId);
    if (!el) return;
    var text = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : el.innerText;
    navigator.clipboard.writeText(text).then(function() {
      var toast = document.getElementById('toast');
      if (toast) {
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(function() {
          toast.classList.add('translate-y-20', 'opacity-0');
        }, 2000);
      }
    }).catch(function() {});
  });
})();

// --- Page 2: Activate card form (NFC scan + submit) ---

(function initActivateCardPage() {
  var formEl = document.getElementById('activateForm');
  if (!formEl) return;

  var activateFormScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onTap: function(data) {
      var nfcStatus = document.getElementById('nfc-status');
      var uidInput = document.getElementById('uid');
      nfcStatus.classList.remove('hidden');
      if (data.serial) {
        var formattedUid = data.serial;
        var validatedUid = validateUid(formattedUid);
        if (validatedUid) {
          uidInput.value = validatedUid;
          nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300';
          nfcStatus.textContent = 'Successfully scanned card UID: ' + validatedUid;
        } else {
          nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
          nfcStatus.textContent = 'Invalid UID format after processing. Expected 14 hex characters.';
        }
      } else {
        nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
        nfcStatus.textContent = 'Could not read UID from card. Please try again.';
      }
      var scanHint = document.getElementById('nfc-scanning-hint');
      if (scanHint) scanHint.textContent = 'Tap again to re-scan card';
    },
    onError: function(err, phase) {
      var nfcStatus = document.getElementById('nfc-status');
      if (phase !== 'permission') {
        nfcStatus.classList.remove('hidden');
        nfcStatus.className = 'rounded-lg px-4 py-3 text-sm mb-3 bg-red-500/10 border border-red-500/30 text-red-300';
        nfcStatus.textContent = 'Error: ' + err.message;
      }
    }
  });

  document.getElementById('activateForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var result = document.getElementById('result');
    var uidInput = document.getElementById('uid');
    var validatedUid = validateUid(uidInput.value.replace(/:/g, '').toLowerCase());

    if (!validatedUid) {
      result.className = 'mt-4 text-sm text-red-300';
      result.textContent = 'Error: UID must be exactly 7 bytes (14 hex characters)';
      return;
    }

    fetch('/experimental/activate/form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: validatedUid })
    }).then(function(r) { return r.json(); }).then(function(json) {
      if (json.status === 'OK') {
        result.className = 'mt-4 text-sm text-emerald-300';
        result.textContent = 'Card activated successfully! ' + (json.message || '');
      } else {
        result.className = 'mt-4 text-sm text-red-300';
        result.textContent = 'Error: ' + (json.reason || 'Unknown error');
      }
    }).catch(function(error) {
      result.className = 'mt-4 text-sm text-red-300';
      result.textContent = 'Error submitting form: ' + error.message;
    });
  });
})();
