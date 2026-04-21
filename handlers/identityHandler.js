import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { hexToBytes } from "../cryptoutils.js";
import { logger } from "../utils/logger.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { renderIdentityPage } from "../templates/identityPage.js";
import { htmlResponse } from "../utils/responses.js";

export function handleIdentityPage(request) {
  const url = new URL(request.url);
  return htmlResponse(renderIdentityPage({ host: url.origin }));
}

export async function handleIdentityVerify(request, env) {
  const url = new URL(request.url);
  const p = url.searchParams.get("p");
  const c = url.searchParams.get("c");

  if (!p || !c) {
    return errorResponse("Missing p or c parameters", 400);
  }

  const decryption = extractUIDAndCounter(p, env);
  if (!decryption.success) {
    return errorResponse("Decryption failed: " + decryption.error, 400);
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  const config = await getUidConfig(uidHex, env);
  if (!config || !config.K2) {
    return jsonResponse({ verified: false, reason: "Card not recognized" });
  }

  const kvRaw = await env.UID_CONFIG.get(uidHex);
  if (!kvRaw) {
    return jsonResponse({ verified: false, reason: "Card not enrolled for identity" });
  }

  const { cmac_validated } = validate_cmac(
    hexToBytes(uidHex),
    hexToBytes(ctr),
    c,
    hexToBytes(config.K2),
  );

  if (!cmac_validated) {
    return jsonResponse({ verified: false, reason: "Card authentication failed" });
  }

  const maskedUid = uidHex.length >= 8
    ? uidHex.substring(0, 4).toUpperCase() + "···" + uidHex.substring(uidHex.length - 4).toUpperCase()
    : uidHex.toUpperCase();

  logger.info("Identity verified", { uidHex, counterValue });

  return jsonResponse({ verified: true, uid: uidHex, maskedUid });
}
