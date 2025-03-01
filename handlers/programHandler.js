import { getDeterministicKeys } from "../keygenerator.js";

export async function handleProgram(url, env) {
  const uid = url.searchParams.get("uid");
  if (!uid) {
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Missing UID" }),
      { status: 400 }
    );
  }

  console.log("Programming the BoltCard with UID:", uid);

  // Get privacy mode flag from environment; default is NOT enabled
  const privacyMode =
    env.PRIVACY_MODE && env.PRIVACY_MODE.toLowerCase() === "true";

  try {
    // Assume getDeterministicKeys returns an object with k0, k1, k2, k3, k4, cardKey, etc.
    const keys = await getDeterministicKeys(uid);

    // Construct a human-readable card name (similar to the Python version)
    const cardName = `UID ${uid.toUpperCase()}`;

    // Build the response based on whether privacy mode is enabled.
    if (privacyMode) {
      // Privacy mode enabled – output a simplified response.
      const responsePayload = {
        protocol_name: "new_bolt_card_response",
        protocol_version: 1,
        card_name: cardName,
        uid_privacy: "Y",
        // Only return the public keys
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
    } else {
      // Default mode: return all details.
      const responsePayload = {
        status: "SUCCESS",
        message: "BoltCard programmed successfully",
        keys: {
          K0: keys.k0,
          K1: keys.k1,
          K2: keys.k2,
          K3: keys.k3,
          K4: keys.k4,
          CardKey: keys.cardKey,
          card_name: cardName,
          uid: uid.toUpperCase(),
        },
      };
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ status: "ERROR", reason: error.message }),
      { status: 500 }
    );
  }
}
