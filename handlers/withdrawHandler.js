import { logger } from "../utils/logger.js";
import { DEFAULT_FALLBACK_HOST, WITHDRAW_MIN_MSAT, WITHDRAW_MAX_MSAT_FAKWALLET, WITHDRAW_MAX_MSAT_DEFAULT } from "../utils/constants.js";

export const constructWithdrawResponse = (uidHex, pHex, cHex, ctr, cmac_validated, baseUrl, paymentMethod = "fakewallet") => {
  if (!cmac_validated) {
    logger.warn("Withdraw response rejected: CMAC validation failed", { uidHex });
    return {
      status: "ERROR",
      reason: "CMAC validation failed or was not performed.",
    };
  }

  const counterValue = parseInt(ctr, 16);
  const host = baseUrl || DEFAULT_FALLBACK_HOST;
  // clnrest and proxy use a fixed 1000 msat amount (1 sat) because the
  // LNURL-withdraw callback is a payment trigger, not a user-chosen amount.
  // fakewallet allows the full 1–1 000 000 msat range for POS flexibility.
  const minWithdrawable = paymentMethod === "fakewallet" ? 1 : WITHDRAW_MIN_MSAT;
  const maxWithdrawable = paymentMethod === "fakewallet" ? WITHDRAW_MAX_MSAT_FAKWALLET : WITHDRAW_MIN_MSAT;

  logger.info("Withdraw response constructed", { uidHex, counterValue });

  return {
    tag: "withdrawRequest",
    callback: `${host}/boltcards/api/v1/lnurl/cb/${pHex}`,
    k1: cHex,
    minWithdrawable,
    maxWithdrawable,
    defaultDescription: `Boltcard payment from UID ${uidHex}, counter ${counterValue}`,
  };
};
