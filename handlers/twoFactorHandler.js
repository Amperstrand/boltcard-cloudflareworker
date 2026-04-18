import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { deriveOtpSecret, generateTOTP, generateHOTP } from "../utils/otp.js";
import { logger } from "../utils/logger.js";

const TOTP_DOMAIN_TAG = "2d003f80";
const HOTP_DOMAIN_TAG = "2d003f81";

export async function handleTwoFactor(request, env) {
  const { searchParams } = new URL(request.url);
  const pHex = searchParams.get("p");
  const cHex = searchParams.get("c");

  if (!pHex || !cHex) {
    return new Response("Missing p or c parameters", { status: 400 });
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

  const baseUrl = `${new URL(request.url).protocol}//${new URL(request.url).host}`;

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

      <div class="flex items-center justify-between border-b border-gray-700 pb-4 mb-6">
        <h1 class="text-2xl font-bold text-emerald-500 tracking-tight">2FA CODES</h1>
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

    </div>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
