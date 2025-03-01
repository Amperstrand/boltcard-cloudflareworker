import { getDeterministicKeys } from "../keygenerator.js";

// We'll parse "onExisting" from the query param to decide "program" or "reset".
export async function handleBoltCardsRequest(request, env) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Only POST allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const onExisting = url.searchParams.get("onExisting"); // e.g. 'UpdateVersion' or 'KeepVersion'
  // In a real scenario, you might also parse a 'version' param or something else.

  try {
    // The Boltcard NFC Programmer will POST JSON, e.g.:
    // { "UID": "04A39493CC8680" } or { "LNURLW": "lnurlw://..." }
    const body = await request.json();
    const uid = body.UID;
    const lnurlw = body.LNURLW;

    if (!uid && !lnurlw) {
      return new Response(JSON.stringify({
        error: "Must provide UID for program, or LNURLW for reset"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (onExisting === "UpdateVersion" && uid) {
      // "Program" flow
      // Possibly do some logic to increment or handle version. For now, just pass version=1.
      const version = 1;
      const keys = await getDeterministicKeys(uid, version);

      // Return keys in a JSON structure akin to the Python example
      const responsePayload = {
        protocol_name: "new_bolt_card_response",
        protocol_version: 1,
        card_name: `UID ${uid.toUpperCase()}`,
        LNURLW: "lnurlw://boltcardpoc.psbt.me/ln", // your LNURL or something else
        K0: keys.k0,
        K1: keys.k1,
        K2: keys.k2,
        K3: keys.k3,
        K4: keys.k4,
      };

      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (onExisting === "KeepVersion" && lnurlw) {
      // "Reset" flow
      // 1) parse lnurlw, extract p=, c= from querystring
      // 2) decrypt to get UID
      // 3) re-derive or do something
      // For now, let's just return a placeholder
      return new Response(JSON.stringify({
        error: "Reset logic not implemented yet."
      }), {
        status: 501, // Not Implemented
        headers: { "Content-Type": "application/json" },
      });
    }

    // If it doesn't match our logic:
    return new Response(JSON.stringify({
      error: "Invalid combination of onExisting and request body"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
