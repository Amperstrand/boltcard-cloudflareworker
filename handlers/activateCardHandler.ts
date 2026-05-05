import { getDeterministicKeys } from "../keygenerator.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { resetReplayProtection, setCardConfig } from "../replayProtection.js";
import { renderActivateCardPage } from "../templates/activatePage.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { validateUid } from "../utils/validation.js";
import { PAYMENT_METHOD, UID_VALIDATION_MSG } from "../utils/constants.js";

export function handleActivateCardPage(): Response {
  return htmlResponse(renderActivateCardPage());
}

export async function handleActivateCardSubmit(request: Request, env: Env): Promise<Response> {
  const data: Record<string, unknown> | null = await parseJsonBody(request);
  if (!data) return errorResponse("Invalid JSON body", 400);

  const uid: string | null = validateUid(data.uid as string);
  if (!uid) {
    return errorResponse(UID_VALIDATION_MSG, 400);
  }
  
  const keys: ReturnType<typeof getDeterministicKeys> = getDeterministicKeys(uid, env);
  if (!keys || !keys.k2) {
    return errorResponse("Failed to generate keys for the UID.", 500);
  }
  
  logger.debug("Generated deterministic keys for activation", { uid });
  try {
    await resetReplayProtection(env, uid);
  } catch (error: unknown) {
    logger.error("Error resetting replay protection during activation", { uid, error: getErrorMessage(error) });
    return errorResponse("Server error", 500);
  }

  const config: { K2: string; payment_method: string } = {
    K2: keys.k2,
    payment_method: PAYMENT_METHOD.FAKEWALLET
  };
  
  try {
    await setCardConfig(env, uid, config);
  } catch (error: unknown) {
    logger.error("Error writing card config during activation", { uid, error: getErrorMessage(error) });
    return errorResponse("Failed to save card config", 500);
  }
  logger.debug("Activated card config written to DO", { uid });

  return jsonResponse(
    {
      status: "SUCCESS", 
      message: `Card with UID ${uid} has been activated with fakewallet payment method.`,
      uid: uid,
      config: config
    },
    201
  );
}
