// two-factor.js — classic script (no import/export)
// Contains both OTP timer (renderTwoFactorPage) and NFC landing scanner (renderTwoFactorLandingPage)
// Depends on: nfc.js (browserSupportsNfc, extractNdefUrl, normalizeBrowserNfcUrl)

// === Part 1: OTP countdown timer (used by renderTwoFactorPage) ===
(function initOtpTimer() {
  var otpRoot = document.getElementById('otp-root');
  if (!otpRoot) return; // not on OTP page

  var bar = document.getElementById('totp-bar');
  var timer = document.getElementById('totp-timer');
  var seconds = parseInt(otpRoot.getAttribute('data-seconds-remaining'), 10);
  if (isNaN(seconds)) seconds = 30;

  setInterval(function() {
    seconds--;
    if (seconds < 0) seconds = 29;
    if (bar) bar.style.width = ((seconds / 30) * 100) + '%';
    if (timer) timer.textContent = seconds + 's';
  }, 1000);
  setTimeout(function() { window.location.reload(); }, 30000);
})();

// === Part 2: NFC landing scanner (used by renderTwoFactorLandingPage) ===
(function initTwoFactorLanding() {
  var landingRoot = document.getElementById('twofa-landing-root');
  if (!landingRoot) return; // not on landing page

  var BASE_URL = landingRoot.getAttribute('data-base-url') || '';
  var scanStatus = document.getElementById('scan-status');
  var scanDetail = document.getElementById('scan-detail');
  var scanError = document.getElementById('scan-error');
  var scanButton = document.getElementById('scan-button');
  var scanIndicator = document.getElementById('scan-indicator');
  var scanAbortController = null;

  function updateIndicator(active) {
    if (active) {
      scanIndicator.className = 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20';
      scanIndicator.textContent = 'NFC active \u00b7 click to restart';
    } else {
      scanIndicator.className = 'rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20';
      scanIndicator.textContent = 'NFC inactive \u00b7 click to start';
    }
  }

  function showError(message) {
    scanError.textContent = message;
    scanError.classList.remove('hidden');
  }

  function clearError() {
    scanError.textContent = '';
    scanError.classList.add('hidden');
  }

  function startScan() {
    clearError();
    if (!browserSupportsNfc()) {
      scanStatus.textContent = 'Web NFC unavailable';
      scanDetail.textContent = 'Use Chrome on Android to demo boltcard-powered 2FA.';
      showError('Web NFC is not supported on this device/browser.');
      return;
    }

    if (scanAbortController) {
      scanAbortController.abort();
    }

    try {
      var ndef = new NDEFReader();
      scanAbortController = new AbortController();
      ndef.scan({ signal: scanAbortController.signal }).then(function() {
        updateIndicator(true);
        scanStatus.textContent = 'Scanning for boltcard payload\u2026';
        scanDetail.textContent = 'Tap the card now. We will redirect into the live TOTP/HOTP view.';

        ndef.onreadingerror = function() {
          showError('NFC read failed. Try holding the card still against the back of the device.');
        };

        ndef.onreading = function(event) {
          extractNdefUrl(event.message.records, ['lnurlw://', 'https://']).then(function(rawUrl) {
            var url = normalizeBrowserNfcUrl(rawUrl);
            if (!url) {
              showError('No compatible boltcard URL was found on the card.');
              return;
            }

            var parsed = new URL(url);
            var p = parsed.searchParams.get('p');
            var c = parsed.searchParams.get('c');
            if (!p || !c) {
              showError('The scanned card did not include the signed 2FA parameters.');
              return;
            }

            scanStatus.textContent = 'Card read. Opening OTP screen\u2026';
            window.location.href = BASE_URL + '/2fa?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c);
          });
        };
      }).catch(function(error) {
        updateIndicator(false);
        if (error.name !== 'AbortError') {
          showError(error.message || 'Unable to start NFC scan.');
          scanStatus.textContent = 'Unable to start NFC scan';
        }
      });
    } catch (error) {
      updateIndicator(false);
      showError(error.message || 'Unable to start NFC scan.');
      scanStatus.textContent = 'Unable to start NFC scan';
    }
  }

  scanButton.addEventListener('click', startScan);
  scanIndicator.addEventListener('click', startScan);
  updateIndicator(false);
  if (browserSupportsNfc()) {
    window.addEventListener('load', startScan);
  }
})();
