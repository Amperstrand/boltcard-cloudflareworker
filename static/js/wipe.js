// wipe.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var wipeRoot = document.getElementById('wipe-root');
  var baseUrl = wipeRoot ? wipeRoot.getAttribute('data-base-url') : '';
  var resetApiUrl = wipeRoot ? wipeRoot.getAttribute('data-reset-api-url') : '';
  var wipeQrCode = null;
  var currentResetLink = '';

  // Workflow 1: NFC Scanner (auto-starts on load)
  var wipeScanner = createNfcScanner({
    continuous: false,
    debounceMs: 0,
    onStatus: function(status) {
      var autoHint = document.getElementById('scan-auto-hint');
      var btn = document.getElementById('btn-scan');
      if (status === 'scanning') {
        if (autoHint) autoHint.classList.remove('hidden');
        btn.classList.add('hidden');
      } else {
        if (autoHint) autoHint.classList.add('hidden');
      }
    },
    onError: function(err, phase) {
      var autoHint = document.getElementById('scan-auto-hint');
      if (autoHint) autoHint.classList.add('hidden');
      if (phase !== 'permission') {
        alert("Error reading NFC: " + err.message);
      }
    },
    onTap: function(data) {
      var autoHint = document.getElementById('scan-auto-hint');
      if (autoHint) autoHint.classList.add('hidden');
      var btn = document.getElementById('btn-scan');
      document.getElementById('scan-uid').innerText = data.serial || "Unknown";
      var pParam = "Not found";
      var cParam = "Not found";
      if (data.url) {
        try {
          var url = new URL(data.url);
          pParam = url.searchParams.get("p") || pParam;
          cParam = url.searchParams.get("c") || cParam;
        } catch(e) {}
      }
      document.getElementById('scan-p').innerText = pParam;
      document.getElementById('scan-c').innerText = cParam;
      document.getElementById('scan-results').classList.remove('hidden');
      btn.classList.remove('hidden');
      btn.innerText = "SCAN AGAIN";
    }
  });

  if (browserSupportsNfc()) {
    canAutoStartNfc().then(function(granted) {
      if (granted) {
        window.addEventListener('load', function() { wipeScanner.scan(); });
      } else {
        var btn = document.getElementById('btn-scan');
        if (btn) btn.classList.remove('hidden');
        var autoHint = document.getElementById('scan-auto-hint');
        if (autoHint) autoHint.classList.add('hidden');
      }
    });
  }

  document.getElementById('btn-scan').addEventListener('click', function() {
    wipeScanner.restart();
  });

  // Handlers for Wipe requests
  document.getElementById('btn-wipe-scanned').addEventListener('click', function() {
    var uid = document.getElementById('scan-uid').innerText;
    if (!uid || uid === "Unknown") {
      alert("Valid UID required.");
      return;
    }
    fetchWipeKeys(uid);
  });

  document.getElementById('btn-wipe-manual').addEventListener('click', function() {
    var uid = document.getElementById('manual-uid').value.trim().toLowerCase();
    if (!uid || uid.length !== 14) {
      alert("Please enter a valid 14-character hex UID.");
      return;
    }
    fetchWipeKeys(uid);
  });

  function fetchWipeKeys(uid) {
    var wipeApiUrl = baseUrl + '/wipe?uid=' + encodeURIComponent(uid);
    fetch(wipeApiUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        displayOutput(uid, data, resetApiUrl);
      })
       .catch(function(error) {
         if (typeof window.reportClientError === 'function') window.reportClientError(error, 'wipe.js:fetch-keys');
         alert("Error fetching wipe keys: " + error.message);
       });
  }

  function displayOutput(uid, data, resetApiUrl) {
    document.getElementById('output-section').classList.remove('hidden');
    document.getElementById('output-uid-badge').innerText = 'UID: ' + uid.toUpperCase();
    document.getElementById('api-response').innerText = JSON.stringify(data, null, 2);

    currentResetLink = 'boltcard://reset?url=' + encodeURIComponent(resetApiUrl);
    document.getElementById('link-wipe-btn').href = currentResetLink;
    document.getElementById('link-wipe-text').innerText = currentResetLink;

    var qrContainer = document.getElementById('qr-wipe');
    qrContainer.replaceChildren();

    wipeQrCode = new QRCode(qrContainer, {
      text: currentResetLink,
      width: 180,
      height: 180,
      colorDark : "#000000",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.L
    });

    document.getElementById('output-section').scrollIntoView({ behavior: 'smooth' });
  }

  // Event delegation for data-action buttons
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'copy-wipe-link') {
      navigator.clipboard.writeText(currentResetLink).then(function() {
        var toast = document.getElementById('toast');
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(function() {
          toast.classList.add('translate-y-20', 'opacity-0');
        }, 2000);
      });
    }
  });
})();
