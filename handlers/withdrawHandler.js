import { logger } from "../utils/logger.js";

export const constructWithdrawResponse = (uidHex, pHex, cHex, ctr, cmac_validated, baseUrl, paymentMethod = "fakewallet") => {
  if (!cmac_validated) {
    logger.warn("Withdraw response rejected: CMAC validation failed", { uidHex });
    return {
      status: "ERROR",
      reason: "CMAC validation failed or was not performed.",
    };
  }

  const counterValue = parseInt(ctr, 16);
  const host = baseUrl || "https://boltcardpoc.psbt.me";
  const minWithdrawable = paymentMethod === "fakewallet" ? 1 : 1000;
  const maxWithdrawable = paymentMethod === "fakewallet" ? 1000000 : 1000;

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
