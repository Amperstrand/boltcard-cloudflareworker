import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { renderLoginPage } from "../templates/loginPage.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getAllIssuerKeyCandidates, getPerCardKeys, getUniquePerCardK1s } from "../utils/keyLookup.js";
import { deriveKeysFromHex } from "../keygenerator.js";
import { getCardState, getCardConfig, recordTapRead, getBalance } from "../replayProtection.js";
import { getRequestOrigin } from "../utils/validation.js";
import { cmacScanVersions } from "../utils/cmacScan.js";
import { DEFAULT_PULL_PAYMENT_ID } from "../utils/constants.js";
import { getUnifiedHistory } from "../utils/history.js";
import { handleTerminateAction, handleRequestWipeAction, handleTopUpAction, resolvePullPaymentId, buildProgrammingEndpoint, normalizeSubmittedUid } from "./loginActions.js";

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

    const candidates = getAllIssuerKeyCandidates(env);

    let matchedIssuer = null;
    let matchedUid = null;
    let matchedCtr = null;
    let matchedKeys = null;
    let matchedCmacValid = false;
    let perCardSource = null;
    let keyVersion = 1;
    let matchedVersion = null;
    let debugInfo = { versionScan: [] };

    for (const candidate of candidates) {
      const tryEnv = { ...env, ISSUER_KEY: candidate.hex };
      const decryption = extractUIDAndCounter(pHex, tryEnv);
      if (!decryption.success) continue;

      const { uidHex, ctr } = decryption;

      matchedIssuer = candidate;
      matchedUid = uidHex;
      matchedCtr = ctr;

      const cardState = await getCardState(env, uidHex);
      const latestVersion = cardState?.latest_issued_version || cardState?.active_version || 1;
      const uidBytes = hexToBytes(uidHex);
      const ctrBytes = hexToBytes(ctr);

      const { matchedVersion: scanVersion, attempts: versionDebug } = await cmacScanVersions(
        uidBytes, ctrBytes, cHex, {
          k2ForVersion: (v) => hexToBytes(deriveKeysFromHex(uidHex, candidate.hex, v).k2),
          highVersion: latestVersion,
          lowVersion: Math.max(1, latestVersion - 10),
        }
      );

      if (scanVersion !== null) {
        matchedCmacValid = true;
        matchedVersion = scanVersion;
        matchedKeys = deriveKeysFromHex(uidHex, candidate.hex, scanVersion);
      } else {
        matchedKeys = deriveKeysFromHex(uidHex, candidate.hex, latestVersion);
        matchedVersion = latestVersion;
      }

      const perCard = getPerCardKeys(uidHex);
      if (perCard) {
        const { cmac_validated: pcCmac } = validate_cmac(uidBytes, ctrBytes, cHex, hexToBytes(perCard.k2));
        if (pcCmac) {
          matchedCmacValid = true;
          perCardSource = perCard.card_name || "recovered";
          matchedKeys = {
            k0: perCard.k0,
            k1: perCard.k1,
            k2: perCard.k2,
            k3: perCard.k3 || matchedKeys.k3,
            k4: perCard.k4 || matchedKeys.k4,
          };
        }
      }

      debugInfo.versionScan = versionDebug;
      break;
    }

    if (!matchedIssuer || !matchedCmacValid) {
      for (const entry of getUniquePerCardK1s()) {
        const tryEnv = { ...env, ISSUER_KEY: entry.k1 };
        const decryption = extractUIDAndCounter(pHex, tryEnv);
        if (!decryption.success) continue;

        const { uidHex: pcUid, ctr: pcCtr } = decryption;
        const perCard = getPerCardKeys(pcUid);
        if (!perCard) continue;

        const { cmac_validated } = validate_cmac(
          hexToBytes(pcUid),
          hexToBytes(pcCtr),
          cHex,
          hexToBytes(perCard.k2),
        );

        if (cmac_validated) {
          matchedIssuer = { hex: "per-card", label: perCard.card_name || "recovered" };
          matchedUid = pcUid;
          matchedCtr = pcCtr;
          matchedCmacValid = true;
          perCardSource = perCard.card_name || "recovered";
          matchedKeys = {
            k0: perCard.k0,
            k1: perCard.k1,
            k2: perCard.k2,
            k3: perCard.k1,
            k4: perCard.k2,
          };
          break;
        }
      }
    }

    if (!matchedIssuer) {
      return errorResponse("Could not decrypt card with any known key", 400);
    }

    const uidHex = matchedUid;
    const counterValue = parseInt(matchedCtr, 16);

    const config = await getUidConfig(uidHex, env);
    const pm = config?.payment_method || "unknown";

    const cardState = await getCardState(env, uidHex);
    const cardConfig = await getCardConfig(env, uidHex);
    const hasDoConfig = cardConfig !== null;
    const deployed = hasDoConfig || !!perCardSource;
    keyVersion = cardState?.active_version || cardState?.latest_issued_version || 1;
    const pullPaymentId = resolvePullPaymentId(env, cardConfig);
    const programmingEndpoint = buildProgrammingEndpoint(requestOrigin, pullPaymentId);

    const host = new URL(request.url).host;
    const path = pm === "twofactor" ? "/2fa" : "/";
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

    let balanceData = { balance: 0 };
    try {
      balanceData = await getBalance(env, uidHex);
    } catch (e) {
      logger.warn("Could not fetch balance", { uidHex, error: e.message });
    }

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
      cardState: cardState?.state || "new",
      balance: balanceData.balance,
      programmingEndpoint: cardState?.state === "keys_delivered" ? programmingEndpoint : undefined,
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
    return errorResponse(error.message, 500);
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
  const pm = config?.payment_method || "fakewallet";
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

  let balanceData = { balance: 0 };
  try {
    balanceData = await getBalance(env, uidHex);
  } catch (e) {
    logger.warn("Could not fetch balance", { uidHex, error: e.message });
  }

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
    cardState: cardState?.state || "new",
    awaitingProgramming: cardState?.state === "keys_delivered",
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
