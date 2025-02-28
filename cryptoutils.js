// cryptoUtils.js

import AES from "aes-js";

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
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
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
    const padded = new Uint8Array(blockSize).fill(0);
    padded.set(message);
    padded[message.length] = 0x80;
    const K2 = generateSubkeyGo(K1);
    console.log("Step 2: K2 = ", bytesToDecimalString(K2));
    M_last = xorArrays(padded, K2);
  }
  console.log("Step 3: M_last = ", bytesToDecimalString(M_last));

  const T = aesEcb.encrypt(M_last);
  console.log("Step 4: T (CMAC result) = ", bytesToDecimalString(T));

  return T;
}

export function computeKs(sv2, cmacKeyBytes) {
  console.log("Computing ks using AES-CMAC(sv2, K2)...");
  const ks = computeAesCmac(sv2, cmacKeyBytes);
  console.log("ks = ", bytesToDecimalString(ks));
  return ks;
}

export function computeCm(ks) {
  console.log("Computing cm from ks...");
  const blockSize = 16;
  const aesEcbKs = new AES.ModeOfOperation.ecb(ks);
  const zeroBlock = new Uint8Array(blockSize);

  const Lprime = aesEcbKs.encrypt(zeroBlock);
  console.log("Step X: L' = ", bytesToDecimalString(Lprime));

  const K1prime = generateSubkeyGo(Lprime);
  console.log("Step X: K1' = ", bytesToDecimalString(K1prime));

  const hk1 = generateSubkeyGo(K1prime);
  console.log("Step X: h.k1 = ", bytesToDecimalString(hk1));

  const hashVal = new Uint8Array(hk1);
  hashVal[0] ^= 0x80;
  console.log("Step X: Final MAC input (hash) = ", bytesToDecimalString(hashVal));

  const cm = aesEcbKs.encrypt(hashVal);
  console.log("Step X: Final cm = ", bytesToDecimalString(cm));
  return cm;
}

export function computeAesCmacForVerification(sv2, cmacKeyBytes) {
  console.log("Computing AES-CMAC for verification...");
  const ks = computeKs(sv2, cmacKeyBytes);
  const cm = computeCm(ks);
  const ct = new Uint8Array([cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]);
  console.log("ct (extracted from cm) = ", bytesToDecimalString(ct));
  return ct;
}
