import { getUidConfig } from "../getUidConfig.js";
import type { CardStateRow, CardConfig, BoltCardKeys, Env } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import { renderLoginPage } from "../templates/loginPage.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { deriveKeysFromHex } from "../keygenerator.js";
import { getCardState, recordTapRead, safeGetBalance } from "../replayProtection.js";
import { getRequestOrigin } from "../utils/validation.js";
import { DEFAULT_PULL_PAYMENT_ID, CARD_STATE, PAYMENT_METHOD, UID_VALIDATION_MSG } from "../utils/constants.js";
import { getUnifiedHistory } from "../utils/history.js";
import { handleTerminateAction, handleRequestWipeAction, handleTopUpAction, getCardProgrammingEndpoint, normalizeSubmittedUid } from "./loginActions.js";
import { matchCardIssuer } from "../utils/cardMatching.js";
import type { MatchResult } from "../utils/cardMatching.js";
import { requireOperator } from "../middleware/operatorAuth.js";

export function handleLoginPage(request: Request): Response {
  const host = getRequestOrigin(request);
  const defaultProgrammingEndpoint = `${host}/api/v1/pull-payments/${DEFAULT_PULL_PAYMENT_ID}/boltcards?onExisting=UpdateVersion`;
  return htmlResponse(renderLoginPage({ host, defaultProgrammingEndpoint }));
}

export async function handleLoginVerify(request: Request, env: Env): Promise<Response> {
  try {
    const body: Record<string, unknown> | null = await parseJsonBody(request);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const { p: pHex, c: cHex, uid: rawUid } = body as { p?: string; c?: string; uid?: string; action?: string; amount?: string };
    const requestOrigin = getRequestOrigin(request);

    if (rawUid && !pHex && !cHex) {
      const action = (body as Record<string, unknown>).action;
      const privilegedActions = ["request-wipe", "terminate", "top-up"];
      if (privilegedActions.includes(action as string)) {
        const auth = requireOperator(request, env);
        if (!auth.authorized) {
          return errorResponse("Operator authentication required", 401);
        }
      }
      if (action === "request-wipe") {
        return await handleRequestWipeAction(rawUid, env, request);
      }
      if (action === "terminate") {
        return await handleTerminateAction(rawUid, env, request);
      }
      if (action === "top-up") {
        return handleTopUpAction(body.uid as string, body.amount as string, env);
      }
      return await handleUidOnlyLogin(rawUid, env, request);
    }

    if (!pHex || !cHex) {
      return errorResponse("Missing p or c", 400);
    }

    const result: MatchResult = await matchCardIssuer(pHex, cHex, env);

    if (!result.matched && !result.issuerKey) {
      return errorResponse("Could not decrypt card with any known key", 400);
    }

    if (!result.uidHex || !result.ctr) {
      return errorResponse("Card decryption incomplete", 400);
    }

    let matchedKeys: BoltCardKeys;
    let matchedVersion: number;
    let perCardSource: string | null = null;

    if (result.matched && result.perCardOverride && result.perCard) {
      const perCard = result.perCard;
      const baseKeys = deriveKeysFromHex(result.uidHex!, result.issuerKey!, result.latestVersion ?? 1);
      matchedKeys = {
        k0: perCard.k0 || baseKeys.k0,
        k1: perCard.k1,
        k2: perCard.k2,
        k3: perCard.k3 || baseKeys.k3,
        k4: perCard.k4 || baseKeys.k4,
      };
      matchedVersion = result.matchedVersion ?? 1;
      perCardSource = result.perCardSource ?? null;
    } else if (result.matched) {
      matchedKeys = deriveKeysFromHex(result.uidHex, result.issuerKey!, result.matchedVersion ?? 1);
      matchedVersion = result.matchedVersion ?? 1;
    } else {
      matchedKeys = deriveKeysFromHex(result.uidHex, result.issuerKey!, result.latestVersion ?? 1);
      matchedVersion = result.latestVersion ?? 1;
    }

    const matchedIssuer: { hex: string; label: string | undefined } | null = result.issuerKey ? { hex: result.issuerKey, label: result.issuerLabel } : null;
    const matchedCmacValid: boolean = result.cmacValid ?? false;
    const debugInfo: { versionScan: Array<{ version: number; cmac_validated: boolean }> } = { versionScan: result.versionAttempts || [] };
    const keyVersion: number = result.matchedVersion || result.latestVersion || 1;

    const uidHex: string = result.uidHex;
    const counterValue: number = parseInt(result.ctr, 16);

    const config = await getUidConfig(uidHex, env) as CardConfig | null;
    const pm: string = config?.payment_method || "unknown";

    let cardState: CardStateRow;
    try {
      cardState = await getCardState(env, uidHex);
    } catch (err: unknown) {
      logger.error("Card state unavailable during NFC login", { uidHex, error: getErrorMessage(err) });
      return errorResponse("Card state unavailable", 503);
    }
    const { cardConfig, programmingEndpoint }: { cardConfig: CardConfig | null; programmingEndpoint: string } = await getCardProgrammingEndpoint(env, uidHex, requestOrigin);
    const hasDoConfig: boolean = cardConfig !== null;
    const deployed: boolean = hasDoConfig || !!perCardSource;

    const path: string = pm === PAYMENT_METHOD.TWOFACTOR ? "/2fa" : "/";
    const ndefUrl: string = `${requestOrigin}${path}?p=${pHex}&c=${cHex}`;

    logger.info("NFC login", {
      uidHex,
      counterValue,
      cardType: pm,
      issuerKey: matchedIssuer?.label,
      cmacValid: matchedCmacValid,
      perCardSource,
      deployed,
      keyVersion,
    });

    const tapHistory: Awaited<ReturnType<typeof getUnifiedHistory>> = await getUnifiedHistory(env, uidHex);

    const balanceData: { balance: number } = await safeGetBalance(env, uidHex);

    recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("user-agent"),
      requestUrl: request.url,
    }).catch((e: unknown) => logger.warn("Failed to record login tap", { uidHex, counterValue, error: getErrorMessage(e) }));

    return jsonResponse({
      success: true,
      uidHex,
      counterValue,
      cardType: pm,
      cmacValid: matchedCmacValid,
      issuerKey: matchedIssuer?.label,
      k0: matchedKeys.k0,
      k1: matchedKeys.k1,
      k2: matchedKeys.k2,
      k3: matchedKeys.k3,
      k4: matchedKeys.k4,
      ndef: ndefUrl,
      compromised: !!perCardSource,
      public: !!perCardSource,
      deployed,
      cardState: cardState?.state || CARD_STATE.NEW,
      balance: balanceData.balance,
      programmingEndpoint: cardState?.state === CARD_STATE.KEYS_DELIVERED ? programmingEndpoint : undefined,
      keysDeliveredAt: cardState?.keys_delivered_at || null,
      keyVersion,
      debug: {
        versionsTried: debugInfo.versionScan,
        matchedVersion: matchedVersion,
        issuerKey: matchedIssuer?.label || null,
      },
      timestamp: Date.now(),
      tapHistory,
    });
  } catch (error: unknown) {
    logger.error("Login verification error", { error: getErrorMessage(error) });
    return errorResponse("Internal error", 500);
  }
}

async function handleUidOnlyLogin(rawUid: string, env: Env, request: Request): Promise<Response> {
  const requestOrigin = getRequestOrigin(request);
  const uidHex: string | null = normalizeSubmittedUid(rawUid);
  if (!uidHex) {
    return errorResponse(UID_VALIDATION_MSG, 400);
  }

  let cardState: CardStateRow;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (err: unknown) {
    logger.error("Card state unavailable during UID-only login", { uidHex, error: getErrorMessage(err) });
    return errorResponse("Card state unavailable", 503);
  }
  const { cardConfig, programmingEndpoint }: { cardConfig: CardConfig | null; programmingEndpoint: string } = await getCardProgrammingEndpoint(env, uidHex, requestOrigin);
  const hasDoConfig: boolean = cardConfig !== null;
  const config = await getUidConfig(uidHex, env) as CardConfig | null;
  const pm: string = config?.payment_method || PAYMENT_METHOD.FAKEWALLET;

  let keyVersion: number = 1;
  let keys: ReturnType<typeof deriveKeysFromHex>;
  if (!env.ISSUER_KEY) {
    return errorResponse("Not configured: missing issuer key", 500);
  }
  if (hasDoConfig && cardState?.active_version) {
    keyVersion = cardState.active_version;
    keys = deriveKeysFromHex(uidHex, env.ISSUER_KEY, keyVersion);
  } else {
    keys = deriveKeysFromHex(uidHex, env.ISSUER_KEY, 1);
  }

  const ndefUrl: null = null;

  logger.info("NFC login (UID-only, undeployed)", { uidHex, deployed: hasDoConfig, keyVersion });

  const tapHistory: Awaited<ReturnType<typeof getUnifiedHistory>> = await getUnifiedHistory(env, uidHex);

  const balanceData: { balance: number } = await safeGetBalance(env, uidHex);

  recordTapRead(env, uidHex, null, {
    userAgent: request.headers.get("user-agent"),
    requestUrl: request.url,
  }).catch((e: unknown) => logger.warn("Failed to record UID-only login tap", { uidHex, error: getErrorMessage(e) }));

  return jsonResponse({
    success: true,
    uidHex,
    counterValue: null,
    cardType: pm,
    cmacValid: false,
    deployed: hasDoConfig,
    cardState: cardState?.state || CARD_STATE.NEW,
    awaitingProgramming: cardState?.state === CARD_STATE.KEYS_DELIVERED,
    balance: balanceData.balance,
    keysDeliveredAt: cardState?.keys_delivered_at || null,
    programmingEndpoint,
    keyVersion,
    k0: keys.k0,
    k1: keys.k1,
    k2: keys.k2,
    k3: keys.k3,
    k4: keys.k4,
    ndef: ndefUrl,
    compromised: false,
    public: false,
    timestamp: Date.now(),
    tapHistory,
  });
}
