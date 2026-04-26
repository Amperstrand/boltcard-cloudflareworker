import { getDeterministicKeys } from "../keygenerator.js";
import { resetReplayProtection, setCardConfig } from "../replayProtection.js";
import { renderActivateCardPage } from "../templates/activatePage.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { validateUid } from "../utils/validation.js";
import { PAYMENT_METHOD } from "../utils/constants.js";

export function handleActivateCardPage() {
  return htmlResponse(renderActivateCardPage());
}

export async function handleActivateCardSubmit(request, env) {
  const data = await parseJsonBody(request).catch(() => null);
  if (!data) return errorResponse("Invalid JSON body", 400);

  const uid = validateUid(data.uid);
  if (!uid) {
    return errorResponse("Invalid UID format. Must be 14 hexadecimal characters (7 bytes).", 400);
  }
  
  const keys = getDeterministicKeys(uid, env);
  if (!keys || !keys.k2) {
    return errorResponse("Failed to generate keys for the UID.", 500);
  }
  
  logger.debug("Generated deterministic keys for activation", { uid });
  try {
    await resetReplayProtection(env, uid);
  } catch (error) {
    logger.error("Error resetting replay protection during activation", { uid, error: error.message });
    return errorResponse("Server error", 500);
  }
  
  const config = {
    K2: keys.k2,
    payment_method: PAYMENT_METHOD.FAKEWALLET
  };
  
  try {
    await setCardConfig(env, uid, config);
  } catch (error) {
    logger.error("Error writing card config during activation", { uid, error: error.message });
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
