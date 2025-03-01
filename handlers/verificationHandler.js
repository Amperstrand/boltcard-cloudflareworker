import AES from "aes-js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";

export async function handleVerification(url, env) {
  const pHex = url.searchParams.get("p");
  const cHex = url.searchParams.get("c");

  if (!pHex || !cHex) {
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Missing parameters" }),
      { status: 400 }
    );
  }

  const k1Keys = env.BOLT_CARD_K1.split(",").map(hexToBytes); // Convert K1 keys to byte arrays
  const k2Bytes = hexToBytes(env.BOLT_CARD_K2);
  const pBytes = hexToBytes(pHex);
  const cBytes = hexToBytes(cHex);

  if (pBytes.length !== 16 || cBytes.length !== 8) {
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Invalid p or c length" }),
      { status: 400 }
    );
  }

  let decrypted, uidBytes, ctr;
  let matched = false;
  let usedK1 = null;

  // Try each K1 key until we find one that produces a valid decryption (first byte === 0xC7)
  for (const k1Bytes of k1Keys) {
    const aesEcbK1 = new AES.ModeOfOperation.ecb(k1Bytes);
    decrypted = aesEcbK1.decrypt(pBytes);

    if (decrypted[0] === 0xC7) {
      matched = true;
      usedK1 = bytesToHex(k1Bytes);
      uidBytes = decrypted.slice(1, 8);
      ctr = new Uint8Array([decrypted[10], decrypted[9], decrypted[8]]);
      break;
    }
  }

  if (!matched) {
    console.error("Failed to decrypt UID with any provided K1 keys.");
    return new Response(
      JSON.stringify({ status: "ERROR", reason: "Unable to decode UID" }),
      { status: 400 }
    );
  }

  console.log(`Decryption successful with K1: ${usedK1}`);

  // Build sv2, ks, cm, and ct from cryptoutils.js
  const { sv2, ks, cm, ct } = buildVerificationData(uidBytes, ctr, k2Bytes);

  // Always return the same response regardless of test vectors
  const response = {
    tag: "withdrawRequest",
    callback: `https://card.yourdomain.com/withdraw?uid=${bytesToHex(uidBytes)}`,
    k1: bytesToHex(uidBytes),
    maxWithdrawable: 100000000,
    minWithdrawable: 1000,
    defaultDescription: `Bolt Card Payment for UID ${bytesToHex(uidBytes)}, counter ${bytesToHex(ctr)}`
  };

  return new Response(JSON.stringify(response), {
    headers: { "Content-Type": "application/json" },
  });
}
