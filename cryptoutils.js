/**
 * cryptoutils.js — Core cryptographic primitives for BoltCard SUN/SDM verification
 *
 * Implements Subsystem B (backend verification channel) of the NTAG 424 DNA architecture
 * as described in NXP AN12196 Rev. 2.0:
 *   - §3: SDM / SUN overview
 *   - §4: Byte order conventions (LSB-first for params, MSB-first for crypto)
 *   - §5.5: PICCData / PICCENCData (encrypted UID + counter)
 *   - §5.7: SDMMAC (truncated CMAC over dynamic NDEF data)
 *
 * AES-CMAC implementation follows RFC 4493.
 *
 * IMPORTANT — BoltCard protocol deviations from NTAG424 standard SDM:
 *   1. CMAC truncation: BoltCard extracts odd-indexed bytes [cm[1],cm[3],..,cm[15]]
 *      (forward order). Standard NTAG424 MACt uses S14||S12||..||S0 (even bytes, reverse).
 *   2. CMAC input: BoltCard computes CMAC over an empty message for the verification tag,
 *      whereas standard SDM MACs over the dynamic ASCII file data.
 *   These deviations are part of the boltcard.org protocol specification.
 *
 * Ref: docs/ntag424_llm_context.md §4 (byte order), §5.4-5.7 (SDM keys & MAC)
 */
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
 * Per RFC 4493: https://datatracker.ietf.org/doc/html/rfc4493
 * Ref: NXP AN12196 §4 (CMAC used throughout SDM/SSM)
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
 * Computes the BoltCard verification tag from SV2 and K2.
 *
 * Derivation chain:
 *   1. ks = AES-CMAC(K2, SV2)  — SDM session MAC key (NXP AN12196 §5.4)
 *   2. cm = AES-CMAC(ks, empty_message) — BoltCard-specific: MACs over empty data
 *   3. ct = cm[1,3,5,7,9,11,13,15] — BoltCard truncation (odd-indexed bytes)
 *
 * NOTE: Standard NTAG424 SDM MACt uses S14||S12||S10||S8||S6||S4||S2||S0
 * (even-indexed bytes, reverse order). The BoltCard protocol uses a different
 * truncation — do NOT change this to match the NXP spec or all cards will fail.
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
 * Builds the SV2 (Session Derivation Value 2) used for SDM MAC key derivation.
 *
 * Per NXP AN12196 §5.4: SV2 = 3CC3 0001 0080 [UID] [SDMReadCtr] [ZeroPadding]
 *   - 0x3C 0xC3: fixed magic bytes for MAC key derivation (SV1 uses C3 3C for ENC)
 *   - 0x00 0x01 0x00 0x80: fixed constants
 *   - UID: 7-byte card UID (MSB-first, per §4 crypto byte order)
 *   - SDMReadCtr: 3-byte counter (little-endian in this implementation,
 *     matching the byte order from the decrypted p-parameter)
 *
 * Counter byte order: the ctr array comes from decryptP() which extracts
 * [decrypted[10], decrypted[9], decrypted[8]] — this is big-endian (MSB first).
 * SV2 places ctr[2] at offset 13 (LSB), ctr[0] at offset 15 (MSB).
 * Net effect: counter in SV2 is little-endian (same as in the p-plaintext).
 */
export function buildVerificationData(uidBytes, ctr, k2Bytes) {
  const sv2 = new Uint8Array(BLOCK_SIZE);
  sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]);
  sv2.set(uidBytes, 6);
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
 * Decrypts the `p` parameter (PICCENCData) and extracts UID + SDMReadCtr.
 *
 * Per NXP AN12196 §5.5: PICCENCData = E(K1; PICCDataTag || UID || SDMReadCtr || RandomPadding)
 *   - PICCDataTag 0xC7 = UID mirrored (bit7) + counter mirrored (bit6) + 7-byte UID (bits 3..0)
 *   - Uses AES-128-ECB (single block, no IV) with K1 as key
 *   - SDMReadCtr bytes 8-10 are little-endian (LSB at byte 8), per §4
 *
 * Multi-K1: tries each candidate K1 until one produces the 0xC7 header byte.
 * Probability of false positive is 1/256 per wrong key. Ref: boltcard-protocol.md §8.
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
  
  // SECURITY: Return generic error message to prevent oracle attacks.
  // Including expected/received CMAC values in error responses leaks the
  // session MAC key derivative to the client, enabling attackers to verify
  // guesses without knowing the key (oracle attack pattern).
  //
  // Server-side debugging can log the mismatch separately if needed.
  // See: NXP AN12196 §5.7 (SDMMAC verification), ntag424-js pattern.
  return {
    cmac_validated,
    cmac_error: cmac_validated
      ? null
      : 'CMAC validation failed'
  };
}
