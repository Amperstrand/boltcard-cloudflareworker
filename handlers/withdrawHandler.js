export const constructWithdrawResponse = (uidHex, pHex, cHex, ctr, cmac_validated) => {
  if (!cmac_validated) {
    return {
      status: "ERROR",
      reason: "CMAC validation failed or was not performed.",
    };
  }

  return {
    tag: "withdrawRequest",
    callback: `https://boltcardpoc.psbt.me/boltcards/api/v1/lnurl/cb/${pHex}`,
    k1: cHex,
    minWithdrawable: 1000,
    maxWithdrawable: 1000,
    defaultDescription: `Boltcard payment from UID ${uidHex}, counter ${parseInt(ctr, 16)}`,
    payLink: `lnurlp://boltcardpoc.psbt.me/boltcards/api/v1/lnurlp_not_implemented_yet/${uidHex}/${pHex}/${cHex}`,
  };
};
