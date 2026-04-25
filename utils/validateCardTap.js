import { extractUIDAndCounter, validate_cmac } from "../boltCardHelper.js";
import { hexToBytes } from "../cryptoutils.js";
import { getUidConfig } from "../getUidConfig.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { getCardState, activateCard, checkAndAdvanceCounter, recordTapRead } from "../replayProtection.js";
import { logger } from "../utils/logger.js";

export async function validateCardTap(request, env, { pHex, cHex, context = "tap" }) {
  if (!pHex || !cHex) {
    return { ok: false, status: 400, error: "Missing card parameters (p and c required)" };
  }

  const decryption = extractUIDAndCounter(pHex, env);
  if (!decryption.success) {
    logger.warn(`${context}: failed to decrypt card`, { error: decryption.error });
    return { ok: false, status: 400, error: "Could not read card — decryption failed" };
  }

  const { uidHex, ctr } = decryption;
  const counterValue = parseInt(ctr, 16);

  let cardState;
  try {
    cardState = await getCardState(env, uidHex);
  } catch (error) {
    logger.error(`${context}: card state check failed`, { uidHex, error: error.message });
    return { ok: false, status: 503, error: "Card state unavailable" };
  }

  if (cardState.state === "terminated") {
    return { ok: false, status: 403, error: "Card has been terminated" };
  }

  if (cardState.state === "wipe_requested") {
    return { ok: false, status: 403, error: "Card is pending wipe — re-program before use" };
  }

  let activeVersion;
  if (cardState.state === "keys_delivered") {
    const keys = getDeterministicKeys(uidHex, env, cardState.latest_issued_version);
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
      return { ok: false, status: 403, error: "Card version mismatch — try again or re-program card" };
    }
  } else if (cardState.state === "active") {
    activeVersion = cardState.active_version || 1;
  } else {
    activeVersion = 1;
  }

  const config = await getUidConfig(uidHex, env, activeVersion);
  if (!config) {
    logger.warn(`${context}: UID not found in config`, { uidHex });
    return { ok: false, status: 404, error: "Card not registered" };
  }

  if (config.K2) {
    const { cmac_validated, cmac_error } = validate_cmac(
      hexToBytes(uidHex),
      hexToBytes(ctr),
      cHex,
      hexToBytes(config.K2),
    );
    if (!cmac_validated) {
      logger.warn(`${context}: CMAC validation failed`, { uidHex, error: cmac_error });
      return { ok: false, status: 403, error: "Card authentication failed" };
    }
  }

  const replayResult = await checkAndAdvanceCounter(env, uidHex, counterValue);
  if (!replayResult.accepted) {
    logger.warn(`${context}: replay detected`, { uidHex, counterValue });
    return { ok: false, status: 400, error: "Card already used — tap rejected" };
  }

  recordTapRead(env, uidHex, counterValue, {
    userAgent: request.headers.get("user-agent"),
    requestUrl: request.url,
  }).catch(e => logger.warn(`Failed to record ${context} tap`, { uidHex, counterValue, error: e.message }));

  return {
    ok: true,
    uidHex,
    counterValue,
    activeVersion,
    config,
    cardState,
  };
}
