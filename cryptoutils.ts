import AES from "aes-js";
import { hex as scureHex } from "@scure/base";
import { logger } from "./utils/logger.js";

const BLOCK_SIZE = 16;
const EXPECTED_PICC_DATA_TAG = 0xc7;

export function hexToBytes(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Invalid hex string: contains non-hex characters");
  }
  return scureHex.decode(hex.toLowerCase());
}

export function bytesToHex(bytes: Uint8Array | Iterable<number>): string {
  return scureHex.encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

export function _bytesToDecimalString(bytes: Uint8Array): string {
  return `[${Array.from(bytes).join(" ")}]`;
}

export function _xorArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new Error("_xorArrays: Input arrays must have the same length");
  }
  return new Uint8Array(a.map((val, i) => val ^ b[i]));
}

export function _shiftGo(src: Uint8Array): { shifted: Uint8Array; carry: number } {
  const shifted = new Uint8Array(src.length);
  let carry = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const msb = src[i] >> 7;
    shifted[i] = ((src[i] << 1) & 0xff) | carry;
    carry = msb;
  }
  return { shifted, carry };
}

export function _generateSubkeyGo(input: Uint8Array): Uint8Array {
  const { shifted, carry } = _shiftGo(input);
  const subkey = new Uint8Array(shifted);
  if (carry) {
    subkey[subkey.length - 1] ^= 0x87;
  }
  return subkey;
}

export function computeAesCmac(message: Uint8Array, key: Uint8Array): Uint8Array {
  if (!(key instanceof Uint8Array) || key.length !== 16) {
    throw new Error("AES-CMAC requires a 16-byte key (AES-128), per RFC 4493 §2.3");
  }

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

  let M_last: Uint8Array;
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

export function _computeKs(sv2: Uint8Array, cmacKeyBytes: Uint8Array): Uint8Array {
  return computeAesCmac(sv2, cmacKeyBytes);
}

export function _computeCm(ks: Uint8Array): Uint8Array {
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

function _extractOddBytes(cm: Uint8Array): Uint8Array {
  return new Uint8Array([
    cm[1],
    cm[3],
    cm[5],
    cm[7],
    cm[9],
    cm[11],
    cm[13],
    cm[15],
  ]);
}

export function _computeAesCmacForVerification(sv2: Uint8Array, cmacKeyBytes: Uint8Array): Uint8Array {
  const ks = _computeKs(sv2, cmacKeyBytes);
  const cm = _computeCm(ks);
  return _extractOddBytes(cm);
}

interface VerificationResult {
  sv2: Uint8Array;
  ks: Uint8Array;
  cm: Uint8Array;
  ct: Uint8Array;
}

export function buildVerificationData(uidBytes: Uint8Array, ctr: Uint8Array, k2Bytes: Uint8Array): VerificationResult {
  const sv2 = new Uint8Array(BLOCK_SIZE);
  sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]);
  sv2.set(uidBytes, 6);
  sv2[13] = ctr[2];
  sv2[14] = ctr[1];
  sv2[15] = ctr[0];

  const ks = _computeKs(sv2, k2Bytes);
  const cm = _computeCm(ks);

  const ct = _extractOddBytes(cm);

  return { sv2, ks, cm, ct };
}

interface DecryptSuccess {
  success: true;
  uidBytes: Uint8Array;
  ctr: Uint8Array;
  usedK1: Uint8Array;
}

interface DecryptFailure {
  success: false;
}

type DecryptResult = DecryptSuccess | DecryptFailure;

export function decryptP(pHex: string, k1Keys: Uint8Array[]): DecryptResult {
  const pBytes = hexToBytes(pHex);
  if (pBytes.length !== BLOCK_SIZE) {
    throw new Error("Invalid p length. Expected 16 bytes.");
  }

  let bestMatch: DecryptSuccess | null = null;
  let matchIndices: number[] = [];

  for (let i = 0; i < k1Keys.length; i++) {
    const k1Bytes = k1Keys[i];
    const aesEcbK1 = new AES.ModeOfOperation.ecb(k1Bytes);
    const decrypted = aesEcbK1.decrypt(pBytes);

    if (decrypted[0] === EXPECTED_PICC_DATA_TAG) {
      const uidBytes = decrypted.slice(1, 8);
      const ctrLo = decrypted[8] | decrypted[9] | decrypted[10];
      if (uidBytes.every(b => b === 0) && ctrLo === 0) continue;

      if (bestMatch === null) {
        const ctr = new Uint8Array([decrypted[10], decrypted[9], decrypted[8]]);
        bestMatch = { success: true, uidBytes, ctr, usedK1: k1Bytes };
      }
      matchIndices.push(i);
    }
  }

  if (matchIndices.length > 1) {
    logger.warn("Multiple K1 keys matched PICCDataTag", {
      matchIndices,
      possibleFalsePositive: true,
    });
  }

  return bestMatch !== null ? bestMatch : { success: false };
}

interface CmacResult {
  cmac_validated: boolean;
  cmac_error: string | null;
}

export function verifyCmac(uidBytes: Uint8Array, ctr: Uint8Array, cHex: string, k2Bytes: Uint8Array): CmacResult {
  if (!cHex || cHex.length !== 16) {
    return { cmac_validated: false, cmac_error: 'CMAC validation failed' };
  }

  const { ct } = buildVerificationData(uidBytes, ctr, k2Bytes);
  if (!ct) { throw new Error('ct is undefined!'); }

  const providedBytes = hexToBytes(cHex);
  let diff = 0;
  for (let i = 0; i < ct.length; i++) {
    diff |= ct[i] ^ providedBytes[i];
  }
  const cmac_validated = diff === 0;

  return {
    cmac_validated,
    cmac_error: cmac_validated
      ? null
      : 'CMAC validation failed'
  };
}
