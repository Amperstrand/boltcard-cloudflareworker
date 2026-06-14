import { deriveOtpSecret, generateTOTP, generateHOTP } from "../utils/otp.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { logger } from "../utils/logger.js";
import { getRequestOrigin, buildMaskedUid } from "../utils/validation.js";
import { errorResponse, htmlResponse, jsonResponse } from "../utils/responses.js";
import { OTP_DOMAIN_TAG_HOTP, OTP_DOMAIN_TAG_TOTP } from "../utils/constants.js";
import { renderTwoFactorPage, renderTwoFactorLandingPage } from "../templates/twoFactorPage.js";
import { resolveCardIdentity, type ResolveResult } from "../utils/cardAuth.js";

export async function handleTwoFactor(request: Request, env: Env): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const pHex = searchParams.get("p");
  const cHex = searchParams.get("c");

  if (!pHex || !cHex) {
    return htmlResponse(renderTwoFactorLandingPage(getRequestOrigin(request)));
  }

  const auth: ResolveResult = await resolveCardIdentity(pHex, cHex, env, { context: "2fa", requestUrl: request.url });
  if (!auth.ok) {
    return errorResponse(auth.error, auth.status);
  }

  const { uidHex, counterValue } = auth;

  let totp: { code: string; secondsRemaining: number; counter: number }, hotp: string;
  try {
    const totpSecret = deriveOtpSecret(env, uidHex, OTP_DOMAIN_TAG_TOTP);
    const hotpSecret = deriveOtpSecret(env, uidHex, OTP_DOMAIN_TAG_HOTP);

    totp = generateTOTP(totpSecret);
    hotp = generateHOTP(hotpSecret, counterValue);

    logger.info("2FA codes generated", { uidHex, counterValue });
  } catch (error: unknown) {
    logger.error("2FA generation failed", { uidHex, error: getErrorMessage(error) });
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
    renderTwoFactorPage({ uidHex, totp, hotp, counterValue, pHex, cHex, baseUrl }),
  );
}
