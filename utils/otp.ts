import { computeAesCmac, hexToBytes } from "../cryptoutils.js";
import type { Env } from "../types/core.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";


export function deriveOtpSecret(env: Env | undefined, uidHex: string, domainTag: string): Uint8Array {
  if (!env?.ISSUER_KEY) {
    if (env?.WORKER_ENV === "production") {
      throw new Error("ISSUER_KEY must be set in production");
    }
  }
  const issuerKeyHex = env?.ISSUER_KEY || "00000000000000000000000000000001";
  const issuerKey = hexToBytes(issuerKeyHex);
  const uid = hexToBytes(uidHex);
  const message = new Uint8Array([...hexToBytes(domainTag), ...uid]);
  return computeAesCmac(message, issuerKey);
}

function hmacSha1(keyBytes: Uint8Array, messageBytes: Uint8Array): Uint8Array {
  return hmac(sha1, keyBytes, messageBytes);
}

function dynamicTruncation(hmacResult: Uint8Array): number {
  const offset = hmacResult[hmacResult.length - 1]! & 0x0f;
  return (
    ((hmacResult[offset]! & 0x7f) << 24) |
    ((hmacResult[offset + 1]! & 0xff) << 16) |
    ((hmacResult[offset + 2]! & 0xff) << 8) |
    (hmacResult[offset + 3]! & 0xff)
  );
}

export function generateHOTP(secretBytes: Uint8Array, counter: number, digits: number = 6): string {
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);
  const hmacResult = hmacSha1(secretBytes, counterBytes);
  const code = dynamicTruncation(hmacResult) % Math.pow(10, digits);
  return code.toString().padStart(digits, "0");
}

export function generateTOTP(secretBytes: Uint8Array, timeStep: number = 30, digits: number = 6): { code: string; secondsRemaining: number; counter: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSec / timeStep);
  const code = generateHOTP(secretBytes, counter, digits);
  const secondsRemaining = timeStep - (nowSec % timeStep);
  return { code, secondsRemaining, counter };
}
