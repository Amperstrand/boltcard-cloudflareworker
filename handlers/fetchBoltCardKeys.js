import { getDeterministicKeys } from "../keygenerator.js";
import { decodeAndValidate } from "../boltCardHelper.js";
import { extractUIDAndCounter } from "../boltCardHelper.js";
//import { getUidConfig } from "./getUidConfig.js";
//import { uidConfig } from "../uidConfig.js";
//import { getUidConfig } from "../uidConfig.js";
import { getUidConfig } from "../getUidConfig.js";



// Helper function to return JSON responses with logging
const jsonResponse = (data, status = 200) => {
  const jsonStr = JSON.stringify(data);
  console.log("Returning JSON response:", jsonStr); // Log the JSON data
  console.log("Returning status:", status); // Log the JSON data
  return new Response(jsonStr, {
    status,
    headers: { "Content-Type": "application/json" },
  });
};

// Helper function for error responses
const errorResponse = (error, status = 400) => jsonResponse({ error }, status);

// Main handler function
export async function fetchBoltCardKeys(request) {
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
      return handleResetFlow(lnurlw);
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
async function handleResetFlow(lnurlw) {
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
      console.log("LNURLW Verification: pHex:", pHex, "cHex:", cHex);
      //const decryption = decrypt_uid_and_counter(pHex, BOLT_CARD_K1);
      const decryption = extractUIDAndCounter(pHex);
      if (!decryption.success) return errorResponse(decryption.error);
      const { uidHex, ctr } = decryption;
      console.log("uidHex:", uidHex, "ctr:", ctr);

      // Fetch the UID configuration from KV, static config, or via deterministic keys
      const config = await getUidConfig(uidHex);
      console.log(JSON.stringify(config));

      // If no configuration is found, return an error
      if (!config) {
        console.error(`UID ${uidHex} not found in any config`);
        return errorResponse("UID not found in config");
      }

      console.log(`Payment method for UID ${uidHex}: ${config.payment_method}`);
      console.log(`K2 for UID ${uidHex}: ${config.K2}`);
      //const { cmac_validated, cmac_error } = validate_cmac(uidBytes, ctr, cHex);
      //if (!cmac_validated) return errorResponse(cmac_error);
      //dummy validation
      const cmac_validated = true;
    //const { uidHex, ctr, error } = decodeAndValidate(pHex, cHex);
    //if (error) {
    //  return errorResponse(error);
    //}

    console.log("Reset Flow: Decoded UID:", uidHex, "Counter:", parseInt(ctr, 16));

    // Regenerate the keys and return them
    return generateKeyResponse(uidHex);
  } catch (err) {
    return errorResponse("Error in generating keys : " + err.message, 500);
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
