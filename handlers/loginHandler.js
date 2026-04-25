import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { renderLoginPage } from "../templates/loginPage.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getAllIssuerKeyCandidates, getPerCardKeys, getUniquePerCardK1s } from "../utils/keyLookup.js";
import { deriveKeysFromHex } from "../keygenerator.js";
import { listTaps, listTransactions, getCardState, getCardConfig, terminateCard, requestWipe, recordTapRead, getBalance, creditCard } from "../replayProtection.js";
import { validateUid, getRequestOrigin } from "../utils/validation.js";
import { cmacScanVersions } from "../utils/cmacScan.js";
import { DEFAULT_PULL_PAYMENT_ID } from "../utils/constants.js";

function resolvePullPaymentId(env, cardConfig) {
  return cardConfig?.pull_payment_id || env.DEFAULT_PULL_PAYMENT_ID || DEFAULT_PULL_PAYMENT_ID;
}

function buildProgrammingEndpoint(requestOrigin, pullPaymentId) {
  return `${requestOrigin}/api/v1/pull-payments/${pullPaymentId}/boltcards?onExisting=UpdateVersion`;
}

function normalizeSubmittedUid(rawUid) {
  return validateUid(typeof rawUid === "string" ? rawUid.replace(/:/g, "") : "");
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

        const perCard = getPerCardKeys(uidHex);
        if (perCard) {
          perCardSource = perCard.card_name || "recovered";
          matchedKeys = {
            k0: perCard.k0,
            k1: perCard.k1,
            k2: perCard.k2,
            k3: perCard.k3 || deriveKeysFromHex(uidHex, candidate.hex, scanVersion).k3,
            k4: perCard.k4 || deriveKeysFromHex(uidHex, candidate.hex, scanVersion).k4,
          };
          const { cmac_validated: pcCmac } = validate_cmac(uidBytes, ctrBytes, cHex, hexToBytes(perCard.k2));
          matchedCmacValid = pcCmac;
        }
      } else {
        matchedKeys = deriveKeysFromHex(uidHex, candidate.hex, latestVersion);
        matchedVersion = latestVersion;
      }

      debugInfo.versionScan = versionDebug;
      break;
    }

    if (!matchedIssuer) {
      for (const entry of getUniquePerCardK1s()) {
        const tryEnv = { ...env, ISSUER_KEY: entry.k1 };
        const decryption = extractUIDAndCounter(pHex, tryEnv);
        if (!decryption.success) continue;

        const { uidHex, ctr } = decryption;
        const perCard = getPerCardKeys(uidHex);
        if (!perCard) continue;

        const { cmac_validated } = validate_cmac(
          hexToBytes(uidHex),
          hexToBytes(ctr),
          cHex,
          hexToBytes(perCard.k2),
        );

        if (cmac_validated) {
          matchedIssuer = { hex: "per-card", label: perCard.card_name || "recovered" };
          matchedUid = uidHex;
          matchedCtr = ctr;
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
    return errorResponse(error, 500);
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

async function handleTerminateAction(rawUid, env, request) {
  const requestOrigin = getRequestOrigin(request);
  const uidHex = normalizeSubmittedUid(rawUid);
  if (!uidHex) {
    return errorResponse("Invalid UID format", 400);
  }

  const cardState = await getCardState(env, uidHex);
  if (cardState.state !== "active" && cardState.state !== "wipe_requested") {
    return errorResponse(`Card is in '${cardState.state}' state, cannot terminate. Only active or wipe_requested cards can be terminated.`, 400);
  }

  await terminateCard(env, uidHex);

  const newState = await getCardState(env, uidHex);
  const cardConfig = await getCardConfig(env, uidHex);
  const pullPaymentId = resolvePullPaymentId(env, cardConfig);
  const programmingEndpoint = buildProgrammingEndpoint(requestOrigin, pullPaymentId);

  logger.info("Card terminated via wipe confirmation", { uidHex, previousVersion: cardState.active_version, newVersion: newState.latest_issued_version });

  return jsonResponse({
    success: true,
    uidHex,
    cardState: newState.state,
    keyVersion: newState.latest_issued_version || (cardState.active_version || 1),
    programmingEndpoint,
  });
}

async function handleRequestWipeAction(rawUid, env, request) {
  const requestOrigin = getRequestOrigin(request);
  const uidHex = normalizeSubmittedUid(rawUid);
  if (!uidHex) {
    return errorResponse("Invalid UID format", 400);
  }

  const cardState = await getCardState(env, uidHex);
  if (cardState.state !== "active") {
    return errorResponse(`Card is in '${cardState.state}' state. Only active cards can request wipe keys.`, 400);
  }

  const version = cardState.active_version || 1;
  const keys = deriveKeysFromHex(uidHex, env.ISSUER_KEY, version);

  await requestWipe(env, uidHex);

  const endpointUrl = `${requestOrigin}/api/keys?uid=${uidHex}&format=boltcard`;
  const cardConfig = await getCardConfig(env, uidHex);
  const pullPaymentId = resolvePullPaymentId(env, cardConfig);
  const programmingEndpoint = buildProgrammingEndpoint(requestOrigin, pullPaymentId);

  logger.info("Wipe keys fetched", { uidHex, version });

  return jsonResponse({
    success: true,
    uidHex,
    cardState: "wipe_requested",
    keyVersion: version,
      k0: keys.k0,
      k1: keys.k1,
      k2: keys.k2,
      k3: keys.k3,
      k4: keys.k4,
      programmingEndpoint,
      wipeDeeplink: `boltcard://reset?url=${encodeURIComponent(endpointUrl)}`,
      wipeJson: JSON.stringify({
        version: version,
        action: "wipe",
        k0: keys.k0.toLowerCase(),
        k1: keys.k1.toLowerCase(),
        k2: keys.k2.toLowerCase(),
        k3: keys.k3.toLowerCase(),
        k4: keys.k4.toLowerCase(),
      }, null, 2),
  });
}

async function handleTopUpAction(rawUid, rawAmount, env, request) {
  void request;
  const uidHex = normalizeSubmittedUid(rawUid);
  if (!uidHex) return errorResponse("Invalid UID format", 400);

  const amount = parseInt(rawAmount, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  try {
    const result = await creditCard(env, uidHex, amount, "Manual top-up via login page");
    if (result.ok) {
      return jsonResponse({ success: true, balance: result.balance, message: `Credited ${amount} units` });
    }
    return errorResponse(result.reason || "Top-up failed", 500);
  } catch (e) {
    logger.error("Top-up failed", { uidHex, amount, error: e.message });
    return errorResponse("Top-up failed: " + e.message, 500);
  }
}

function mergeHistory(taps, transactions) {
  const txEntries = (transactions || []).map((tx) => ({
    counter: tx.counter,
    bolt11: null,
    status: tx.amount > 0 ? "topup" : "payment",
    payment_hash: null,
    amount_msat: Math.abs(tx.amount),
    user_agent: null,
    request_url: null,
    created_at: tx.created_at,
    updated_at: tx.created_at,
    note: tx.note || null,
    balance_after: tx.balance_after,
  }));

  const merged = [...(taps || []), ...txEntries].sort((a, b) => {
    const timeDiff = (b.created_at || 0) - (a.created_at || 0);
    if (timeDiff !== 0) return timeDiff;
    return (b.counter || 0) - (a.counter || 0);
  });

  return merged.slice(0, 25);
}

async function getUnifiedHistory(env, uidHex) {
  let taps = [];
  let transactions = [];
  try {
    const tapData = await listTaps(env, uidHex, 25);
    taps = tapData.taps || [];
  } catch (e) {
    logger.warn("Could not load tap history", { uidHex, error: e.message });
  }
  try {
    const txData = await listTransactions(env, uidHex, 25);
    transactions = txData.transactions || [];
  } catch (e) {
    logger.warn("Could not load transactions", { uidHex, error: e.message });
  }
  return mergeHistory(taps, transactions);
}
