import { getDeterministicKeys } from "../keygenerator.js";
import { decodeAndValidate } from "../boltCardHelper.js";

// Helper function to return JSON responses
const jsonResponse = (data, status = 200) => 
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Helper function for error responses
const errorResponse = (error, status = 400) => jsonResponse({ error }, status);

// Main handler function
export async function fetchBoltCardKeys(request, env) {
  if (request.method !== "POST") {
    return errorResponse("Only POST allowed", 405);
  }

  try {
    const url = new URL(request.url);
    const onExisting = url.searchParams.get("onExisting"); // 'UpdateVersion' or 'KeepVersion'
    const { UID: uid, LNURLW: lnurlw } = await request.json();

    if (!uid && !lnurlw) {
      return errorResponse("Must provide UID for programming, or LNURLW for reset");
    }

    if (onExisting === "UpdateVersion" && uid) {
      return handleProgrammingFlow(uid);
    }

    if (onExisting === "KeepVersion" && lnurlw) {
      return handleResetFlow(lnurlw, env);
    }

    return errorResponse("Invalid combination of 'onExisting' and request body");
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

// Handles the "Program" flow (UpdateVersion)
async function handleProgrammingFlow(uid) {
  return generateKeyResponse(uid);
}

// Handles the "Reset" flow (KeepVersion)
async function handleResetFlow(lnurlw, env) {
  try {
    // Parse the LNURLW
    const lnurl = new URL(lnurlw);
    const pHex = lnurl.searchParams.get("p");
    const cHex = lnurl.searchParams.get("c");

    if (!pHex || !cHex) {
      return errorResponse("Invalid LNURLW format: missing 'p' or 'c'");
    }

    // Decode and validate
    console.log("Decoding LNURLW: pHex:", pHex, "cHex:", cHex);
    const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex, env);
    if (error) {
      return errorResponse(error);
    }

    console.log("Reset Flow: Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));

    // Regenerate the keys and return them
    return generateKeyResponse(uidHex);
  } catch (err) {
    return errorResponse("Error processing LNURLW: " + err.message, 500);
  }
}

// Generates the key response structure
async function generateKeyResponse(uid) {
  const version = 1; // Could be dynamically managed in future updates
  const keys = await getDeterministicKeys(uid, version);

  return jsonResponse({
    protocol_name: "new_bolt_card_response",
    protocol_version: 1,
    card_name: `UID ${uid.toUpperCase()}`,
    LNURLW: "lnurlw://boltcardpoc.psbt.me/ln", // Placeholder LNURL
    K0: keys.k0,
    K1: keys.k1,
    K2: keys.k2,
    K3: keys.k3,
    K4: keys.k4,
  });
}
