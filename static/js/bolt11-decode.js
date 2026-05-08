// bolt11-decode.js — classic script (no import/export)

(function() {
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
          errEl.textContent = data.error || 'Decode failed';
          errEl.classList.remove('hidden');
          return;
        }
        renderResult(data);
      })
      .catch(function(e) {
        errEl.textContent = 'Request failed: ' + e.message;
        errEl.classList.remove('hidden');
      });
  }

  function makeBadge(text, bgClass, textClass) {
    var span = document.createElement('span');
    span.className = 'inline-block px-2 py-0.5 text-xs font-bold rounded ' + bgClass + ' ' + textClass;
    span.textContent = text;
    return span;
  }

  function cardEl(labelEl, valueContent) {
    var div = document.createElement('div');
    div.className = 'bg-gray-800 border border-gray-700 rounded-lg p-3';
    var labelP = document.createElement('p');
    labelP.className = 'text-xs text-gray-500 uppercase tracking-wider mb-1';
    labelP.appendChild(labelEl);
    div.appendChild(labelP);
    var valueP = document.createElement('p');
    valueP.className = 'text-sm font-mono text-gray-200';
    valueP.appendChild(valueContent);
    div.appendChild(valueP);
    return div;
  }

  function textNode(s) {
    return document.createTextNode(String(s));
  }

  function renderResult(d) {
    document.getElementById('decode-result').classList.remove('hidden');

    var sigBadge = d.signatureValid
      ? makeBadge('VALID', 'bg-emerald-900', 'text-emerald-300')
      : makeBadge('INVALID', 'bg-red-900', 'text-red-300');

    var expiryBadge = d.isExpired
      ? makeBadge('EXPIRED', 'bg-red-900', 'text-red-300')
      : makeBadge('ACTIVE', 'bg-emerald-900', 'text-emerald-300');

    var headerCards = [
      cardEl(textNode('Network'), textNode(d.network)),
      cardEl(textNode('Amount'), textNode(d.amountDisplay || 'any')),
      cardEl(textNode('Timestamp'), textNode(d.timestampISO || '')),
      (function() {
        var c = cardEl(textNode('Expiry'), textNode(d.expiry + 's '));
        c.querySelector('p:last-child').appendChild(expiryBadge);
        return c;
      })(),
      cardEl(textNode('Expires At'), textNode(d.expiresAt || '')),
      cardEl(textNode('Signature'), sigBadge),
    ];
    document.getElementById('result-header').replaceChildren.apply(
      document.getElementById('result-header'), headerCards
    );

    var table = document.createElement('table');
    table.className = 'w-full';
    var tags = d.rawTags || [];
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i];
      var tr = document.createElement('tr');
      tr.className = 'border-b border-gray-700/50';

      var td1 = document.createElement('td');
      td1.className = 'px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap';
      td1.textContent = t.name + ' ';
      var codeSpan = document.createElement('span');
      codeSpan.className = 'text-gray-600';
      codeSpan.textContent = '[' + t.code + ']';
      td1.appendChild(codeSpan);
      tr.appendChild(td1);

      var td2 = document.createElement('td');
      td2.className = 'px-4 py-2 text-sm text-gray-300';
      if (Array.isArray(t.value)) {
        t.value.forEach(function(v) {
          var chip = document.createElement('span');
          chip.className = 'inline-block bg-gray-700 rounded px-1.5 py-0.5 text-xs mr-1 mb-1';
          chip.textContent = v;
          td2.appendChild(chip);
        });
      } else {
        var valSpan = document.createElement('span');
        valSpan.className = 'font-mono text-xs break-all';
        valSpan.textContent = String(t.value);
        td2.appendChild(valSpan);
        if (String(t.value).length === 64) {
          var copyBtn = document.createElement('button');
          copyBtn.setAttribute('data-copy-val', String(t.value));
          copyBtn.className = 'copy-val-btn ml-1 text-amber-400 hover:text-amber-300 text-xs';
          copyBtn.textContent = 'copy';
          td2.appendChild(copyBtn);
        }
      }
      if (t.rawHex) {
        var hexNote = document.createElement('span');
        hexNote.className = 'text-gray-500 text-xs';
        hexNote.textContent = ' (' + t.rawHex + ')';
        td2.appendChild(hexNote);
      }
      tr.appendChild(td2);
      table.appendChild(tr);
    }

    if (d.payee) {
      var payeeTr = document.createElement('tr');
      payeeTr.className = 'border-b border-gray-700/50';
      var payeeTd1 = document.createElement('td');
      payeeTd1.className = 'px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap';
      payeeTd1.textContent = 'payee (recovered)';
      payeeTr.appendChild(payeeTd1);
      var payeeTd2 = document.createElement('td');
      payeeTd2.className = 'px-4 py-2 text-sm font-mono text-purple-300 break-all';
      payeeTd2.textContent = d.payee + ' ';
      var payeeCopyBtn = document.createElement('button');
      payeeCopyBtn.setAttribute('data-copy-val', d.payee);
      payeeCopyBtn.className = 'copy-val-btn ml-1 text-amber-400 hover:text-amber-300 text-xs';
      payeeCopyBtn.textContent = 'copy';
      payeeTd2.appendChild(payeeCopyBtn);
      payeeTr.appendChild(payeeTd2);
      table.appendChild(payeeTr);
    }

    document.getElementById('result-tags').replaceChildren(table);
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
