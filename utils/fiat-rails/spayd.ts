import { logger } from "../logger.js";

export class SpaydPaymentDetails {
  acc: string;
  am: number | undefined;
  cc: string | undefined;
  rn: string | undefined;
  msg: string | undefined;
  dt: string | undefined;
  rf: string | undefined;

  constructor(acc: string, am: number | undefined, cc: string | undefined, rn: string | undefined, msg: string | undefined, dt: string | undefined, rf: string | undefined) {
    this.acc = acc;
    this.am = am;
    this.cc = cc;
    this.rn = rn;
    this.msg = msg;
    this.dt = dt;
    this.rf = rf;
  }
}

export function isSpaydUri(text: unknown): boolean {
  const trimmed = (text || "").toString().trim();
  return trimmed.startsWith("SPD*") || trimmed.startsWith("spayd://");
}

export function parseSpayd(input: unknown): SpaydPaymentDetails | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  let processedInput = raw;
  if (processedInput.startsWith("spayd://")) {
    processedInput = processedInput.substring(8);
  }

  const segments = processedInput.split("*");
  while (segments.length && segments[segments.length - 1] === "") segments.pop();

  if (segments.length < 2) return null;
  if (segments[0] !== "SPD") return null;

  const attributes: Record<string, string[]> = Object.create(null);

  for (let i = 2; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;

    const colonIdx = seg.indexOf(":");
    if (colonIdx <= 0) continue;

    const key = seg.slice(0, colonIdx).trim().toUpperCase();
    let value = seg.slice(colonIdx + 1).replace(/^\s+/, "");

    try {
      value = decodeURIComponent(value);
    } catch {
      // keep raw value
    }

    if (!attributes[key]) attributes[key] = [];
    attributes[key].push(value);
  }

  const acc = firstValue(attributes, "ACC");
  if (!acc) return null;

  const am = firstValue(attributes, "AM");
  const cc = firstValue(attributes, "CC");

  return new SpaydPaymentDetails(
    acc,
    am ? parseFloat(am) : undefined,
    cc || undefined,
    firstValue(attributes, "RN") || undefined,
    firstValue(attributes, "MSG") || undefined,
    firstValue(attributes, "DT") || undefined,
    firstValue(attributes, "RF") || undefined
  );
}

interface EncodeSpaydOptions {
  version?: string;
  includeCrc32?: boolean;
  sortAttributes?: boolean;
}

export function encodeSpayd(attrs: Record<string, string | string[] | undefined>, options: EncodeSpaydOptions = {}): string {
  const { version = "1.0", includeCrc32 = false, sortAttributes = false } = options;

  if (!attrs || typeof attrs !== "object") {
    throw new Error("encodeSpayd: attrs must be an object");
  }

  const pairs: Array<[string, string]> = [];
  for (const [kRaw, vRaw] of Object.entries(attrs)) {
    if (vRaw == null) continue;
    const key = String(kRaw).toUpperCase();
    const values = Array.isArray(vRaw) ? vRaw : [vRaw];
    for (const v of values) {
      if (v == null) continue;
      pairs.push([key, String(v)]);
    }
  }

  if (!pairs.some(([k, v]) => k === "ACC" && v)) {
    throw new Error("encodeSpayd: missing required 'ACC' attribute");
  }

  const pairsNoCrc = pairs.filter(([k]) => k !== "CRC32");
  const basePairs = sortAttributes ? sortPairsLex(pairsNoCrc) : pairsNoCrc;

  const encodedBase = buildSpaydString(version, basePairs);

  if (!includeCrc32) return encodedBase;

  const canonical = buildSpaydString(version, sortPairsLex(pairsNoCrc));
  const crc = crc32HexUpper(canonical);
  return `${encodedBase}*CRC32:${crc}`;
}

function firstValue(attributes: Record<string, string[]>, key: string): string | null {
  const arr = attributes[key];
  return arr && arr.length ? (arr[0] ?? null) : null;
}

function buildSpaydString(version: string, pairs: Array<[string, string]>): string {
  const parts = ["SPD", version || "1.0"];
  for (const [k, v] of pairs) {
    const wireVal = encodeURIComponent(v).replace(/\*/g, "%2A");
    parts.push(`${k}:${wireVal}`);
  }
  return parts.join("*");
}

function sortPairsLex(pairs: Array<[string, string]>): Array<[string, string]> {
  return [...pairs].sort((a, b) => {
    const k = a[0].localeCompare(b[0]);
    if (k !== 0) return k;
    return String(a[1]).localeCompare(String(b[1]));
  });
}

let _crc32Table: Uint32Array | null = null;
function crc32Table(): Uint32Array {
  if (_crc32Table) return _crc32Table;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  _crc32Table = table;
  return table;
}

function crc32(input: string): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i) & 0xff;
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32HexUpper(input: string): string {
  const n = crc32(input);
  return n.toString(16).toUpperCase().padStart(8, "0");
}
