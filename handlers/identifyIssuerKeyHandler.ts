import { jsonResponse, errorResponse } from "../utils/responses.js";
import { parseValidatedBody, cardTapBodySchema, type CardTapBody } from "../utils/schemas.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { logger } from "../utils/logger.js";
import { matchCardIssuer, type MatchResult } from "../utils/cardMatching.js";

export async function handleIdentifyIssuerKey(request: Request, env: Env): Promise<Response> {
  try {
    const bodyResult = await parseValidatedBody<CardTapBody>(request, cardTapBodySchema);
    if (!bodyResult.ok) return errorResponse(bodyResult.error, 400);
    const { p: pHex, c: cHex } = bodyResult.data;

    const result: MatchResult = await matchCardIssuer(pHex, cHex, env);

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
  } catch (error: unknown) {
    logger.error("Identify issuer key failed", { error: getErrorMessage(error) });
    return errorResponse("Failed to identify issuer key", 500);
  }
}
