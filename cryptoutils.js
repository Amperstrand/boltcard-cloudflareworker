import AES from "aes-js";

const DEBUG = false;
const BLOCK_SIZE = 16; // AES block size in bytes

/**
 * Converts a hex string to a Uint8Array.
 * @param {string} hex - The hex string.
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  return new Uint8Array(
    hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );
}

/**
 * Converts a Uint8Array to a hex string.
 * @param {Uint8Array} bytes - The byte array.
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Returns a string of decimal values for the given bytes.
 * @param {Uint8Array} bytes - The byte array.
 * @returns {string}
 */
export function bytesToDecimalString(bytes) {
  return `[${Array.from(bytes).join(" ")}]`;
}

/**
 * XORs two arrays of equal length.
 * @param {Uint8Array} a - First byte array.
 * @param {Uint8Array} b - Second byte array.
 * @returns {number[]}
 */
export function xorArrays(a, b) {
  if (a.length !== b.length) {
    throw new Error("xorArrays: Input arrays must have the same length");
  }
  return a.map((val, i) => val ^ b[i]);
}

/**
 * Shifts the bits of the source array to the left by one.
 * Returns the shifted array and the carry-out bit.
 * @param {Uint8Array} src - Source byte array.
 * @returns {{ shifted: Uint8Array, carry: number }}
 */
export function shiftGo(src) {
  const shifted = new Uint8Array(src.length);
  let carry = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const msb = src[i] >> 7; // Extract the most significant bit.
    shifted[i] = ((src[i] << 1) & 0xff) | carry;
    carry = msb;
  }
  return { shifted, carry };
}

/**
 * Generates a subkey as required by the AES-CMAC algorithm.
 * @param {Uint8Array} input - Input block.
 * @returns {Uint8Array}
 */
export function generateSubkeyGo(input) {
  const { shifted, carry } = shiftGo(input);
  const subkey = new Uint8Array(shifted);
  if (carry) {
    subkey[subkey.length - 1] ^= 0x87;
  }
  return subkey;
}

/**
 * Computes the AES-CMAC for a given message and key.
 * @param {Uint8Array} message - The input message.
 * @param {Uint8Array} key - The AES key.
 * @returns {Uint8Array} - The CMAC result.
 */
export function computeAesCmac(message, key) {
  if (DEBUG)
    console.log(
      "[AES-CMAC] Computing AES-CMAC for message:",
      bytesToDecimalString(message)
    );

  const aesEcb = new AES.ModeOfOperation.ecb(key);
  const zeroBlock = new Uint8Array(BLOCK_SIZE);

  // Step 1: Encrypt the zero block to produce L.
  const L = aesEcb.encrypt(zeroBlock);
  if (DEBUG) console.log("[AES-CMAC] Step 1: L =", bytesToDecimalString(L));

  // Step 2: Generate K1 from L.
  const K1 = generateSubkeyGo(L);
  if (DEBUG) console.log("[AES-CMAC] Step 2: K1 =", bytesToDecimalString(K1));

  let M_last;
  if (message.length === BLOCK_SIZE) {
    // If the message length is exactly one block, XOR with K1.
    M_last = xorArrays(message, K1);
  } else {
    // Otherwise, pad the message and XOR with K2.
    const padded = new Uint8Array(BLOCK_SIZE);
    padded.fill(0);
    padded.set(message);
    padded[message.length] = 0x80; // Padding: append 0x80.
    const K2 = generateSubkeyGo(K1);
    if (DEBUG)
      console.log("[AES-CMAC] Step 2: K2 =", bytesToDecimalString(K2));
    M_last = xorArrays(padded, K2);
  }

  if (DEBUG)
    console.log("[AES-CMAC] Step 3: M_last =", bytesToDecimalString(M_last));

  // Step 4: Encrypt the last block to produce the CMAC.
  const T = aesEcb.encrypt(M_last);
  if (DEBUG)
    console.log(
      "[AES-CMAC] Step 4: T (CMAC result) =",
      bytesToDecimalString(T)
    );

  return T;
}

/**
 * Computes the session key (ks) using AES-CMAC.
 * @param {Uint8Array} sv2 - The session derivation value.
 * @param {Uint8Array} cmacKeyBytes - The key used for AES-CMAC.
 * @returns {Uint8Array}
 */
export function computeKs(sv2, cmacKeyBytes) {
  if (DEBUG)
    console.log("[KS] Computing ks using AES-CMAC(sv2, K2)...");
  const ks = computeAesCmac(sv2, cmacKeyBytes);
  if (DEBUG) console.log("[KS] ks =", bytesToDecimalString(ks));
  return ks;
}

/**
 * Computes the cm value from the session key.
 * @param {Uint8Array} ks - The session key.
 * @returns {Uint8Array}
 */
export function computeCm(ks) {
  if (DEBUG) console.log("[CM] Computing cm from ks...");

  const aesEcbKs = new AES.ModeOfOperation.ecb(ks);
  const zeroBlock = new Uint8Array(BLOCK_SIZE);

  // Derive Lprime from encrypting a zero block.
  const Lprime = aesEcbKs.encrypt(zeroBlock);
  if (DEBUG) console.log("[CM] Step X: L' =", bytesToDecimalString(Lprime));

  // Generate K1prime from Lprime.
  const K1prime = generateSubkeyGo(Lprime);
  if (DEBUG)
    console.log("[CM] Step X: K1' =", bytesToDecimalString(K1prime));

  // Generate an intermediate key hk1 from K1prime.
  const hk1 = generateSubkeyGo(K1prime);
  if (DEBUG) console.log("[CM] Step X: h.k1 =", bytesToDecimalString(hk1));

  // Modify the first byte of hk1.
  const hashVal = new Uint8Array(hk1);
  hashVal[0] ^= 0x80;
  if (DEBUG)
    console.log(
      "[CM] Step X: Final MAC input (hash) =",
      bytesToDecimalString(hashVal)
    );

  // Encrypt hashVal to produce the final cm.
  const cm = aesEcbKs.encrypt(hashVal);
  if (DEBUG)
    console.log("[CM] Step X: Final cm =", bytesToDecimalString(cm));

  return cm;
}

/**
 * Computes AES-CMAC for verification and extracts a verification tag.
 * @param {Uint8Array} sv2 - The session derivation value.
 * @param {Uint8Array} cmacKeyBytes - The key used for AES-CMAC.
 * @returns {Uint8Array} - The verification tag.
 */
export function computeAesCmacForVerification(sv2, cmacKeyBytes) {
  if (DEBUG)
    console.log("[VERIFY] Computing AES-CMAC for verification...");
  const ks = computeKs(sv2, cmacKeyBytes);
  const cm = computeCm(ks);

  // Extract verification tag from cm.
  const ct = new Uint8Array([
    cm[1],
    cm[3],
    cm[5],
    cm[7],
    cm[9],
    cm[11],
    cm[13],
    cm[15],
  ]);
  if (DEBUG)
    console.log("[VERIFY] ct (extracted from cm) =", bytesToDecimalString(ct));

  return ct;
}

/**
 * Builds verification data using UID, counter, and the K2 key.
 * @param {Uint8Array} uidBytes - The UID from the card.
 * @param {Uint8Array} ctr - The counter (3 bytes).
 * @param {Uint8Array} k2Bytes - The K2 key.
 * @returns {{ sv2: Uint8Array, ks: Uint8Array, cm: Uint8Array, ct: Uint8Array }}
 */
export function buildVerificationData(uidBytes, ctr, k2Bytes) {
  const sv2 = new Uint8Array(BLOCK_SIZE);
  // Set fixed header values.
  sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]);
  // Place UID starting at index 6.
  sv2.set(uidBytes, 6);
  // Set counter bytes in reverse order.
  sv2[13] = ctr[2];
  sv2[14] = ctr[1];
  sv2[15] = ctr[0];

  const ks = computeKs(sv2, k2Bytes);
  const cm = computeCm(ks);

  // Extract verification tag.
  const ct = new Uint8Array([
    cm[1],
    cm[3],
    cm[5],
    cm[7],
    cm[9],
    cm[11],
    cm[13],
    cm[15],
  ]);

  return { sv2, ks, cm, ct };
}

/**
 * Decrypts the given hex-encoded payload and extracts UID and counter.
 * @param {string} pHex - The payload in hex string form.
 * @param {Array<Uint8Array>} k1Keys - An array of possible K1 keys.
 * @returns {{ success: boolean, uidBytes?: Uint8Array, ctr?: Uint8Array, usedK1?: Uint8Array }}
 */
export function decryptP(pHex, k1Keys) {
  const pBytes = hexToBytes(pHex);
  if (pBytes.length !== BLOCK_SIZE) {
    throw new Error("Invalid p length. Expected 16 bytes.");
  }

  let decrypted, uidBytes, ctr, usedK1 = null;
  for (const k1Bytes of k1Keys) {
    const aesEcbK1 = new AES.ModeOfOperation.ecb(k1Bytes);
    decrypted = aesEcbK1.decrypt(pBytes);

    // Look for the expected header byte.
    if (decrypted[0] === 0xc7) {
      usedK1 = k1Bytes;
      uidBytes = decrypted.slice(1, 8);
      // Counter is stored in reverse order.
      ctr = new Uint8Array([decrypted[10], decrypted[9], decrypted[8]]);
      return { success: true, uidBytes, ctr, usedK1 };
    }
  }

  return { success: false };
}

/**
 * Verifies the CMAC by building the expected verification tag and comparing it to the provided value.
 * @param {Uint8Array} uidBytes - The UID bytes.
 * @param {Uint8Array} ctr - The counter bytes.
 * @param {string} cHex - The provided CMAC as a hex string.
 * @param {Uint8Array} k2Bytes - The K2 key.
 * @returns {{ cmac_validated: boolean, cmac_error: string|null }}
 */
export function verifyCmac(uidBytes, ctr, cHex, k2Bytes) {
  const { ct } = buildVerificationData(uidBytes, ctr, k2Bytes);
  if (!ct) { throw new Error('ct is undefined!'); }
  const computedCmacHex = bytesToHex(ct).toLowerCase();
  const providedCmac = cHex.toLowerCase();
  const cmac_validated = computedCmacHex === providedCmac;
  return {
    cmac_validated,
    cmac_error: cmac_validated
      ? null
      : `CMAC validation failed: expected ${computedCmacHex}, received ${providedCmac}`
  };
}
