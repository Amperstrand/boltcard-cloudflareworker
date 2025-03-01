import AES from "aes-js";

const DEBUG = process.env.DEBUG === "true"; // Toggle verbose logging

export function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export function bytesToDecimalString(bytes) {
  return `[${Array.from(bytes).join(" ")}]`;
}

export function xorArrays(a, b) {
  if (a.length !== b.length) {
    throw new Error("xorArrays: Input arrays must have the same length");
  }
  return a.map((val, i) => val ^ b[i]);
}

export function shiftGo(src) {
  const dst = new Uint8Array(src.length);
  let carry = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const bit = src[i] >> 7;
    dst[i] = ((src[i] << 1) & 0xff) | carry;
    carry = bit;
  }
  return { shifted: dst, carry };
}

export function generateSubkeyGo(input) {
  const { shifted, carry } = shiftGo(input);
  const subkey = new Uint8Array(shifted);
  if (carry) {
    subkey[subkey.length - 1] ^= 0x87;
  }
  return subkey;
}

export function computeAesCmac(message, key) {
  if (DEBUG) console.log("[AES-CMAC] Computing AES-CMAC for message:", bytesToDecimalString(message));
  const blockSize = 16;
  const aesEcb = new AES.ModeOfOperation.ecb(key);
  const zeroBlock = new Uint8Array(blockSize);

  // Step 1: Compute L = AES-ECB(key, 0^16)
  const L = aesEcb.encrypt(zeroBlock);
  if (DEBUG) console.log("[AES-CMAC] Step 1: L =", bytesToDecimalString(L));

  // Step 2: Compute K1 = generateSubkeyGo(L)
  const K1 = generateSubkeyGo(L);
  if (DEBUG) console.log("[AES-CMAC] Step 2: K1 =", bytesToDecimalString(K1));

  let M_last;
  if (message.length === blockSize) {
    M_last = xorArrays(message, K1);
  } else {
    const padded = new Uint8Array(blockSize).fill(0);
    padded.set(message);
    padded[message.length] = 0x80;
    const K2 = generateSubkeyGo(K1);
    if (DEBUG) console.log("[AES-CMAC] Step 2: K2 =", bytesToDecimalString(K2));
    M_last = xorArrays(padded, K2);
  }
  if (DEBUG) console.log("[AES-CMAC] Step 3: M_last =", bytesToDecimalString(M_last));

  const T = aesEcb.encrypt(M_last);
  if (DEBUG) console.log("[AES-CMAC] Step 4: T (CMAC result) =", bytesToDecimalString(T));

  return T;
}

export function computeKs(sv2, cmacKeyBytes) {
  if (DEBUG) console.log("[KS] Computing ks using AES-CMAC(sv2, K2)...");
  const ks = computeAesCmac(sv2, cmacKeyBytes);
  if (DEBUG) console.log("[KS] ks =", bytesToDecimalString(ks));
  return ks;
}

export function computeCm(ks) {
  if (DEBUG) console.log("[CM] Computing cm from ks...");
  const blockSize = 16;
  const aesEcbKs = new AES.ModeOfOperation.ecb(ks);
  const zeroBlock = new Uint8Array(blockSize);

  // Step 1: Compute L' = AES-ECB(ks, 0^16)
  const Lprime = aesEcbKs.encrypt(zeroBlock);
  if (DEBUG) console.log("[CM] Step X: L' =", bytesToDecimalString(Lprime));

  // Step 2: Compute K1' = generateSubkeyGo(L')
  const K1prime = generateSubkeyGo(Lprime);
  if (DEBUG) console.log("[CM] Step X: K1' =", bytesToDecimalString(K1prime));

  // Step 3: Compute h.k1 = generateSubkeyGo(K1')
  const hk1 = generateSubkeyGo(K1prime);
  if (DEBUG) console.log("[CM] Step X: h.k1 =", bytesToDecimalString(hk1));

  // Step 4: Compute Final Hash Input
  const hashVal = new Uint8Array(hk1);
  hashVal[0] ^= 0x80;
  if (DEBUG) console.log("[CM] Step X: Final MAC input (hash) =", bytesToDecimalString(hashVal));

  // Step 5: Compute cm = AES-ECB(ks, hashVal)
  const cm = aesEcbKs.encrypt(hashVal);
  if (DEBUG) console.log("[CM] Step X: Final cm =", bytesToDecimalString(cm));

  return cm;
}

export function computeAesCmacForVerification(sv2, cmacKeyBytes) {
  if (DEBUG) console.log("[VERIFY] Computing AES-CMAC for verification...");
  const ks = computeKs(sv2, cmacKeyBytes);
  const cm = computeCm(ks);
  const ct = new Uint8Array([cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]);
  if (DEBUG) console.log("[VERIFY] ct (extracted from cm) =", bytesToDecimalString(ct));
  return ct;
}
