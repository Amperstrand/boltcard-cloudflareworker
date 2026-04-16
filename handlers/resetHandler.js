import { getDeterministicKeys } from "../keygenerator.js";
import { resetReplayProtection } from "../replayProtection.js";
import { jsonResponse } from "../utils/responses.js";

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
    const responsePayload = {
      protocol_name: "new_bolt_card_response",
      protocol_version: 1,
      card_name: `UID ${uid}`,
      LNURLW: `lnurlw://${host.replace(/^https?:\/\//, "")}/`,
      K0: keys.k0,
      K1: keys.k1,
      K2: keys.k2,
      K3: keys.k3,
      K4: keys.k4
    };
    return jsonResponse(responsePayload, 200);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
