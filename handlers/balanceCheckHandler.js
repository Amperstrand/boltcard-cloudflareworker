import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { checkAndAdvanceCounter, recordTapRead, getCardState, activateCard, getBalance } from "../replayProtection.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { logger } from "../utils/logger.js";

export async function handleBalanceCheck(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { p: pHex, c: cHex } = body;
  if (!pHex || !cHex) {
    return errorResponse("Missing card parameters", 400);
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    return errorResponse("Could not read card", 400);
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  let cardState;
  try {
    cardState = await getCardState(env, uidHex);
  } catch {
    return errorResponse("Card state unavailable", 503);
  }

  if (cardState.state === "terminated") {
    return errorResponse("Card has been terminated", 403);
  }

  let activeVersion;
  if (cardState.state === "keys_delivered") {
    const keys = await getDeterministicKeys(uidHex, env, cardState.latest_issued_version);
    const { cmac_validated } = validate_cmac(hexToBytes(uidHex), hexToBytes(ctr), cHex, hexToBytes(keys.k2));
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
    const { cmac_validated } = validate_cmac(hexToBytes(uidHex), hexToBytes(ctr), cHex, hexToBytes(config.K2));
    if (!cmac_validated) {
      return errorResponse("Card authentication failed", 403);
    }
  }

  const replayResult = await checkAndAdvanceCounter(env, uidHex, counterValue);
  if (!replayResult.accepted) {
    return errorResponse("Card already used — tap rejected", 400);
  }

  recordTapRead(env, uidHex, counterValue, {
    userAgent: request.headers.get("user-agent"),
    requestUrl: request.url,
  }).catch(() => {});

  const balanceData = await getBalance(env, uidHex);
  return jsonResponse({ success: true, balance: balanceData.balance, uidHex });
}
