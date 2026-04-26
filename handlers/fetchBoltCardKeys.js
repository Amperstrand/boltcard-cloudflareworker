import { getDeterministicKeys } from "../keygenerator.js";
import { decodeAndValidate, extractUIDAndCounter } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { resetReplayProtection, getCardState, deliverKeys, setCardConfig, requestWipe } from "../replayProtection.js";
import { jsonResponse, buildBoltCardResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getRequestOrigin, validateUid } from "../utils/validation.js";
import { DEFAULT_PULL_PAYMENT_ID, DEFAULT_FALLBACK_HOST, CARD_STATE, PAYMENT_METHOD } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

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
    const body = await parseJsonBody(request).catch(() => null);
    if (!body) return errorResponse("Invalid JSON body", 400);
    const { UID: uid, LNURLW: lnurlw } = body;
    const baseUrl = getRequestOrigin(request);

    if (!uid && !lnurlw) {
      return errorResponse("Must provide UID for programming, or LNURLW for reset");
    }

    if ((onExisting === "UpdateVersion" || (!onExisting && uid && !lnurlw)) && uid) {
      if (!validateUid(uid)) {
        return errorResponse("Invalid UID: must be exactly 14 hex characters", 400);
      }
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
    logger.error("fetchBoltCardKeys error", { error: err.message });
    return errorResponse("Internal error", 500);
  }
}

async function handleProgrammingFlow(uid, env, baseUrl, cardType, lightningAddress, minSendable, maxSendable) {
  const normalizedUid = uid.toLowerCase();
  const defaultPullPaymentId = env.DEFAULT_PULL_PAYMENT_ID || DEFAULT_PULL_PAYMENT_ID;

  const cardState = await getCardState(env, normalizedUid);

  if (cardState.state === CARD_STATE.ACTIVE) {
    return errorResponse("Card is active. Terminate (wipe) the card before reprogramming.", 409);
  }
  if (cardState.state === CARD_STATE.KEYS_DELIVERED) {
    // Card provisioned but not yet written — re-deliver same keys (idempotent)
    const version = cardState.latest_issued_version || 1;
    return generateKeyResponse(normalizedUid, env, baseUrl, cardType, version);
  }

  const delivered = await deliverKeys(env, normalizedUid);
  const version = typeof delivered === "number"
    ? delivered
    : delivered?.version ?? delivered?.latest_issued_version ?? delivered?.active_version;

  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Invalid version returned from key delivery");
  }

  await setCardConfig(env, normalizedUid, {
    pull_payment_id: defaultPullPaymentId,
  });

  await resetReplayProtection(env, normalizedUid);

  const keys = getDeterministicKeys(normalizedUid, env, version);

  let config;
  if (cardType === "pos") {
    config = {
      K2: keys.k2,
      payment_method: PAYMENT_METHOD.LNURLPAY,
      lnurlpay: {
        lightning_address: lightningAddress,
        min_sendable: minSendable,
        max_sendable: maxSendable,
      },
    };
  } else if (cardType === "2fa") {
    config = {
      K2: keys.k2,
      payment_method: PAYMENT_METHOD.TWOFACTOR,
    };
  } else {
    config = {
      K2: keys.k2,
      payment_method: PAYMENT_METHOD.FAKEWALLET,
    };
  }

  config.pull_payment_id = defaultPullPaymentId;

  await setCardConfig(env, normalizedUid, config);

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

    if (cardState.state !== CARD_STATE.ACTIVE && cardState.state !== CARD_STATE.TERMINATED && cardState.state !== CARD_STATE.NEW && cardState.state !== CARD_STATE.WIPE_REQUESTED) {
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

  if (cardState.state === CARD_STATE.ACTIVE) {
      await requestWipe(env, uidHex);
    }

    return generateKeyResponse(uidHex, env, baseUrl, "withdraw", wipeVersion);
  } catch (err) {
    logger.error("fetchBoltCardKeys reset flow error", { error: err.message });
    return errorResponse("Internal error", 500);
  }
}

async function generateKeyResponse(uid, env, baseUrl, cardType = "withdraw", version = 1) {
  const keys = getDeterministicKeys(uid, env, version);
  const host = baseUrl || DEFAULT_FALLBACK_HOST;
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
