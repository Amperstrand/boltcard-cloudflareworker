// bolt11-decode.js — classic script (no import/export)

(function() {
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function decode() {
    var input = document.getElementById('invoice-input').value.trim();
    var errEl = document.getElementById('decode-error');
    var resultEl = document.getElementById('decode-result');
    errEl.classList.add('hidden');
    resultEl.classList.add('hidden');

    if (!input) {
      errEl.textContent = 'Please paste a BOLT11 invoice';
      errEl.classList.remove('hidden');
      return;
    }

    fetch('/api/decode?invoice=' + encodeURIComponent(input))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) {
          errEl.textContent = esc(data.error || 'Decode failed');
          errEl.classList.remove('hidden');
          return;
        }
        renderResult(data);
      })
      .catch(function(e) {
        errEl.textContent = 'Request failed: ' + esc(e.message);
        errEl.classList.remove('hidden');
      });
  }

  function renderResult(d) {
    document.getElementById('decode-result').classList.remove('hidden');

    var sigBadge = d.signatureValid
      ? '<span class="inline-block px-2 py-0.5 text-xs font-bold rounded bg-emerald-900 text-emerald-300">VALID</span>'
      : '<span class="inline-block px-2 py-0.5 text-xs font-bold rounded bg-red-900 text-red-300">INVALID</span>';

    var expiryBadge = d.isExpired
      ? '<span class="inline-block px-2 py-0.5 text-xs font-bold rounded bg-red-900 text-red-300">EXPIRED</span>'
      : '<span class="inline-block px-2 py-0.5 text-xs font-bold rounded bg-emerald-900 text-emerald-300">ACTIVE</span>';

    document.getElementById('result-header').innerHTML = [
      card('Network', esc(d.network)),
      card('Amount', esc(d.amountDisplay || 'any')),
      card('Timestamp', esc(d.timestampISO || '')),
      card('Expiry', esc(d.expiry + 's') + ' ' + expiryBadge),
      card('Expires At', esc(d.expiresAt || '')),
      card('Signature', sigBadge),
    ].join('');

    var tagRows = '';
    var tags = d.rawTags || [];
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i];
      var val = '';
      if (Array.isArray(t.value)) {
        val = t.value.map(function(v) { return '<span class="inline-block bg-gray-700 rounded px-1.5 py-0.5 text-xs mr-1 mb-1">' + esc(v) + '</span>'; }).join('');
      } else {
        val = '<span class="font-mono text-xs break-all">' + esc(String(t.value)) + '</span>';
        if (String(t.value).length === 64) {
          val += ' <button data-copy-val="' + esc(String(t.value)) + '" class="copy-val-btn ml-1 text-amber-400 hover:text-amber-300 text-xs">copy</button>';
        }
      }
      if (t.rawHex) {
        val += ' <span class="text-gray-500 text-xs">(' + esc(t.rawHex) + ')</span>';
      }
      tagRows += '<tr class="border-b border-gray-700/50"><td class="px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap">' + esc(t.name) + ' <span class="text-gray-600">[' + t.code + ']</span></td><td class="px-4 py-2 text-sm text-gray-300">' + val + '</td></tr>';
    }

    if (d.payee) {
      tagRows += '<tr class="border-b border-gray-700/50"><td class="px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap">payee (recovered)</td><td class="px-4 py-2 text-sm font-mono text-purple-300 break-all">' + esc(d.payee) + ' <button data-copy-val="' + esc(d.payee) + '" class="copy-val-btn ml-1 text-amber-400 hover:text-amber-300 text-xs">copy</button></td></tr>';
    }

    document.getElementById('result-tags').innerHTML = '<table class="w-full">' + tagRows + '</table>';
  }

  function card(label, value) {
    return '<div class="bg-gray-800 border border-gray-700 rounded-lg p-3"><p class="text-xs text-gray-500 uppercase tracking-wider mb-1">' + label + '</p><p class="text-sm font-mono text-gray-200">' + value + '</p></div>';
  }

  function clearAll() {
    document.getElementById('invoice-input').value = '';
    document.getElementById('decode-error').classList.add('hidden');
    document.getElementById('decode-result').classList.add('hidden');
  }

  // Event delegation for data-action
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'decode') decode();
    else if (action === 'clear') clearAll();
    else if (action === 'copy-val') {
      var val = btn.getAttribute('data-copy-val');
      if (val) navigator.clipboard.writeText(val).catch(function() {});
    }
  });

  // Ctrl/Cmd+Enter to decode
  document.getElementById('invoice-input').addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') decode();
  });
})();
