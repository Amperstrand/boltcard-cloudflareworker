import { getDeterministicKeys } from "../keygenerator.js";
import { resetReplayProtection, setCardConfig } from "../replayProtection.js";
import { renderActivateCardPage } from "../templates/activatePage.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse } from "../utils/responses.js";
import { validateUid } from "../utils/validation.js";

export function handleActivateCardPage() {
  return htmlResponse(renderActivateCardPage());
}

export async function handleActivateCardSubmit(request, env) {
  try {
    const data = await request.json();
    
    const uid = validateUid(data.uid);
    if (!uid) {
      return jsonResponse(
        {
          status: "ERROR", 
          reason: "Invalid UID format. Must be 14 hexadecimal characters (7 bytes)." 
        },
        400
      );
    }
    
    const keys = await getDeterministicKeys(uid, env);
    if (!keys || !keys.k2) {
      return jsonResponse({ status: "ERROR", reason: "Failed to generate keys for the UID." }, 500);
    }
    
    logger.debug("Generated deterministic keys for activation", { uid });
    await resetReplayProtection(env, uid);
    
    const config = {
      K2: keys.k2,
      payment_method: "fakewallet"
    };
    
    await setCardConfig(env, uid, config);
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
  } catch (error) {
    logger.error("Error activating card", { error: error.message });
    return jsonResponse({ status: "ERROR", reason: `Server error: ${error.message}` }, 500);
  }
}
