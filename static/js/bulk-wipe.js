// bulk-wipe.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

var UID_REGEX = /^[0-9a-f]{14}$/;
function validateUid(uid) {
  var normalized = uid.replace(/:/g, '').toLowerCase();
  if (UID_REGEX.test(normalized)) return normalized;
  return null;
}

(function() {
  var bulkRoot = document.getElementById('bulk-wipe-root');
  var baseUrl = bulkRoot ? bulkRoot.getAttribute('data-base-url') : '';

  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Tap-to-detect
  var detectScanner = null;
  var detectedUid = null;
  var detectedVersion = null;
  var detectedFingerprint = null;

  function initDetectScanner() {
    detectScanner = createNfcScanner({
      continuous: false,
      debounceMs: 0,
      onTap: function(data) {
        var url = data.url;
        if (!url) {
          document.getElementById('detect-error').textContent = 'No URL found on card. The card may not be programmed.';
          document.getElementById('detect-error').classList.remove('hidden');
          document.getElementById('detect-status').classList.add('hidden');
          return;
        }
        try {
          var parsed = new URL(url);
          var p = parsed.searchParams.get('p');
          var c = parsed.searchParams.get('c');
          if (!p || !c) {
            document.getElementById('detect-error').textContent = 'Card URL missing p/c parameters.';
            document.getElementById('detect-error').classList.remove('hidden');
            document.getElementById('detect-status').classList.add('hidden');
            return;
          }
          document.getElementById('detect-status').querySelector('span').textContent = 'Identifying card...';
          fetch('/api/identify-issuer-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ p: p, c: c })
          }).then(function(r) { return r.json(); }).then(function(result) {
            document.getElementById('detect-status').classList.add('hidden');
            if (result.matched) {
              detectedUid = result.uid;
              detectedVersion = result.version;
              detectedFingerprint = result.issuerKeyFingerprint;
              document.getElementById('detect-uid').textContent = result.uid.toUpperCase();
              document.getElementById('detect-version').textContent = result.version;
              document.getElementById('detect-label').textContent = result.issuerKeyLabel;
              document.getElementById('detect-result').classList.remove('hidden');
              document.getElementById('detect-error').classList.add('hidden');
              var keySelect = document.getElementById('key-select');
              var matchedOption = keySelect.querySelector('option[data-fingerprint="' + result.issuerKeyFingerprint + '"]');
              if (matchedOption) {
                keySelect.value = matchedOption.value;
                keySelect.dispatchEvent(new Event('change'));
              } else {
                keySelect.value = 'custom';
                keySelect.dispatchEvent(new Event('change'));
                document.getElementById('custom-key').value = '';
                document.getElementById('custom-key').focus();
              }
            } else {
              document.getElementById('detect-error').textContent = 'Unknown issuer \u2014 this card was not provisioned with any of our known issuer keys. Switch to Custom key\u2026 and paste the master secret manually.';
              document.getElementById('detect-error').classList.remove('hidden');
              document.getElementById('detect-result').classList.add('hidden');
              document.getElementById('key-select').value = 'custom';
              document.getElementById('key-select').dispatchEvent(new Event('change'));
              document.getElementById('custom-key').focus();
            }
          }).catch(function(e) {
            document.getElementById('detect-error').textContent = 'Error: ' + e.message;
            document.getElementById('detect-error').classList.remove('hidden');
            document.getElementById('detect-status').classList.add('hidden');
          });
        } catch (e) {
          document.getElementById('detect-error').textContent = 'Error: ' + e.message;
          document.getElementById('detect-error').classList.remove('hidden');
          document.getElementById('detect-status').classList.add('hidden');
        }
      },
      onError: function(err, phase) {
        if (phase === 'permission') {
          document.getElementById('detect-status').querySelector('span').textContent = 'NFC permission denied. Tap to retry.';
        }
      },
      onStatus: function(status) {
        var el = document.getElementById('detect-status');
        if (status === 'scanning') {
          el.classList.remove('hidden');
          el.querySelector('span').textContent = 'Tap your card to detect issuer key...';
        } else {
          el.classList.add('hidden');
        }
      }
    });
  }

  if (browserSupportsNfc()) {
    initDetectScanner();
    window.addEventListener('load', function() { detectScanner.scan(); });
  } else {
    document.getElementById('detect-status').querySelector('span').textContent = 'Web NFC not supported. Use Chrome on Android.';
    document.getElementById('detect-status').querySelector('div').className = 'w-2 h-2 bg-red-500 rounded-full';
  }

  document.getElementById('detect-wipe-this').addEventListener('click', function() {
    if (!detectedUid) return;
    document.getElementById('uid-input').value = detectedUid.toUpperCase();
    var keySelect = document.getElementById('key-select');
    if (keySelect.value !== 'custom') {
      var matchedOption = keySelect.querySelector('option[data-fingerprint="' + detectedFingerprint + '"]');
      if (matchedOption) keySelect.value = matchedOption.value;
    }
    document.getElementById('btn-generate').click();
  });

  document.getElementById('detect-use-key').addEventListener('click', function() {
    document.getElementById('uid-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Toggle custom key section
  document.getElementById('key-select').addEventListener('change', function(e) {
    var section = document.getElementById('custom-key-section');
    if (e.target.value === 'custom') {
      section.classList.remove('hidden');
    } else {
      section.classList.add('hidden');
    }
  });

  // Show inline error
  function showError(msg) {
    var el = document.getElementById('error-msg');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() {
    document.getElementById('error-msg').classList.add('hidden');
  }

  // Toast
  function showToast() {
    var toast = document.getElementById('toast');
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(function() {
      toast.classList.add('translate-y-20', 'opacity-0');
    }, 2000);
  }

  // Copy helper
  function copyText(text) {
    navigator.clipboard.writeText(text).then(function() { showToast(); }).catch(function() {});
  }

  // Generate button
  document.getElementById('btn-generate').addEventListener('click', function() {
    hideError();
    var results = document.getElementById('results');
    results.replaceChildren();

    var keySelect = document.getElementById('key-select');
    var key = keySelect.value;
    if (key === 'custom') {
      key = document.getElementById('custom-key').value.trim().toLowerCase();
      if (!key || !/^[0-9a-f]{32}$/.test(key)) {
        showError('Please enter a valid 32-character hex issuer key.');
        return;
      }
    }
    if (!key) {
      showError('Please select an issuer key.');
      return;
    }

    var raw = document.getElementById('uid-input').value;
    var uids = raw.split(/[\n\r]+/).map(function(u) { return u.trim().toLowerCase(); }).filter(function(u) { return u.length > 0; });
    if (uids.length === 0) {
      showError('Please enter at least one card UID.');
      return;
    }

    var invalidUids = uids.filter(function(u) { return !validateUid(u); });
    if (invalidUids.length > 0) {
      showError('Invalid UID format (must be 14 hex chars): ' + invalidUids.join(', '));
      return;
    }

    var btn = document.getElementById('btn-generate');
    btn.disabled = true;
    btn.textContent = 'PROCESSING ' + uids.length + ' CARD(S)...';

    (function processUids(index) {
      if (index >= uids.length) {
        btn.disabled = false;
        btn.textContent = 'GENERATE WIPE DATA';
        if (results.children.length > 0) {
          results.children[0].scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }
      var uid = uids[index];
      var apiUrl = baseUrl + '/api/bulk-wipe-keys?uid=' + encodeURIComponent(uid) + '&key=' + encodeURIComponent(key);
      fetch(apiUrl).then(function(resp) {
        if (!resp.ok) return resp.text().then(function(errBody) {
          renderCardError(results, uid, 'Server error ' + resp.status + ': ' + errBody);
          processUids(index + 1);
        });
        return resp.json().then(function(data) {
          renderCardResult(results, data);
          processUids(index + 1);
        });
      }).catch(function(err) {
        renderCardError(results, uid, 'Fetch failed: ' + err.message);
        processUids(index + 1);
      });
    })(0);
  });

  function renderCardResult(container, data) {
    var uid = (data.uid || '').toUpperCase();
    var wipeJson = data.wipe_json || {};
    var wipeJsonStr = JSON.stringify(wipeJson);
    var resetLink = data.reset_deeplink || '';

    var card = document.createElement('div');
    card.className = 'bg-gray-800 border border-gray-700 rounded-lg p-6 shadow-xl';

    var header = _el('div', 'flex items-center justify-between mb-4 border-b border-gray-700 pb-2');
    var h3 = _el('h3', 'text-lg font-bold text-gray-200');
    h3.appendChild(document.createTextNode('UID: '));
    var uidSpan = _el('span', 'text-amber-500 font-mono');
    uidSpan.textContent = uid;
    h3.appendChild(uidSpan);
    header.appendChild(h3);
    header.appendChild(_el('span', 'px-2 py-1 bg-green-500/10 text-green-500 text-xs font-mono rounded border border-green-500/20', 'OK'));
    card.appendChild(header);

    var grid = _el('div', 'grid grid-cols-1 md:grid-cols-2 gap-6');
    var jsonCol = _el('div');
    jsonCol.appendChild(_el('label', 'block text-xs font-bold text-gray-500 uppercase mb-2', 'Wipe JSON'));
    var pre = _el('pre', 'font-mono text-xs text-green-400 bg-gray-900 p-4 rounded border border-gray-700 overflow-x-auto min-h-[140px] mb-2');
    pre.textContent = JSON.stringify(wipeJson, null, 2);
    jsonCol.appendChild(pre);
    var jsonCopyBtn = _el('button', 'copy-btn text-xs text-amber-500 hover:text-amber-400 font-bold', 'COPY JSON');
    jsonCopyBtn.dataset.copy = encodeURIComponent(wipeJsonStr);
    jsonCol.appendChild(jsonCopyBtn);
    grid.appendChild(jsonCol);

    var qrCol = _el('div', 'flex flex-col items-center');
    qrCol.appendChild(_el('label', 'block text-xs font-bold text-gray-500 uppercase mb-2', 'QR Code'));
    var qrDiv = _el('div', 'qr-container mb-4');
    qrDiv.id = 'qr-' + data.uid;
    qrCol.appendChild(qrDiv);
    grid.appendChild(qrCol);
    card.appendChild(grid);

    var footer = _el('div', 'mt-4 bg-gray-900 rounded p-3 border border-gray-800');
    var footerRow = _el('div', 'flex justify-between items-center mb-2');
    footerRow.appendChild(_el('span', 'text-xs font-bold text-red-500 uppercase', 'Reset Deeplink'));
    var linkCopyBtn = _el('button', 'copy-btn text-xs text-amber-500 hover:text-amber-400 font-bold', 'COPY LINK');
    linkCopyBtn.dataset.copy = encodeURIComponent(resetLink);
    footerRow.appendChild(linkCopyBtn);
    footer.appendChild(footerRow);
    var resetAnchor = document.createElement('a');
    resetAnchor.href = resetLink;
    resetAnchor.className = 'text-blue-400 hover:text-blue-300 text-sm font-mono break-all underline';
    resetAnchor.textContent = resetLink;
    footer.appendChild(resetAnchor);
    card.appendChild(footer);

    container.appendChild(card);

    if (qrDiv && wipeJsonStr) {
      new QRCode(qrDiv, {
        text: wipeJsonStr,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.L
      });
    }
  }

  function renderCardError(container, uid, msg) {
    var card = document.createElement('div');
    card.className = 'bg-gray-800 border border-red-500/30 rounded-lg p-6 shadow-xl';

    var header = _el('div', 'flex items-center justify-between mb-2');
    var h3 = _el('h3', 'text-lg font-bold text-gray-200');
    h3.appendChild(document.createTextNode('UID: '));
    var uidSpan = _el('span', 'text-amber-500 font-mono');
    uidSpan.textContent = uid.toUpperCase();
    h3.appendChild(uidSpan);
    header.appendChild(h3);
    header.appendChild(_el('span', 'px-2 py-1 bg-red-500/10 text-red-500 text-xs font-mono rounded border border-red-500/20', 'ERROR'));
    card.appendChild(header);

    card.appendChild(_el('p', 'text-sm text-red-400 font-mono', msg));

    container.appendChild(card);
  }

  // Event delegation for copy buttons
  document.getElementById('results').addEventListener('click', function(e) {
    var btn = e.target.closest('.copy-btn');
    if (btn) {
      copyText(decodeURIComponent(btn.getAttribute('data-copy')));
    }
  });
})();
