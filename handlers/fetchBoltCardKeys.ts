import { getDeterministicKeys } from "../keygenerator.js";
import type { CardStateRow } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { decodeAndValidate, extractUIDAndCounter } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { resetReplayProtection, getCardState, deliverKeys, setCardConfig, requestWipe, markPending, resolveLatestVersion, resolveActiveVersion } from "../replayProtection.js";
import { jsonResponse, buildBoltCardResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getRequestOrigin, validateUid } from "../utils/validation.js";
import { DEFAULT_PULL_PAYMENT_ID, DEFAULT_FALLBACK_HOST, CARD_STATE, PAYMENT_METHOD, UID_VALIDATION_MSG } from "../utils/constants.js";
import { classifyIssuerKey } from "../utils/keyLookup.js";
import { logger } from "../utils/logger.js";

const UID_OR_LNURLW_REQUIRED = "Must provide UID for programming, or LNURLW for reset";

export async function fetchBoltCardKeys(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse("Only POST allowed", 405);
  }

  try {
    const url = new URL(request.url);
    const onExisting: string | null = url.searchParams.get("onExisting");
    const cardType: string = url.searchParams.get("card_type") || "withdraw";
    const lightningAddress: string = url.searchParams.get("lightning_address") || "";
    const minSendable: number = parseInt(url.searchParams.get("min_sendable") || "") || 1000;
    const maxSendable: number = parseInt(url.searchParams.get("max_sendable") || "") || 1000;
    const body: any = await parseJsonBody(request);
    if (!body) return errorResponse("Invalid JSON body", 400);
    const { UID: uid, LNURLW: lnurlw }: { UID?: string; LNURLW?: string } = body;
    const baseUrl: string = getRequestOrigin(request);

    if (!uid && !lnurlw) {
      return errorResponse(UID_OR_LNURLW_REQUIRED, 400);
    }

    if ((onExisting === "UpdateVersion" || (!onExisting && uid && !lnurlw)) && uid) {
      if (!validateUid(uid)) {
        return errorResponse(UID_VALIDATION_MSG, 400);
      }
      if (cardType === "pos" && !lightningAddress) {
        return errorResponse("POS card programming requires lightning_address parameter", 400);
      }
      return handleProgrammingFlow(uid, env, baseUrl, cardType, lightningAddress, minSendable, maxSendable);
    }

    if ((onExisting === "KeepVersion" || (!onExisting && lnurlw)) && lnurlw) {
      return handleResetFlow(lnurlw, env, baseUrl);
    }

    if (onExisting === "KeepVersion" && uid && !lnurlw) {
      return errorResponse("KeepVersion with UID requires card tap (LNURLW)", 400);
    }

    if (onExisting === "UpdateVersion" && !uid) {
      return errorResponse("Programming flow requires UID in request body", 400);
    }

    return errorResponse(UID_OR_LNURLW_REQUIRED, 400);
  } catch (err: unknown) {
    logger.error("fetchBoltCardKeys error", { error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }
}

async function handleProgrammingFlow(uid: string, env: Env, baseUrl: string, cardType: string, lightningAddress: string, minSendable: number, maxSendable: number): Promise<Response> {
  const normalizedUid: string = uid.toLowerCase();
  const defaultPullPaymentId: string = env.DEFAULT_PULL_PAYMENT_ID || DEFAULT_PULL_PAYMENT_ID;

  let cardState: CardStateRow;
  try {
    cardState = await getCardState(env, normalizedUid);
  } catch (err: unknown) {
    logger.error("Failed to get card state during programming", { uid: normalizedUid, error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }

  if (cardState.state === CARD_STATE.ACTIVE) {
    return errorResponse("Card is active. Terminate (wipe) the card before reprogramming.", 409);
  }
  if (cardState.state === CARD_STATE.KEYS_DELIVERED) {
    const version: number = resolveLatestVersion(cardState);
    return generateKeyResponse(normalizedUid, env, baseUrl, cardType, version);
  }

  if (cardState.state === CARD_STATE.NEW || cardState.state === CARD_STATE.LEGACY || cardState.state === CARD_STATE.PENDING || cardState.state === CARD_STATE.DISCOVERED) {
    const classified: any = classifyIssuerKey(env, env.ISSUER_KEY);
    try {
      await markPending(env, normalizedUid, {
        key_provenance: classified.provenance,
        key_fingerprint: classified.fingerprint,
        key_label: classified.label,
      });
    } catch (err: unknown) {
      logger.warn("Failed to mark pending during programming", { uid: normalizedUid, error: getErrorMessage(err) });
    }
  }

  let version: number;
  try {
    const delivered: any = await deliverKeys(env, normalizedUid);
    version = typeof delivered === "number"
      ? delivered
      : delivered?.version ?? delivered?.latest_issued_version ?? delivered?.active_version;

    if (!Number.isInteger(version) || version < 1) {
      throw new Error("Invalid version returned from key delivery");
    }

    await setCardConfig(env, normalizedUid, {
      pull_payment_id: defaultPullPaymentId,
    });

    await resetReplayProtection(env, normalizedUid);
  } catch (err: unknown) {
    logger.error("Programming flow: key delivery or config failed", { uid: normalizedUid, error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }

  const keys: any = getDeterministicKeys(normalizedUid, env, version);

  let config: Record<string, any>;
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

  try {
    await setCardConfig(env, normalizedUid, config);
  } catch (err: unknown) {
    logger.error("Programming flow: final config set failed", { uid: normalizedUid, error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }

  return generateKeyResponse(normalizedUid, env, baseUrl, cardType, version);
}

async function handleResetFlow(lnurlw: string, env: Env, baseUrl: string): Promise<Response> {
  try {
    const lnurl = new URL(lnurlw);
    const pHex: string | null = lnurl.searchParams.get("p");
    const cHex: string | null = lnurl.searchParams.get("c");

    if (!pHex || !cHex) {
      return errorResponse("Invalid LNURLW format: missing 'p' or 'c'", 400);
    }

    const decryption: any = extractUIDAndCounter(pHex, env);
    if (!decryption.success) return errorResponse(decryption.error, 400);
    const { uidHex }: { uidHex: string } = decryption;

    const cardState: CardStateRow = await getCardState(env, uidHex);

    if (cardState.state !== CARD_STATE.ACTIVE && cardState.state !== CARD_STATE.TERMINATED && cardState.state !== CARD_STATE.NEW && cardState.state !== CARD_STATE.WIPE_REQUESTED) {
      return errorResponse("Card must be active or terminated to retrieve wipe keys", 409);
    }

    const wipeVersion: number = resolveActiveVersion(cardState);
    const config: any = await getUidConfig(uidHex, env, wipeVersion);

    if (!config) {
      return errorResponse("UID not found in config", 404);
    }

    if (!config.K2) {
      return errorResponse("K2 key not available for CMAC validation during reset flow", 500);
    }

    const k2Bytes: Uint8Array = hexToBytes(config.K2);
    const validation: any = decodeAndValidate(pHex, cHex, env, k2Bytes);
    if (!validation.cmac_validated) {
      return errorResponse(validation.cmac_error || "CMAC validation failed", 403);
    }

    if (cardState.state === CARD_STATE.ACTIVE) {
      await requestWipe(env, uidHex);
    }

    return generateKeyResponse(uidHex, env, baseUrl, "withdraw", wipeVersion);
  } catch (err: unknown) {
    logger.error("fetchBoltCardKeys reset flow error", { error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }
}

async function generateKeyResponse(uid: string, env: Env, baseUrl: string, cardType: string = "withdraw", version: number = 1): Promise<Response> {
  const keys: any = getDeterministicKeys(uid, env, version);
  const host: string = baseUrl || DEFAULT_FALLBACK_HOST;
  const hostPart: string = host.replace(/^https?:\/\//, "");

  const response: Record<string, any> = buildBoltCardResponse(keys, uid, host, version);

  if (cardType === "2fa") {
    response.LNURLW_BASE = `https://${hostPart}/2fa`;
    response.LNURLW = `https://${hostPart}/2fa`;
  } else if (cardType === "pos") {
    response.LNURLW_BASE = `lnurlp://${hostPart}/`;
    response.LNURLW = `lnurlp://${hostPart}/`;
  }

  return jsonResponse(response);
}
