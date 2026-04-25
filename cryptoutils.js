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
import { hex as scureHex } from "@scure/base";
import { logger } from "./utils/logger.js";

const BLOCK_SIZE = 16;

export function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Invalid hex string: contains non-hex characters");
  }
  return scureHex.decode(hex.toLowerCase());
}

export function bytesToHex(bytes) {
  return scureHex.encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/**
 * Returns a string of decimal values for the given bytes.
 * @param {Uint8Array} bytes - The byte array.
 * @returns {string}
 */
export function _bytesToDecimalString(bytes) {
  return `[${Array.from(bytes).join(" ")}]`;
}

/**
 * XORs two arrays of equal length.
 * @param {Uint8Array} a - First byte array.
 * @param {Uint8Array} b - Second byte array.
 * @returns {Uint8Array}
 */
export function _xorArrays(a, b) {
  if (a.length !== b.length) {
    throw new Error("_xorArrays: Input arrays must have the same length");
  }
  // Return Uint8Array for type consistency with the rest of the crypto layer.
  // Array.prototype.map on a Uint8Array returns a plain Array, so we must
  // explicitly wrap the result.
  return new Uint8Array(a.map((val, i) => val ^ b[i]));
}

/**
 * Shifts the bits of the source array to the left by one.
 * Returns the shifted array and the carry-out bit.
 * @param {Uint8Array} src - Source byte array.
 * @returns {{ shifted: Uint8Array, carry: number }}
 */
export function _shiftGo(src) {
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
export function _generateSubkeyGo(input) {
  const { shifted, carry } = _shiftGo(input);
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
  // RFC 4493 §2.3: AES-CMAC is defined for AES-128 (16-byte key only).
  // aes-js silently accepts wrong-length keys and produces garbage CMAC output.
  // A misconfigured 15 or 17-byte key would cause all CMAC validations to
  // silently fail, accepting or rejecting all taps without any error message —
  // extremely difficult to debug. Fail fast with a clear message.
  if (!(key instanceof Uint8Array) || key.length !== 16) {
    throw new Error("AES-CMAC requires a 16-byte key (AES-128), per RFC 4493 §2.3");
  }

  // Guard: this implementation only handles 0 or 1 block messages (≤16 bytes).
  // RFC 4493 §2.4 defines multi-block CMAC with CBC chaining (Algorithm 3,
  // steps 5-6), but all BoltCard protocol messages are single-block:
  //   - SV2 session vector = 16 bytes (exactly one block)
  //   - Empty-message ks derivation = 0 bytes
  // Without this guard, a >16 byte message would silently produce a wrong
  // CMAC (only processing the last block, skipping CBC chaining), or throw
  // a RangeError at padded.set(message) if message > 16 bytes.
  // Fail explicitly rather than silently produce wrong output.
  // If multi-block is ever needed, implement full CBC chain per RFC 4493 §2.4.
  if (message.length > BLOCK_SIZE) {
    throw new Error(
      `computeAesCmac: message length ${message.length} exceeds single-block limit (${BLOCK_SIZE}). ` +
      "Multi-block CBC-MAC chaining not implemented. See RFC 4493 §2.4."
    );
  }

  const aesEcb = new AES.ModeOfOperation.ecb(key);
  const zeroBlock = new Uint8Array(BLOCK_SIZE);

  const L = aesEcb.encrypt(zeroBlock);

  const K1 = _generateSubkeyGo(L);

  let M_last;
  if (message.length === BLOCK_SIZE) {
    M_last = _xorArrays(message, K1);
  } else {
    const padded = new Uint8Array(BLOCK_SIZE);
    padded.fill(0);
    padded.set(message);
    padded[message.length] = 0x80;
    const K2 = _generateSubkeyGo(K1);
    M_last = _xorArrays(padded, K2);
  }

  const T = aesEcb.encrypt(M_last);

  return T;
}

/**
 * Computes the session key (ks) using AES-CMAC.
 * @param {Uint8Array} sv2 - The session derivation value.
 * @param {Uint8Array} cmacKeyBytes - The key used for AES-CMAC.
 * @returns {Uint8Array}
 */
export function _computeKs(sv2, cmacKeyBytes) {
  return computeAesCmac(sv2, cmacKeyBytes);
}

/**
 * Computes the cm value from the session key.
 * @param {Uint8Array} ks - The session key.
 * @returns {Uint8Array}
 */
export function _computeCm(ks) {
  const aesEcbKs = new AES.ModeOfOperation.ecb(ks);
  const zeroBlock = new Uint8Array(BLOCK_SIZE);

  const Lprime = aesEcbKs.encrypt(zeroBlock);

  const K1prime = _generateSubkeyGo(Lprime);

  const hk1 = _generateSubkeyGo(K1prime);

  const hashVal = new Uint8Array(hk1);
  hashVal[0] ^= 0x80;

  const cm = aesEcbKs.encrypt(hashVal);

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
export function _computeAesCmacForVerification(sv2, cmacKeyBytes) {
  const ks = _computeKs(sv2, cmacKeyBytes);
  const cm = _computeCm(ks);

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

  const ks = _computeKs(sv2, k2Bytes);
  const cm = _computeCm(ks);

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
 *   - Uses AES-128 decryption with K1 as key (single 16-byte block; CBC with zero IV and ECB are
 *     mathematically identical for single blocks. aes-js uses ECB mode. Spec ref: NXP AN12196 §5.5)
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

  // NXP AN12196 §5.5: PICCDataTag 0xC7 indicates UID+counter mirroring.
  // Only 1 byte is checked, so each wrong key has a 1/256 false-positive
  // chance. With multiple K1 candidates (for key rotation), a wrong key
  // could beat the correct one.
  // ntag424-js also only checks the header byte, but with a single key —
  // multi-key scenarios introduce false-positive risk.
  // We exhaustively check ALL candidates and warn if multiple match.
  let bestMatch = null;
  let matchIndices = [];

  for (let i = 0; i < k1Keys.length; i++) {
    const k1Bytes = k1Keys[i];
    const aesEcbK1 = new AES.ModeOfOperation.ecb(k1Bytes);
    const decrypted = aesEcbK1.decrypt(pBytes);

    // Look for the expected header byte.
    if (decrypted[0] === 0xc7) {
      const uidBytes = decrypted.slice(1, 8);
      const ctrLo = decrypted[8] | decrypted[9] | decrypted[10];
      if (uidBytes.every(b => b === 0) && ctrLo === 0) continue;

      if (bestMatch === null) {
        // Counter is stored in reverse order.
        const ctr = new Uint8Array([decrypted[10], decrypted[9], decrypted[8]]);
        bestMatch = { success: true, uidBytes, ctr, usedK1: k1Bytes };
      }
      matchIndices.push(i);
    }
  }

  if (matchIndices.length > 1) {
    // Multiple keys produced 0xC7 header — possible false positive.
    // First matching key wins (consistent with previous behavior).
    // Investigate if this appears in logs — may indicate key rotation overlap.
    logger.warn("Multiple K1 keys matched PICCDataTag 0xC7", {
      matchIndices,
      possibleFalsePositive: true,
    });
  }

  return bestMatch !== null ? bestMatch : { success: false };
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
  // Validate cHex length: truncated CMAC is 8 bytes = 16 hex chars.
  // Rejecting wrong-length values before XOR prevents length-based oracles.
  if (!cHex || cHex.length !== 16) {
    return { cmac_validated: false, cmac_error: 'CMAC validation failed' };
  }

  const { ct } = buildVerificationData(uidBytes, ctr, k2Bytes);
  if (!ct) { throw new Error('ct is undefined!'); }

  // Timing-safe comparison: string === short-circuits on first mismatch,
  // leaking information about how many leading bytes match via response timing.
  // An attacker can brute-force the CMAC one byte at a time (timing oracle).
  // XOR accumulator runs in constant time regardless of where bytes differ.
  // Ref: https://codahale.com/a-lesson-in-timing-attacks/
  // Ref: NXP AN12196 §5.7 (SDMMAC verification)
  const providedBytes = hexToBytes(cHex);
  let diff = 0;
  for (let i = 0; i < ct.length; i++) {
    diff |= ct[i] ^ providedBytes[i];
  }
  const cmac_validated = diff === 0;

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
