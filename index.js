// Import aes-js (Cloudflare Workers compatible)
import AES from "aes-js";

////////////////////////////////////////////////////////////
// Helper Functions
////////////////////////////////////////////////////////////

/**
 * Convert a hex string into a Uint8Array.
 */
function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

/**
 * Convert a Uint8Array to a hex string.
 */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert a Uint8Array to a formatted decimal string (for debugging).
 */
function bytesToDecimalString(bytes) {
  return `[${Array.from(bytes).join(" ")}]`;
}

/**
 * XOR two byte arrays (assumes same length).
 */
function xorArrays(a, b) {
  if (a.length !== b.length) {
    throw new Error("xorArrays: Input arrays must have the same length");
  }
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

/**
 * Go's shift function.
 * Iterates from the last byte down to the first, shifting left by one bit
 * and propagating the carry.
 */
function shiftGo(src) {
  const dst = new Uint8Array(src.length);
  let carry = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const bit = src[i] >> 7; // Extract MSB of src[i]
    dst[i] = ((src[i] << 1) & 0xff) | carry;
    carry = bit;
  }
  return { shifted: dst, carry };
}

/**
 * Generate a subkey using Go's algorithm.
 * Given a 16-byte input, shift it left one bit and if the final carry is 1, XOR the last byte with 0x87.
 */
function generateSubkeyGo(input) {
  const { shifted, carry } = shiftGo(input);
  const subkey = new Uint8Array(shifted);
  if (carry) {
    subkey[subkey.length - 1] ^= 0x87;
  }
  return subkey;
}

/**
 * Compute AES-CMAC following RFC 4493 exactly as in the Go implementation.
 * This is used to compute ks = AES-CMAC(sv2, K2).
 */
function computeAesCmac(message, key) {
  console.log("Computing AES-CMAC for message:", bytesToDecimalString(message));
  const blockSize = 16;
  const aesEcb = new AES.ModeOfOperation.ecb(key);
  const zeroBlock = new Uint8Array(blockSize);

  // Step 1: Compute L = AES-ECB(key, 0^16)
  const L = aesEcb.encrypt(zeroBlock);
  console.log("Step 1: L = ", bytesToDecimalString(L));

  // Step 2: Compute K1 = generateSubkeyGo(L)
  const K1 = generateSubkeyGo(L);
  console.log("Step 2: K1 = ", bytesToDecimalString(K1));

  let M_last;
  if (message.length === blockSize) {
    M_last = xorArrays(message, K1);
  } else {
    // For non-full block, pad message with 0x80 then zeros and XOR with K2.
    const padded = new Uint8Array(blockSize).fill(0);
    padded.set(message);
    padded[message.length] = 0x80;
    const K2 = generateSubkeyGo(K1);
    console.log("Step 2: K2 = ", bytesToDecimalString(K2));
    M_last = xorArrays(padded, K2);
  }
  console.log("Step 3: M_last = ", bytesToDecimalString(M_last));

  // Step 4: Compute T = AES-ECB(key, M_last)
  const T = aesEcb.encrypt(M_last);
  console.log("Step 4: T (CMAC result) = ", bytesToDecimalString(T));

  return T;
}

/**
 * Compute ks = AES-CMAC(sv2, K2) exactly as in Go.
 */
function computeKs(sv2, cmacKeyBytes) {
  console.log("Computing ks using AES-CMAC(sv2, K2)...");
  const ks = computeAesCmac(sv2, cmacKeyBytes);
  console.log("ks = ", bytesToDecimalString(ks));
  return ks;
}

/**
 * Compute cm from ks following Go's finalization.
 * Mimics:
 *  - L' = AES-ECB(ks, 0^16)
 *  - K1' = generateSubkeyGo(L')
 *  - h.k1 = generateSubkeyGo(K1')
 *  - hash = h.k1 with hash[0] ^= 0x80
 *  - cm = AES-ECB(ks, hash)
 */
function computeCm(ks) {
  console.log("Computing cm from ks...");
  const blockSize = 16;
  const aesEcbKs = new AES.ModeOfOperation.ecb(ks);
  const zeroBlock = new Uint8Array(blockSize);

  // Compute L' = AES-ECB(ks, 0^16)
  const Lprime = aesEcbKs.encrypt(zeroBlock);
  console.log("Step X: L' = ", bytesToDecimalString(Lprime));

  // Compute K1' = generateSubkeyGo(L')
  const K1prime = generateSubkeyGo(Lprime);
  console.log("Step X: K1' = ", bytesToDecimalString(K1prime));

  // Compute h.k1 = generateSubkeyGo(K1')
  const hk1 = generateSubkeyGo(K1prime);
  console.log("Step X: h.k1 = ", bytesToDecimalString(hk1));

  // For empty message, copy h.k1 then modify: hash[0] ^= 0x80
  const hashVal = new Uint8Array(hk1);
  hashVal[0] ^= 0x80;
  console.log("Step X: Final MAC input (hash) = ", bytesToDecimalString(hashVal));

  // Compute cm = AES-ECB(ks, hashVal)
  const cm = aesEcbKs.encrypt(hashVal);
  console.log("Step X: Final cm = ", bytesToDecimalString(cm));
  return cm;
}

/**
 * Compute the final MAC verification value:
 * - ks = AES-CMAC(sv2, K2)
 * - cm = computeCm(ks)
 * - ct = bytes at indices 1,3,5,7,9,11,13,15 of cm
 */
function computeAesCmacForVerification(sv2, cmacKeyBytes) {
  console.log("Computing AES-CMAC for verification...");
  const ks = computeKs(sv2, cmacKeyBytes);
  const cm = computeCm(ks);
  const ct = Uint8Array.of(cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]);
  console.log("ct (extracted from cm) = ", bytesToDecimalString(ct));
  return ct;
}

////////////////////////////////////////////////////////////
// Cloudflare Worker Fetch Handler
////////////////////////////////////////////////////////////

export default {
  async fetch(request, env) {
    console.log("\n-- bolt card crypto test vectors --\n");

    // Retrieve query parameters p and c
    const url = new URL(request.url);
    const pHex = url.searchParams.get("p");
    const cHex = url.searchParams.get("c");
    if (!pHex || !cHex) {
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "Missing parameters" }),
        { status: 400 }
      );
    }
    console.log("p = ", pHex);
    console.log("c = ", cHex);

    // Load environment keys (available in wrangler.toml)
    // K1: decryption key; K2: authentication (CMAC) key.
    const k1Hex = env.BOLT_CARD_K1?.trim();
    const k2Hex = env.BOLT_CARD_K2?.trim();
    if (!k1Hex || !k2Hex) {
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "Missing keys" }),
        { status: 500 }
      );
    }
    console.log("aes_decrypt_key (K1) = ", k1Hex);
    console.log("aes_cmac_key (K2) = ", k2Hex, "\n");

    const k1Bytes = hexToBytes(k1Hex);
    const k2Bytes = hexToBytes(k2Hex);
    const pBytes = hexToBytes(pHex);
    const cBytes = hexToBytes(cHex);
    if (pBytes.length !== 16 || cBytes.length !== 8) {
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "Invalid p or c length" }),
        { status: 400 }
      );
    }

    // Decrypt p using AES-ECB with K1 to obtain the PICCData.
    console.log("Decrypting p using AES-ECB (K1)...");
    const aesEcbK1 = new AES.ModeOfOperation.ecb(k1Bytes);
    const decrypted = aesEcbK1.decrypt(pBytes);
    console.log("Decrypted block:", bytesToHex(decrypted));
    if (decrypted[0] !== 0xC7) {
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "Invalid card data" }),
        { status: 400 }
      );
    }

    // Extract UID (bytes 1-7) and counter (bytes 8-10)
    const uidBytes = decrypted.slice(1, 8);
    // In Go: ctr[0]=decrypted[10], ctr[1]=decrypted[9], ctr[2]=decrypted[8]
    const ctr = new Uint8Array([decrypted[10], decrypted[9], decrypted[8]]);
    console.log("decrypted card data : uid", bytesToHex(uidBytes), ", ctr", bytesToHex(ctr));

    // Build sv2 as in Go:
    // sv2[0..5] = [0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]
    // sv2[6..12] = uid (7 bytes)
    // sv2[13] = ctr[2], sv2[14] = ctr[1], sv2[15] = ctr[0]
    const sv2 = new Uint8Array(16);
    sv2.set([0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]);
    sv2.set(uidBytes, 6);
    sv2[13] = ctr[2];
    sv2[14] = ctr[1];
    sv2[15] = ctr[0];
    console.log("sv2 = ", bytesToDecimalString(sv2));
    // Expected sv2: [60 195 0 1 0 128 4 153 108 106 146 105 128 3 0 0]

    // Compute the MAC verification value:
    // 1. ks = AES-CMAC(sv2, K2)
    // 2. cm = computeCm(ks) following Go's finalization.
    // 3. ct = extract bytes 1,3,5,7,9,11,13,15 from cm.
    const computedCmac = computeAesCmacForVerification(sv2, k2Bytes);
    const computedCmacHex = bytesToHex(computedCmac);
    console.log("Computed CMAC (ct):", computedCmacHex);
    console.log("Provided CMAC:", bytesToHex(cBytes));

    if (computedCmacHex !== bytesToHex(cBytes)) {
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "CMAC verification failed" }),
        { status: 400 }
      );
    }

    console.log("cmac validates ok\n");

    // Now, build the full LNUrl Withdraw response as a real Boltcard server would.
    // For example:
    const uidHex = bytesToHex(uidBytes);
    const ctrHex = bytesToHex(ctr);
    const lnurlwResponse = {
      tag: "withdrawRequest",
      callback: `https://card.yourdomain.com/withdraw?uid=${uidHex}`,
      k1: uidHex, // For demonstration; in production, use a secure random value.
      maxWithdrawable: 100000000,  // Maximum amount in millisatoshis.
      minWithdrawable: 1000,        // Minimum amount in millisatoshis.
      defaultDescription: `Bolt Card Payment for UID ${uidHex}, counter ${ctrHex}`
    };
    console.log("LNUrl Withdraw response:", JSON.stringify(lnurlwResponse, null, 2));

    return new Response(JSON.stringify(lnurlwResponse), {
      headers: { "Content-Type": "application/json" }
    });
  }
};

