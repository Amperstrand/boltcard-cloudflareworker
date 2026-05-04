import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import * as secp from "@noble/secp256k1";
import { bech32 } from "@scure/base";
import { hexToBytes, bytesToHex } from "../cryptoutils.js";

secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key: Uint8Array, data: Uint8Array) => hmac(sha256, key, data);

const DIVISORS: Record<string, number> = { m: 1e3, u: 1e6, n: 1e9, p: 1e12 };
const DIVISOR_LABELS: Record<string, string> = { m: "milli", u: "micro", n: "nano", p: "pico" };
const MILLISATS_PER_BTC = 1e11;
const BOLT11_DEFAULT_EXPIRY = 3600;
const BOLT11_DEFAULT_CLTV = 9;

const NETWORK_MAP: Record<string, string> = { bc: "mainnet", tb: "testnet", bcrt: "regtest" };

const TAG_NAMES: Record<number, string> = {
  1: "payment_hash",
  13: "description",
  19: "payee",
  23: "purpose_hash",
  6: "expiry",
  16: "payment_secret",
  9: "features",
  24: "min_final_cltv_expiry",
};

interface FeatureDef {
  bit: number;
  name: string;
}

const FEATURES: FeatureDef[] = [
  { bit: 0, name: "var_onion_optin" },
  { bit: 6, name: "payment_secret" },
  { bit: 7, name: "basic_mpp" },
  { bit: 12, name: "payment_metadata" },
  { bit: 14, name: "tlv_onion" },
  { bit: 17, name: "payment_secret_experimental" },
  { bit: 25, name: "channel_type" },
  { bit: 45, name: "scid_alias_quiescence" },
  { bit: 51, name: "zero_conf" },
];

export function decodeBolt11Amount(invoice: string): number | null {
  if (!invoice || typeof invoice !== "string") return null;

  const lower = invoice.toLowerCase();
  if (!lower.startsWith("lnbc")) return null;

  const hrpEnd = lower.lastIndexOf("1");
  if (hrpEnd <= 4) return null;

  const amountPart = lower.substring(4, hrpEnd);
  if (amountPart.length === 0) return null;

  const lastChar = amountPart[amountPart.length - 1];
  let divisor: string | null = null;
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

function convertBits(data: Iterable<number>, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
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

function bytesTo5Bit(data: Uint8Array): number[] {
  return convertBits(data, 8, 5, true);
}

function fiveBitToBytes(words: number[]): number[] {
  return convertBits(words, 5, 8, false);
}

function encodeInt5Bit(value: number, totalBits: number): number[] {
  const words: number[] = [];
  for (let i = totalBits - 5; i >= 0; i -= 5) {
    words.push((value >> i) & 0x1f);
  }
  return words;
}

function encodeTag(typeCode: number, data: Uint8Array): number[] {
  const words = bytesTo5Bit(data);
  return [typeCode, (words.length >> 5) & 0x1f, words.length & 0x1f, ...words];
}

function encodeAmountHrp(amountMsat: number): string {
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

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

interface GenerateFakeBolt11Options {
  description?: string;
  paymentSecret?: string;
}

export function generateFakeBolt11(amountMsat: number, { description, paymentSecret }: GenerateFakeBolt11Options = {}): string {
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
  expiryBuf[0] = (BOLT11_DEFAULT_EXPIRY >> 8) & 0xff;
  expiryBuf[1] = BOLT11_DEFAULT_EXPIRY & 0xff;
  const expiryTag = encodeTag(6, expiryBuf);

  const secretHex = paymentSecret || randomHex(32);
  const secretTag = encodeTag(16, hexToBytes(secretHex));

  const featuresTag = encodeTag(9, new Uint8Array([0x41]));

  const cltvTag = [24, 0, 1, BOLT11_DEFAULT_CLTV];

  const dataWithoutSig = [
    ...tsWords,
    ...paymentHashTag,
    ...descriptionTag,
    ...expiryTag,
    ...secretTag,
    ...featuresTag,
    ...cltvTag,
  ];

  const hrpBytes = new TextEncoder().encode(hrp);
  const dataBytes = fiveBitToBytes(dataWithoutSig);
  const msgBytes = new Uint8Array([...hrpBytes, ...dataBytes]);
  const msgHash = sha256(msgBytes);

  const privKey = hexToBytes(randomHex(32));
  const sigRecovered = secp.sign(msgHash, privKey, { format: "recovered" });
  const recovery = sigRecovered[0];
  const r = sigRecovered.slice(1, 33);
  const s = sigRecovered.slice(33, 65);

  const sigBytes = new Uint8Array(65);
  sigBytes.set(r, 0);
  sigBytes.set(s, 32);
  sigBytes[64] = recovery & 0x03;

  const sigWords = bytesTo5Bit(sigBytes);
  const dataWords = [...dataWithoutSig, ...sigWords];

  return bech32.encode(hrp, dataWords, 1024);
}

function decodeFeaturesBytes(bytes: Uint8Array): FeatureDef[] {
  const bits: FeatureDef[] = [];
  for (let byteIdx = 0; byteIdx < bytes.length; byteIdx++) {
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      if (bytes[byteIdx] & (1 << bitIdx)) {
        const globalBit = byteIdx * 8 + bitIdx;
        const feature = FEATURES.find(f => f.bit === globalBit);
        bits.push({
          bit: globalBit,
          name: feature ? feature.name : `unknown_bit_${globalBit}`,
        });
      }
    }
  }
  return bits;
}

function decodeHrpAmount(amountPart: string): { amountMsat: number | null; amountDisplay: string } {
  if (amountPart.length === 0) return { amountMsat: null, amountDisplay: "any amount" };
  const lastChar = amountPart[amountPart.length - 1];
  let divisor: string | null = null;
  let numStr = amountPart;
  if (DIVISORS[lastChar] !== undefined) {
    divisor = lastChar;
    numStr = amountPart.slice(0, -1);
  }
  if (!numStr.match(/^\d+$/)) return { amountMsat: null, amountDisplay: `invalid: ${amountPart}` };
  const value = parseInt(numStr, 10);
  if (!Number.isSafeInteger(value)) return { amountMsat: null, amountDisplay: `overflow: ${amountPart}` };
  if (divisor) {
    const msat = Math.round((value * MILLISATS_PER_BTC) / DIVISORS[divisor]);
    return { amountMsat: msat, amountDisplay: `${value} ${DIVISOR_LABELS[divisor]}BTC (${msat} msat)` };
  }
  const msat = value * MILLISATS_PER_BTC;
  return { amountMsat: msat, amountDisplay: `${value} BTC (${msat} msat)` };
}

function readUint5BE(words: number[]): number {
  let value = 0;
  for (const w of words) value = (value << 5) | w;
  return value;
}

function readTagInt(tagData: number[]): number {
  if (tagData.length === 0) return 0;
  const bytes = fiveBitToBytes(tagData);
  if (bytes.length === 0) {
    let value = 0;
    for (const w of tagData) value = (value << 5) | w;
    return value;
  }
  let value = 0;
  for (const b of bytes) value = (value << 8) | b;
  return value;
}

interface RawTag {
  code: number;
  name: string;
  value: string | number | string[];
  rawHex?: string;
}

interface DecodedBolt11Success {
  ok: true;
  network: string;
  hrp: string;
  amountMsat: number | null;
  amountDisplay: string;
  timestamp: number;
  timestampISO: string;
  expiry: number;
  expiresAt: string;
  isExpired: boolean;
  signatureValid: boolean;
  payee: string | null;
  tags: Record<string, unknown>;
  rawTags: RawTag[];
}

interface DecodedBolt11Failure {
  ok: false;
  error: string;
}

type DecodedBolt11 = DecodedBolt11Success | DecodedBolt11Failure;

export function decodeBolt11(invoice: string): DecodedBolt11 {
  if (!invoice || typeof invoice !== "string") {
    return { ok: false, error: "Invoice is required" };
  }

  const lower = invoice.toLowerCase();
  if (!lower.startsWith("ln")) {
    return { ok: false, error: "Not a BOLT11 invoice (must start with 'ln')" };
  }

  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(lower, lower.length);
  } catch {
    return { ok: false, error: "Invalid bech32 encoding" };
  }

  const hrp = decoded.prefix;
  const words = decoded.words;

  const networkMatch = Object.entries(NETWORK_MAP).find(([k]) => hrp === `ln${k}` || hrp.startsWith(`ln${k}`));
  if (!networkMatch) {
    return { ok: false, error: `Unknown network prefix in HRP: ${hrp}` };
  }

  const network = networkMatch[1];
  const amountPart = hrp.substring(2 + networkMatch[0].length);
  const { amountMsat, amountDisplay } = decodeHrpAmount(amountPart);

  if (words.length < 7 + 104) {
    return { ok: false, error: "Invoice too short (missing signature)" };
  }

  const sigWords = words.slice(-104);
  const dataWords = words.slice(0, -104);

  const sigBytes = fiveBitToBytes(sigWords);
  if (sigBytes.length < 65) {
    return { ok: false, error: "Signature too short" };
  }

  const r = sigBytes.slice(0, 32);
  const s = sigBytes.slice(32, 64);
  const recoveryFlag = sigBytes[64] & 0x03;

  let timestamp: number;
  if (dataWords.length < 7) {
    return { ok: false, error: "Data too short for timestamp" };
  }
  timestamp = readUint5BE(dataWords.slice(0, 7));

  const tags: Array<{ code: number; data: number[] }> = [];
  let pos = 7;
  while (pos < dataWords.length) {
    if (pos + 2 >= dataWords.length) break;
    const tagCode = dataWords[pos];
    const tagLen = (dataWords[pos + 1] << 5) | dataWords[pos + 2];
    pos += 3;
    if (pos + tagLen > dataWords.length) break;
    const tagData = dataWords.slice(pos, pos + tagLen);
    pos += tagLen;
    tags.push({ code: tagCode, data: tagData });
  }

  const hrpBytes = new TextEncoder().encode(hrp);
  const dataBytesForSig = fiveBitToBytes(dataWords);
  const msgBytes = new Uint8Array([...hrpBytes, ...dataBytesForSig]);
  const msgHash = sha256(msgBytes);

  let payee: string | null = null;
  let signatureValid = false;
  try {
    const recoveredSig = new Uint8Array(65);
    recoveredSig[0] = recoveryFlag;
    recoveredSig.set(r, 1);
    recoveredSig.set(s, 33);
    const payeeBytes = secp.recoverPublicKey(recoveredSig, msgHash);
    if (payeeBytes) {
      const sig64 = new Uint8Array(64);
      sig64.set(r, 0);
      sig64.set(s, 32);
      signatureValid = secp.verify(sig64, msgHash, payeeBytes);
      payee = bytesToHex(payeeBytes);
    }
  } catch {
    signatureValid = false;
  }

  const parsedTags: Record<string, unknown> = {};
  const rawTags: RawTag[] = [];

  for (const tag of tags) {
    const name = TAG_NAMES[tag.code] || `unknown_tag_${tag.code}`;
    const tagBytes = new Uint8Array(fiveBitToBytes(tag.data));

    switch (tag.code) {
      case 1: {
        parsedTags.payment_hash = bytesToHex(tagBytes);
        rawTags.push({ code: tag.code, name, value: bytesToHex(tagBytes) });
        break;
      }
      case 13: {
        const desc = new TextDecoder().decode(tagBytes);
        parsedTags.description = desc;
        rawTags.push({ code: tag.code, name, value: desc });
        break;
      }
      case 19: {
        parsedTags.payee = bytesToHex(tagBytes);
        rawTags.push({ code: tag.code, name, value: bytesToHex(tagBytes) });
        break;
      }
      case 23: {
        parsedTags.purpose_hash = bytesToHex(tagBytes);
        rawTags.push({ code: tag.code, name, value: bytesToHex(tagBytes) });
        break;
      }
      case 6: {
        const expiry = readTagInt(tag.data);
        parsedTags.expiry = expiry;
        rawTags.push({ code: tag.code, name, value: expiry });
        break;
      }
      case 16: {
        parsedTags.payment_secret = bytesToHex(tagBytes);
        rawTags.push({ code: tag.code, name, value: bytesToHex(tagBytes) });
        break;
      }
      case 9: {
        const featureBits = decodeFeaturesBytes(tagBytes);
        parsedTags.features = featureBits;
        rawTags.push({ code: tag.code, name, value: featureBits.map(f => f.name), rawHex: bytesToHex(tagBytes) });
        break;
      }
      case 24: {
        const cltv = readTagInt(tag.data);
        parsedTags.min_final_cltv_expiry = cltv;
        rawTags.push({ code: tag.code, name, value: cltv });
        break;
      }
      default: {
        rawTags.push({ code: tag.code, name, value: bytesToHex(tagBytes) });
        break;
      }
    }
  }

  const result: DecodedBolt11Success = {
    ok: true,
    network,
    hrp,
    amountMsat,
    amountDisplay,
    timestamp,
    timestampISO: new Date(timestamp * 1000).toISOString(),
    expiry: (parsedTags.expiry as number) ?? BOLT11_DEFAULT_EXPIRY,
    expiresAt: new Date((timestamp + ((parsedTags.expiry as number) ?? BOLT11_DEFAULT_EXPIRY)) * 1000).toISOString(),
    isExpired: Date.now() / 1000 > timestamp + ((parsedTags.expiry as number) ?? BOLT11_DEFAULT_EXPIRY),
    signatureValid,
    payee,
    tags: parsedTags,
    rawTags,
  };

  return result;
}
