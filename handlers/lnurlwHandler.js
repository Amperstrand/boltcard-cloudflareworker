import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { handleProxy } from "./proxyHandler.js";
import { constructWithdrawResponse } from "./withdrawHandler.js";
import { constructPayRequest } from "./lnurlPayHandler.js";
import { hexToBytes } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { logger } from "../utils/logger.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { recordTapRead, getCardState, activateCard, checkAndAdvanceCounter } from "../replayProtection.js";
import { getRequestOrigin } from "../utils/validation.js";
import { cmacScanVersions } from "../utils/cmacScan.js";
import { CARD_STATE, PAYMENT_METHOD, VERSION_SCAN_RANGE } from "../utils/constants.js";

async function detectCardVersion(uidHex, ctr, cHex, env, latestVersion) {
  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);
  const { matchedVersion } = await cmacScanVersions(uidBytes, ctrBytes, cHex, {
    k2ForVersion: (v) => hexToBytes(getDeterministicKeys(uidHex, env, v).k2),
    highVersion: latestVersion,
    lowVersion: Math.max(1, latestVersion - VERSION_SCAN_RANGE),
  });
  return matchedVersion;
}

async function checkReplayAndRecordTap(env, uidHex, counterValue, request, fireAndForget = true) {
  try {
    const replayResult = await checkAndAdvanceCounter(env, uidHex, counterValue);
    if (!replayResult.accepted) {
      logger.warn("Counter replay detected", { uidHex, counterValue });
      return { ok: false, response: errorResponse(replayResult.reason || "Counter replay detected — tap rejected") };
    }
  } catch (error) {
    logger.error("Replay protection check failed", { uidHex, counterValue, error: error.message });
    return { ok: false, response: errorResponse("Replay protection unavailable", 500) };
  }

  logger.info("LNURLW request accepted", { uidHex, counterValue });
  const tapPromise = recordTapRead(env, uidHex, counterValue, {
    userAgent: request.headers.get("User-Agent") || null,
    requestUrl: request.url,
  });
  if (fireAndForget) {
    tapPromise.catch(e => logger.warn("recordTapRead failed", { uidHex, counterValue, error: e.message }));
  } else {
    await tapPromise;
  }
  return { ok: true };
}

export async function handleLnurlw(request, env) {
  const url = new URL(request.url);
  const { searchParams } = url;
  const pHex = searchParams.get("p");
  const cHex = searchParams.get("c");

  if (!pHex || !cHex) {
    logger.error("Missing required parameters", { pHex: !!pHex, cHex: !!cHex });
    return errorResponse("Missing required parameters: p and c are required");
  }

  logger.trace("LNURLW verification request", {
    hasP: Boolean(pHex),
    hasC: Boolean(cHex),
  });

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    logger.error("Failed to extract UID and counter", { error: decryption.error });
    return errorResponse(decryption.error);
  }

  const { uidHex, ctr } = decryption;

  if (!uidHex) {
    logger.error("UID is undefined after decryption", { pHex: "[REDACTED]", cHex: "[REDACTED]" });
    return errorResponse("Failed to extract UID from payload");
  }

  const counterValue = parseInt(ctr, 16);

  logger.info("LNURLW decrypted", { uidHex, counterValue });

  let cardState;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (error) {
    logger.error("Card state check failed", { uidHex, error: error.message });
    return errorResponse("Card state unavailable", 503);
  }

  if (cardState.state === CARD_STATE.TERMINATED) {
    return errorResponse("Card has been terminated. Re-activate to use.", 403);
  }

  let activeVersion;

  if (cardState.state === CARD_STATE.KEYS_DELIVERED) {
    activeVersion = await detectCardVersion(uidHex, ctr, cHex, env, cardState.latest_issued_version);
    if (activeVersion === null) {
      return errorResponse("Unable to verify card. Version mismatch.", 403);
    }
    try {
      await activateCard(env, uidHex, activeVersion);
    } catch (error) {
      logger.error("Card activation failed", { uidHex, activeVersion, error: error.message });
      return errorResponse("Card activation failed", 500);
    }
  } else if (cardState.state === CARD_STATE.ACTIVE) {
    activeVersion = cardState.active_version || 1;
  } else {
    activeVersion = 1;
  }

  const config = await getUidConfig(uidHex, env, activeVersion);
  logger.info("Card config loaded", {
    uidHex,
    paymentMethod: config?.payment_method,
    cardState: cardState.state,
    activeVersion,
  });

  if (!config) {
    logger.error("UID not found in configuration", { uidHex });
    return errorResponse("UID not found in config");
  }

  const proxyRelayMode = config.payment_method === PAYMENT_METHOD.PROXY && !!config.proxy?.baseurl;
  const hasK2 = typeof config.K2 === "string" && config.K2.length > 0;

  let cmac_validated = false;
  let cmac_error = null;

  if (hasK2) {
    ({ cmac_validated, cmac_error } = validate_cmac(
      hexToBytes(uidHex),
      hexToBytes(ctr),
      cHex,
      hexToBytes(config.K2)
    ));
  } else if (proxyRelayMode) {
    cmac_error = "CMAC validation deferred to downstream backend";
    logger.info("Proxy relay mode: CMAC deferred", { uidHex });
  } else {
    logger.error("K2 missing for payment method requiring local verification", {
      uidHex,
      paymentMethod: config.payment_method,
    });
    return errorResponse("K2 key not available for local CMAC validation");
  }

  if (hasK2 && !cmac_validated) {
    logger.warn(`CMAC validation failed: ${cmac_error || "CMAC validation failed."}`);
    return errorResponse(cmac_error || "CMAC validation failed");
  }

  if (proxyRelayMode) {
    const replay = await checkReplayAndRecordTap(env, uidHex, counterValue, request);
    if (!replay.ok) return replay.response;
    return handleProxy(request, uidHex, pHex, cHex, config.proxy.baseurl, {
      cmacValidated: cmac_validated,
      validationDeferred: !hasK2,
    });
  }

  if (config.payment_method === PAYMENT_METHOD.LNURLPAY) {
    const baseUrl = getRequestOrigin(request);
    recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("User-Agent") || null,
      requestUrl: request.url,
    }).catch(e => logger.warn("recordTapRead failed", { uidHex, counterValue, error: e.message }));
    return jsonResponse(constructPayRequest(uidHex, pHex, cHex, counterValue, baseUrl, config, env));
  }

  if (config.payment_method === PAYMENT_METHOD.CLNREST || config.payment_method === PAYMENT_METHOD.FAKEWALLET) {
    const replay = await checkReplayAndRecordTap(env, uidHex, counterValue, request);
    if (!replay.ok) return replay.response;
    const baseUrl = getRequestOrigin(request);
    const responsePayload = constructWithdrawResponse(uidHex, pHex, cHex, ctr, cmac_validated, baseUrl, config.payment_method);
    if (responsePayload.status === "ERROR") return errorResponse(responsePayload.reason);
    return jsonResponse(responsePayload);
  }

  logger.error("Unsupported payment method", { uidHex, paymentMethod: config.payment_method });
  return errorResponse(`Unsupported payment method: ${config.payment_method}`);
}
