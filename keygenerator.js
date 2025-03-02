import AES from "aes-js";
import { hexToBytes, bytesToHex, xorArrays } from "./cryptoutils.js";

const DEBUG = false


// Hardcoded Issuer Key (16 bytes)
const ISSUER_KEY = hexToBytes("00000000000000000000000000000001");

/**
 * Performs AES-128 CMAC as defined in RFC 4493.
 * This function is used as the PRF.
 * @param {Uint8Array} key - The 16-byte key.
 * @param {Uint8Array} message - The message to MAC.
 * @returns {Uint8Array} The 16-byte CMAC.
 */
function aesCmac(key, message) {
  if (DEBUG) console.log("[AES-CMAC] Computing CMAC for message:", bytesToHex(message));
  const blockSize = 16;
  const aesEcb = new AES.ModeOfOperation.ecb(key);
  const zeroBlock = new Uint8Array(blockSize);

  // Step 1: Compute L = AES-ECB(key, 0^16)
  const L = aesEcb.encrypt(zeroBlock);
  if (DEBUG) console.log("[AES-CMAC] Step 1: L =", bytesToHex(L));

  // Step 2: Generate subkeys K1 and K2
  const K1 = generateSubkey(L);
  if (DEBUG) console.log("[AES-CMAC] Step 2: K1 =", bytesToHex(K1));
  const K2 = generateSubkey(K1);
  if (DEBUG) console.log("[AES-CMAC] Step 2: K2 =", bytesToHex(K2));

  // Step 3: Determine M_last
  let M_last;
  if (message.length === blockSize) {
    // If message is a full block, XOR with K1
    M_last = xorArrays(message, K1);
  } else {
    // Otherwise, pad message with 0x80 followed by zeros and XOR with K2
    const padded = new Uint8Array(blockSize);
    padded.fill(0);
    padded.set(message);
    padded[message.length] = 0x80;
    M_last = xorArrays(padded, K2);
  }
  if (DEBUG) console.log("[AES-CMAC] Step 3: M_last =", bytesToHex(M_last));

  // Step 4: Compute T = AES-ECB(key, M_last)
  const T = aesEcb.encrypt(M_last);
  if (DEBUG) console.log("[AES-CMAC] Step 4: T =", bytesToHex(T));

  return T;
}

/**
 * Helper: Generate a subkey by left-shifting the input and conditionally XORing the last byte with 0x87.
 * @param {Uint8Array} input - A 16-byte block.
 * @returns {Uint8Array} The generated subkey.
 */
function generateSubkey(input) {
  const blockSize = 16;
  const shifted = new Uint8Array(blockSize);
  let carry = 0;
  for (let i = blockSize - 1; i >= 0; i--) {
    const byte = input[i];
    shifted[i] = ((byte << 1) & 0xff) | carry;
    carry = (byte & 0x80) ? 1 : 0;
  }
  if (carry) {
    shifted[blockSize - 1] ^= 0x87;
  }
  return shifted;
}

/**
 * PRF (Pseudo-Random Function) using AES-CMAC.
 * @param {string} keyHex - The key as a hex string.
 * @param {string} messageHex - The message as a hex string.
 * @returns {Uint8Array} The 16-byte MAC result.
 */
function PRF(keyHex, messageHex) {
  const keyBytes = hexToBytes(keyHex);
  const messageBytes = hexToBytes(messageHex);
  return aesCmac(keyBytes, messageBytes);
}

/**
 * Computes the CMAC for an empty message given key 'ks'.
 * According to RFC4493, for an empty message, pad with 0x80 followed by zeros,
 * XOR with K2 (derived from K1 = leftShift(L), where L = AES-ECB(ks, 0^16)).
 * @param {Uint8Array} ks - The key to use for final CMAC computation.
 * @returns {Uint8Array} The computed 16-byte CMAC.
 */
function computeCm(ks) {
  if (DEBUG) console.log("[CM] Computing cm from ks...");
  const blockSize = 16;
  const aesEcbKs = new AES.ModeOfOperation.ecb(ks);
  const zeroBlock = new Uint8Array(blockSize);

  // Compute Lprime = AES-ECB(ks, 0^16)
  const Lprime = aesEcbKs.encrypt(zeroBlock);
  if (DEBUG) console.log("[CM] Step: L' =", bytesToHex(Lprime));

  // Compute K1prime = generateSubkey(Lprime)
  const K1prime = generateSubkey(Lprime);
  if (DEBUG) console.log("[CM] Step: K1' =", bytesToHex(K1prime));

  // Compute K2 = generateSubkey(K1prime)
  const K2 = generateSubkey(K1prime);
  if (DEBUG) console.log("[CM] Step: K2 =", bytesToHex(K2));

  // For an empty message, padded message = 0x80 || 0^15
  const padded = new Uint8Array(blockSize);
  padded.fill(0);
  padded[0] = 0x80;
  // M_last = padded XOR K2
  const M_last = xorArrays(padded, K2);
  if (DEBUG) console.log("[CM] Step: M_last =", bytesToHex(M_last));

  // Final cm = AES-ECB(ks, M_last)
  const cm = aesEcbKs.encrypt(M_last);
  if (DEBUG) console.log("[CM] Step: Final cm =", bytesToHex(cm));
  return cm;
}

/**
 * Computes the verification CMAC (ct) by extracting specific bytes from cm.
 * @param {Uint8Array} sv2 - The sv2 array.
 * @param {Uint8Array} cmacKeyBytes - The key (K2) used for CMAC verification.
 * @returns {Uint8Array} The extracted 8-byte CMAC verification value.
 */
export function computeAesCmacForVerification(sv2, cmacKeyBytes) {
  if (DEBUG) console.log("[VERIFY] Computing AES-CMAC for verification...");
  const ks = computeAesCmac(sv2, cmacKeyBytes);
  if (DEBUG) console.log("[VERIFY] ks =", bytesToHex(ks));
  const cm = computeCm(ks);
  if (DEBUG) console.log("[VERIFY] cm =", bytesToHex(cm));
  const ct = new Uint8Array([cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]);
  if (DEBUG) console.log("[VERIFY] ct =", bytesToHex(ct));
  return ct;
}

/**
 * Deterministic Key Generation:
 * Generates keys for a BoltCard using the given UID and a fixed Issuer Key and Version.
 * 
 * Process:
 *   CardKey = PRF(IssuerKey, "2d003f75" || UID || Version)
 *   K0 = PRF(CardKey, "2d003f76")
 *   K1 = PRF(IssuerKey, "2d003f77")
 *   K2 = PRF(CardKey, "2d003f78")
 *   K3 = PRF(CardKey, "2d003f79")
 *   K4 = PRF(CardKey, "2d003f7a")
 *   ID = PRF(IssuerKey, "2d003f7b" || UID)
 * 
 * @param {string} uidHex - The UID as a 14-character hex string (7 bytes).
 * @param {number} version - The version number (default 1).
 * @returns {Promise<Object>} An object with keys: k0, k1, k2, k3, k4, id, cardKey (all hex strings).
 */
export async function getDeterministicKeys(uidHex, version = 1) {
  if (!uidHex || uidHex.length !== 14) {
    throw new Error("Invalid UID: Must be exactly 7 bytes (14 hex characters)");
  }

  const uid = hexToBytes(uidHex);
  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, version, true); // Little-endian

  if (DEBUG) console.log("Generating deterministic keys for UID:", uidHex);

  // Generate CardKey
  const cardKeyMessage = new Uint8Array([...hexToBytes("2d003f75"), ...uid, ...versionBytes]);
  const cardKey = await aesCmac(ISSUER_KEY, cardKeyMessage);

  // Generate application keys
  const k0 = await aesCmac(cardKey, hexToBytes("2d003f76"));
  const k1 = await aesCmac(ISSUER_KEY, hexToBytes("2d003f77"));
  const k2 = await aesCmac(cardKey, hexToBytes("2d003f78"));
  const k3 = await aesCmac(cardKey, hexToBytes("2d003f79"));
  const k4 = await aesCmac(cardKey, hexToBytes("2d003f7a"));

  // Generate ID using IssuerKey and UID
  const idMessage = new Uint8Array([...hexToBytes("2d003f7b"), ...uid]);
  const id = await aesCmac(ISSUER_KEY, idMessage);

  if (DEBUG) {
    console.log("Generated Keys:");
    console.log("K0:", bytesToHex(k0));
    console.log("K1:", bytesToHex(k1));
    console.log("K2:", bytesToHex(k2));
    console.log("K3:", bytesToHex(k3));
    console.log("K4:", bytesToHex(k4));
    console.log("ID:", bytesToHex(id));
    console.log("CardKey:", bytesToHex(cardKey));
  } else {
    console.log("✅ Keys generated for UID:", uidHex);
  }

  return {
    k0: bytesToHex(k0),
    k1: bytesToHex(k1),
    k2: bytesToHex(k2),
    k3: bytesToHex(k3),
    k4: bytesToHex(k4),
    id: bytesToHex(id),
    cardKey: bytesToHex(cardKey),
  };
}
