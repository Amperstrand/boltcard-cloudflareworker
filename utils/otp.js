import { computeAesCmac, hexToBytes } from "../cryptoutils.js";

export function deriveOtpSecret(env, uidHex, domainTag) {
  const issuerKeyHex = env?.ISSUER_KEY || "00000000000000000000000000000001";
  const issuerKey = hexToBytes(issuerKeyHex);
  const uid = hexToBytes(uidHex);
  const message = new Uint8Array([...hexToBytes(domainTag), ...uid]);
  return computeAesCmac(message, issuerKey);
}

async function hmacSha1(keyBytes, messageBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, messageBytes);
  return new Uint8Array(sig);
}

function dynamicTruncation(hmacResult) {
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  return (
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff)
  );
}

export async function generateHOTP(secretBytes, counter, digits = 6) {
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);
  const hmac = await hmacSha1(secretBytes, counterBytes);
  const code = dynamicTruncation(hmac) % Math.pow(10, digits);
  return code.toString().padStart(digits, "0");
}

export async function generateTOTP(secretBytes, timeStep = 30, digits = 6) {
  const nowSec = Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSec / timeStep);
  const code = await generateHOTP(secretBytes, counter, digits);
  const secondsRemaining = timeStep - (nowSec % timeStep);
  return { code, secondsRemaining, counter };
}
