/**
 * otp.js — TOTP (RFC 6238) and HOTP (RFC 4226) using Web Crypto API
 *
 * Generates one-time passwords for 2FA card mode.
 * Secrets are derived deterministically from IssuerKey + UID using AES-CMAC
 * with domain-separation tags, following the same pattern as keygenerator.js.
 *
 * Uses SubtleCrypto (HMAC-SHA1) — available in Cloudflare Workers.
 */
import { computeAesCmac, hexToBytes } from "../cryptoutils.js";

const TOTP_DOMAIN_TAG = "2d003f80";
const HOTP_DOMAIN_TAG = "2d003f81";

/**
 * Derive a 16-byte OTP secret from IssuerKey + UID via AES-CMAC.
 * @param {object} env - Workers env (for ISSUER_KEY)
 * @param {string} uidHex - 14-char hex UID
 * @param {string} domainTag - Domain-separation tag (TOTP_DOMAIN_TAG or HOTP_DOMAIN_TAG)
 * @returns {Uint8Array} 16-byte secret suitable for HMAC-SHA1
 */
export function deriveOtpSecret(env, uidHex, domainTag) {
  const issuerKeyHex = env?.ISSUER_KEY || "00000000000000000000000000000001";
  const issuerKey = hexToBytes(issuerKeyHex);
  const uid = hexToBytes(uidHex);
  const message = new Uint8Array([...hexToBytes(domainTag), ...uid]);
  return computeAesCmac(message, issuerKey);
}

/**
 * HMAC-SHA1 using Web Crypto API (SubtleCrypto).
 */
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

/**
 * Dynamic truncation per RFC 4226 §5.3.
 */
function dynamicTruncation(hmacResult) {
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  return (
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff)
  );
}

/**
 * Generate an HOTP code (RFC 4226).
 * @param {Uint8Array} secretBytes - HMAC-SHA1 key
 * @param {number} counter - Moving factor
 * @param {number} digits - Code length (default 6)
 * @returns {Promise<string>} Zero-padded numeric code
 */
export async function generateHOTP(secretBytes, counter, digits = 6) {
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);
  const hmac = await hmacSha1(secretBytes, counterBytes);
  const code = dynamicTruncation(hmac) % Math.pow(10, digits);
  return code.toString().padStart(digits, "0");
}

/**
 * Generate a TOTP code (RFC 6238).
 * @param {Uint8Array} secretBytes - HMAC-SHA1 key
 * @param {number} timeStep - Time step in seconds (default 30)
 * @param {number} digits - Code length (default 6)
 * @returns {Promise<{code: string, secondsRemaining: number, counter: number}>}
 */
export async function generateTOTP(secretBytes, timeStep = 30, digits = 6) {
  const nowSec = Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSec / timeStep);
  const code = await generateHOTP(secretBytes, counter, digits);
  const secondsRemaining = timeStep - (nowSec % timeStep);
  return { code, secondsRemaining, counter };
}
