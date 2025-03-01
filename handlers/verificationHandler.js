import { hexToBytes, bytesToHex, buildVerificationData, decryptP, computeAesCmacForVerification, getK2KeyForUID } from "../cryptoutils.js";

export async function handleVerification(url, env) {
  const pHex = url.searchParams.get("p");
  const cHex = url.searchParams.get("c");

  if (!pHex || !cHex) {
    return new Response(JSON.stringify({ status: "ERROR", reason: "Missing parameters" }), { status: 400 });
  }

  const k1Keys = env.BOLT_CARD_K1.split(",").map(hexToBytes);
  const cBytes = hexToBytes(cHex);

  if (cBytes.length !== 8) {
    return new Response(JSON.stringify({ status: "ERROR", reason: "Invalid c length" }), { status: 400 });
  }

  // Decrypt pHex
  const { success, uidBytes, ctr, usedK1 } = decryptP(pHex, k1Keys);
  if (!success) {
    return new Response(JSON.stringify({ status: "ERROR", reason: "Unable to decode UID" }), { status: 400 });
  }

  const uidHex = bytesToHex(uidBytes);
  console.log(`[DEBUG] Decrypted UID: ${uidHex}, Counter: ${bytesToHex(ctr)}`);

  // Retrieve the correct K2 key for this UID
  const k2Bytes = getK2KeyForUID(env, uidHex);
  if (!k2Bytes) {
    return new Response(JSON.stringify({ status: "ERROR", reason: `K2 key not found for UID ${uidHex}` }), { status: 400 });
  }

  // Compute verification data (sv2, ks, cm, ct)
  const { sv2, ks, cm, ct } = buildVerificationData(uidBytes, ctr, k2Bytes);

  // Verify CMAC
  const computedCt = computeAesCmacForVerification(sv2, k2Bytes);
  const cmacValid = bytesToHex(computedCt) === bytesToHex(ct);

  console.log(`[DEBUG] CMAC validation: ${cmacValid ? "OK" : "FAIL"}`);

  // Construct response
  const response = {
    tag: "withdrawRequest",
    callback: `https://card.yourdomain.com/withdraw?uid=${uidHex}`,
    k1: uidHex,
    maxWithdrawable: cmacValid ? 100000000 : 1,
    minWithdrawable: cmacValid ? 1000 : 1,
    defaultDescription: `${uidHex}, counter ${bytesToHex(ctr)}, cmac: ${cmacValid ? "OK" : "FAIL"}`
  };

  return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } });
}
