// Re-export all crypto primitives from @ntag424/crypto
export {
  hexToBytes,
  bytesToHex,
  computeAesCmac,
  decryptP,
  verifyCmac,
  buildVerificationData,
  _computeKs,
  _computeCm,
  _computeAesCmacForVerification,
} from "@ntag424/crypto";

export type { DecryptResult, DecryptSuccess, DecryptFailure } from "@ntag424/crypto";
export type { VerificationResult } from "@ntag424/crypto";

// Internal debug helper (not in library)
export function _bytesToDecimalString(bytes: Uint8Array): string {
  return `[${Array.from(bytes).join(" ")}]`;
}

// Internal helpers kept for test compatibility (private in library)
const BLOCK_SIZE = 16;

export function _xorArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new Error("_xorArrays: Input arrays must have the same length");
  }
  return new Uint8Array(a.map((val, i) => val ^ b[i]!));
}

export function _shiftGo(src: Uint8Array): { shifted: Uint8Array; carry: number } {
  const shifted = new Uint8Array(src.length);
  let carry = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const msb = src[i]! >> 7;
    shifted[i] = ((src[i]! << 1) & 0xff) | carry;
    carry = msb;
  }
  return { shifted, carry };
}

export function _generateSubkeyGo(input: Uint8Array): Uint8Array {
  const { shifted, carry } = _shiftGo(input);
  const subkey = new Uint8Array(shifted);
  if (carry) {
    subkey[subkey.length - 1]! ^= 0x87;
  }
  return subkey;
}
