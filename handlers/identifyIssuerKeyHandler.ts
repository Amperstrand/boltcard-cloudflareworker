import { jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { logger } from "../utils/logger.js";
import { matchCardIssuer } from "../utils/cardMatching.js";
import { MISSING_PARAMS_MSG } from "../utils/constants.js";

export async function handleIdentifyIssuerKey(request: Request, env: Env): Promise<Response> {
  try {
    const body: any = await parseJsonBody(request);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const pHex: string | undefined = body?.p;
    const cHex: string | undefined = body?.c;

    if (!pHex || !cHex) {
      return errorResponse(MISSING_PARAMS_MSG);
    }

    const result: any = await matchCardIssuer(pHex, cHex, env);

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
