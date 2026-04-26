import { getUidConfig } from "../getUidConfig.js";
import { renderLoginPage } from "../templates/loginPage.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { deriveKeysFromHex } from "../keygenerator.js";
import { getCardState, getCardConfig, recordTapRead, getBalance } from "../replayProtection.js";
import { getRequestOrigin } from "../utils/validation.js";
import { DEFAULT_PULL_PAYMENT_ID, CARD_STATE, PAYMENT_METHOD } from "../utils/constants.js";
import { getUnifiedHistory } from "../utils/history.js";
import { handleTerminateAction, handleRequestWipeAction, handleTopUpAction, resolvePullPaymentId, buildProgrammingEndpoint, normalizeSubmittedUid } from "./loginActions.js";
import { matchCardIssuer } from "../utils/cardMatching.js";
import { requireOperator } from "../middleware/operatorAuth.js";

async function safeGetBalance(env, uidHex) {
  try {
    return await getBalance(env, uidHex);
  } catch (e) {
    logger.warn("Could not fetch balance", { uidHex, error: e.message });
    return { balance: 0 };
  }
}

export function handleLoginPage(request) {
  const host = getRequestOrigin(request);
  const defaultProgrammingEndpoint = `${host}/api/v1/pull-payments/${DEFAULT_PULL_PAYMENT_ID}/boltcards?onExisting=UpdateVersion`;
  return htmlResponse(renderLoginPage({ host, defaultProgrammingEndpoint }));
}

export async function handleLoginVerify(request, env) {
  try {
    const body = await parseJsonBody(request).catch(() => null);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const { p: pHex, c: cHex, uid: rawUid } = body;
    const requestOrigin = getRequestOrigin(request);

    if (rawUid && !pHex && !cHex) {
      const privilegedActions = ["request-wipe", "terminate", "top-up"];
      if (privilegedActions.includes(body.action)) {
        const auth = requireOperator(request, env);
        if (!auth.authorized) {
          return errorResponse("Operator authentication required", 401);
        }
      }
      if (body.action === "request-wipe") {
        return await handleRequestWipeAction(rawUid, env, request);
      }
      if (body.action === "terminate") {
        return await handleTerminateAction(rawUid, env, request);
      }
      if (body.action === "top-up") {
        return handleTopUpAction(body.uid, body.amount, env, request);
      }
      return await handleUidOnlyLogin(rawUid, env, request);
    }

    if (!pHex || !cHex) {
      return errorResponse("Missing p or c", 400);
    }

    const result = await matchCardIssuer(pHex, cHex, env);

    if (!result.matched && !result.issuerKey) {
      return errorResponse("Could not decrypt card with any known key", 400);
    }

    let matchedKeys;
    let matchedVersion;
    let perCardSource = null;

    if (result.matched && result.perCardOverride) {
      const perCard = result.perCard;
      const baseKeys = deriveKeysFromHex(result.uidHex, result.issuerKey, result.latestVersion);
      matchedKeys = {
        k0: perCard.k0,
        k1: perCard.k1,
        k2: perCard.k2,
        k3: perCard.k3 || baseKeys.k3,
        k4: perCard.k4 || baseKeys.k4,
      };
      matchedVersion = result.matchedVersion;
      perCardSource = result.perCardSource;
    } else if (result.matched) {
      matchedKeys = deriveKeysFromHex(result.uidHex, result.issuerKey, result.matchedVersion);
      matchedVersion = result.matchedVersion;
    } else {
      matchedKeys = deriveKeysFromHex(result.uidHex, result.issuerKey, result.latestVersion);
      matchedVersion = result.latestVersion;
    }

    const matchedIssuer = result.issuerKey ? { hex: result.issuerKey, label: result.issuerLabel } : null;
    const matchedCmacValid = result.cmacValid;
    const debugInfo = { versionScan: result.versionAttempts || [] };
    const keyVersion = result.matchedVersion || result.latestVersion || 1;

    const uidHex = result.uidHex;
    const counterValue = parseInt(result.ctr, 16);

    const config = await getUidConfig(uidHex, env);
    const pm = config?.payment_method || "unknown";

    const cardState = await getCardState(env, uidHex);
    const cardConfig = await getCardConfig(env, uidHex);
    const hasDoConfig = cardConfig !== null;
    const deployed = hasDoConfig || !!perCardSource;
    const pullPaymentId = resolvePullPaymentId(env, cardConfig);
    const programmingEndpoint = buildProgrammingEndpoint(requestOrigin, pullPaymentId);

    const host = new URL(request.url).host;
    const path = pm === PAYMENT_METHOD.TWOFACTOR ? "/2fa" : "/";
    const ndefUrl = `https://${host}${path}?p=${pHex}&c=${cHex}`;

    logger.info("NFC login", {
      uidHex,
      counterValue,
      cardType: pm,
      issuerKey: matchedIssuer.label,
      cmacValid: matchedCmacValid,
      perCardSource,
      deployed,
      keyVersion,
    });

    const tapHistory = await getUnifiedHistory(env, uidHex);

    const balanceData = await safeGetBalance(env, uidHex);

    recordTapRead(env, uidHex, counterValue, {
      userAgent: request.headers.get("user-agent"),
      requestUrl: request.url,
    }).catch(e => logger.warn("Failed to record login tap", { uidHex, counterValue, error: e.message }));

    return jsonResponse({
      success: true,
      uidHex,
      counterValue,
      cardType: pm,
      cmacValid: matchedCmacValid,
      issuerKey: matchedIssuer.label,
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
  } catch (error) {
    logger.error("Login verification error", { error: error.message });
    return errorResponse("Internal error", 500);
  }
}

async function handleUidOnlyLogin(rawUid, env, request) {
  const requestOrigin = getRequestOrigin(request);
  const uidHex = normalizeSubmittedUid(rawUid);
  if (!uidHex) {
    return errorResponse("Invalid UID format", 400);
  }

  const cardState = await getCardState(env, uidHex);
  const cardConfig = await getCardConfig(env, uidHex);
  const hasDoConfig = cardConfig !== null;
  const config = await getUidConfig(uidHex, env);
  const pm = config?.payment_method || PAYMENT_METHOD.FAKEWALLET;
  const pullPaymentId = resolvePullPaymentId(env, cardConfig);
  const programmingEndpoint = buildProgrammingEndpoint(requestOrigin, pullPaymentId);

  let keyVersion = 1;
  let keys;
  if (hasDoConfig && cardState?.active_version) {
    keyVersion = cardState.active_version;
    keys = deriveKeysFromHex(uidHex, env.ISSUER_KEY, keyVersion);
  } else {
    keys = deriveKeysFromHex(uidHex, env.ISSUER_KEY, 1);
  }

  const ndefUrl = null;

  logger.info("NFC login (UID-only, undeployed)", { uidHex, deployed: hasDoConfig, keyVersion });

  const tapHistory = await getUnifiedHistory(env, uidHex);

  const balanceData = await safeGetBalance(env, uidHex);

  recordTapRead(env, uidHex, null, {
    userAgent: request.headers.get("user-agent"),
    requestUrl: request.url,
  }).catch(e => logger.warn("Failed to record UID-only login tap", { uidHex, error: e.message }));

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
