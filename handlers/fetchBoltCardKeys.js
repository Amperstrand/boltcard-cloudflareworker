import { getDeterministicKeys } from "../keygenerator.js";
import { decodeAndValidate } from "../boltCardHelper.js";
import { extractUIDAndCounter } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { resetReplayProtection, getCardState, deliverKeys, terminateCard } from "../replayProtection.js";
import { jsonResponse, buildBoltCardResponse } from "../utils/responses.js";

const errorResponse = (error, status = 400) => jsonResponse({ error }, status);

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
      return errorResponse("KeepVersion with UID requires card tap (LNURLW)");
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

  const cardState = await getCardState(env, normalizedUid);

  if (cardState.state === "active") {
    return errorResponse("Card is active. Terminate (wipe) the card before reprogramming.", 409);
  }
  if (cardState.state === "keys_delivered") {
    return errorResponse("Keys already delivered for this activation cycle. Write the card and tap to activate.", 409);
  }

  const delivered = await deliverKeys(env, normalizedUid);
  const version = typeof delivered === "number"
    ? delivered
    : delivered?.version ?? delivered?.latest_issued_version ?? delivered?.active_version;

  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Invalid version returned from key delivery");
  }

  await resetReplayProtection(env, normalizedUid);

  const keys = await getDeterministicKeys(normalizedUid, env, version);

  if (env?.UID_CONFIG) {
    let config;
    if (cardType === "pos") {
      config = {
        K2: keys.k2,
        version,
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
        version,
        payment_method: "twofactor",
      };
    } else {
      config = {
        K2: keys.k2,
        version,
        payment_method: "fakewallet",
      };
    }

    await env.UID_CONFIG.put(normalizedUid, JSON.stringify(config));
  }

  return generateKeyResponse(normalizedUid, env, baseUrl, cardType, version);
}

async function handleResetFlow(lnurlw, env, baseUrl) {
  try {
    const lnurl = new URL(lnurlw);
    const pHex = lnurl.searchParams.get("p");
    const cHex = lnurl.searchParams.get("c");

    if (!pHex || !cHex) {
      return errorResponse("Invalid LNURLW format: missing 'p' or 'c'");
    }

    const decryption = extractUIDAndCounter(pHex, env);
    if (!decryption.success) return errorResponse(decryption.error);
    const { uidHex } = decryption;

    const cardState = await getCardState(env, uidHex);

    if (cardState.state !== "active" && cardState.state !== "terminated" && cardState.state !== "new") {
      return errorResponse("Card must be active or terminated to retrieve wipe keys");
    }

    const wipeVersion = cardState.active_version || 1;
    const config = await getUidConfig(uidHex, env, wipeVersion);

    if (!config) {
      return errorResponse("UID not found in config");
    }

    if (!config.K2) {
      return errorResponse("K2 key not available for CMAC validation during reset flow");
    }

    const k2Bytes = hexToBytes(config.K2);
    const validation = decodeAndValidate(pHex, cHex, env, k2Bytes);
    if (!validation.cmac_validated) {
      return errorResponse(validation.cmac_error || "CMAC validation failed");
    }

    if (cardState.state === "active") {
      await terminateCard(env, uidHex);
    }

    return generateKeyResponse(uidHex, env, baseUrl, "withdraw", wipeVersion);
  } catch (err) {
    return errorResponse("Error in generating keys: " + err.message, 500);
  }
}

async function generateKeyResponse(uid, env, baseUrl, cardType = "withdraw", version = 1) {
  const keys = await getDeterministicKeys(uid, env, version);
  const host = baseUrl || "https://boltcardpoc.psbt.me";
  const hostPart = host.replace(/^https?:\/\//, "");

  const response = buildBoltCardResponse(keys, uid, host, version);

  if (cardType === "2fa") {
    response.LNURLW_BASE = `https://${hostPart}/2fa`;
    response.LNURLW = `https://${hostPart}/2fa`;
  } else if (cardType === "pos") {
    response.LNURLW_BASE = `lnurlp://${hostPart}/`;
    response.LNURLW = `lnurlp://${hostPart}/`;
  }

  return jsonResponse(response);
}
