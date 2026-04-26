import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { getUidConfig } from "../getUidConfig.js";
import { hexToBytes } from "../cryptoutils.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";
import { getCardState, getBalance, listTaps } from "../replayProtection.js";
import { buildMaskedUid } from "../utils/validation.js";
import { renderCardDashboardPage } from "../templates/cardDashboardPage.js";
import { CARD_STATE, KEY_PROVENANCE } from "../utils/constants.js";

export async function handleCardPage(request, env) {
  const url = new URL(request.url);
  return htmlResponse(renderCardDashboardPage({ host: url.origin }));
}

export async function handleCardInfo(request, env) {
  const url = new URL(request.url);
  const pHex = url.searchParams.get("p");
  const cHex = url.searchParams.get("c");

  if (!pHex || !cHex) {
    return errorResponse("Missing p or c parameters", 400);
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return errorResponse("Decryption failed: " + decryption.error, 400);
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  let cardState;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (error) {
    logger.error("Card state lookup failed in /card/info", { uidHex, error: error.message });
    return errorResponse("Card state unavailable", 500);
  }

  if (cardState.state === CARD_STATE.TERMINATED) {
    return jsonResponse({
      uid: uidHex,
      maskedUid: buildMaskedUid(uidHex),
      state: cardState.state,
      keyProvenance: cardState.key_provenance || null,
      programmingRecommended: false,
      balance: 0,
      recentTaps: [],
    });
  }

  const activeVersion = cardState.active_version || cardState.latest_issued_version || 1;
  const config = await getUidConfig(uidHex, env, activeVersion);

  if (!config || !config.K2) {
    return jsonResponse({
      uid: uidHex,
      maskedUid: buildMaskedUid(uidHex),
      state: cardState.state,
      keyProvenance: cardState.key_provenance || null,
      programmingRecommended: cardState.key_provenance === KEY_PROVENANCE.PUBLIC_ISSUER,
      balance: 0,
      recentTaps: [],
    });
  }

  const { cmac_validated } = validate_cmac(
    hexToBytes(uidHex),
    hexToBytes(ctr),
    cHex,
    hexToBytes(config.K2)
  );

  if (!cmac_validated) {
    return errorResponse("CMAC validation failed", 403);
  }

  let balance = 0;
  try {
    const balResult = await getBalance(env, uidHex);
    balance = balResult.balance || 0;
  } catch (e) {
    logger.warn("Balance fetch failed in /card/info", { uidHex, error: e.message });
  }

  let recentTaps = [];
  try {
    const tapResult = await listTaps(env, uidHex, 5);
    recentTaps = (tapResult.taps || []).map(t => ({
      counter: t.counter,
      status: t.status,
      amountMsat: t.amount_msat || 0,
      createdAt: t.created_at,
    }));
  } catch (e) {
    logger.warn("Tap listing failed in /card/info", { uidHex, error: e.message });
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
    activeVersion,
    programmingRecommended,
    balance,
    recentTaps,
  });
}
