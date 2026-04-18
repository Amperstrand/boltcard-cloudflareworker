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
          <button id="login-btn" onclick="startLoginScan()"
            class="relative mx-auto w-32 h-32 rounded-full bg-emerald-600 hover:bg-emerald-500 transition-colors flex items-center justify-center mb-4 cursor-pointer">
            <div class="pulse-ring absolute inset-0 rounded-full bg-emerald-500 opacity-30" id="pulse"></div>
            <svg class="w-12 h-12 text-white relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
          </button>
          <p id="scan-status" class="text-gray-400 text-sm">Tap button, then tap card</p>
        </div>
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

      <div class="bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-8 mb-4">
        <div class="text-center">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">Session Duration</p>
          <div id="timer" class="text-5xl font-mono text-gray-200 font-bold tracking-wider">00:00:00</div>
          <p class="text-xs text-gray-600 mt-3 font-mono">since last tap</p>
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

      <div id="nfc-reset-ready" class="text-center">
        <button id="reset-btn" onclick="startResetScan()"
          class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded transition-colors mb-3">
          TAP TO RESET TIMER
        </button>
        <p id="reset-status" class="text-gray-500 text-xs"></p>
      </div>

      <div id="nfc-reset-not-supported" class="hidden text-center">
        <button onclick="resetTimerManual()"
          class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded transition-colors mb-3">
          RESET TIMER
        </button>
        <p class="text-gray-500 text-xs">Web NFC unavailable — manual reset only</p>
      </div>
    </div>

    <div id="error-toast" class="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded shadow-lg transform translate-y-20 opacity-0 transition-all duration-300 font-medium z-50">
    </div>

    <script>
      let loginTime = null;
      let timerInterval = null;
      let abortController = null;
      const API_HOST = "${host}";

      if (!('NDEFReader' in window)) {
        document.getElementById('nfc-not-supported').classList.remove('hidden');
        document.getElementById('nfc-ready').classList.add('hidden');
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

      function showSession(result) {
        const uidHex = result.uidHex;
        const masked = uidHex.length >= 8
          ? uidHex.substring(0, 4) + '\\u00b7\\u00b7\\u00b7' + uidHex.substring(uidHex.length - 4)
          : uidHex;
        document.getElementById('uid-display').textContent = 'UID: ' + uidHex.toUpperCase();

        const typeColors = { fakewallet: 'text-amber-400', lnurlpay: 'text-purple-400', twofactor: 'text-emerald-400' };
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
          const resetUrl = API_HOST + '/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=KeepVersion';
          document.getElementById('wipe-link').href = 'boltcard://reset?url=' + encodeURIComponent(resetUrl);
        } else {
          banner.classList.add('hidden');
        }

        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('session-view').classList.remove('hidden');

        if (!('NDEFReader' in window)) {
          document.getElementById('nfc-reset-ready').classList.add('hidden');
          document.getElementById('nfc-reset-not-supported').classList.remove('hidden');
        }
      }

      function resetTimerManual() {
        loginTime = Date.now();
        document.getElementById('timer').textContent = '00:00:00';
      }

      function showError(msg) {
        const toast = document.getElementById('error-toast');
        toast.textContent = msg;
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
      }

      async function validateWithServer(p, c) {
        const resp = await fetch(API_HOST + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ p, c }),
        });
        return resp.json();
      }

      async function startLoginScan() {
        if (abortController) {
          abortController.abort();
          abortController = null;
          document.getElementById('scan-status').textContent = 'Tap button, then tap card';
          document.getElementById('pulse').classList.add('pulse-ring');
          return;
        }

        const ndef = new NDEFReader();
        abortController = new AbortController();

        try {
          await ndef.scan({ signal: abortController.signal });
          document.getElementById('scan-status').textContent = 'Scanning... tap your card now';
          document.getElementById('pulse').classList.remove('pulse-ring');

          ndef.onreading = async (event) => {
            abortController.abort();
            abortController = null;
            document.getElementById('scan-status').textContent = 'Card detected!';

            for (const record of event.message.records) {
              if (record.recordType === 'url') {
                const url = new TextDecoder().decode(record.data);
                try {
                  const urlObj = new URL(url);
                  const p = urlObj.searchParams.get('p');
                  const c = urlObj.searchParams.get('c');
                  if (p && c) {
                    document.getElementById('scan-status').textContent = 'Verifying...';
                    const result = await validateWithServer(p, c);
                    if (result.success) {
                      loginTime = Date.now();
                      document.getElementById('timer').textContent = '00:00:00';
                      showSession(result);
                      startTimer();
                    } else {
                      showError(result.error || 'Authentication failed');
                      document.getElementById('scan-status').textContent = 'Failed. Try again.';
                    }
                  } else {
                    showError('Card URL missing p/c parameters');
                  }
                } catch(e) {
                  showError('Invalid card URL: ' + e.message);
                }
              }
            }
          };

          ndef.onreadingerror = () => {
            document.getElementById('scan-status').textContent = 'Read error. Try again.';
          };
        } catch (error) {
          abortController = null;
          if (error.name === 'NotAllowedError') {
            showError('NFC permission denied');
          } else if (error.name === 'NotSupportedError') {
            showError('NFC not available on this device');
          } else {
            showError(error.message);
          }
          document.getElementById('scan-status').textContent = 'Tap button, then tap card';
        }
      }

      async function startResetScan() {
        const btn = document.getElementById('reset-btn');
        btn.textContent = 'SCANNING...';
        btn.disabled = true;

        const ndef = new NDEFReader();
        const ac = new AbortController();

        try {
          await ndef.scan({ signal: ac.signal });
          document.getElementById('reset-status').textContent = 'Tap your card now';

          ndef.onreading = async (event) => {
            ac.abort();
            for (const record of event.message.records) {
              if (record.recordType === 'url') {
                const url = new TextDecoder().decode(record.data);
                try {
                  const urlObj = new URL(url);
                  const p = urlObj.searchParams.get('p');
                  const c = urlObj.searchParams.get('c');
                  if (p && c) {
                    document.getElementById('reset-status').textContent = 'Verifying...';
                    const result = await validateWithServer(p, c);
                    if (result.success) {
                      loginTime = Date.now();
                      document.getElementById('timer').textContent = '00:00:00';
                      document.getElementById('reset-status').textContent = 'Timer reset!';
                    } else {
                      showError(result.error || 'Verification failed');
                      document.getElementById('reset-status').textContent = '';
                    }
                  }
                } catch(e) {
                  showError('Invalid card URL');
                }
              }
            }
            btn.textContent = 'TAP TO RESET TIMER';
            btn.disabled = false;
          };

          ndef.onreadingerror = () => {
            btn.textContent = 'TAP TO RESET TIMER';
            btn.disabled = false;
            document.getElementById('reset-status').textContent = 'Read error. Try again.';
          };

          setTimeout(() => {
            if (!ac.signal.aborted) {
              ac.abort();
              btn.textContent = 'TAP TO RESET TIMER';
              btn.disabled = false;
              document.getElementById('reset-status').textContent = 'Scan timed out. Try again.';
            }
          }, 30000);
        } catch (error) {
          btn.textContent = 'TAP TO RESET TIMER';
          btn.disabled = false;
          showError(error.message);
        }
      }
    </script>
  </body>
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
