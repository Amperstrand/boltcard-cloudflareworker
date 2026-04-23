import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { renderTopupPage } from "../templates/topupPage.js";
import { renderRefundPage } from "../templates/refundPage.js";
import { getCurrencyLabel } from "../utils/currency.js";
import { htmlResponse, jsonResponse, errorResponse } from "../utils/responses.js";
import { checkAndAdvanceCounter, recordTapRead, getCardState, activateCard, debitCard, getBalance } from "../replayProtection.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { logger } from "../utils/logger.js";
import { getRequestOrigin } from "../utils/validation.js";

export function handleRefundPage(request, env) {
  const host = getRequestOrigin(request);
  const currencyLabel = getCurrencyLabel(env);
  return htmlResponse(renderRefundPage({ host, currencyLabel }));
}

export async function handleRefundApply(request, env, session) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { p: pHex, c: cHex, amount } = body;
  const fullRefund = body.fullRefund === true;

  if (!pHex || !cHex) {
    return errorResponse("Missing card parameters (p and c required)", 400);
  }

  if (!fullRefund && (!amount || parseInt(amount, 10) <= 0)) {
    return errorResponse("Amount must be a positive integer for partial refund", 400);
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    logger.warn("Refund: failed to decrypt card", { error: decryption.error });
    return errorResponse("Could not read card", 400);
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  let cardState;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (error) {
    logger.error("Refund: card state check failed", { uidHex, error: error.message });
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
      return errorResponse("Card version mismatch", 403);
    }
  } else if (cardState.state === "active") {
    activeVersion = cardState.active_version || 1;
  } else {
    activeVersion = 1;
  }

  const config = await getUidConfig(uidHex, env, activeVersion);
  if (!config) {
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
      logger.warn("Refund: CMAC failed", { uidHex, error: cmac_error });
      return errorResponse("Card authentication failed", 403);
    }
  }

  const replayResult = await checkAndAdvanceCounter(env, uidHex, counterValue);
  if (!replayResult.accepted) {
    logger.warn("Refund: replay detected", { uidHex, counterValue });
    return errorResponse("Card already used — tap rejected", 400);
  }

  recordTapRead(env, uidHex, counterValue, {
    userAgent: request.headers.get("user-agent"),
    requestUrl: request.url,
  }).catch(e => logger.warn("Failed to record refund tap", { uidHex, counterValue, error: e.message }));

  let refundAmount;
  if (fullRefund) {
    const balanceData = await getBalance(env, uidHex);
    refundAmount = balanceData.balance;
    if (!refundAmount || refundAmount <= 0) {
      return jsonResponse({ success: true, amount: 0, balance: 0, note: "refund:zero" });
    }
  } else {
    refundAmount = parseInt(amount, 10);
    const balanceData = await getBalance(env, uidHex);
    if (refundAmount > balanceData.balance) {
      return errorResponse(`Refund amount (${refundAmount}) exceeds balance (${balanceData.balance})`, 400, {
        currentBalance: balanceData.balance,
      });
    }
  }

  const shiftId = session?.shiftId || "unknown";
  const note = `refund:${shiftId}`;

  try {
    const result = await debitCard(env, uidHex, counterValue, refundAmount, note);
    if (!result.ok) {
      logger.error("Refund: debit failed", { uidHex, amount: refundAmount, reason: result.reason });
      return errorResponse(result.reason || "Refund failed", 500);
    }

    const balanceData = await getBalance(env, uidHex);
    logger.info("Refund successful", { uidHex, amount: refundAmount, newBalance: balanceData.balance, shiftId, fullRefund });

    return jsonResponse({
      success: true,
      amount: refundAmount,
      balance: balanceData.balance,
      note,
    });
  } catch (error) {
    logger.error("Refund: unexpected error", { uidHex, amount: refundAmount, error: error.message });
    return errorResponse("Refund failed: " + error.message, 500);
  }
}
