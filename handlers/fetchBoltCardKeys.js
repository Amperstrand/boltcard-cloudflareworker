import { getDeterministicKeys } from "../keygenerator.js";
import { decodeAndValidate } from "../boltCardHelper.js";
import { extractUIDAndCounter } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";

// Ref: NXP AN12196 §8 (personalization flow), §5.8 (SUN verification)
// Ref: docs/ntag424_llm_context.md §15 (provisioning recipe)

const jsonResponse = (data, status = 200) => {
  const jsonStr = JSON.stringify(data);
  return new Response(jsonStr, {
    status,
    headers: { "Content-Type": "application/json" },
  });
};

const errorResponse = (error, status = 400) => jsonResponse({ error }, status);

// NFC programmer app endpoint — handles both card programming (UpdateVersion)
// and card reset/wipe (KeepVersion) flows.
// Ref: NXP AN12196 §8.1 example personalization sequence
export async function fetchBoltCardKeys(request, env) {
  if (request.method !== "POST") {
    return errorResponse("Only POST allowed", 405);
  }

  try {
    const url = new URL(request.url);
    const onExisting = url.searchParams.get("onExisting");
    const { UID: uid, LNURLW: lnurlw } = await request.json();

    if (!uid && !lnurlw) {
      return errorResponse("Must provide UID for programming, or LNURLW for reset");
    }

    if (onExisting === "UpdateVersion" && uid) {
      return handleProgrammingFlow(uid, env);
    }

    if (onExisting === "KeepVersion" && lnurlw) {
      return handleResetFlow(lnurlw, env);
    }

    return errorResponse("Invalid combination of 'onExisting' and request body");
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

async function handleProgrammingFlow(uid, env) {
  return generateKeyResponse(uid, env);
}

// Reset flow: decrypt the LNURLW tap data to recover the UID, validate CMAC,
// then regenerate keys so the programmer can overwrite the card.
async function handleResetFlow(lnurlw, env) {
  try {
    const lnurl = new URL(lnurlw);
    const pHex = lnurl.searchParams.get("p");
    const cHex = lnurl.searchParams.get("c");

    if (!pHex || !cHex) {
      return errorResponse("Invalid LNURLW format: missing 'p' or 'c'");
    }

    // Step 1: Decrypt PICCENCData to recover UID and SDMReadCtr
    // (NXP AN12196 §5.8 step 3)
    const decryption = extractUIDAndCounter(pHex, env);
    if (!decryption.success) return errorResponse(decryption.error);
    const { uidHex, ctr } = decryption;

    // Step 2: Look up card config (KV → static → deterministic keys)
    const config = await getUidConfig(uidHex, env);

    if (!config) {
      return errorResponse("UID not found in config");
    }

    if (!config.K2) {
      return errorResponse("K2 key not available for CMAC validation");
    }

    // Step 3: Validate CMAC with the card's K2 key
    // (NXP AN12196 §5.8 steps 4-8)
    const k2Bytes = hexToBytes(config.K2);
    const validation = decodeAndValidate(pHex, cHex, env, k2Bytes);
    if (!validation.cmac_validated) {
      return errorResponse(validation.cmac_error || "CMAC validation failed");
    }

    // Step 4: Regenerate keys for the programmer to write
    return generateKeyResponse(uidHex, env);
  } catch (err) {
    return errorResponse("Error in generating keys: " + err.message, 500);
  }
}

// Generates the new_bolt_card_response payload expected by the NFC programmer app.
// Contains all 5 AES keys (K0-K4) and the LNURLW base URL for the NDEF template.
async function generateKeyResponse(uid, env) {
  const version = 1;
  const keys = await getDeterministicKeys(uid, env, version);

  return jsonResponse({
    protocol_name: "new_bolt_card_response",
    protocol_version: 1,
    card_name: `UID ${uid.toUpperCase()}`,
    // LNURLW base URL — the NFC programmer writes this into the NDEF template.
    // The card appends ?p=<PICCENCData>&c=<SDMMAC> at runtime via SDM mirroring.
    LNURLW: "lnurlw://boltcardpoc.psbt.me/",
    K0: keys.k0,
    K1: keys.k1,
    K2: keys.k2,
    K3: keys.k3,
    K4: keys.k4,
  });
}
