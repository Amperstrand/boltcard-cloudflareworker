import { getDeterministicKeys } from "../keygenerator.js";
import { uidConfig } from "../uidConfig.js";


export async function handleReset(uid) {
  try {
    if (!uid) {
      return new Response(JSON.stringify({ error: "Missing UID parameter for reset." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    console.log(`Resetting card with UID: ${uid}`);
    // Derive keys using the decoded UID.
    const keys = await getDeterministicKeys(uid);
    // Construct response payload.
    const responsePayload = {
      protocol_name: "new_bolt_card_response",
      protocol_version: 1,
      card_name: `UID ${uid}`,
      LNURLW: "lnurlw://boltcardpoc.psbt.me/ln",
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
