export const constructWithdrawResponse = (uidHex, pHex, cHex, ctr, cmac_validated, baseUrl) => {
  if (!cmac_validated) {
    return {
      status: "ERROR",
      reason: "CMAC validation failed or was not performed.",
    };
  }

  const counterValue = parseInt(ctr, 16);
  const host = baseUrl || "https://boltcardpoc.psbt.me";

  return {
    tag: "withdrawRequest",
    callback: `${host}/boltcards/api/v1/lnurl/cb/${pHex}`,
    k1: cHex,
    minWithdrawable: 1000,
    maxWithdrawable: 1000,
    defaultDescription: `Boltcard payment from UID ${uidHex}, counter ${counterValue}`,
  };
};
