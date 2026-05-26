import { jsonResponse, errorResponse } from "../utils/responses.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { UID_VALIDATION_MSG } from "../utils/constants.js";
import type { Env } from "../types/core.js";
import { logger, getErrorMessage } from "../utils/logger.js";

const UID_HEX_RE = /^[0-9a-fA-F]{14}$/;

export async function handleVirtualCardKeys(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const uid = url.searchParams.get("uid");

    if (!uid) {
      return errorResponse("Missing required parameter: uid", 400);
    }

    if (!UID_HEX_RE.test(uid)) {
      return errorResponse(UID_VALIDATION_MSG, 400);
    }

    const keys = getDeterministicKeys(uid, env, 1);

    return jsonResponse({
      uid,
      k1: keys.k1,
      k2: keys.k2,
      version: 1,
    });
  } catch (error: unknown) {
    logger.error("Virtual card keys failed", { error: getErrorMessage(error) });
    return errorResponse("Internal error", 500);
  }
}
