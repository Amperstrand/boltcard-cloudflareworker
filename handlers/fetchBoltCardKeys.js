import { getDeterministicKeys } from "../keygenerator.js";
import { decodeAndValidate } from "../boltCardHelper.js";
import { extractUIDAndCounter } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { resetReplayProtection } from "../replayProtection.js";
import { jsonResponse } from "../utils/responses.js";

// Ref: NXP AN12196 §8 (personalization flow), §5.8 (SUN verification)
// Ref: docs/ntag424_llm_context.md §15 (provisioning recipe)

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
    const cardType = url.searchParams.get("card_type") || "withdraw";
    const lightningAddress = url.searchParams.get("lightning_address") || "";
    const minSendable = parseInt(url.searchParams.get("min_sendable")) || 1000;
    const maxSendable = parseInt(url.searchParams.get("max_sendable")) || 1000;
    const { UID: uid, LNURLW: lnurlw } = await request.json();
    const baseUrl = `${url.protocol}//${url.host}`;

    if (!uid && !lnurlw) {
      return errorResponse("Must provide UID for programming, or LNURLW for reset");
    }

    if ((onExisting === "UpdateVersion" || (!onExisting && uid && !lnurlw)) && uid) {
      if (cardType === "pos" && !lightningAddress) {
        return errorResponse("POS card programming requires lightning_address parameter");
      }
      return handleProgrammingFlow(uid, env, baseUrl, cardType, lightningAddress, minSendable, maxSendable);
    }

    if ((onExisting === "KeepVersion" || (!onExisting && lnurlw)) && lnurlw) {
      return handleResetFlow(lnurlw, env, baseUrl);
    }

    if (onExisting === "KeepVersion" && uid && !lnurlw) {
      return generateKeyResponse(uid, env, baseUrl);
    }

    if (onExisting === "UpdateVersion" && !uid) {
      return errorResponse("Programming flow requires UID in request body");
    }

    return errorResponse("Must provide UID for programming, or LNURLW for reset");
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

async function handleProgrammingFlow(uid, env, baseUrl, cardType, lightningAddress, minSendable, maxSendable) {
  const normalizedUid = uid.toLowerCase();
  await resetReplayProtection(env, normalizedUid);

  if (env?.UID_CONFIG) {
    const keys = await getDeterministicKeys(normalizedUid, env);

    let config;
    if (cardType === "pos") {
      config = {
        K2: keys.k2,
        payment_method: "lnurlpay",
        lnurlpay: {
          lightning_address: lightningAddress,
          min_sendable: minSendable,
          max_sendable: maxSendable,
        },
      };
    } else if (cardType === "2fa") {
      config = {
        K2: keys.k2,
        payment_method: "twofactor",
      };
    } else {
      config = {
        K2: keys.k2,
        payment_method: "fakewallet",
      };
    }

    if (config) {
      await env.UID_CONFIG.put(normalizedUid, JSON.stringify(config));
    }
  }

  return generateKeyResponse(normalizedUid, env, baseUrl, cardType);
}

async function handleResetFlow(lnurlw, env, baseUrl) {
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
      return errorResponse("K2 key not available for CMAC validation during reset flow");
    }

    // Step 3: Validate CMAC with the card's K2 key
    // (NXP AN12196 §5.8 steps 4-8)
    const k2Bytes = hexToBytes(config.K2);
    const validation = decodeAndValidate(pHex, cHex, env, k2Bytes);
    if (!validation.cmac_validated) {
      return errorResponse(validation.cmac_error || "CMAC validation failed");
    }

    await resetReplayProtection(env, uidHex);
    return generateKeyResponse(uidHex, env, baseUrl);
  } catch (err) {
    return errorResponse("Error in generating keys: " + err.message, 500);
  }
}

// Generates the new_bolt_card_response payload expected by the NFC programmer app.
// Contains all 5 AES keys (K0-K4) and the LNURLW base URL for the NDEF template.
async function generateKeyResponse(uid, env, baseUrl, cardType = "withdraw") {
  const version = 1;
  const keys = await getDeterministicKeys(uid, env, version);
  const host = baseUrl || "https://boltcardpoc.psbt.me";
  const hostPart = host.replace(/^https?:\/\//, "");

  let scheme;
  let path;
  if (cardType === "2fa") {
    scheme = "https://";
    path = `${hostPart}/2fa`;
  } else if (cardType === "pos") {
    scheme = "lnurlp://";
    path = `${hostPart}/`;
  } else {
    scheme = "lnurlw://";
    path = `${hostPart}/`;
  }

  return jsonResponse({
    CARD_NAME: `UID ${uid.toUpperCase()}`,
    ID: "1",
    K0: keys.k0,
    K1: keys.k1,
    K2: keys.k2,
    K3: keys.k3,
    K4: keys.k4,
    LNURLW_BASE: `${scheme}${path}`,
    LNURLW: `${scheme}${path}`,
    PROTOCOL_NAME: "NEW_BOLT_CARD_RESPONSE",
    PROTOCOL_VERSION: "1",
  });
}
