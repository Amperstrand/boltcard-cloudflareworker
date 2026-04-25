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

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

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

// BOLT #11 tag type codes: 1=p(payment_hash), 13=d(description), 6=x(expiry)
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
 *
 * The invoice is properly signed with a random secp256k1 key so any
 * bolt11 decoder can extract the payee pubkey and verify the signature.
 * The payee node does not exist on any Lightning network.
 *
 * @param {number} amountMsat
 * @returns {string} bolt11 invoice starting with "lnbc"
 */
export function generateFakeBolt11(amountMsat) {
  if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
    throw new Error(`generateFakeBolt11: amountMsat must be a positive integer, got ${amountMsat}`);
  }

  const hrp = `lnbc${encodeAmountHrp(amountMsat)}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const tsWords = encodeInt5Bit(timestamp, 35);

  const paymentHashTag = encodeTag(1, hexToBytes(randomHex(32)));

  const descriptionTag = encodeTag(13, new TextEncoder().encode("fakewallet payment"));

  const expiryBuf = new Uint8Array(2);
  expiryBuf[0] = (3600 >> 8) & 0xff;
  expiryBuf[1] = 3600 & 0xff;
  const expiryTag = encodeTag(6, expiryBuf);

  const dataWithoutSig = [...tsWords, ...paymentHashTag, ...descriptionTag, ...expiryTag];

  const hrpWords = [];
  for (const ch of hrp) {
    hrpWords.push(BECH32_CHARSET.indexOf(ch.toLowerCase()));
  }
  const msgBytes = fiveBitToBytes([...hrpWords, ...dataWithoutSig]);
  const msgHash = sha256(new Uint8Array(msgBytes));

  const privKey = hexToBytes(randomHex(32));
  const sigRecovered = secp.sign(msgHash, privKey, { format: "recovered" });
  const recovery = sigRecovered[0];
  const r = sigRecovered.slice(1, 33);
  const s = sigRecovered.slice(33, 65);

  // BOLT #11: signature field is 104 five-bit words = 65 bytes.
  // Byte layout: r(32) || s(32) || footer(1).
  // Footer: bit 0 = recovery flag, bits 1-4 must be 0.
  const sigBytes = new Uint8Array(65);
  sigBytes.set(r, 0);
  sigBytes.set(s, 32);
  sigBytes[64] = recovery & 0x01;

  const sigWords = bytesTo5Bit(sigBytes);
  const dataWords = [...dataWithoutSig, ...sigWords];

  return bech32.encode(hrp, dataWords, 1024);
}
