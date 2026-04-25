import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { deriveOtpSecret, generateTOTP, generateHOTP } from "../utils/otp.js";
import { logger } from "../utils/logger.js";
import { getRequestOrigin, buildMaskedUid } from "../utils/validation.js";
import { errorResponse, htmlResponse, jsonResponse } from "../utils/responses.js";
import { OTP_DOMAIN_TAG_HOTP, OTP_DOMAIN_TAG_TOTP } from "../utils/constants.js";
import { renderTwoFactorPage, renderTwoFactorLandingPage } from "../templates/twoFactorPage.js";

export async function handleTwoFactor(request, env) {
  const { searchParams } = new URL(request.url);
  const pHex = searchParams.get("p");
  const cHex = searchParams.get("c");

  if (!pHex || !cHex) {
    return htmlResponse(renderTwoFactorLandingPage(getRequestOrigin(request)));
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return errorResponse(decryption.error, 400);
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  let totp, hotp;
  try {
  const config = await getUidConfig(uidHex, env);
  if (!config || !config.K2) {
    return errorResponse("Card not registered", 404);
  }

  const { cmac_validated, cmac_error } = validate_cmac(
    hexToBytes(uidHex),
    hexToBytes(ctr),
    cHex,
    hexToBytes(config.K2),
  );
  if (!cmac_validated) {
    return errorResponse(cmac_error || "CMAC validation failed", 403);
  }

  const totpSecret = deriveOtpSecret(env, uidHex, OTP_DOMAIN_TAG_TOTP);
  const hotpSecret = deriveOtpSecret(env, uidHex, OTP_DOMAIN_TAG_HOTP);

  totp = generateTOTP(totpSecret);
  hotp = generateHOTP(hotpSecret, counterValue);

  logger.info("2FA codes generated", { uidHex, counterValue });
  } catch (error) {
    logger.error("2FA generation failed", { uidHex, error: error.message });
    return errorResponse("Failed to generate 2FA codes", 500);
  }

  const accept = request.headers.get("Accept") || "";
  if (accept.includes("application/json")) {
    const maskedUid = buildMaskedUid(uidHex);
    return jsonResponse({
      uidHex,
      maskedUid,
      totpCode: totp.code,
      totpSecondsRemaining: totp.secondsRemaining,
      hotpCode: hotp,
      counterValue,
    });
  }

  const baseUrl = getRequestOrigin(request);

  return htmlResponse(
    renderTwoFactorPage(uidHex, totp, hotp, counterValue, pHex, cHex, baseUrl),
  );
}
