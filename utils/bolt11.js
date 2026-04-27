import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import * as secp from "@noble/secp256k1";
import { bech32 } from "@scure/base";
import { hexToBytes, bytesToHex } from "../cryptoutils.js";

secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key, data) => hmac(sha256, key, data);

const DIVISORS = { m: 1e3, u: 1e6, n: 1e9, p: 1e12 };
const MILLISATS_PER_BTC = 1e11;

export function decodeBolt11Amount(invoice) {
  if (!invoice || typeof invoice !== "string") return null;

  const lower = invoice.toLowerCase();
  if (!lower.startsWith("lnbc")) return null;

  const hrpEnd = lower.lastIndexOf("1");
  if (hrpEnd <= 4) return null;

  const amountPart = lower.substring(4, hrpEnd);
  if (amountPart.length === 0) return null;

  const lastChar = amountPart[amountPart.length - 1];
  let divisor = null;
  let numStr = amountPart;

  if (DIVISORS[lastChar] !== undefined) {
    divisor = lastChar;
    numStr = amountPart.slice(0, -1);
  }

  if (!numStr.match(/^\d+$/)) return null;

  const value = parseInt(numStr, 10);
  if (!Number.isSafeInteger(value)) return null;

  if (divisor) {
    return Math.round((value * MILLISATS_PER_BTC) / DIVISORS[divisor]);
  }

  return value * MILLISATS_PER_BTC;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const result = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) {
    result.push((acc << (toBits - bits)) & maxv);
  }
  return result;
}

function bytesTo5Bit(data) {
  return convertBits(data, 8, 5, true);
}

function fiveBitToBytes(words) {
  return convertBits(words, 5, 8, false);
}

function encodeInt5Bit(value, totalBits) {
  const words = [];
  for (let i = totalBits - 5; i >= 0; i -= 5) {
    words.push((value >> i) & 0x1f);
  }
  return words;
}

// BOLT #11 tag type codes
// 1=p(payment_hash), 13=d(description), 6=x(expiry),
// 16=s(payment_secret), 9=9(features), 24=c(min_final_cltv_expiry)
// Tag length is encoded as two 5-bit values: high5 || low5
function encodeTag(typeCode, data) {
  const words = bytesTo5Bit(data);
  return [typeCode, (words.length >> 5) & 0x1f, words.length & 0x1f, ...words];
}

function encodeAmountHrp(amountMsat) {
  if (!amountMsat || amountMsat === 0) return "";

  const candidates = [
    { letter: "m", divisor: 1e3 },
    { letter: "u", divisor: 1e6 },
    { letter: "n", divisor: 1e9 },
    { letter: "p", divisor: 1e12 },
  ];

  for (const { letter, divisor } of candidates) {
    const value = (amountMsat * divisor) / MILLISATS_PER_BTC;
    if (value === Math.floor(value) && value > 0 && Number.isSafeInteger(value)) {
      return `${value}${letter}`;
    }
  }

  const btcValue = amountMsat / MILLISATS_PER_BTC;
  if (btcValue === Math.floor(btcValue) && btcValue > 0 && Number.isSafeInteger(btcValue)) {
    return `${btcValue}`;
  }

  const picoValue = Math.round((amountMsat * 1e12) / MILLISATS_PER_BTC);
  return `${picoValue}p`;
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

/**
 * Generate a fake bolt11 invoice for fakewallet.
 *
 * BOLT #11 tag types used:
 *   1  = payment_hash (p)
 *   13 = description (d)
 *   6  = expiry (x)
 *   16 = payment_secret (s)
 *   9  = features (9)
 *   24 = min_final_cltv_expiry (c)
 *
 * The invoice is properly signed with a random secp256k1 key so any
 * bolt11 decoder can extract the payee pubkey and verify the signature.
 * The payee node does not exist on any Lightning network.
 *
 * Per BOLT #11, the signing message is:
 *   SHA256(UTF8(hrp) || 5bit_to_8bit(dataWithoutSig))
 *
 * @param {number} amountMsat
 * @param {{ description?: string, paymentSecret?: string }} [options]
 * @returns {string} bolt11 invoice starting with "lnbc"
 */
export function generateFakeBolt11(amountMsat, { description, paymentSecret } = {}) {
  if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
    throw new Error(`generateFakeBolt11: amountMsat must be a positive integer, got ${amountMsat}`);
  }

  const hrp = `lnbc${encodeAmountHrp(amountMsat)}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const tsWords = encodeInt5Bit(timestamp, 35);

  const paymentHashTag = encodeTag(1, hexToBytes(randomHex(32)));

  const descText = description || "fakewallet payment";
  const descriptionTag = encodeTag(13, new TextEncoder().encode(descText));

  const expiryBuf = new Uint8Array(2);
  expiryBuf[0] = (3600 >> 8) & 0xff;
  expiryBuf[1] = 3600 & 0xff;
  const expiryTag = encodeTag(6, expiryBuf);

  // payment_secret (tag 16): 32 random bytes
  const secretHex = paymentSecret || randomHex(32);
  const secretTag = encodeTag(16, hexToBytes(secretHex));

  // features (tag 9): bit 8 = basic_mpp, bit 14 = payment_secret (both supported/even)
  // byte[1] = 0x41 (bit 14 at position 6, bit 8 at position 0), trimmed = [0x41]
  const featuresTag = encodeTag(9, new Uint8Array([0x41]));

  // min_final_cltv_expiry (tag 24): 9 blocks (default), single 5-bit word
  const cltvTag = [24, 0, 1, 9];

  const dataWithoutSig = [
    ...tsWords,
    ...paymentHashTag,
    ...descriptionTag,
    ...expiryTag,
    ...secretTag,
    ...featuresTag,
    ...cltvTag,
  ];

  // BOLT #11: signing message = SHA256(UTF8(hrp) || 5bit_to_8bit(dataWithoutSig))
  const hrpBytes = new TextEncoder().encode(hrp);
  const dataBytes = fiveBitToBytes(dataWithoutSig);
  const msgBytes = new Uint8Array([...hrpBytes, ...dataBytes]);
  const msgHash = sha256(msgBytes);

  const privKey = hexToBytes(randomHex(32));
  const sigRecovered = secp.sign(msgHash, privKey, { format: "recovered" });
  const recovery = sigRecovered[0];
  const r = sigRecovered.slice(1, 33);
  const s = sigRecovered.slice(33, 65);

  // BOLT #11: signature field is 104 five-bit words = 65 bytes.
  // Byte layout: r(32) || s(32) || footer(1).
  // Footer: bits 0-1 = recovery flag, bits 2-7 must be 0.
  const sigBytes = new Uint8Array(65);
  sigBytes.set(r, 0);
  sigBytes.set(s, 32);
  sigBytes[64] = recovery & 0x03;

  const sigWords = bytesTo5Bit(sigBytes);
  const dataWords = [...dataWithoutSig, ...sigWords];

  return bech32.encode(hrp, dataWords, 1024);
}
