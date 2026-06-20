(function() {
  var VC_KEY = 'virtual_boltcard';

  function loadVC() {
    try {
      var raw = localStorage.getItem(VC_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && data.uid && data.k1 && data.k2 && typeof data.counter === 'number') return data;
    } catch (e) {}
    return null;
  }

  function saveVC(card) {
    try { localStorage.setItem(VC_KEY, JSON.stringify(card)); } catch (e) {}
  }

  function clearVC() {
    try { localStorage.removeItem(VC_KEY); } catch (e) {}
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function showView(viewId) {
    ['vc-no-card', 'vc-card-details'].forEach(function(id) {
      document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');
  }

  function updateCardDisplay(card) {
    document.getElementById('vc-uid').textContent = card.uid.toUpperCase();
    document.getElementById('vc-counter').textContent = String(card.counter);
    document.getElementById('vc-k1').textContent = card.k1.substring(0, 12) + '\u2026';
    document.getElementById('vc-k2').textContent = card.k2.substring(0, 12) + '\u2026';
    var created = card.createdAt ? new Date(card.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
    document.getElementById('vc-created').textContent = created;
  }

  function createCard() {
    var btn = document.getElementById('vc-create-btn');
    var status = document.getElementById('vc-create-status');
    btn.disabled = true;
    btn.textContent = 'Creating\u2026';
    status.className = 'mt-3 text-sm text-gray-400';
    status.textContent = 'Generating random UID and fetching keys\u2026';
    status.classList.remove('hidden');

    var uidBytes = new Uint8Array(7);
    crypto.getRandomValues(uidBytes);
    var uidHex = Array.from(uidBytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

    fetch('/api/vc/keys?uid=' + uidHex)
      .then(function(r) {
        if (!r.ok) throw new Error('Server returned ' + r.status);
        return r.json();
      })
      .then(function(data) {
        var card = {
          uid: data.uid,
          k1: data.k1,
          k2: data.k2,
          counter: 1,
          createdAt: Date.now()
        };
        saveVC(card);
        updateCardDisplay(card);
        showView('vc-card-details');
        document.getElementById('vc-banner').classList.remove('hidden');
        status.classList.add('hidden');
        btn.textContent = 'Create Virtual Card';
        btn.disabled = false;
      })
      .catch(function(err) {
        if (typeof window.reportClientError === 'function') window.reportClientError(err, 'virtual-card-page.js:create');
        status.className = 'mt-3 text-sm text-red-400';
        status.textContent = 'Failed: ' + err.message;
        btn.textContent = 'Create Virtual Card';
        btn.disabled = false;
      });
  }

  function virtualTapCard() {
    var card = loadVC();
    if (!card) return;

    var k1 = [], uid = [];
    for (var i = 0; i < card.k1.length; i += 2) k1.push(parseInt(card.k1.substring(i, i + 2), 16));
    for (var i = 0; i < card.uid.length; i += 2) uid.push(parseInt(card.uid.substring(i, i + 2), 16));
    k1 = new Uint8Array(k1);
    uid = new Uint8Array(uid);

    var plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(uid, 1);
    plaintext[8] = card.counter & 0xff;
    plaintext[9] = (card.counter >> 8) & 0xff;
    plaintext[10] = (card.counter >> 16) & 0xff;

    var aes = new aesjs.ModeOfOperation.ecb(k1);
    var encrypted = new Uint8Array(aes.encrypt(plaintext));
    var pHex = Array.from(encrypted).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

    card.counter++;
    saveVC(card);
    document.getElementById('vc-counter').textContent = String(card.counter);

    location.href = '/?p=' + encodeURIComponent(pHex) + '&c=' + encodeURIComponent(pHex.substring(0, 16));
  }

  var existing = loadVC();
  if (existing) {
    updateCardDisplay(existing);
    showView('vc-card-details');
    document.getElementById('vc-banner').classList.remove('hidden');
  } else {
    showView('vc-no-card');
  }

  document.getElementById('vc-create-btn').addEventListener('click', createCard);

  document.getElementById('vc-tap-btn').addEventListener('click', function() {
    if (window._virtualSim && window._virtualSim.isActive()) {
      window._virtualSim.tap();
    }
  });

  document.getElementById('vc-delete-btn').addEventListener('click', function() {
    document.getElementById('vc-delete-confirm').classList.remove('hidden');
  });

  document.getElementById('vc-delete-cancel').addEventListener('click', function() {
    document.getElementById('vc-delete-confirm').classList.add('hidden');
  });

  document.getElementById('vc-delete-confirm-btn').addEventListener('click', function() {
    clearVC();
    location.reload();
  });
})();
