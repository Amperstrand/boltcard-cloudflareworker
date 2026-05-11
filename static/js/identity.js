// identity.js — classic script (no import/export)
// Depends on: nfc.js (browserSupportsNfc, createNfcScanner)

(function() {
  var ui = {
    idle: document.getElementById('state-idle'),
    scanning: document.getElementById('state-scanning'),
    verified: document.getElementById('state-verified'),
    denied: document.getElementById('state-denied'),
    panel: document.getElementById('card-panel'),
    btnScan: document.getElementById('btn-scan'),
    btnRetry: document.getElementById('btn-retry'),
    btnReset: document.getElementById('btn-reset'),
    noNfcMsg: document.getElementById('no-nfc-msg'),
    nfcStatus: document.getElementById('nfc-status')
  };

  var profile = {
    avatar: document.getElementById('profile-avatar'),
    name: document.getElementById('profile-name'),
    role: document.getElementById('profile-role'),
    dept: document.getElementById('profile-dept'),
    clearance: document.getElementById('profile-clearance'),
    uid: document.getElementById('profile-uid'),
    time: document.getElementById('profile-time'),
    reason: document.getElementById('error-reason'),
    openTwoFactor: document.getElementById('identity-open-2fa'),
    emojiSaveButton: document.getElementById('emoji-save-button'),
    emojiSaveStatus: document.getElementById('emoji-save-status'),
    emojiButtons: Array.from(document.querySelectorAll('.identity-emoji-btn')),
  };

  function iconSpan(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  var appState = 'idle';
  var currentVerification = null;
  var selectedEmoji = null;
  var nfcScanner = null;

  function setEmojiSelection(emoji) {
    selectedEmoji = emoji;
    profile.emojiButtons.forEach(function(button) {
      var active = button.dataset.emoji === emoji;
      button.classList.toggle('border-pink-400', active);
      button.classList.toggle('bg-pink-500/10', active);
      button.classList.toggle('scale-105', active);
    });
    profile.emojiSaveButton.disabled = !emoji;
  }

  function setSaveStatus(message, tone) {
    tone = tone || 'muted';
    var toneClass = tone === 'success'
      ? 'text-emerald-300'
      : tone === 'error'
        ? 'text-red-300'
        : 'text-gray-500';
    profile.emojiSaveStatus.className = 'text-xs ' + toneClass;
    profile.emojiSaveStatus.textContent = message;
  }

  function hydrateVerifiedProfile(result, verificationParams) {
    var profileData = result.profile || {};
    profile.avatar.textContent = profileData.emoji || '\uD83D\uDC64';
    profile.name.textContent = profileData.name || 'Operator';
    profile.role.textContent = profileData.role || 'Role';
    profile.dept.textContent = profileData.dept || 'Engineering';
    profile.clearance.textContent = profileData.level || 'Level 1';
    profile.uid.textContent = result.maskedUid;
    profile.time.textContent = new Date().toLocaleTimeString([], { hour12: false });
    currentVerification = verificationParams;
    profile.openTwoFactor.href = '/2fa?p=' + encodeURIComponent(verificationParams.p) + '&c=' + encodeURIComponent(verificationParams.c);
    setEmojiSelection(profileData.emoji || null);
    setSaveStatus('Pick an emoji to save it to this card profile.');
  }

  async function saveEmojiSelection() {
    if (!currentVerification || !selectedEmoji) {
      return;
    }

    profile.emojiSaveButton.disabled = true;
    setSaveStatus('Saving avatar choice...', 'muted');

    try {
      var response = await fetch('/api/identity/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p: currentVerification.p,
          c: currentVerification.c,
          emoji: selectedEmoji,
        }),
      });
      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.reason || data.error || 'Unable to save avatar');
      }
      hydrateVerifiedProfile(Object.assign({}, data, { maskedUid: data.maskedUid || profile.uid.textContent }), currentVerification);
      setSaveStatus('Saved. This emoji will show the next time this card is verified.', 'success');
     } catch (error) {
       if (typeof window.reportClientError === 'function') window.reportClientError(error, 'identity.js:save-profile');
       setSaveStatus(error.message || 'Unable to save avatar.', 'error');
     } finally {
      profile.emojiSaveButton.disabled = !selectedEmoji;
    }
  }

  function setState(newState) {
    appState = newState;

    ['idle', 'scanning', 'verified', 'denied'].forEach(function(s) {
      ui[s].classList.add('hidden');
      ui[s].classList.remove('opacity-100');
      ui[s].classList.add('opacity-0');
    });

    ui.panel.className = 'w-full bg-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-800 p-8 shadow-2xl transition-all duration-500 relative overflow-hidden flex flex-col items-center text-center';
    ui.nfcStatus.className = 'w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-300';
    ui.nfcStatus.replaceChildren(iconSpan('text-gray-500', '\u26A1'));

    var target = ui[newState];
    target.classList.remove('hidden');

    void target.offsetWidth; // Reflow

    target.classList.remove('opacity-0');
    target.classList.add('opacity-100');

    if (newState === 'verified') {
      ui.panel.classList.replace('border-gray-800', 'border-emerald-500/50');
      ui.panel.classList.add('shadow-[0_0_30px_rgba(16,185,129,0.15)]');
      ui.nfcStatus.classList.add('bg-emerald-500/20', 'border-emerald-500/50');
      ui.nfcStatus.replaceChildren(iconSpan('text-emerald-400', '\u2713'));
    } else if (newState === 'denied') {
      ui.panel.classList.replace('border-gray-800', 'border-red-500/50');
      ui.panel.classList.add('shadow-[0_0_30px_rgba(239,68,68,0.15)]');
      ui.nfcStatus.classList.add('bg-red-500/20', 'border-red-500/50');
      ui.nfcStatus.replaceChildren(iconSpan('text-red-400', '\u2717'));
    } else if (newState === 'scanning') {
      ui.panel.classList.replace('border-gray-800', 'border-blue-500/50');
      ui.nfcStatus.classList.add('bg-blue-500/20', 'border-blue-500/50', 'animate-pulse');
      ui.nfcStatus.replaceChildren(iconSpan('text-blue-400', '\uD83D\uDCF3'));
    } else {
      ui.nfcStatus.classList.add('bg-gray-900', 'border-gray-800');
    }
  }

  async function processNdefUrl(url) {
    setState('scanning');
    try {
      var parsed = new URL(url);
      var p = parsed.searchParams.get('p');
      var c = parsed.searchParams.get('c');

      if (!p || !c) {
        throw new Error('Invalid card payload');
      }

      var response = await fetch('/api/verify-identity?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c));
      var data = await response.json();

      if (data.verified) {
        hydrateVerifiedProfile(data, { p: p, c: c });
        setState('verified');
      } else {
        profile.reason.textContent = data.reason || 'Verification failed';
        setState('denied');
      }
     } catch (err) {
       if (typeof window.reportClientError === 'function') window.reportClientError(err, 'identity.js:verify');
       profile.reason.textContent = err.message || 'Network error';
       setState('denied');
     }
  }

  function initNfc() {
    nfcScanner = createNfcScanner({
      continuous: false,
      debounceMs: 0,
      onStatus: function(status) {
        if (status === 'scanning') setState('scanning');
      },
      onError: function(err, phase) {
        if (phase === 'permission') {
          ui.noNfcMsg.classList.remove('hidden');
          ui.btnScan.classList.remove('hidden');
        } else {
          profile.reason.textContent = err.message || 'Scan failed';
          setState('denied');
        }
      },
      onTap: async function(data) {
        if (data.url) {
          processNdefUrl(data.url);
        } else {
          profile.reason.textContent = 'No NDEF URL found on card';
          setState('denied');
        }
      }
    });
    if (browserSupportsNfc()) {
      window.addEventListener('load', function() { nfcScanner.scan(); });
    } else {
      ui.noNfcMsg.classList.remove('hidden');
    }
  }

  ui.btnScan.addEventListener('click', function() {
    setState('idle');
    if (nfcScanner) nfcScanner.restart();
  });

  ui.btnRetry.addEventListener('click', function() {
    setState('idle');
    if (nfcScanner) nfcScanner.restart();
  });

  ui.btnReset.addEventListener('click', function() {
    setState('idle');
    if (nfcScanner) nfcScanner.restart();
  });

  initNfc();

  profile.emojiButtons.forEach(function(button) {
    button.addEventListener('click', function() { setEmojiSelection(button.dataset.emoji); });
  });

  profile.emojiSaveButton.addEventListener('click', saveEmojiSelection);
  profile.emojiSaveButton.disabled = true;
})();
