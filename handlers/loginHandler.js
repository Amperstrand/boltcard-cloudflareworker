import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { renderLoginPage } from "../templates/loginPage.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse } from "../utils/responses.js";
import { getAllIssuerKeyCandidates, getPerCardKeys } from "../utils/keyLookup.js";
import { PERCARD_KEYS } from "../utils/generatedKeyData.js";
import { deriveKeysFromHex } from "../keygenerator.js";
import { listTaps, getCardState, getCardConfig, terminateCard, requestWipe, recordTapRead } from "../replayProtection.js";
import { validateUid, getRequestOrigin } from "../utils/validation.js";

export async function handleLoginPage(request) {
  const host = getRequestOrigin(request);
  return htmlResponse(renderLoginPage({ host }));
}

export async function handleLoginVerify(request, env) {
  try {
    const body = await request.json();
    const { p: pHex, c: cHex, uid: rawUid } = body;
    const requestOrigin = getRequestOrigin(request);

    if (rawUid && !pHex && !cHex) {
      if (body.action === "request-wipe") {
        return await handleRequestWipeAction(rawUid, env, request);
      }
      if (body.action === "terminate") {
        return await handleTerminateAction(rawUid, env, request);
      }
      return await handleUidOnlyLogin(rawUid, env, request);
    }

    if (!pHex || !cHex) {
      return jsonResponse({ success: false, error: "Missing p or c" }, 400);
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
      const minVersion = Math.max(1, latestVersion - 10);
      const uidBytes = hexToBytes(uidHex);
      const ctrBytes = hexToBytes(ctr);
      const versionDebug = [];

      for (let v = latestVersion; v >= minVersion; v--) {
        const keys = deriveKeysFromHex(uidHex, candidate.hex, v);
        const { cmac_validated } = validate_cmac(uidBytes, ctrBytes, cHex, hexToBytes(keys.k2));
        versionDebug.push({ version: v, cmac: cmac_validated });
        if (cmac_validated) {
          matchedCmacValid = true;
          matchedVersion = v;
          matchedKeys = keys;

          const perCard = getPerCardKeys(uidHex);
          if (perCard) {
            perCardSource = perCard.card_name || "recovered";
            matchedKeys = {
              k0: perCard.k0,
              k1: perCard.k1,
              k2: perCard.k2,
              k3: perCard.k1,
              k4: perCard.k2,
            };
            const { cmac_validated: pcCmac } = validate_cmac(uidBytes, ctrBytes, cHex, hexToBytes(perCard.k2));
            matchedCmacValid = pcCmac;
          }

          break;
        }
      }

      if (!matchedKeys) {
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
      return jsonResponse({ success: false, error: "Could not decrypt card with any known key" }, 400);
    }

    const uidHex = matchedUid;
    const counterValue = parseInt(matchedCtr, 16);

    const config = await getUidConfig(uidHex, env);
    const pm = config?.payment_method || "unknown";

    const cardState = await getCardState(env, uidHex);
    const hasDoConfig = (await getCardConfig(env, uidHex)) !== null;
    const deployed = hasDoConfig || !!perCardSource;
    keyVersion = cardState?.active_version || cardState?.latest_issued_version || 1;

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

    let tapHistory = [];
    try {
      const tapData = await listTaps(env, uidHex, 20);
      tapHistory = tapData.taps || [];
    } catch (e) {
      logger.warn("Could not load tap history", { uidHex, error: e.message });
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
      issuerKeyHex: perCardSource ? undefined : matchedIssuer.hex,
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
      programmingEndpoint: cardState?.state === "keys_delivered"
        ? `${requestOrigin}/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion`
        : undefined,
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
    return jsonResponse({ success: false, error: error.message }, 500);
  }
}

async function handleUidOnlyLogin(rawUid, env, request) {
  const requestOrigin = getRequestOrigin(request);
  const uidHex = validateUid(rawUid.replace(/:/g, ""));
  const programmingEndpoint = `${requestOrigin}/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion`;
  if (!uidHex) {
    return jsonResponse({ success: false, error: "Invalid UID format" }, 400);
  }

  const cardState = await getCardState(env, uidHex);
  const hasDoConfig = (await getCardConfig(env, uidHex)) !== null;
  const config = await getUidConfig(uidHex, env);
  const pm = config?.payment_method || "fakewallet";

  let keyVersion = 1;
  let keys;
  if (hasDoConfig && cardState?.active_version) {
    keyVersion = cardState.active_version;
    keys = deriveKeysFromHex(uidHex, env.ISSUER_KEY || env.BOLT_CARD_K1?.split(",")[0], keyVersion);
  } else {
    keys = deriveKeysFromHex(uidHex, env.ISSUER_KEY || env.BOLT_CARD_K1?.split(",")[0], 1);
  }

  const ndefUrl = null;

  logger.info("NFC login (UID-only, undeployed)", { uidHex, deployed: hasDoConfig, keyVersion });

  let tapHistory = [];
  try {
    const tapData = await listTaps(env, uidHex, 20);
    tapHistory = tapData.taps || [];
  } catch (e) {
    logger.warn("Could not load tap history", { uidHex, error: e.message });
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
  const uidHex = validateUid(rawUid.replace(/:/g, ""));
  if (!uidHex) {
    return jsonResponse({ success: false, error: "Invalid UID format" }, 400);
  }

  const cardState = await getCardState(env, uidHex);
  if (cardState.state !== "active" && cardState.state !== "wipe_requested") {
    return jsonResponse({ success: false, error: `Card is in '${cardState.state}' state, cannot terminate. Only active or wipe_requested cards can be terminated.` }, 400);
  }

  await terminateCard(env, uidHex);

  const newState = await getCardState(env, uidHex);
  const programmingEndpoint = `${requestOrigin}/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion`;

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
  const uidHex = validateUid(rawUid.replace(/:/g, ""));
  if (!uidHex) {
    return jsonResponse({ success: false, error: "Invalid UID format" }, 400);
  }

  const cardState = await getCardState(env, uidHex);
  if (cardState.state !== "active") {
    return jsonResponse({ success: false, error: `Card is in '${cardState.state}' state. Only active cards can request wipe keys.` }, 400);
  }

  const version = cardState.active_version || 1;
  const keys = deriveKeysFromHex(uidHex, env.ISSUER_KEY || env.BOLT_CARD_K1?.split(",")[0], version);

  await requestWipe(env, uidHex);

  const endpointUrl = `${requestOrigin}/api/keys?uid=${uidHex}&format=boltcard`;

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

function getUniquePerCardK1s() {
  const seen = new Set();
  return PERCARD_KEYS.filter((e) => {
    if (seen.has(e.k1)) return false;
    seen.add(e.k1);
    return true;
  });
}
