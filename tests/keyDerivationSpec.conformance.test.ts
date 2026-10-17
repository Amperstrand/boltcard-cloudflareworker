/**
 * Key-derivation conformance: worker implementation vs the Bolt Card service spec.
 *
 * Spec source (citable):
 *   boltcard/boltcard — docs/DETERMINISTIC.md, section "Keys generation":
 *     CardKey = PRF(IssuerKey, '2d003f75' || UID || Version)
 *     K0      = PRF(CardKey,  '2d003f76')
 *     K1      = PRF(IssuerKey, '2d003f77')   // keyed by IssuerKey — NOT CardKey
 *     K2      = PRF(CardKey,  '2d003f78')
 *     K3      = PRF(CardKey,  '2d003f79')
 *     K4      = PRF(CardKey,  '2d003f7a')
 *     ID      = PRF(IssuerKey, '2d003f7b' || UID)
 *   with PRF = CMAC per NIST SP 800-38B (RFC 4493 for AES-128), UID = 7 bytes,
 *   Version = 4-byte little-endian ("must be incremented every time the user
 *   re-programs ... the same BoltCard on the same LNUrl Withdraw Service").
 *   https://github.com/boltcard/boltcard/blob/main/docs/DETERMINISTIC.md
 *   (local reference clone: ~/src/boltcard on the bench host, same file)
 *
 * SUN message structure (spec "How to implement a verification";
 * NXP NTAG 424 DNA AN12196 §3.4.2.1; Go reference crypto.go):
 *   PICCData = AES-128(K1) decrypt of p  → [0]=0xC7 | UID(7) | ctr(3, LE) | RFU
 *   sv2 = 3c c3 00 01 00 80 || UID(7) || ctr(3, big-endian)
 *   Ks  = CMAC(K2, sv2);  Cm = CMAC(Ks, <URL MAC-window data or empty>);
 *   c   = odd-index bytes of Cm (indices 1,3,5,...,15).
 *
 * Conformance strategy: every derivation is recomputed here from AES first
 * principles using the vendored aes-js implementation (an independent code
 * path from @ntag424/crypto), then compared against both the worker's output
 * and the spec's published test vectors. RFC 4493 correctness of the CMAC
 * primitive itself is separately pinned in cryptoutils.test.ts.
 */
import aesjs from "aes-js";
import { getDeterministicKeys } from "../keygenerator.js";
import { getBoltCardK1, getUidConfig } from "../getUidConfig.js";
import { extractUIDAndCounter, validateCmac } from "../boltCardHelper.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import type { Env } from "../types/core.js";

const asEnv = (obj: Record<string, unknown>) => obj as unknown as Env;

// ---- Independent RFC 4493 AES-CMAC built on vendored aes-js --------------
// (deliberately NOT importing computeAesCmac from @ntag424/crypto)

function aesEcbEncryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array<ArrayBuffer> {
  const ecb = new aesjs.ModeOfOperation.ecb(key);
  const out = new Uint8Array(16);
  out.set(ecb.encrypt(block));
  return out;
}

function xorInto(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

function shiftLeft(buf: Uint8Array): { shifted: Uint8Array; carry: number } {
  const out = new Uint8Array(buf.length);
  let carry = 0;
  for (let i = buf.length - 1; i >= 0; i--) {
    const msb = buf[i]! >> 7;
    out[i] = ((buf[i]! << 1) & 0xff) | carry;
    carry = msb;
  }
  return { shifted: out, carry };
}

function doubleSubkey(buf: Uint8Array): Uint8Array {
  const { shifted, carry } = shiftLeft(buf);
  if (carry) shifted[shifted.length - 1]! ^= 0x87;
  return shifted;
}

/** RFC 4493 AES-CMAC (AES-128). Independent of the worker's implementation. */
function cmacPrf(key: Uint8Array, message: Uint8Array): Uint8Array {
  const L = aesEcbEncryptBlock(key, new Uint8Array(16));
  const subK1 = doubleSubkey(L);
  const subK2 = doubleSubkey(subK1);
  const n = Math.ceil(message.length / 16);
  const complete = message.length > 0 && message.length % 16 === 0;

  let mLast: Uint8Array;
  if (complete) {
    mLast = xorInto(message.subarray((n - 1) * 16), subK1);
  } else {
    const padded = new Uint8Array(16);
    padded.set(message.subarray(n === 0 ? 0 : (n - 1) * 16));
    padded[message.length % 16] = 0x80;
    mLast = xorInto(padded, subK2);
  }

  let c = new Uint8Array(16);
  for (let i = 0; i < n - 1; i++) {
    c = aesEcbEncryptBlock(key, xorInto(message.subarray(i * 16, (i + 1) * 16), c));
  }
  return aesEcbEncryptBlock(key, xorInto(mLast, c));
}

const hexToBytesLocal = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
const bytesToHexLocal = (b: Uint8Array): string =>
  Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
const cat = (...arrs: Uint8Array[]): Uint8Array => {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};

/** Spec formula: PRF(key, hexConstant || extra) */
const specPrf = (keyHex: string, constantHex: string, extra: Uint8Array = new Uint8Array()) =>
  bytesToHexLocal(cmacPrf(hexToBytesLocal(keyHex), cat(hexToBytesLocal(constantHex), extra)));

// ---- Spec published test vectors (docs/DETERMINISTIC.md "Test vectors") --
const SPEC_UID = "04a39493cc8680";
const SPEC_ISSUER_KEY = "00000000000000000000000000000001";
const SPEC_VERSION = 1;
const SPEC_VECTOR = {
  k0: "a29119fcb48e737d1591d3489557e49b",
  k1: "55da174c9608993dc27bb3f30a4a7314",
  k2: "f4b404be700ab285e333e32348fa3d3b",
  k3: "73610ba4afe45b55319691cb9489142f",
  k4: "addd03e52964369be7f2967736b7bdb5",
  id: "e07ce1279d980ecb892a81924b67bf18",
  cardKey: "ebff5a4e6da5ee14cbfe720ae06fbed9",
};

describe("Spec §Keys generation — each derivation pinned independently", () => {
  const uidBytes = hexToBytesLocal(SPEC_UID);
  const issuer = SPEC_ISSUER_KEY;
  // Independent recomputation with LE32 version, per spec.
  const versionLe = new Uint8Array(4);
  new DataView(versionLe.buffer).setUint32(0, SPEC_VERSION, true);
  const cardKey = specPrf(issuer, "2d003f75", cat(uidBytes, versionLe));

  test("CardKey = PRF(IssuerKey, '2d003f75' || UID || Version_LE32)", () => {
    expect(cardKey).toBe(SPEC_VECTOR.cardKey);
    expect(getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), SPEC_VERSION).cardKey).toBe(SPEC_VECTOR.cardKey);
  });

  test("K0 = PRF(CardKey, '2d003f76')", () => {
    expect(specPrf(cardKey, "2d003f76")).toBe(SPEC_VECTOR.k0);
    expect(getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), SPEC_VERSION).k0).toBe(SPEC_VECTOR.k0);
  });

  test("K1 = PRF(IssuerKey, '2d003f77') — keyed by IssuerKey, not CardKey", () => {
    expect(specPrf(issuer, "2d003f77")).toBe(SPEC_VECTOR.k1);
    expect(getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), SPEC_VERSION).k1).toBe(SPEC_VECTOR.k1);
    // Negative pin: keying K1's PRF with CardKey instead of IssuerKey is a
    // distinct value — the spec's key choice is load-bearing (K1 is shared
    // across all cards of one issuer; see spec §"K1 security").
    expect(specPrf(cardKey, "2d003f77")).not.toBe(SPEC_VECTOR.k1);
  });

  test("K2 = PRF(CardKey, '2d003f78')", () => {
    expect(specPrf(cardKey, "2d003f78")).toBe(SPEC_VECTOR.k2);
    expect(getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), SPEC_VERSION).k2).toBe(SPEC_VECTOR.k2);
  });

  test("K3 = PRF(CardKey, '2d003f79')", () => {
    expect(specPrf(cardKey, "2d003f79")).toBe(SPEC_VECTOR.k3);
    expect(getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), SPEC_VERSION).k3).toBe(SPEC_VECTOR.k3);
  });

  test("K4 = PRF(CardKey, '2d003f7a')", () => {
    expect(specPrf(cardKey, "2d003f7a")).toBe(SPEC_VECTOR.k4);
    expect(getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), SPEC_VERSION).k4).toBe(SPEC_VECTOR.k4);
  });

  test("ID = PRF(IssuerKey, '2d003f7b' || UID)", () => {
    expect(specPrf(issuer, "2d003f7b", uidBytes)).toBe(SPEC_VECTOR.id);
    expect(getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), SPEC_VERSION).id).toBe(SPEC_VECTOR.id);
  });
});

describe("Spec §Keys generation — Version is 4-byte LITTLE-endian", () => {
  const uidBytes = hexToBytesLocal(SPEC_UID);
  const issuer = SPEC_ISSUER_KEY;
  const v2le = new Uint8Array(4);
  new DataView(v2le.buffer).setUint32(0, 2, true);
  const v2be = new Uint8Array(4);
  new DataView(v2be.buffer).setUint32(0, 2, false);

  const keysV1 = getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), 1);
  const keysV2 = getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), 2);

  test("version advance rotates CardKey-derived keys (K0, K2, K3, K4, CardKey)", () => {
    expect(keysV2.cardKey).toBe(specPrf(issuer, "2d003f75", cat(uidBytes, v2le)));
    expect(keysV2.k0).not.toBe(keysV1.k0);
    expect(keysV2.k2).not.toBe(keysV1.k2);
    expect(keysV2.k3).not.toBe(keysV1.k3);
    expect(keysV2.k4).not.toBe(keysV1.k4);
  });

  test("K1 and ID are version-invariant (spec keys them from IssuerKey + UID only)", () => {
    expect(keysV2.k1).toBe(keysV1.k1);
    expect(keysV2.id).toBe(keysV1.id);
  });

  test("big-endian encoding of Version does NOT match the derivation (LE pin)", () => {
    const cardKeyBe = specPrf(issuer, "2d003f75", cat(uidBytes, v2be));
    expect(cardKeyBe).not.toBe(keysV2.cardKey);
  });
});

describe("Service PICC decryption key — getBoltCardK1 == spec K1", () => {
  test("ISSUER_KEY-derived K1 list equals spec K1 for that issuer", () => {
    const k1s = getBoltCardK1(asEnv({ ISSUER_KEY: SPEC_ISSUER_KEY }));
    expect(k1s).toHaveLength(1);
    expect(bytesToHexLocal(k1s[0]!)).toBe(SPEC_VECTOR.k1);
  });
});

describe("Spec §How to implement a verification — SUN p/c round trip", () => {
  // Build a synthetic tap exactly as the spec's verification procedure
  // describes, using the independent aes-js pipeline, then run the worker's
  // service-side pipeline (extractUIDAndCounter → validateCmac) on it.
  const uidBytes = hexToBytesLocal(SPEC_UID);
  const issuer = SPEC_ISSUER_KEY;
  const keys = getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), 1);
  const k1 = hexToBytesLocal(keys.k1);
  const k2 = hexToBytesLocal(keys.k2);
  const ctrLe = new Uint8Array([0x4e, 0x00, 0x00]); // counter 78, little-endian per PICCData

  const piccData = new Uint8Array(16);
  piccData[0] = 0xc7; // spec: "Check PICCData[0] == 0xc7"
  piccData.set(uidBytes, 1);
  piccData.set(ctrLe, 8);
  const pHex = bytesToHexLocal(aesEcbEncryptBlock(k1, piccData));

  const sv2 = new Uint8Array(16);
  sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80], 0);
  sv2.set(uidBytes, 6);
  // NTAG424 SUN sv2 carries the 3-byte counter LSB-first — same byte order as
  // PICCData[8..10] (AN12196; confirmed by BTCPay CanCalculateSunMac vectors).
  sv2.set(ctrLe, 13);
  const ks = cmacPrf(k2, sv2);
  const cm = cmacPrf(ks, new Uint8Array(0));
  const cHex = bytesToHexLocal(new Uint8Array([1, 3, 5, 7, 9, 11, 13, 15].map((i) => cm[i]!)));

  test("step 2: decrypt p with K1 recovers UID and counter (PICCData[0]=0xC7)", () => {
    const res = extractUIDAndCounter(pHex, asEnv({ ISSUER_KEY: issuer }));
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.uidHex).toBe(SPEC_UID);
      expect(res.ctr).toBe(bytesToHexLocal(new Uint8Array([ctrLe[2]!, ctrLe[1]!, ctrLe[0]!])));
    }
  });

  test("steps 8-9: SUN MAC in c= verifies under K2", () => {
    const v = validateCmac(uidBytes, hexToBytesLocal(bytesToHexLocal(new Uint8Array([ctrLe[2]!, ctrLe[1]!, ctrLe[0]!]))), cHex, k2);
    expect(v.cmac_validated).toBe(true);
    expect(v.cmac_error).toBeNull();
  });

  test("c= computed from EVEN-index bytes does not validate (odd-byte truncation pin)", () => {
    const cEven = bytesToHexLocal(new Uint8Array([0, 2, 4, 6, 8, 10, 12, 14].map((i) => cm[i]!)));
    const v = validateCmac(uidBytes, hexToBytesLocal(bytesToHexLocal(new Uint8Array([ctrLe[2]!, ctrLe[1]!, ctrLe[0]!]))), cEven, k2);
    expect(v.cmac_validated).toBe(false);
  });

  test("tampered c= or wrong K2 is rejected", () => {
    const ctrBe = new Uint8Array([ctrLe[2]!, ctrLe[1]!, ctrLe[0]!]);
    const tampered = (parseInt(cHex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, "0") + cHex.slice(2);
    expect(validateCmac(uidBytes, ctrBe, tampered, k2).cmac_validated).toBe(false);
    expect(validateCmac(uidBytes, ctrBe, cHex, hexToBytesLocal(SPEC_VECTOR.k3)).cmac_validated).toBe(false);
  });

  test("p= without 0xC7 leading byte is not decoded as PICCData", () => {
    const bogus = new Uint8Array(16); // all-zero plaintext → tag != 0xC7
    const bogusP = bytesToHexLocal(aesEcbEncryptBlock(k1, bogus));
    const res = extractUIDAndCounter(bogusP, asEnv({ ISSUER_KEY: issuer }));
    expect(res.success).not.toBe(true);
  });
});

describe("getUidConfig + Durable Objects — versioned deterministic fallback (spec §Keys generation)", () => {
  const issuer = SPEC_ISSUER_KEY;

  test("no DO row → fakewallet fallback whose K2 equals spec derivation at requested version", async () => {
    const doStub = makeReplayNamespace();
    const env = asEnv({ CARD_REPLAY: doStub, ISSUER_KEY: issuer });
    const v1 = await getUidConfig(SPEC_UID, env, 1);
    const v2 = await getUidConfig(SPEC_UID, env, 2);
    expect(v1?.payment_method).toBe("fakewallet");
    expect(v1?.K2).toBe(SPEC_VECTOR.k2);
    expect(v2?.K2).toBe(getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), 2).k2);
    expect(v2?.K2).not.toBe(v1?.K2);
  });

  test("DO row without K2 → augmented with deterministic K2 at the requested version", async () => {
    const doStub = makeReplayNamespace({}, { [SPEC_UID]: 1 });
    const doObj = doStub.get(SPEC_UID as unknown as DurableObjectId);
    await doObj.fetch(new Request("https://internal/set-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment_method: "clnrest" }),
    }));
    const env = asEnv({ CARD_REPLAY: doStub, ISSUER_KEY: issuer });
    const cfg = await getUidConfig(SPEC_UID, env, 2);
    expect(cfg?.payment_method).toBe("clnrest");
    expect(cfg?.K2).toBe(getDeterministicKeys(SPEC_UID, asEnv({ ISSUER_KEY: issuer }), 2).k2);
  });

  test("DO row with explicit K2 wins over deterministic derivation", async () => {
    const doStub = makeReplayNamespace({}, { [SPEC_UID]: 1 });
    const doObj = doStub.get(SPEC_UID as unknown as DurableObjectId);
    const explicitK2 = "ab".repeat(16);
    await doObj.fetch(new Request("https://internal/set-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment_method: "clnrest", K2: explicitK2 }),
    }));
    const env = asEnv({ CARD_REPLAY: doStub, ISSUER_KEY: issuer });
    const cfg = await getUidConfig(SPEC_UID, env, 1);
    expect(cfg?.K2).toBe(explicitK2);
  });
});
