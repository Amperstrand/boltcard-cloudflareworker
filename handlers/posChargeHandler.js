import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { checkAndAdvanceCounter, recordTapRead, getCardState, activateCard, debitCard, getBalance } from "../replayProtection.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { logger } from "../utils/logger.js";

export async function handlePosCharge(request, env, session) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { p: pHex, c: cHex, amount } = body;
  const items = body.items || null;
  const terminalId = body.terminalId || "unknown";

  if (!pHex || !cHex) {
    return errorResponse("Missing card parameters (p and c required)", 400);
  }

  const parsedAmount = parseInt(amount, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    return errorResponse("Amount must be a positive integer", 400);
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    logger.warn("POS charge: failed to decrypt card", { error: decryption.error });
    return errorResponse("Could not read card", 400);
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  let cardState;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (error) {
    logger.error("POS charge: card state check failed", { uidHex, error: error.message });
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
      logger.warn("POS charge: CMAC failed", { uidHex, error: cmac_error });
      return errorResponse("Card authentication failed", 403);
    }
  }

  const replayResult = await checkAndAdvanceCounter(env, uidHex, counterValue);
  if (!replayResult.accepted) {
    logger.warn("POS charge: replay detected", { uidHex, counterValue });
    return errorResponse("Card already used — tap rejected", 400);
  }

  recordTapRead(env, uidHex, counterValue, {
    userAgent: request.headers.get("user-agent"),
    requestUrl: request.url,
  }).catch(e => logger.warn("Failed to record POS tap", { uidHex, counterValue, error: e.message }));

  const shiftId = session?.shiftId || "unknown";
  const noteParts = ["pos", shiftId, terminalId];
  if (items && items.length > 0) {
    noteParts.push(items.map(i => `${i.name || "item"}:${i.qty || 1}`).join(","));
  }
  const note = noteParts.join(":");

  try {
    const preBalance = await getBalance(env, uidHex);
    if (preBalance.balance < parsedAmount) {
      logger.info("POS charge: insufficient balance", { uidHex, requested: parsedAmount, available: preBalance.balance });
      return errorResponse("Insufficient balance", 402, {
        currentBalance: preBalance.balance,
      });
    }

    const result = await debitCard(env, uidHex, counterValue, parsedAmount, note);
    if (!result.ok) {
      const status = result.reason && result.reason.toLowerCase().includes("insufficient") ? 402 : 500;
      return errorResponse(result.reason || "Debit failed", status);
    }

    const postBalance = await getBalance(env, uidHex);
    logger.info("POS charge successful", { uidHex, amount: parsedAmount, newBalance: postBalance.balance, shiftId, terminalId });

    return jsonResponse({
      success: true,
      amount: parsedAmount,
      balance: postBalance.balance,
      txnId: result.txnId || null,
      note,
    });
  } catch (error) {
    logger.error("POS charge: unexpected error", { uidHex, amount: parsedAmount, error: error.message });
    return errorResponse("Charge failed: " + error.message, 500);
  }
}
