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
  verifiableCredential?: string;
}

export const constructWithdrawResponse = (
  uidHex: string,
  pHex: string,
  cHex: string,
  ctr: string,
  cmac_validated: boolean,
  baseUrl: string,
  paymentMethod: string = PAYMENT_METHOD.FAKEWALLET,
  k1Hex?: string
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

  logger.info("Withdraw response constructed", { uidHex, counterValue, k1Fresh: k1Hex !== undefined });

  return {
    tag: "withdrawRequest",
    callback: `${host}/boltcards/api/v1/lnurl/cb/${pHex}`,
    // K1_FRESH (audit #13): a random server-stored challenge replaces the
    // k1=c convention when the flag is on (Go parity: 16 random bytes,
    // single-use, TTL). Default stays k1=c — the boltcard-POS/HIL convention.
    k1: k1Hex ?? cHex,
    minWithdrawable,
    maxWithdrawable,
    defaultDescription: `Boltcard payment #${counterValue}`,
  };
};
