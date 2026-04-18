import { getDeterministicKeys } from "../keygenerator.js";
import { resetReplayProtection } from "../replayProtection.js";
import { jsonResponse, buildBoltCardResponse } from "../utils/responses.js";

// Card wipe/reset endpoint — returns fresh keys so the NFC programmer can
// overwrite the card, effectively wiping it.
// Ref: NXP AN12196 §8.1 (personalization sequence), §8.12 (key changes)

export async function handleReset(uid, env, baseUrl) {
  try {
    if (!uid) {
      return jsonResponse({ error: "Missing UID parameter for reset." }, 400);
    }
    await resetReplayProtection(env, uid);
    const keys = await getDeterministicKeys(uid, env);
    const host = baseUrl || "https://boltcardpoc.psbt.me";
    const lnurlwPath = `${host.replace(/^https?:\/\//, "")}/`;
    const responsePayload = {
      CARD_NAME: `UID ${uid.toUpperCase()}`,
      ID: "1",
      K0: keys.k0,
      K1: keys.k1,
      K2: keys.k2,
      K3: keys.k3,
      K4: keys.k4,
      LNURLW_BASE: `lnurlw://${lnurlwPath}`,
      LNURLW: `lnurlw://${lnurlwPath}`,
      PROTOCOL_NAME: "NEW_BOLT_CARD_RESPONSE",
      PROTOCOL_VERSION: "1",
    };
    return jsonResponse(responsePayload, 200);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
