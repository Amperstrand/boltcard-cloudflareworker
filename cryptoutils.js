import AES from "aes-js";

const DEBUG = true;

export function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
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

  const L = aesEcb.encrypt(zeroBlock);
  if (DEBUG) console.log("[AES-CMAC] Step 1: L =", bytesToDecimalString(L));

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

  const Lprime = aesEcbKs.encrypt(zeroBlock);
  if (DEBUG) console.log("[CM] Step X: L' =", bytesToDecimalString(Lprime));

  const K1prime = generateSubkeyGo(Lprime);
  if (DEBUG) console.log("[CM] Step X: K1' =", bytesToDecimalString(K1prime));

  const hk1 = generateSubkeyGo(K1prime);
  if (DEBUG) console.log("[CM] Step X: h.k1 =", bytesToDecimalString(hk1));

  const hashVal = new Uint8Array(hk1);
  hashVal[0] ^= 0x80;
  if (DEBUG) console.log("[CM] Step X: Final MAC input (hash) =", bytesToDecimalString(hashVal));

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

export function buildVerificationData(uidBytes, ctr, k2Bytes) {
  const sv2 = new Uint8Array(16);
  sv2.set([0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]);
  sv2.set(uidBytes, 6);
  sv2[13] = ctr[2];
  sv2[14] = ctr[1];
  sv2[15] = ctr[0];

  const ks = computeKs(sv2, k2Bytes);
  const cm = computeCm(ks);

  const ct = new Uint8Array([
    cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]
  ]);

  return { sv2, ks, cm, ct };
}

// Function to decrypt p and extract UID, counter, etc.
export function decryptP(pHex, k1Keys) {
  const pBytes = hexToBytes(pHex);

  if (pBytes.length !== 16) {
    throw new Error("Invalid p length. Expected 16 bytes.");
  }

  let decrypted, uidBytes, ctr, usedK1 = null;

  for (const k1Bytes of k1Keys) {
    const aesEcbK1 = new AES.ModeOfOperation.ecb(k1Bytes);
    decrypted = aesEcbK1.decrypt(pBytes);

    if (decrypted[0] === 0xC7) {
      usedK1 = k1Bytes;
      uidBytes = decrypted.slice(1, 8);
      ctr = new Uint8Array([decrypted[10], decrypted[9], decrypted[8]]);
      return { success: true, uidBytes, ctr, usedK1 };
    }
  }

  return { success: false };
}

// Function to retrieve K2 key for a specific UID from environment variables
export function getK2KeyForUID(env, uidHex) {
  const k2Hex = env[`K2_${uidHex.toUpperCase()}`];

  if (!k2Hex) {
    console.error(`[ERROR] No K2 key found for UID: ${uidHex}`);
    return null;
  }

  if (DEBUG) console.log(`[DEBUG] Found K2 key for UID ${uidHex}: ${k2Hex}`);
  return hexToBytes(k2Hex);
}

