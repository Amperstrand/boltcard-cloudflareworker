import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { deriveOtpSecret, generateTOTP, generateHOTP } from "../utils/otp.js";
import { logger } from "../utils/logger.js";
import { getRequestOrigin } from "../utils/validation.js";
import { BROWSER_NFC_HELPERS } from "../templates/browserNfc.js";

const TOTP_DOMAIN_TAG = "2d003f80";
const HOTP_DOMAIN_TAG = "2d003f81";

export async function handleTwoFactor(request, env) {
  const { searchParams } = new URL(request.url);
  const pHex = searchParams.get("p");
  const cHex = searchParams.get("c");

  if (!pHex || !cHex) {
    return renderTwoFactorLandingPage(getRequestOrigin(request));
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return new Response("Decryption failed: " + decryption.error, { status: 400 });
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  const config = await getUidConfig(uidHex, env);
  if (!config || !config.K2) {
    return new Response("Card not registered", { status: 404 });
  }

  const { cmac_validated, cmac_error } = validate_cmac(
    hexToBytes(uidHex),
    hexToBytes(ctr),
    cHex,
    hexToBytes(config.K2),
  );
  if (!cmac_validated) {
    return new Response("CMAC validation failed: " + (cmac_error || ""), { status: 403 });
  }

  const totpSecret = deriveOtpSecret(env, uidHex, TOTP_DOMAIN_TAG);
  const hotpSecret = deriveOtpSecret(env, uidHex, HOTP_DOMAIN_TAG);

  const totp = await generateTOTP(totpSecret);
  const hotp = await generateHOTP(hotpSecret, counterValue);

  logger.info("2FA codes generated", { uidHex, counterValue });

  const baseUrl = getRequestOrigin(request);

  return renderTwoFactorPage(uidHex, totp, hotp, counterValue, pHex, cHex, baseUrl);
}

function renderTwoFactorPage(uidHex, totp, hotp, counterValue, pHex, cHex, baseUrl) {
  const maskedUid = uidHex.length >= 8
    ? uidHex.substring(0, 4) + "···" + uidHex.substring(uidHex.length - 4)
    : uidHex;

  const host = baseUrl.replace(/^https?:\/\//, "");
  const withdrawLink = `lnurlw://${host}/?p=${pHex}&c=${cHex}`;
  const payLink = `lnurlp://${host}/?p=${pHex}&c=${cHex}`;

  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="refresh" content="5" />
    <title>2FA — NFC One-Time Password</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { background-color: #111827; color: #f3f4f6; }
      .otp-code { font-family: 'Courier New', monospace; font-size: 2.5rem; letter-spacing: 0.5rem; }
      @media (min-width: 768px) { .otp-code { font-size: 3.5rem; } }
    </style>
  </head>
  <body class="min-h-screen p-4 md:p-8 font-sans antialiased flex flex-col items-center">
    <div class="max-w-lg w-full bg-gray-800 border border-gray-700 shadow-xl rounded-lg p-6 md:p-8">

      <div class="flex items-center justify-between border-b border-gray-700 pb-4 mb-6 gap-3">
        <div>
          <h1 class="text-2xl font-bold text-emerald-500 tracking-tight">2FA CODES</h1>
          <p class="mt-1 text-xs text-gray-500">Live boltcard authenticator demo</p>
        </div>
        <span class="px-3 py-1 bg-emerald-500/10 text-emerald-500 text-sm font-mono rounded border border-emerald-500/20">${maskedUid}</span>
      </div>

      <div class="mb-8 text-center">
        <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Time-based (TOTP)</h2>
        <div class="bg-gray-900 border border-emerald-500/30 rounded-lg py-6 px-4">
          <div class="otp-code text-emerald-400" id="totp-code">${totp.code}</div>
        </div>
        <div class="mt-3 flex items-center justify-center gap-2">
          <div class="w-full bg-gray-700 rounded-full h-2 max-w-xs">
            <div class="bg-emerald-500 h-2 rounded-full transition-all duration-1000" style="width: ${(totp.secondsRemaining / 30) * 100}%"></div>
          </div>
          <span class="text-sm text-gray-400 font-mono w-8 text-right">${totp.secondsRemaining}s</span>
        </div>
      </div>

      <div class="mb-8 text-center">
        <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Counter-based (HOTP)</h2>
        <div class="bg-gray-900 border border-blue-500/30 rounded-lg py-6 px-4">
          <div class="otp-code text-blue-400">${hotp}</div>
        </div>
        <p class="mt-3 text-xs text-gray-500 font-mono">Counter: ${counterValue}</p>
      </div>

      <div class="border-t border-gray-700 pt-6 mb-4">
        <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 text-center">Lightning Actions</h2>
        <div class="grid grid-cols-2 gap-3">
          <a href="${withdrawLink}" class="block text-center bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 px-4 rounded transition-colors text-sm shadow-[0_0_15px_rgba(217,119,6,0.2)]">
            WITHDRAW<br/><span class="font-normal text-amber-200 text-xs">lnurlw://</span>
          </a>
          <a href="${payLink}" class="block text-center bg-purple-700 hover:bg-purple-600 text-white font-bold py-3 px-4 rounded transition-colors text-sm">
            PAY<br/><span class="font-normal text-purple-200 text-xs">lnurlp://</span>
          </a>
        </div>
      </div>

      <div class="text-center">
        <p class="text-xs text-gray-500">Auto-refreshes every 5 seconds. Tap card again for new HOTP code.</p>
      </div>

      <div class="mt-5 flex items-center justify-center gap-4 text-xs text-gray-500">
        <a href="/debug" class="hover:text-gray-300 transition-colors">Debug tools →</a>
        <a href="/identity" class="hover:text-cyan-300 transition-colors">Identity demo →</a>
      </div>

    </div>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

function renderTwoFactorLandingPage(baseUrl) {
  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>2FA Demo — Boltcard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { background-color: #030712; color: #f3f4f6; }
    </style>
  </head>
  <body class="min-h-screen bg-gray-950 text-gray-100 font-sans antialiased">
    <div class="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-4 md:p-8">
      <section class="rounded-3xl border border-gray-800 bg-gray-900/80 p-6 shadow-2xl shadow-black/30 md:p-8">
        <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div class="max-w-3xl">
            <p class="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-400">Operator utility</p>
            <h1 class="mt-3 text-3xl font-bold tracking-tight text-white md:text-5xl">Boltcard 2FA demo</h1>
            <p class="mt-4 max-w-2xl text-sm leading-6 text-gray-400 md:text-base">
              Tap any enrolled bolt card to generate live TOTP and HOTP codes. This turns the debug-tools link into a real demo flow instead of a dead end.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <a href="/debug" class="rounded-xl border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:border-cyan-500/50 hover:text-cyan-300">Back to debug tools</a>
            <a href="/identity" class="rounded-xl border border-pink-500/30 bg-pink-500/10 px-4 py-2 text-sm font-semibold text-pink-200 transition hover:bg-pink-500/20">Identity demo</a>
            <button id="scan-indicator" class="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20">NFC inactive · click to start</button>
          </div>
        </div>

        <div class="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div class="rounded-2xl border border-cyan-500/20 bg-gray-950/70 p-6">
            <div class="flex items-center gap-4">
              <div class="flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-4xl">🛡️</div>
              <div>
                <h2 class="text-xl font-semibold text-white">Tap a card to mint codes</h2>
                <p class="mt-2 text-sm leading-6 text-gray-400">The page reads the card payload with Web NFC, preserves the signed proof (<span class="font-mono text-cyan-300">p/c</span>), and redirects into the live OTP screen.</p>
              </div>
            </div>

            <div class="mt-6 rounded-2xl border border-gray-800 bg-gray-900/80 p-5">
              <div class="text-xs font-semibold uppercase tracking-[0.25em] text-gray-500">Live scan status</div>
              <div id="scan-status" class="mt-3 text-lg font-semibold text-cyan-300">Waiting to start NFC scan…</div>
              <div id="scan-detail" class="mt-2 text-sm text-gray-400">Open this page on Chrome for Android and hold the card steady once scanning starts.</div>
            </div>

            <button id="scan-button" class="mt-6 w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">Start NFC scan</button>
            <div id="scan-error" class="mt-4 hidden rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"></div>
          </div>

          <div class="space-y-4">
            <div class="rounded-2xl border border-gray-800 bg-gray-950/70 p-5">
              <div class="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">What this shows</div>
              <ul class="mt-3 space-y-3 text-sm leading-6 text-gray-300">
                <li>• <span class="font-semibold text-white">TOTP</span> refreshes automatically every 30 seconds.</li>
                <li>• <span class="font-semibold text-white">HOTP</span> changes when the card counter changes.</li>
                <li>• The live page also exposes the same signed card proof that could later back stronger verifiable-credential flows.</li>
              </ul>
            </div>
            <div class="rounded-2xl border border-gray-800 bg-gray-950/70 p-5">
              <div class="text-xs font-semibold uppercase tracking-[0.25em] text-gray-500">Suggested demo path</div>
              <ol class="mt-3 space-y-3 text-sm leading-6 text-gray-300">
                <li>1. Open this page from <span class="font-semibold text-white">Debug & Tools</span>.</li>
                <li>2. Tap a bolt card to jump into the live OTP screen.</li>
                <li>3. Compare it with the identity demo to show the same card acting as both badge and authenticator.</li>
              </ol>
            </div>
          </div>
        </div>
      </section>
    </div>

    <script>
      ${BROWSER_NFC_HELPERS}
      const BASE_URL = ${JSON.stringify(baseUrl)};
      const scanStatus = document.getElementById('scan-status');
      const scanDetail = document.getElementById('scan-detail');
      const scanError = document.getElementById('scan-error');
      const scanButton = document.getElementById('scan-button');
      const scanIndicator = document.getElementById('scan-indicator');
      let scanAbortController = null;

      function updateIndicator(active) {
        if (active) {
          scanIndicator.className = 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20';
          scanIndicator.textContent = 'NFC active · click to restart';
        } else {
          scanIndicator.className = 'rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20';
          scanIndicator.textContent = 'NFC inactive · click to start';
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

      async function startScan() {
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
          const ndef = new NDEFReader();
          scanAbortController = new AbortController();
          await ndef.scan({ signal: scanAbortController.signal });
          updateIndicator(true);
          scanStatus.textContent = 'Scanning for boltcard payload…';
          scanDetail.textContent = 'Tap the card now. We will redirect into the live TOTP/HOTP view.';

          ndef.onreadingerror = () => {
            showError('NFC read failed. Try holding the card still against the back of the device.');
          };

          ndef.onreading = async (event) => {
            const url = normalizeBrowserNfcUrl(await extractNdefUrl(event.message.records, ['lnurlw://', 'https://']));
            if (!url) {
              showError('No compatible boltcard URL was found on the card.');
              return;
            }

            const parsed = new URL(url);
            const p = parsed.searchParams.get('p');
            const c = parsed.searchParams.get('c');
            if (!p || !c) {
              showError('The scanned card did not include the signed 2FA parameters.');
              return;
            }

            scanStatus.textContent = 'Card read. Opening OTP screen…';
            window.location.href = BASE_URL + '/2fa?p=' + encodeURIComponent(p) + '&c=' + encodeURIComponent(c);
          };
        } catch (error) {
          updateIndicator(false);
          if (error.name !== 'AbortError') {
            showError(error.message || 'Unable to start NFC scan.');
            scanStatus.textContent = 'Unable to start NFC scan';
          }
        }
      }

      scanButton.addEventListener('click', startScan);
      scanIndicator.addEventListener('click', startScan);
      updateIndicator(false);
      if (browserSupportsNfc()) {
        window.addEventListener('load', startScan);
      }
    </script>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
