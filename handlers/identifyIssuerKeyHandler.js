import { deriveKeysFromHex } from "../keygenerator.js";
import { getPerCardKeys } from "../utils/keyLookup.js";
import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { logger } from "../utils/logger.js";
import { matchCardIssuer } from "../utils/cardMatching.js";

export async function handleIdentifyIssuerKey(request, env) {
  try {
    const body = await parseJsonBody(request).catch(() => null);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const pHex = body?.p;
    const cHex = body?.c;

    if (!pHex || !cHex) {
      return errorResponse("Missing required parameters: p and c are required");
    }

    const result = await matchCardIssuer(pHex, cHex, env);

    if (!result.matched) {
      return jsonResponse({ matched: false, uid: null });
    }

    return jsonResponse({
      matched: true,
      uid: result.uidHex,
      version: result.matchedVersion,
      issuerKeyFingerprint: result.issuerFingerprint,
      issuerKeyLabel: result.issuerLabel,
      isPercard: result.isPercard,
    });
  } catch (error) {
    logger.error("Identify issuer key failed", { error: error.message });
    return errorResponse("Failed to identify issuer key", 500);
  }
}
