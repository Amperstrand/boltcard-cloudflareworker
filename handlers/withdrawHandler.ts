import { logger } from "../utils/logger.js";
import { DEFAULT_FALLBACK_HOST, WITHDRAW_MIN_MSAT, WITHDRAW_MAX_MSAT_FAKWALLET, PAYMENT_METHOD } from "../utils/constants.js";

export interface WithdrawResponse {
  status?: string;
  reason?: string;
  tag?: string;
  callback?: string;
  k1?: string;
  minWithdrawable?: number;
  maxWithdrawable?: number;
  defaultDescription?: string;
}

export const constructWithdrawResponse = (
  uidHex: string,
  pHex: string,
  cHex: string,
  ctr: string,
  cmac_validated: boolean,
  baseUrl: string,
  paymentMethod: string = PAYMENT_METHOD.FAKEWALLET
): WithdrawResponse => {
  if (!cmac_validated) {
    logger.warn("Withdraw response rejected: CMAC validation failed", { uidHex });
    return {
      status: "ERROR",
      reason: "CMAC validation failed or was not performed.",
    };
  }

  const rawCounter = parseInt(ctr, 16);
  if (!Number.isFinite(rawCounter)) return { status: "ERROR", reason: "Invalid counter value" };
  const counterValue = rawCounter;
  const host = baseUrl || DEFAULT_FALLBACK_HOST;
  const minWithdrawable = paymentMethod === PAYMENT_METHOD.FAKEWALLET ? 1 : WITHDRAW_MIN_MSAT;
  const maxWithdrawable = paymentMethod === PAYMENT_METHOD.FAKEWALLET ? WITHDRAW_MAX_MSAT_FAKWALLET : WITHDRAW_MIN_MSAT;

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
