import { getDeterministicKeys } from "../keygenerator.js";

// Card wipe/reset endpoint — returns fresh keys so the NFC programmer can
// overwrite the card, effectively wiping it.
// Ref: NXP AN12196 §8.1 (personalization sequence), §8.12 (key changes)

export async function handleReset(uid, env) {
  try {
    if (!uid) {
      return new Response(JSON.stringify({ error: "Missing UID parameter for reset." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const keys = await getDeterministicKeys(uid, env);
    const responsePayload = {
      protocol_name: "new_bolt_card_response",
      protocol_version: 1,
      card_name: `UID ${uid}`,
      // LNURLW base URL written into NDEF — matches the root route handler.
      // Path was previously /ln which had no matching route; corrected to /
      LNURLW: "lnurlw://boltcardpoc.psbt.me/",
      K0: keys.k0,
      K1: keys.k1,
      K2: keys.k2,
      K3: keys.k3,
      K4: keys.k4
    };
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
