import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { computeAesCmac, hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { logger } from "../utils/logger.js";
import { jsonResponse } from "../utils/responses.js";
import { getAllIssuerKeyCandidates, getPerCardKeys } from "../utils/keyLookup.js";
import { PERCARD_KEYS } from "../utils/generatedKeyData.js";

function deriveAllKeys(uidHex, issuerKeyHex) {
  const issuerKey = hexToBytes(issuerKeyHex);
  const uid = hexToBytes(uidHex);
  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, 1, true);

  const cardKeyMsg = new Uint8Array([...hexToBytes("2d003f75"), ...uid, ...versionBytes]);
  const cardKey = computeAesCmac(cardKeyMsg, issuerKey);

  return {
    k0: Array.from(computeAesCmac(hexToBytes("2d003f76"), cardKey)).map(b => b.toString(16).padStart(2, "0")).join(""),
    k1: Array.from(computeAesCmac(hexToBytes("2d003f77"), issuerKey)).map(b => b.toString(16).padStart(2, "0")).join(""),
    k2: Array.from(computeAesCmac(hexToBytes("2d003f78"), cardKey)).map(b => b.toString(16).padStart(2, "0")).join(""),
    k3: Array.from(computeAesCmac(hexToBytes("2d003f79"), cardKey)).map(b => b.toString(16).padStart(2, "0")).join(""),
    k4: Array.from(computeAesCmac(hexToBytes("2d003f7a"), cardKey)).map(b => b.toString(16).padStart(2, "0")).join(""),
  };
}

export async function handleLoginPage(request) {
  const host = `${new URL(request.url).protocol}//${new URL(request.url).host}`;

  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NFC Login</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { background-color: #111827; color: #f3f4f6; }
      .pulse-ring {
        animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
      }
      @keyframes pulse-ring {
        0% { transform: scale(0.8); opacity: 1; }
        80%, 100% { transform: scale(1.4); opacity: 0; }
      }
    </style>
  </head>
  <body class="min-h-screen p-4 md:p-8 font-sans antialiased flex flex-col items-center justify-center">

    <!-- Login State -->
    <div id="login-view" class="max-w-md w-full">
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold text-emerald-500 tracking-tight mb-2">NFC LOGIN</h1>
        <p class="text-gray-400 text-sm">Tap your NTAG424 card to authenticate</p>
      </div>

      <div class="bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-6">
        <div id="nfc-not-supported" class="hidden text-center py-8">
          <p class="text-red-400 font-semibold mb-2">Web NFC not supported</p>
          <p class="text-gray-500 text-xs">Use Chrome 89+ on Android. On desktop, scan the card with your phone and open the URL.</p>
        </div>

        <div id="nfc-ready" class="text-center">
          <div class="relative mx-auto w-32 h-32 rounded-full bg-emerald-600 flex items-center justify-center mb-4">
            <div class="pulse-ring absolute inset-0 rounded-full bg-emerald-500 opacity-30" id="pulse"></div>
            <svg class="w-12 h-12 text-white relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
          </div>
          <p id="scan-status" class="text-gray-400 text-sm">Starting NFC...</p>
          <p id="nfc-indicator" class="text-xs mt-2 hidden">
            <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1"></span>
            <span class="text-emerald-400">NFC active</span>
          </p>
        </div>
      </div>

      <div id="last-ndef" class="hidden bg-gray-800 border border-gray-700 rounded-lg p-4 mt-4">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Last NDEF Read</p>
          <button onclick="navigator.clipboard.writeText(document.getElementById('ndef-raw').textContent)" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
        </div>
        <p id="ndef-raw" class="font-mono text-xs text-gray-400 break-all"></p>
      </div>

      <div id="error-box" class="hidden bg-red-900/30 border border-red-500/40 rounded-lg p-4 mt-4">
        <p id="error-msg" class="text-red-300 text-sm"></p>
      </div>
    </div>

    <!-- Logged-in State -->
    <div id="session-view" class="max-w-md w-full hidden">
      <div class="text-center mb-6">
        <div class="inline-flex items-center gap-3 mb-2">
          <div class="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-4 py-1">
            <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span class="text-emerald-400 text-sm font-semibold">AUTHENTICATED</span>
          </div>
          <span id="card-type-badge" class="px-3 py-1 rounded text-xs font-bold border bg-amber-500/10 text-amber-400 border-amber-500/30">WITHDRAW</span>
        </div>
        <p class="text-gray-500 text-xs font-mono" id="uid-display"></p>
      </div>

      <div id="compromised-banner" class="hidden bg-amber-900/30 border border-amber-500/40 rounded-lg p-4 mb-4">
        <p class="text-amber-300 font-bold text-sm mb-1">🔑 Keys Recovered</p>
        <p class="text-amber-200/70 text-xs mb-3">Good news — your card's keys are known, which means you can wipe and repurpose this bolt card.</p>
        <a id="wipe-link" href="#" class="block w-full text-center bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 px-4 rounded transition-colors text-sm">
          Open Bolt Card App to Wipe &amp; Reprogram
        </a>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Actions</p>
        <div class="space-y-3">
          <div>
            <p class="text-xs text-gray-400 mb-2">Reset this card (opens Bolt Card app):</p>
            <div class="flex gap-2">
              <a id="reset-deeplink" href="#" class="flex-1 text-center bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-3 rounded transition-colors text-sm">
                Open in App
              </a>
              <button onclick="navigator.clipboard.writeText(document.getElementById('reset-deeplink').href)" class="bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2 px-3 rounded transition-colors text-xs">
                COPY
              </button>
            </div>
            <p id="reset-url-text" class="font-mono text-xs text-gray-600 break-all mt-2"></p>
          </div>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-8 mb-4">
        <div class="text-center">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">Session Duration</p>
          <div id="timer" class="text-5xl font-mono text-gray-200 font-bold tracking-wider">00:00:00</div>
          <p class="text-xs text-gray-600 mt-3 font-mono">tap card again to reset</p>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-3">Card Details</p>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-500">Counter</span>
            <span id="card-counter" class="font-mono text-gray-300">0</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">Issuer Key</span>
            <span id="card-issuer" class="font-mono text-gray-300 text-xs">-</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">CMAC</span>
            <span id="card-cmac" class="font-mono text-emerald-400">-</span>
          </div>
        </div>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex justify-between items-center mb-3">
          <p class="text-xs text-gray-500 uppercase tracking-wider">Keys</p>
        </div>
        <table class="w-full text-sm"><tbody id="card-keys"></tbody></table>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider">NDEF URL</p>
          <button onclick="navigator.clipboard.writeText(document.getElementById('card-ndef').textContent)" class="text-xs text-gray-600 hover:text-amber-500 font-bold transition-colors">COPY</button>
        </div>
        <p id="card-ndef" class="font-mono text-xs text-gray-400 break-all"></p>
      </div>

      <div id="session-error-box" class="hidden bg-red-900/30 border border-red-500/40 rounded-lg p-4 mb-4">
        <p id="session-error-msg" class="text-red-300 text-sm"></p>
      </div>

      <p class="text-center text-xs text-gray-600 mt-4">
        <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1"></span>
        NFC still active — tap card again to refresh session
      </p>
    </div>
  </body>

  <script>
    let loginTime = null;
    let timerInterval = null;
    let nfcAbortController = null;
    let lastNfcReadTime = 0;
    const API_HOST = "${host}";

    if (!('NDEFReader' in window)) {
      document.getElementById('nfc-not-supported').classList.remove('hidden');
      document.getElementById('nfc-ready').classList.add('hidden');
    } else {
      window.addEventListener('load', startNfc);
    }

    function formatDuration(ms) {
      const totalSec = Math.floor(ms / 1000);
      const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      return h + ':' + m + ':' + s;
    }

    function startTimer() {
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        if (loginTime) {
          document.getElementById('timer').textContent = formatDuration(Date.now() - loginTime);
        }
      }, 1000);
    }

    function showPersistentError(msg) {
      const loginView = document.getElementById('login-view');
      const sessionView = document.getElementById('session-view');
      if (!sessionView.classList.contains('hidden')) {
        document.getElementById('session-error-msg').textContent = msg;
        document.getElementById('session-error-box').classList.remove('hidden');
      } else {
        document.getElementById('error-msg').textContent = msg;
        document.getElementById('error-box').classList.remove('hidden');
      }
    }

    function clearErrors() {
      document.getElementById('error-box').classList.add('hidden');
      document.getElementById('session-error-box').classList.add('hidden');
    }

    function showNdef(url) {
      document.getElementById('ndef-raw').textContent = url;
      document.getElementById('last-ndef').classList.remove('hidden');
    }

    function showSession(result) {
      clearErrors();
      const uidHex = result.uidHex;
      document.getElementById('uid-display').textContent = 'UID: ' + uidHex.toUpperCase();

      const typeLabels = { fakewallet: 'WITHDRAW', lnurlpay: 'POS', twofactor: '2FA' };
      const cardType = result.cardType || 'unknown';
      document.getElementById('card-type-badge').textContent = typeLabels[cardType] || cardType.toUpperCase();
      document.getElementById('card-type-badge').className = 'px-3 py-1 rounded text-xs font-bold border ' +
        (cardType === 'lnurlpay' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
         cardType === 'twofactor' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
         'bg-amber-500/10 text-amber-400 border-amber-500/30');

      document.getElementById('card-counter').textContent = result.counterValue;
      document.getElementById('card-issuer').textContent = result.issuerKey || 'unknown';
      const cmacEl = document.getElementById('card-cmac');
      cmacEl.textContent = result.cmacValid ? 'VERIFIED' : 'FAILED';
      cmacEl.className = result.cmacValid ? 'font-mono text-emerald-400' : 'font-mono text-red-400';
      document.getElementById('card-keys').innerHTML =
        '<tr><td class="pr-3 text-gray-500">K0</td><td class="font-mono text-xs text-gray-400">' + (result.k0 || '-') + '</td></tr>' +
        '<tr><td class="pr-3 text-gray-500">K1</td><td class="font-mono text-xs text-gray-400">' + (result.k1 || '-') + '</td></tr>' +
        '<tr><td class="pr-3 text-gray-500">K2</td><td class="font-mono text-xs text-gray-400">' + (result.k2 || '-') + '</td></tr>' +
        '<tr><td class="pr-3 text-gray-500">K3</td><td class="font-mono text-xs text-gray-400">' + (result.k3 || '-') + '</td></tr>' +
        '<tr><td class="pr-3 text-gray-500">K4</td><td class="font-mono text-xs text-gray-400">' + (result.k4 || '-') + '</td></tr>';

      if (result.ndef) {
        document.getElementById('card-ndef').textContent = result.ndef;
      }

      const banner = document.getElementById('compromised-banner');
      if (result.compromised) {
        banner.classList.remove('hidden');
        const wipeUrl = API_HOST + '/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=KeepVersion';
        document.getElementById('wipe-link').href = 'boltcard://reset?url=' + encodeURIComponent(wipeUrl);
      } else {
        banner.classList.add('hidden');
      }

      const resetApiUrl = API_HOST + '/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=KeepVersion';
      const resetDeepLink = 'boltcard://reset?url=' + encodeURIComponent(resetApiUrl);
      document.getElementById('reset-deeplink').href = resetDeepLink;
      document.getElementById('reset-url-text').textContent = resetDeepLink;

      loginTime = Date.now();
      document.getElementById('timer').textContent = '00:00:00';
      document.getElementById('login-view').classList.add('hidden');
      document.getElementById('session-view').classList.remove('hidden');
      startTimer();
    }

    async function validateWithServer(p, c) {
      const resp = await fetch(API_HOST + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p, c }),
      });
      return resp.json();
    }

    async function startNfc() {
      const statusEl = document.getElementById('scan-status');
      const indicatorEl = document.getElementById('nfc-indicator');

      try {
        const ndef = new NDEFReader();
        nfcAbortController = new AbortController();
        await ndef.scan({ signal: nfcAbortController.signal });

        statusEl.textContent = 'Scanning... tap your card';
        indicatorEl.classList.remove('hidden');

        ndef.onreading = async (event) => {
          const now = Date.now();
          if (now - lastNfcReadTime < 3000) return;
          lastNfcReadTime = now;

          clearErrors();

          for (const record of event.message.records) {
            if (record.recordType === 'url') {
              const rawUrl = new TextDecoder().decode(record.data);
              let url = rawUrl;
              if (url.startsWith('lnurlw://')) url = 'https://' + url.substring(9);
              else if (url.startsWith('lnurlp://')) url = 'https://' + url.substring(9);

              showNdef(rawUrl);
              statusEl.textContent = 'Card detected! Verifying...';

              try {
                const urlObj = new URL(url);
                const p = urlObj.searchParams.get('p');
                const c = urlObj.searchParams.get('c');
                if (p && c) {
                  const result = await validateWithServer(p, c);
                  if (result.success) {
                    showSession(result);
                  } else {
                    showPersistentError(result.error || 'Authentication failed');
                    statusEl.textContent = 'Failed. Tap card to retry.';
                  }
                } else {
                  showPersistentError('Card URL missing p/c parameters. Raw: ' + rawUrl);
                  statusEl.textContent = 'Invalid card. Tap to retry.';
                }
              } catch(e) {
                showPersistentError('Could not parse card URL: ' + e.message + '. Raw: ' + rawUrl);
                statusEl.textContent = 'Parse error. Tap to retry.';
              }
            }
          }
        };

        ndef.onreadingerror = () => {
          statusEl.textContent = 'Read error. Tap card again.';
        };
      } catch (error) {
        nfcAbortController = null;
        indicatorEl.classList.add('hidden');
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
  </script>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

export async function handleLoginVerify(request, env) {
  try {
    const body = await request.json();
    const { p: pHex, c: cHex } = body;

    if (!pHex || !cHex) {
      return jsonResponse({ success: false, error: "Missing p or c" }, 400);
    }

    const candidates = getAllIssuerKeyCandidates(env);

    let matchedIssuer = null;
    let matchedUid = null;
    let matchedCtr = null;
    let matchedKeys = null;
    let matchedCmacValid = false;
    let perCardSource = null;

    // Phase 1: Try issuer key derivation
    for (const candidate of candidates) {
      const tryEnv = { ...env, ISSUER_KEY: candidate.hex };
      const decryption = extractUIDAndCounter(pHex, tryEnv);
      if (!decryption.success) continue;

      const { uidHex, ctr } = decryption;
      const keys = deriveAllKeys(uidHex, candidate.hex);

      const { cmac_validated } = validate_cmac(
        hexToBytes(uidHex),
        hexToBytes(ctr),
        cHex,
        hexToBytes(keys.k2),
      );

      matchedIssuer = candidate;
      matchedUid = uidHex;
      matchedCtr = ctr;
      matchedKeys = keys;

      if (cmac_validated) {
        matchedCmacValid = true;

        // Check if per-card keys exist (compromised key set)
        const perCard = getPerCardKeys(uidHex);
        if (perCard) {
          perCardSource = perCard.card_name || "recovered";
          matchedKeys = {
            k0: perCard.k0,
            k1: perCard.k1,
            k2: perCard.k2,
            k3: perCard.k1,
            k4: perCard.k2,
          };
          const { cmac_validated: pcCmac } = validate_cmac(
            hexToBytes(uidHex),
            hexToBytes(ctr),
            cHex,
            hexToBytes(perCard.k2),
          );
          matchedCmacValid = pcCmac;
        }

        break;
      }
    }

    // Phase 2: If issuer key derivation failed, try per-card K1 directly
    if (!matchedIssuer) {
      for (const entry of getUniquePerCardK1s()) {
        const tryEnv = { ...env, ISSUER_KEY: entry.k1 };
        const decryption = extractUIDAndCounter(pHex, tryEnv);
        if (!decryption.success) continue;

        const { uidHex, ctr } = decryption;
        const perCard = getPerCardKeys(uidHex);
        if (!perCard) continue;

        const { cmac_validated } = validate_cmac(
          hexToBytes(uidHex),
          hexToBytes(ctr),
          cHex,
          hexToBytes(perCard.k2),
        );

        if (cmac_validated) {
          matchedIssuer = { hex: "per-card", label: perCard.card_name || "recovered" };
          matchedUid = uidHex;
          matchedCtr = ctr;
          matchedCmacValid = true;
          perCardSource = perCard.card_name || "recovered";
          matchedKeys = {
            k0: perCard.k0,
            k1: perCard.k1,
            k2: perCard.k2,
            k3: perCard.k1,
            k4: perCard.k2,
          };
          break;
        }
      }
    }

    if (!matchedIssuer) {
      return jsonResponse({ success: false, error: "Could not decrypt card with any known key" }, 400);
    }

    const uidHex = matchedUid;
    const counterValue = parseInt(matchedCtr, 16);

    const config = await getUidConfig(uidHex, env);
    const pm = config?.payment_method || "unknown";

    const host = new URL(request.url).host;
    const path = pm === "twofactor" ? "/2fa" : "/";
    const ndefUrl = `https://${host}${path}?p=${pHex}&c=${cHex}`;

    logger.info("NFC login", {
      uidHex,
      counterValue,
      cardType: pm,
      issuerKey: matchedIssuer.label,
      cmacValid: matchedCmacValid,
      perCardSource,
    });

    return jsonResponse({
      success: true,
      uidHex,
      counterValue,
      cardType: pm,
      cmacValid: matchedCmacValid,
      issuerKey: matchedIssuer.label,
      k0: matchedKeys.k0,
      k1: matchedKeys.k1,
      k2: matchedKeys.k2,
      k3: matchedKeys.k3,
      k4: matchedKeys.k4,
      ndef: ndefUrl,
      compromised: !!perCardSource,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error("Login verification error", { error: error.message });
    return jsonResponse({ success: false, error: error.message }, 500);
  }
}

function getUniquePerCardK1s() {
  const seen = new Set();
  return PERCARD_KEYS.filter((e) => {
    if (seen.has(e.k1)) return false;
    seen.add(e.k1);
    return true;
  });
}
