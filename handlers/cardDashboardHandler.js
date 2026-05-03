import { extractUIDAndCounter, validateCmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getCardState, getCardConfig, safeGetBalance, getAnalytics, terminateCard, deliverKeys, resolveActiveVersion, resolveLatestVersion } from "../replayProtection.js";
import { buildMaskedUid } from "../utils/validation.js";
import { renderCardDashboardPage } from "../templates/cardDashboardPage.js";
import { CARD_STATE, KEY_PROVENANCE, PAYMENT_METHOD } from "../utils/constants.js";
import { getUnifiedHistory } from "../utils/history.js";
import { resolveCardIdentity } from "../utils/cardAuth.js";

const PAYMENT_METHOD_LABELS = {
  [PAYMENT_METHOD.FAKEWALLET]: "Internal Wallet",
  [PAYMENT_METHOD.CLNREST]: "Lightning Node",
  [PAYMENT_METHOD.PROXY]: "Proxy Relay",
  [PAYMENT_METHOD.LNURLPAY]: "POS Card",
  [PAYMENT_METHOD.TWOFACTOR]: "2FA Token",
};

async function resolveCardAuth(body, env, endpoint) {
  const { p: pHex, c: cHex } = body || {};
  const auth = await resolveCardIdentity(pHex, cHex, env, { requireState: true, context: endpoint });
  if (!auth.ok) {
    return { error: errorResponse(auth.error, auth.status) };
  }
  return { uidHex: auth.uidHex, ctr: auth.ctr, cardState: auth.cardState, config: auth.config, activeVersion: auth.activeVersion };
}

export async function handleCardPage(request, env) {
  return htmlResponse(renderCardDashboardPage());
}

export async function handleCardInfo(request, env) {
  const url = new URL(request.url);
  const pHex = url.searchParams.get("p");
  const cHex = url.searchParams.get("c");

  if (!pHex || !cHex) {
    return errorResponse("Missing p or c parameters", 400);
  }

  const auth = await resolveCardIdentity(pHex, cHex, env, { requireState: true, skipCmac: true, context: "/card/info" });
  if (!auth.ok) {
    return errorResponse(auth.error, auth.status);
  }

  const { uidHex, cardState, cmac_validated } = auth;

  if (cardState.state === CARD_STATE.TERMINATED) {
    const currentVersion = resolveLatestVersion(cardState);

    const balance = (await safeGetBalance(env, uidHex)).balance;

    return jsonResponse({
      uid: uidHex,
      maskedUid: buildMaskedUid(uidHex),
      state: cardState.state,
      keyProvenance: cardState.key_provenance || null,
      programmingRecommended: false,
      balance,
      history: [],
      analytics: null,
      paymentMethod: null,
      paymentMethodLabel: null,
      activatedAt: cardState.activated_at || null,
      terminatedAt: cardState.terminated_at || null,
      currentVersion,
      reactivationAvailable: cmac_validated,
    });
  }

  if (!cmac_validated) {
    return errorResponse("CMAC validation failed", 403);
  }

  const balance = (await safeGetBalance(env, uidHex)).balance;

  let history = [];
  try {
    history = await getUnifiedHistory(env, uidHex);
  } catch (e) {
    logger.warn("History fetch failed in /card/info", { uidHex, error: e.message });
  }

  let analytics = null;
  try {
    analytics = await getAnalytics(env, uidHex);
  } catch (e) {
    logger.warn("Analytics fetch failed in /card/info", { uidHex, error: e.message });
  }

  let paymentMethod = null;
  let paymentMethodLabel = null;
  let cardConfig = null;
  try {
    cardConfig = await getCardConfig(env, uidHex);
    if (cardConfig) {
      paymentMethod = cardConfig.payment_method || null;
      paymentMethodLabel = PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod;
    }
  } catch (e) {
    logger.warn("Config fetch failed in /card/info", { uidHex, error: e.message });
  }

  const programmingRecommended = cardState.key_provenance === KEY_PROVENANCE.PUBLIC_ISSUER;

  logger.info("Card info requested", { uidHex, state: cardState.state, provenance: cardState.key_provenance });

  return jsonResponse({
    uid: uidHex,
    maskedUid: buildMaskedUid(uidHex),
    state: cardState.state,
    keyProvenance: cardState.key_provenance || null,
    keyLabel: cardState.key_label || null,
    keyFingerprint: cardState.key_fingerprint || null,
    firstSeenAt: cardState.first_seen_at || null,
    activatedAt: cardState.activated_at || null,
    activeVersion: auth.activeVersion,
    programmingRecommended,
    balance,
    history,
    analytics,
    paymentMethod,
    paymentMethodLabel,
  });
}

export async function handleCardLock(request, env) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return errorResponse("Invalid JSON body", 400);
  }

  const auth = await resolveCardAuth(body, env, "/api/card/lock");
  if (auth.error) return auth.error;

  const { uidHex, cardState } = auth;

  if (cardState.state === CARD_STATE.TERMINATED) {
    return errorResponse("Card is already locked", 400);
  }

  if (cardState.state !== CARD_STATE.ACTIVE && cardState.state !== CARD_STATE.DISCOVERED) {
    return errorResponse(`Card in '${cardState.state}' state cannot be locked`, 400);
  }

  try {
    await terminateCard(env, uidHex);
    logger.info("Card locked by cardholder", { uidHex });
    return jsonResponse({ success: true, state: "terminated" });
  } catch (err) {
    logger.error("Card lock failed", { uidHex, error: err.message });
    return errorResponse("Failed to lock card", 500);
  }
}

export async function handleCardReactivate(request, env) {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return errorResponse("Invalid JSON body", 400);
  }

  const auth = await resolveCardAuth(body, env, "/api/card/reactivate");
  if (auth.error) return auth.error;

  const { uidHex, cardState } = auth;

  if (cardState.state !== CARD_STATE.TERMINATED) {
    return errorResponse(`Card is not terminated (state: ${cardState.state})`, 400);
  }

  const currentVersion = resolveLatestVersion(cardState);

  try {
    const delivered = await deliverKeys(env, uidHex);
    const newVersion = delivered.latest_issued_version || delivered.version || currentVersion + 1;
    logger.info("Card re-activated by cardholder", { uidHex, oldVersion: currentVersion, newVersion });
    return jsonResponse({
      success: true,
      state: CARD_STATE.KEYS_DELIVERED,
      uid: uidHex,
      version: newVersion,
    });
  } catch (err) {
    logger.error("Card re-activation failed", { uidHex, error: err.message });
    return errorResponse("Failed to re-activate card", 500);
  }
}
