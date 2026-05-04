import { extractUIDAndCounter, validateCmac } from "../boltCardHelper.js";
import type { CardStateRow, CardConfig, Env } from "../types/core.js";
import { getErrorMessage } from "../utils/logger.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { logger } from "../utils/logger.js";
import { htmlResponse, jsonResponse, errorResponse, parseJsonBody } from "../utils/responses.js";
import { getCardState, getCardConfig, safeGetBalance, getAnalytics, terminateCard, deliverKeys, resolveActiveVersion, resolveLatestVersion } from "../replayProtection.js";
import { buildMaskedUid } from "../utils/validation.js";
import { renderCardDashboardPage } from "../templates/cardDashboardPage.js";
import { CARD_STATE, KEY_PROVENANCE, PAYMENT_METHOD } from "../utils/constants.js";
import { getUnifiedHistory } from "../utils/history.js";
import { resolveCardIdentity, type ResolveResult } from "../utils/cardAuth.js";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  [PAYMENT_METHOD.FAKEWALLET]: "Internal Wallet",
  [PAYMENT_METHOD.CLNREST]: "Lightning Node",
  [PAYMENT_METHOD.PROXY]: "Proxy Relay",
  [PAYMENT_METHOD.LNURLPAY]: "POS Card",
  [PAYMENT_METHOD.TWOFACTOR]: "2FA Token",
};

async function resolveCardAuth(body: any, env: Env, endpoint: string): Promise<{ error?: Response; uidHex?: string; ctr?: string; cardState?: CardStateRow; config?: CardConfig; activeVersion?: number }> {
  const { p: pHex, c: cHex }: { p?: string; c?: string } = body || {};
  const auth: ResolveResult = await resolveCardIdentity(pHex, cHex, env, { requireState: true, context: endpoint });
  if (!auth.ok) {
    return { error: errorResponse(auth.error, auth.status) };
  }
  return { uidHex: auth.uidHex, ctr: auth.ctr, cardState: auth.cardState, config: auth.config, activeVersion: auth.activeVersion };
}

export async function handleCardPage(request: Request, env: Env): Promise<Response> {
  return htmlResponse(renderCardDashboardPage());
}

export async function handleCardInfo(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pHex: string | null = url.searchParams.get("p");
  const cHex: string | null = url.searchParams.get("c");

  if (!pHex || !cHex) {
    return errorResponse("Missing p or c parameters", 400);
  }

  const auth: ResolveResult = await resolveCardIdentity(pHex, cHex, env, { requireState: true, skipCmac: true, context: "/card/info" });
  if (!auth.ok) {
    return errorResponse(auth.error, auth.status);
  }

  const { uidHex, cardState, cmac_validated } = auth;
  const state = cardState!;

  if (state.state === CARD_STATE.TERMINATED) {
    const currentVersion: number = resolveLatestVersion(state);

    const balance: number = (await safeGetBalance(env, uidHex)).balance;

    return jsonResponse({
      uid: uidHex,
      maskedUid: buildMaskedUid(uidHex),
      state: state.state,
      keyProvenance: state.key_provenance || null,
      programmingRecommended: false,
      balance,
      history: [],
      analytics: null,
      paymentMethod: null,
      paymentMethodLabel: null,
      activatedAt: state.activated_at || null,
      terminatedAt: state.terminated_at || null,
      currentVersion,
      reactivationAvailable: cmac_validated,
    });
  }

  if (!cmac_validated) {
    return errorResponse("CMAC validation failed", 403);
  }

  const balance: number = (await safeGetBalance(env, uidHex)).balance;

  let history: any[] = [];
  try {
    history = await getUnifiedHistory(env, uidHex);
  } catch (e: unknown) {
    logger.warn("History fetch failed in /card/info", { uidHex, error: getErrorMessage(e) });
  }

  let analytics: any = null;
  try {
    analytics = await getAnalytics(env, uidHex);
  } catch (e: unknown) {
    logger.warn("Analytics fetch failed in /card/info", { uidHex, error: getErrorMessage(e) });
  }

  let paymentMethod: string | null = null;
  let paymentMethodLabel: string | null = null;
  let cardConfig: any = null;
  try {
    cardConfig = await getCardConfig(env, uidHex);
    if (cardConfig) {
      paymentMethod = cardConfig.payment_method || null;
      paymentMethodLabel = PAYMENT_METHOD_LABELS[paymentMethod!] || paymentMethod;
    }
  } catch (e: unknown) {
    logger.warn("Config fetch failed in /card/info", { uidHex, error: getErrorMessage(e) });
  }

  const programmingRecommended: boolean = state.key_provenance === KEY_PROVENANCE.PUBLIC_ISSUER;

  logger.info("Card info requested", { uidHex, state: state.state, provenance: state.key_provenance });

  return jsonResponse({
    uid: uidHex,
    maskedUid: buildMaskedUid(uidHex),
    state: state.state,
    keyProvenance: state.key_provenance || null,
    keyLabel: state.key_label || null,
    keyFingerprint: state.key_fingerprint || null,
    firstSeenAt: state.first_seen_at || null,
    activatedAt: state.activated_at || null,
    activeVersion: auth.activeVersion,
    programmingRecommended,
    balance,
    history,
    analytics,
    paymentMethod,
    paymentMethodLabel,
  });
}

export async function handleCardLock(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const body: any = await parseJsonBody(request);
  if (!body) {
    return errorResponse("Invalid JSON body", 400);
  }

  const auth = await resolveCardAuth(body, env, "/api/card/lock");
  if (auth.error) return auth.error;

  const uidHex = auth.uidHex!;
  const cardState = auth.cardState!;

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
  } catch (err: unknown) {
    logger.error("Card lock failed", { uidHex, error: getErrorMessage(err) });
    return errorResponse("Failed to lock card", 500);
  }
}

export async function handleCardReactivate(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const body: any = await parseJsonBody(request);
  if (!body) {
    return errorResponse("Invalid JSON body", 400);
  }

  const auth = await resolveCardAuth(body, env, "/api/card/reactivate");
  if (auth.error) return auth.error;

  const uidHex = auth.uidHex!;
  const cardState = auth.cardState!;

  if (cardState.state !== CARD_STATE.TERMINATED) {
    return errorResponse(`Card is not terminated (state: ${cardState.state})`, 400);
  }

  const currentVersion: number = resolveLatestVersion(cardState);

  try {
    const delivered: any = await deliverKeys(env, uidHex);
    const newVersion: number = delivered.latest_issued_version || delivered.version || currentVersion + 1;
    logger.info("Card re-activated by cardholder", { uidHex, oldVersion: currentVersion, newVersion });
    return jsonResponse({
      success: true,
      state: CARD_STATE.KEYS_DELIVERED,
      uid: uidHex,
      version: newVersion,
    });
  } catch (err: unknown) {
    logger.error("Card re-activation failed", { uidHex, error: getErrorMessage(err) });
    return errorResponse("Failed to re-activate card", 500);
  }
}
