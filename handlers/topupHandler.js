import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { renderTopupPage } from "../templates/topupPage.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";
import { checkAndAdvanceCounter, recordTapRead, getCardState, activateCard, creditCard, getBalance } from "../replayProtection.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { logger } from "../utils/logger.js";
import { getRequestOrigin } from "../utils/validation.js";

export function handleTopupPage(request, env) {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderTopupPage({ host, currencyLabel }));
}

export async function handleTopupApply(request, env, session) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { p: pHex, c: cHex, amount } = body;

  if (!pHex || !cHex) {
    return errorResponse("Missing card parameters (p and c required)", 400);
  }

  const parsedAmount = parseInt(amount, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  if (env.MAX_TOPUP_AMOUNT) {
    const maxAmount = parseInt(env.MAX_TOPUP_AMOUNT, 10);
    if (Number.isInteger(maxAmount) && parsedAmount > maxAmount) {
      return errorResponse(`Amount exceeds maximum of ${maxAmount}`, 400);
    }
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    logger.warn("Top-up: failed to decrypt card", { error: decryption.error });
    return errorResponse("Could not read card — decryption failed", 400);
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  let cardState;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (error) {
    logger.error("Top-up: card state check failed", { uidHex, error: error.message });
    return errorResponse("Card state unavailable", 503);
  }

  if (cardState.state === "terminated") {
    return errorResponse("Card has been terminated", 403);
  }

  let activeVersion;
  if (cardState.state === "keys_delivered") {
    const keys = await getDeterministicKeys(uidHex, env, cardState.latest_issued_version);
    const { cmac_validated } = validate_cmac(
      hexToBytes(uidHex),
      hexToBytes(ctr),
      cHex,
      hexToBytes(keys.k2),
    );
    if (cmac_validated) {
      activeVersion = cardState.latest_issued_version;
      await activateCard(env, uidHex, activeVersion);
    } else {
      return errorResponse("Card version mismatch — try again or re-program card", 403);
    }
  } else if (cardState.state === "active") {
    activeVersion = cardState.active_version || 1;
  } else {
    activeVersion = 1;
  }

  const config = await getUidConfig(uidHex, env, activeVersion);
  if (!config) {
    logger.warn("Top-up: UID not found in config", { uidHex });
    return errorResponse("Card not registered", 404);
  }

  if (config.K2) {
    const { cmac_validated, cmac_error } = validate_cmac(
      hexToBytes(uidHex),
      hexToBytes(ctr),
      cHex,
      hexToBytes(config.K2),
    );
    if (!cmac_validated) {
      logger.warn("Top-up: CMAC validation failed", { uidHex, error: cmac_error });
      return errorResponse("Card authentication failed", 403);
    }
  }

  const replayResult = await checkAndAdvanceCounter(env, uidHex, counterValue);
  if (!replayResult.accepted) {
    logger.warn("Top-up: replay detected", { uidHex, counterValue });
    return errorResponse("Card already used — tap rejected", 400);
  }

  recordTapRead(env, uidHex, counterValue, {
    userAgent: request.headers.get("user-agent"),
    requestUrl: request.url,
  }).catch(e => logger.warn("Failed to record top-up tap", { uidHex, counterValue, error: e.message }));

  const shiftId = session?.shiftId || "unknown";
  const note = `topup:${shiftId}`;

  try {
    const result = await creditCard(env, uidHex, parsedAmount, note);
    if (!result.ok) {
      logger.error("Top-up: credit failed", { uidHex, amount: parsedAmount, reason: result.reason });
      return errorResponse(result.reason || "Credit failed", 500);
    }

    const balanceData = await getBalance(env, uidHex);
    const newBalance = balanceData.balance;

    logger.info("Top-up successful", { uidHex, amount: parsedAmount, newBalance, shiftId });
    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: newBalance,
      note,
    });
  } catch (error) {
    logger.error("Top-up: unexpected error", { uidHex, amount: parsedAmount, error: error.message });
    return errorResponse("Top-up failed: " + error.message, 500);
  }
}
