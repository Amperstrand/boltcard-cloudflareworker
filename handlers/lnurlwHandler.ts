import { extractUIDAndCounter, validateCmac as verifyCardCmac } from "../boltCardHelper.js";
import type { CardStateRow } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import type { Env } from "../types/core.js";
import { getUidConfig } from "../getUidConfig.js";
import { handleProxy } from "./proxyHandler.js";
import { constructWithdrawResponse } from "./withdrawHandler.js";
import { constructPayRequest } from "./lnurlPayHandler.js";
import { hexToBytes } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { logger } from "../utils/logger.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { recordTapRead, getCardState, activateCard, checkAndAdvanceCounter, discoverCard, setCardK2, resolveActiveVersion } from "../replayProtection.js";
import { getRequestOrigin } from "../utils/validation.js";
import { cmacScanVersions } from "../utils/cmacScan.js";
import { classifyIssuerKey, getAllIssuerKeyCandidates } from "../utils/keyLookup.js";
import { CARD_STATE, PAYMENT_METHOD, VERSION_SCAN_RANGE, MISSING_PARAMS_MSG } from "../utils/constants.js";

async function detectCardVersion(uidHex: string, ctr: string, cHex: string, env: Env, latestVersion: number): Promise<number | null> {
  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);
  const { matchedVersion } = await cmacScanVersions(uidBytes, ctrBytes, cHex, {
    k2ForVersion: async (v: number) => hexToBytes(getDeterministicKeys(uidHex, env, v).k2),
    highVersion: latestVersion,
    lowVersion: Math.max(1, latestVersion - VERSION_SCAN_RANGE),
  });
  return matchedVersion;
}

async function discoverUnknownCard(uidHex: string, ctr: string, cHex: string, env: Env): Promise<{ version: number; provenance: any } | null> {
  const uidBytes = hexToBytes(uidHex);
  const ctrBytes = hexToBytes(ctr);
  const candidates: any[] = getAllIssuerKeyCandidates(env);

  for (const candidate of candidates) {
    for (let version = 1; version <= VERSION_SCAN_RANGE; version++) {
      try {
        const tempEnv: any = { ...env, ISSUER_KEY: candidate.hex };
        const k2 = getDeterministicKeys(uidHex, tempEnv, version).k2;
        const { matchedVersion } = await cmacScanVersions(uidBytes, ctrBytes, cHex, {
          k2ForVersion: async () => hexToBytes(k2),
          highVersion: version,
          lowVersion: version,
        });
        if (matchedVersion !== null) {
          const classified: any = classifyIssuerKey(env, candidate.hex);
          logger.info("Discovered unknown card", {
            uidHex,
            version: matchedVersion,
            provenance: classified.provenance,
            label: classified.label,
          });
          try {
            await discoverCard(env, uidHex, {
              key_provenance: classified.provenance,
              key_fingerprint: classified.fingerprint,
              key_label: classified.label,
              active_version: matchedVersion,
            });
          } catch (err: unknown) {
            logger.warn("Failed to persist card discovery", { uidHex, error: getErrorMessage(err) });
          }
          try {
            await setCardK2(env, uidHex, k2);
          } catch (err: unknown) {
            logger.warn("Failed to persist discovered card K2", { uidHex, error: getErrorMessage(err) });
          }
          return { version: matchedVersion, provenance: classified };
        }
      } catch (e: unknown) {
        continue;
      }
    }
  }
  return null;
}

async function checkReplayAndRecordTap(env: Env, uidHex: string, counterValue: number, request: Request, fireAndForget: boolean = true): Promise<{ ok: boolean; response?: Response }> {
  try {
    const replayResult: any = await checkAndAdvanceCounter(env, uidHex, counterValue);
    if (!replayResult.accepted) {
      logger.warn("Counter replay detected", { uidHex, counterValue });
      return { ok: false, response: jsonResponse({ status: "ERROR", reason: replayResult.reason || "Counter replay detected — tap rejected" }, 409) };
    }
  } catch (error: unknown) {
    logger.error("Replay protection check failed", { uidHex, counterValue, error: getErrorMessage(error) });
    return { ok: false, response: errorResponse("Replay protection unavailable", 500) };
  }

  logger.info("LNURLW request accepted", { uidHex, counterValue });
  const tapPromise = recordTapRead(env, uidHex, counterValue, {
    userAgent: request.headers.get("user-agent") || null,
    requestUrl: request.url,
  });
  if (fireAndForget) {
    tapPromise.catch((e: any) => logger.warn("recordTapRead failed", { uidHex, counterValue, error: getErrorMessage(e) }));
  } else {
    await tapPromise;
  }
  return { ok: true };
}

async function resolveCardVersion(uidHex: string, ctr: string, cHex: string, env: Env, cardState: CardStateRow): Promise<{ activeVersion?: number; error?: Response }> {
  if (cardState.state === CARD_STATE.KEYS_DELIVERED) {
    const activeVersion = await detectCardVersion(uidHex, ctr, cHex, env, cardState.latest_issued_version);
    if (activeVersion === null) {
      return { error: errorResponse("Unable to verify card. Version mismatch.", 403) };
    }
    try {
      await activateCard(env, uidHex, activeVersion);
    } catch (error: unknown) {
      logger.error("Card activation failed", { uidHex, activeVersion, error: getErrorMessage(error) });
      return { error: errorResponse("Card activation failed", 500) };
    }
    return { activeVersion };
  }

  if (cardState.state === CARD_STATE.ACTIVE || cardState.state === CARD_STATE.DISCOVERED) {
    return { activeVersion: resolveActiveVersion(cardState) };
  }

  if (cardState.state === CARD_STATE.PENDING) {
    const discovery = await discoverUnknownCard(uidHex, ctr, cHex, env);
    if (!discovery) {
      return { error: errorResponse("Unable to identify card key", 403) };
    }
    return { activeVersion: discovery.version };
  }

  const isNew = cardState.state === CARD_STATE.NEW || cardState.state === CARD_STATE.LEGACY;
  if (isNew) {
    const discovery = await discoverUnknownCard(uidHex, ctr, cHex, env);
    return { activeVersion: discovery ? discovery.version : 1 };
  }

  return { activeVersion: 1 };
}

function validateCmac(uidHex: string, ctr: string, cHex: string, config: any): { error?: Response; cmac_validated?: boolean; proxyRelayMode?: boolean } {
  const proxyRelayMode = config.payment_method === PAYMENT_METHOD.PROXY && !!config.proxy?.baseurl;
  const hasK2 = typeof config.K2 === "string" && config.K2.length > 0;

  let cmac_validated = false;
  let cmac_error: string | null = null;

  if (hasK2) {
    ({ cmac_validated, cmac_error } = verifyCardCmac(
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
    return { error: errorResponse("K2 key not available for local CMAC validation", 500) };
  }

  if (hasK2 && !cmac_validated) {
    logger.warn(`CMAC validation failed: ${cmac_error || "CMAC validation failed."}`);
    return { error: errorResponse(cmac_error || "CMAC validation failed", 403) };
  }

  return { cmac_validated, proxyRelayMode };
}

async function routeByPaymentMethod(request: Request, env: Env, uidHex: string, pHex: string, cHex: string, ctr: string, counterValue: number, config: any, cmac_validated: boolean, proxyRelayMode: boolean): Promise<Response> {
  if (proxyRelayMode) {
    const replay = await checkReplayAndRecordTap(env, uidHex, counterValue, request);
    if (!replay.ok) return replay.response!;
    return handleProxy(request, uidHex, pHex, cHex, config.proxy.baseurl, {
      cmacValidated: cmac_validated,
      validationDeferred: !config.K2,
    });
  }

  if (config.payment_method === PAYMENT_METHOD.LNURLPAY) {
    const baseUrl = getRequestOrigin(request);
    recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("user-agent") || null,
      requestUrl: request.url,
    }).catch((e: any) => logger.warn("recordTapRead failed", { uidHex, counterValue, error: getErrorMessage(e) }));
    return jsonResponse(constructPayRequest(uidHex, pHex, cHex, counterValue, baseUrl, config, env));
  }

  if (config.payment_method === PAYMENT_METHOD.CLNREST || config.payment_method === PAYMENT_METHOD.FAKEWALLET) {
    const replay = await checkReplayAndRecordTap(env, uidHex, counterValue, request);
    if (!replay.ok) return replay.response!;
    const baseUrl = getRequestOrigin(request);
    const responsePayload: any = constructWithdrawResponse(uidHex, pHex, cHex, ctr, cmac_validated, baseUrl, config.payment_method);
    if (responsePayload.status === "ERROR") return errorResponse(responsePayload.reason, 403);
    return jsonResponse(responsePayload);
  }

  logger.error("Unsupported payment method", { uidHex, paymentMethod: config.payment_method });
  return errorResponse(`Unsupported payment method: ${config.payment_method}`, 400);
}

export async function handleLnurlw(request: Request, env: Env): Promise<Response> {
  try {
  const url = new URL(request.url);
  const { searchParams } = url;
  const pHex = searchParams.get("p");
  const cHex = searchParams.get("c");

  if (!pHex || !cHex) {
    logger.error("Missing required parameters", { pHex: !!pHex, cHex: !!cHex });
    return errorResponse(MISSING_PARAMS_MSG);
  }

  const decryption: any = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    logger.error("Failed to extract UID and counter", { error: decryption.error });
    return errorResponse(decryption.error);
  }

  const { uidHex: rawUid, ctr } = decryption;

  if (!rawUid) {
    logger.error("UID is undefined after decryption", { pHex: "[REDACTED]", cHex: "[REDACTED]" });
    return errorResponse("Failed to extract UID from payload", 400);
  }

  const uidHex: string = rawUid.toLowerCase();

  const counterValue: number = parseInt(ctr, 16);

  logger.info("LNURLW decrypted", { uidHex, counterValue });

  let cardState: CardStateRow;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (error: unknown) {
    logger.error("Card state check failed", { uidHex, error: getErrorMessage(error) });
    return errorResponse("Card state unavailable", 503);
  }

  if (cardState.state === CARD_STATE.TERMINATED) {
    return errorResponse("Card has been terminated. Re-activate to use.", 403);
  }

  const versionResult = await resolveCardVersion(uidHex, ctr, cHex, env, cardState);
  if (versionResult.error) return versionResult.error;
  const { activeVersion } = versionResult;

  const config: any = await getUidConfig(uidHex, env, activeVersion!);
  logger.info("Card config loaded", {
    uidHex,
    paymentMethod: config?.payment_method,
    cardState: cardState.state,
    activeVersion,
  });

  if (!config) {
    logger.error("UID not found in configuration", { uidHex });
    return errorResponse("UID not found in config", 404);
  }

  const cmacResult = validateCmac(uidHex, ctr, cHex, config);
  if (cmacResult.error) return cmacResult.error;

  return await routeByPaymentMethod(request, env, uidHex, pHex, cHex, ctr, counterValue, config, cmacResult.cmac_validated!, cmacResult.proxyRelayMode!);

  } catch (err: unknown) {
    logger.error("Unhandled error in handleLnurlw", { error: getErrorMessage(err) });
    return errorResponse("Internal error", 500);
  }
}
