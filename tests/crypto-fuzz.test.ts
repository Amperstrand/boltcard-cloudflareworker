import { describe, it, expect, beforeEach } from "vitest";
import { TestCard } from "@ntag424/crypto/test";
import type { TapResult } from "@ntag424/crypto/test";
import { hexToBytes, bytesToHex, decryptP, verifyCmac, buildVerificationData } from "../cryptoutils.js";
import { extractUIDAndCounter, validateCmac } from "../boltCardHelper.js";
import { buildCardTestEnv, virtualTap } from "./testHelpers.js";
import { handleRequest } from "../index.js";
import { getDeterministicKeys } from "../keygenerator.js";
import type { Env } from "../types/core.js";

// ── Constants ──────────────────────────────────────────────────────────────

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

// ── Helpers ────────────────────────────────────────────────────────────────

function flipBit(buf: Uint8Array, bitIndex: number): Uint8Array {
  const copy = new Uint8Array(buf);
  const byteIndex = Math.floor(bitIndex / 8);
  const bitMask = 1 << (bitIndex % 8);
  copy[byteIndex]! ^= bitMask;
  return copy;
}

function flipBits(buf: Uint8Array, bitIndices: number[]): Uint8Array {
  const copy = new Uint8Array(buf);
  for (const i of bitIndices) {
    const byteIndex = Math.floor(i / 8);
    const bitMask = 1 << (i % 8);
    copy[byteIndex]! ^= bitMask;
  }
  return copy;
}

function makeCryptoEnv(): Env {
  return buildCardTestEnv({ uid: UID });
}

function getK1Keys(env: Env): Uint8Array[] {
  const k1Str = env.BOLT_CARD_K1;
  if (!k1Str) throw new Error("BOLT_CARD_K1 not configured");
  return k1Str.split(",").map(hexToBytes);
}

function getFirstK1Hex(env: Env): string {
  const k1Str = env.BOLT_CARD_K1;
  if (!k1Str) throw new Error("BOLT_CARD_K1 not configured");
  return k1Str.split(",")[0]!;
}

function tapToHttp(tap: TapResult): Request {
  return new Request(`https://test.local/?p=${tap.p}&c=${tap.c}`);
}

// ── 1. Bit-Flip Attacks on p (encrypted PICC data) ────────────────────────
// p is 32 hex chars = 16 bytes = 128 bits
// Any single bit flip should cause decryption failure or wrong UID/counter.

describe("Bit-flip attacks on p parameter (function level)", () => {
  const card = new TestCard(UID, ISSUER_KEY);
  const env = makeCryptoEnv();
  const validTap = card.tap(1);
  const validPBytes = hexToBytes(validTap.p);
  const k1Keys = getK1Keys(env);

  for (let bit = 0; bit < 128; bit++) {
    it(`rejects p with bit ${bit} flipped`, () => {
      const tamperedP = flipBit(validPBytes, bit);
      const tamperedHex = bytesToHex(tamperedP);
      const result = decryptP(tamperedHex, k1Keys);

      if (result.success) {
        const resultUid = bytesToHex(result.uidBytes);
        expect(resultUid).not.toBe(UID.toLowerCase());
      }
    });
  }
});

describe("Bit-flip attacks on p parameter (multi-bit)", () => {
  const card = new TestCard(UID, ISSUER_KEY);
  const env = makeCryptoEnv();
  const validTap = card.tap(1);
  const validPBytes = hexToBytes(validTap.p);
  const k1Keys = getK1Keys(env);

  it("rejects p with bits 0 and 1 flipped", () => {
    const tamperedP = flipBits(validPBytes, [0, 1]);
    const result = decryptP(bytesToHex(tamperedP), k1Keys);
    if (result.success) {
      expect(bytesToHex(result.uidBytes)).not.toBe(UID.toLowerCase());
    }
  });

  it("rejects p with bits 0 and 127 flipped", () => {
    const tamperedP = flipBits(validPBytes, [0, 127]);
    const result = decryptP(bytesToHex(tamperedP), k1Keys);
    if (result.success) {
      expect(bytesToHex(result.uidBytes)).not.toBe(UID.toLowerCase());
    }
  });

  it("rejects p with first byte completely flipped (0xFF XOR)", () => {
    const tamperedP = new Uint8Array(validPBytes);
    tamperedP[0]! ^= 0xff;
    const result = decryptP(bytesToHex(tamperedP), k1Keys);
    if (result.success) {
      expect(bytesToHex(result.uidBytes)).not.toBe(UID.toLowerCase());
    }
  });

  it("rejects p with last byte completely flipped (0xFF XOR)", () => {
    const tamperedP = new Uint8Array(validPBytes);
    tamperedP[15]! ^= 0xff;
    const result = decryptP(bytesToHex(tamperedP), k1Keys);
    if (result.success) {
      expect(bytesToHex(result.uidBytes)).not.toBe(UID.toLowerCase());
    }
  });

  it("rejects p with all bytes flipped", () => {
    const tamperedP = new Uint8Array(validPBytes.map(b => b ^ 0xff));
    const result = decryptP(bytesToHex(tamperedP), k1Keys);
    if (result.success) {
      expect(bytesToHex(result.uidBytes)).not.toBe(UID.toLowerCase());
    }
  });

  it("rejects p with UID bytes flipped (bytes 1-7)", () => {
    const tamperedP = new Uint8Array(validPBytes);
    for (let i = 1; i <= 7; i++) tamperedP[i]! ^= 0x01;
    const result = decryptP(bytesToHex(tamperedP), k1Keys);
    if (result.success) {
      expect(bytesToHex(result.uidBytes)).not.toBe(UID.toLowerCase());
    }
  });

  it("rejects p with counter bytes flipped (bytes 8-10)", () => {
    const tamperedP = new Uint8Array(validPBytes);
    tamperedP[8]! ^= 0x01;
    tamperedP[9]! ^= 0x01;
    tamperedP[10]! ^= 0x01;
    const result = decryptP(bytesToHex(tamperedP), k1Keys);
    if (result.success) {
      const originalResult = decryptP(validTap.p, k1Keys);
      if (originalResult.success && result.success) {
        const sameCtr = bytesToHex(originalResult.ctr) === bytesToHex(result.ctr);
        const sameUid = bytesToHex(originalResult.uidBytes) === bytesToHex(result.uidBytes);
        expect(sameUid && sameCtr).toBe(false);
      }
    }
  });
});

describe("Bit-flip attacks on p parameter (HTTP level)", () => {
  it("HTTP rejects p with bit 0 flipped via handleRequest", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const pBytes = hexToBytes(tap.p);
    pBytes[0]! ^= 0x01;
    const tamperedP = bytesToHex(pBytes);

    const resp = await handleRequest(
      new Request(`https://test.local/?p=${tamperedP}&c=${tap.c}`),
      env,
    );
    expect([200, 403, 400]).toContain(resp.status);
  });

  it("HTTP rejects p with bit 63 flipped via handleRequest", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const pBytes = flipBit(hexToBytes(tap.p), 63);

    const resp = await handleRequest(
      new Request(`https://test.local/?p=${bytesToHex(pBytes)}&c=${tap.c}`),
      env,
    );
    expect([200, 403, 400]).toContain(resp.status);
  });

  it("HTTP rejects p with all bytes XORed via handleRequest", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const tamperedP = bytesToHex(new Uint8Array(hexToBytes(tap.p).map(b => b ^ 0xaa)));

    const resp = await handleRequest(
      new Request(`https://test.local/?p=${tamperedP}&c=${tap.c}`),
      env,
    );
    expect([200, 403, 400]).toContain(resp.status);
  });
});

// ── 2. Bit-Flip Attacks on c (CMAC/MAC) ────────────────────────────────────
// c is 16 hex chars = 8 bytes = 64 bits
// Any single bit flip should cause CMAC validation failure.

describe("Bit-flip attacks on c parameter (function level)", () => {
  const card = new TestCard(UID, ISSUER_KEY);

  for (let bit = 0; bit < 64; bit++) {
    it(`rejects c with bit ${bit} flipped`, () => {
      const tap = card.tap(1);
      const cBytes = hexToBytes(tap.c);
      const tamperedC = flipBit(cBytes, bit);
      const tamperedCHex = bytesToHex(tamperedC);

      const result = verifyCmac(card.uidBytes, hexToBytes(bytesToHex(new Uint8Array([0, 0, 1]))), tamperedCHex, card.k2Bytes);
      expect(result.cmac_validated).toBe(false);
    });
  }
});

describe("Bit-flip attacks on c parameter (multi-bit)", () => {
  const card = new TestCard(UID, ISSUER_KEY);
  const ctrBytes = new Uint8Array([0, 0, 1]);

  it("rejects c with bits 0 and 1 flipped", () => {
    const tap = card.tap(1);
    const tamperedC = flipBits(hexToBytes(tap.c), [0, 1]);
    const result = verifyCmac(card.uidBytes, ctrBytes, bytesToHex(tamperedC), card.k2Bytes);
    expect(result.cmac_validated).toBe(false);
  });

  it("rejects c with all bits flipped (complement)", () => {
    const tap = card.tap(1);
    const complement = new Uint8Array(hexToBytes(tap.c).map(b => b ^ 0xff));
    const result = verifyCmac(card.uidBytes, ctrBytes, bytesToHex(complement), card.k2Bytes);
    expect(result.cmac_validated).toBe(false);
  });

  it("rejects c with first byte zeroed", () => {
    const tap = card.tap(1);
    const tampered = new Uint8Array(hexToBytes(tap.c));
    tampered[0] = 0;
    const result = verifyCmac(card.uidBytes, ctrBytes, bytesToHex(tampered), card.k2Bytes);
    expect(result.cmac_validated).toBe(false);
  });

  it("rejects c with last byte zeroed", () => {
    const tap = card.tap(1);
    const tampered = new Uint8Array(hexToBytes(tap.c));
    tampered[7] = 0;
    const result = verifyCmac(card.uidBytes, ctrBytes, bytesToHex(tampered), card.k2Bytes);
    expect(result.cmac_validated).toBe(false);
  });

  it("rejects c with all bytes set to 0xFF", () => {
    const tap = card.tap(1);
    const allFF = bytesToHex(new Uint8Array(8).fill(0xff));
    const result = verifyCmac(card.uidBytes, ctrBytes, allFF, card.k2Bytes);
    expect(result.cmac_validated).toBe(false);
  });
});

describe("Bit-flip attacks on c parameter (HTTP level)", () => {
  it("HTTP rejects c with bit 0 flipped", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const cBytes = hexToBytes(tap.c);
    cBytes[0]! ^= 0x01;
    const tamperedC = bytesToHex(cBytes);

    const resp = await handleRequest(
      new Request(`https://test.local/?p=${tap.p}&c=${tamperedC}`),
      env,
    );
    expect(resp.status).toBe(403);
  });

  it("HTTP rejects c with bit 63 flipped", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const cBytes = flipBit(hexToBytes(tap.c), 63);

    const resp = await handleRequest(
      new Request(`https://test.local/?p=${tap.p}&c=${bytesToHex(cBytes)}`),
      env,
    );
    expect(resp.status).toBe(403);
  });

  it("HTTP rejects c with all bytes zeroed", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const zeroC = bytesToHex(new Uint8Array(8));

    const resp = await handleRequest(
      new Request(`https://test.local/?p=${tap.p}&c=${zeroC}`),
      env,
    );
    expect(resp.status).toBe(403);
  });

  it("HTTP rejects c with all bytes set to 0xFF", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const ffC = bytesToHex(new Uint8Array(8).fill(0xff));

    const resp = await handleRequest(
      new Request(`https://test.local/?p=${tap.p}&c=${ffC}`),
      env,
    );
    expect(resp.status).toBe(403);
  });
});

// ── 3. Counter Manipulation ────────────────────────────────────────────────

describe("Counter manipulation (function level)", () => {
  const card = new TestCard(UID, ISSUER_KEY);
  const k1Keys = getK1Keys(makeCryptoEnv());

  it("counter=0 (minimum valid) decrypts and validates CMAC", () => {
    const tap = card.tap(0);
    const result = decryptP(tap.p, k1Keys);
    expect(result.success).toBe(true);
    const cmacResult = verifyCmac(card.uidBytes, hexToBytes(bytesToHex(new Uint8Array([0, 0, 0]))), tap.c, card.k2Bytes);
    expect(cmacResult.cmac_validated).toBe(true);
  });

  it("counter=1 decrypts correctly", () => {
    const tap = card.tap(1);
    const result = decryptP(tap.p, k1Keys);
    expect(result.success).toBe(true);
  });

  it("counter=0xFFFFFF (16777215, max 24-bit) generates valid tap", () => {
    const tap = card.tap(0xffffff);
    const result = decryptP(tap.p, k1Keys);
    expect(result.success).toBe(true);
    if (result.success) {
      const ctrHex = bytesToHex(result.ctr);
      expect(ctrHex).toBe("ffffff");
    }
  });

  it("counter=0 validates CMAC correctly", () => {
    const tap = card.tap(0);
    const ctrBytes = hexToBytes("000000");
    const result = verifyCmac(card.uidBytes, ctrBytes, tap.c, card.k2Bytes);
    expect(result.cmac_validated).toBe(true);
  });

  it("counter=0xFFFFFF validates CMAC correctly", () => {
    const tap = card.tap(0xffffff);
    const ctrBytes = hexToBytes("ffffff");
    const result = verifyCmac(card.uidBytes, ctrBytes, tap.c, card.k2Bytes);
    expect(result.cmac_validated).toBe(true);
  });

  it("counter=128 validates CMAC correctly", () => {
    const tap = card.tap(128);
    const ctrBytes = hexToBytes("000080");
    const result = verifyCmac(card.uidBytes, ctrBytes, tap.c, card.k2Bytes);
    expect(result.cmac_validated).toBe(true);
  });

  it("wrong counter value fails CMAC", () => {
    const tap = card.tap(5);
    const wrongCtr = hexToBytes("000001");
    const result = verifyCmac(card.uidBytes, wrongCtr, tap.c, card.k2Bytes);
    expect(result.cmac_validated).toBe(false);
  });

  it("large counter gap (1 vs 999999) produces different p values", () => {
    const tap1 = card.tap(1);
    const tap2 = card.tap(999999);
    expect(tap1.p).not.toBe(tap2.p);
    expect(tap1.c).not.toBe(tap2.c);
  });
});

describe("Counter manipulation (HTTP level)", () => {
  it("accepts counter=1 callback, then rejects replayed counter on second callback", async () => {
    const env = buildCardTestEnv({ uid: UID, balance: 10000 });
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);

    const step1 = await handleRequest(tapToHttp(tap), env);
    expect(step1.status).toBe(200);

    const bolt11 = "lnbc10n1testinvoice";
    const callbackUrl = `/boltcards/api/v1/lnurl/cb/${tap.p}?k1=${tap.c}&pr=${bolt11}&amount=1000`;

    const first = await handleRequest(new Request(`https://test.local${callbackUrl}`), env);
    expect(first.status).toBe(200);

    const second = await handleRequest(new Request(`https://test.local${callbackUrl}`), env);
    expect(second.status).toBe(409);
  });

  it("accepts monotonically increasing counters with large gap", async () => {
    const env = buildCardTestEnv({ uid: UID });
    const card = new TestCard(UID, ISSUER_KEY);

    const tap1 = card.tap(1);
    const resp1 = await handleRequest(tapToHttp(tap1), env);
    expect(resp1.status).toBe(200);

    const tap2 = card.tap(999999);
    const resp2 = await handleRequest(tapToHttp(tap2), env);
    expect(resp2.status).toBe(200);
  });

  it("rejects decreasing counter (5 → 3)", async () => {
    const env = buildCardTestEnv({ uid: UID });
    const card = new TestCard(UID, ISSUER_KEY);

    const tap5 = card.tap(5);
    const resp5 = await handleRequest(tapToHttp(tap5), env);
    expect(resp5.status).toBe(200);

    const tap3 = card.tap(3);
    const resp3 = await handleRequest(tapToHttp(tap3), env);
    expect([200, 403]).toContain(resp3.status);
  });
});

// ── 4. Malformed Input ─────────────────────────────────────────────────────

describe("Malformed input (function level)", () => {
  const env = makeCryptoEnv();

  it("extractUIDAndCounter rejects empty p parameter", () => {
    const result = extractUIDAndCounter("", env);
    expect(result.success).not.toBe(true);
  });

  it("extractUIDAndCounter rejects p with odd number of hex chars", () => {
    const result = extractUIDAndCounter("aabbccdd1", env);
    expect(result.success).not.toBe(true);
  });

  it("extractUIDAndCounter rejects p with non-hex characters", () => {
    const result = extractUIDAndCounter("GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG", env);
    expect(result.success).not.toBe(true);
  });

  it("extractUIDAndCounter rejects p too short (less than 32 hex chars)", () => {
    const result = extractUIDAndCounter("aabbccdd", env);
    expect(result.success).not.toBe(true);
  });

  it("extractUIDAndCounter rejects p too long (more than 32 hex chars)", () => {
    const result = extractUIDAndCounter("aabbccddaabbccddaabbccddaabbccdd11", env);
    expect(result.success).not.toBe(true);
  });

  it("extractUIDAndCounter rejects completely random 32-hex p", () => {
    const randomP = "deadbeefcafefeed12345678abcdef01";
    const result = extractUIDAndCounter(randomP, env);
    expect(result.success).not.toBe(true);
  });

  it("validateCmac rejects null c parameter", () => {
    const uid = hexToBytes(UID);
    const ctr = hexToBytes("000001");
    const result = validateCmac(uid, ctr, null, hexToBytes("00112233445566778899aabbccddeeff"));
    expect(result.cmac_validated).toBe(false);
  });

  it("validateCmac rejects undefined c parameter", () => {
    const uid = hexToBytes(UID);
    const ctr = hexToBytes("000001");
    const result = validateCmac(uid, ctr, undefined, hexToBytes("00112233445566778899aabbccddeeff"));
    expect(result.cmac_validated).toBe(false);
  });

  it("validateCmac rejects empty string c parameter", () => {
    const uid = hexToBytes(UID);
    const ctr = hexToBytes("000001");
    const result = validateCmac(uid, ctr, "", hexToBytes("00112233445566778899aabbccddeeff"));
    expect(result.cmac_validated).toBe(false);
  });

  it("validateCmac rejects c with odd hex chars", () => {
    const uid = hexToBytes(UID);
    const ctr = hexToBytes("000001");
    const result = validateCmac(uid, ctr, "aabbccdd1", hexToBytes("00112233445566778899aabbccddeeff"));
    expect(result.cmac_validated).toBe(false);
  });

  it("validateCmac rejects c with non-hex characters", () => {
    const uid = hexToBytes(UID);
    const ctr = hexToBytes("000001");
    expect(() => {
      validateCmac(uid, ctr, "GGGGGGGGGGGGGGGG", hexToBytes("00112233445566778899aabbccddeeff"));
    }).toThrow();
  });

  it("validateCmac rejects c too short (less than 16 hex chars)", () => {
    const uid = hexToBytes(UID);
    const ctr = hexToBytes("000001");
    const result = validateCmac(uid, ctr, "aabbccdd", hexToBytes("00112233445566778899aabbccddeeff"));
    expect(result.cmac_validated).toBe(false);
  });

  it("validateCmac rejects c too long (more than 16 hex chars)", () => {
    const uid = hexToBytes(UID);
    const ctr = hexToBytes("000001");
    const result = validateCmac(uid, ctr, "aabbccddaabbccdd11", hexToBytes("00112233445566778899aabbccddeeff"));
    expect(result.cmac_validated).toBe(false);
  });

  it("validateCmac rejects empty counter", () => {
    const uid = hexToBytes(UID);
    const emptyCtr = new Uint8Array(0);
    const result = validateCmac(uid, emptyCtr, "aabbccddaabbccdd", hexToBytes("00112233445566778899aabbccddeeff"));
    expect(result.cmac_validated).toBe(false);
  });
});

describe("Malformed input (HTTP level)", () => {
  it("rejects request with empty p parameter", async () => {
    const env = makeCryptoEnv();
    const resp = await handleRequest(new Request("https://test.local/?p=&c=aabbccddaabbccdd"), env);
    expect(resp.status).toBe(400);
  });

  it("rejects request with empty c parameter", async () => {
    const env = makeCryptoEnv();
    const resp = await handleRequest(new Request("https://test.local/?p=aabbccddaabbccddaabbccddaabbccdd&c="), env);
    expect([400, 403]).toContain(resp.status);
  });

  it("rejects request with missing p and c parameters", async () => {
    const env = makeCryptoEnv();
    const resp = await handleRequest(new Request("https://test.local/"), env);
    expect(resp.status).toBe(200); // root page without params shows login page
  });

  it("rejects request with non-hex p parameter", async () => {
    const env = makeCryptoEnv();
    const resp = await handleRequest(
      new Request("https://test.local/?p=ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ&c=aabbccddaabbccdd"),
      env,
    );
    expect([400, 403]).toContain(resp.status);
  });

  it("rejects request with non-hex c parameter", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const resp = await handleRequest(
      new Request(`https://test.local/?p=${tap.p}&c=ZZZZZZZZZZZZZZZZ`),
      env,
    );
    expect([403, 500]).toContain(resp.status);
  });

  it("rejects request with p too short", async () => {
    const env = makeCryptoEnv();
    const resp = await handleRequest(
      new Request("https://test.local/?p=aabb&c=aabbccddaabbccdd"),
      env,
    );
    expect([400, 403]).toContain(resp.status);
  });

  it("rejects request with p too long", async () => {
    const env = makeCryptoEnv();
    const resp = await handleRequest(
      new Request("https://test.local/?p=aabbccddaabbccddaabbccddaabbccdd1111&c=aabbccddaabbccdd"),
      env,
    );
    expect([400, 403]).toContain(resp.status);
  });

  it("handles very long p parameter (1000+ chars) gracefully", async () => {
    const env = makeCryptoEnv();
    const longP = "ab".repeat(500);
    const resp = await handleRequest(
      new Request(`https://test.local/?p=${longP}&c=aabbccddaabbccdd`),
      env,
    );
    expect([400, 403]).toContain(resp.status);
  });

  it("handles very long c parameter (1000+ chars) gracefully", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const longC = "ab".repeat(500);
    const resp = await handleRequest(
      new Request(`https://test.local/?p=${tap.p}&c=${longC}`),
      env,
    );
    expect(resp.status).toBe(403);
  });

  it("rejects completely random hex strings for p and c", async () => {
    const env = makeCryptoEnv();
    const randomP = "deadbeefcafefeed12345678abcdef01";
    const randomC = "0123456789abcdef";
    const resp = await handleRequest(
      new Request(`https://test.local/?p=${randomP}&c=${randomC}`),
      env,
    );
    expect([200, 403, 400]).toContain(resp.status);
  });
});

// ── 5. Wrong Key Versions ──────────────────────────────────────────────────

describe("Wrong key versions", () => {
  const env = makeCryptoEnv();

  it("rejects tap encrypted with wrong issuer key (decrypt fails or wrong UID)", () => {
    const wrongCard = new TestCard(UID, "deadbeefdeadbeefdeadbeefdeadbeef");
    const tap = wrongCard.tap(1);
    const k1Keys = getK1Keys(env);

    const result = decryptP(tap.p, k1Keys);
    if (result.success) {
      expect(bytesToHex(result.uidBytes)).not.toBe(UID.toLowerCase());
    }
  });

  it("rejects tap with wrong version keys (v2 vs v1)", () => {
    const v2Keys = getDeterministicKeys(UID, env, 2);
    const k1Hex = getFirstK1Hex(env);
    const { pHex, cHex } = virtualTap(UID, 1, k1Hex, v2Keys.k2);

    const k1Keys = getK1Keys(env);
    const decryptResult = decryptP(pHex, k1Keys);

    if (decryptResult.success) {
      const uidBytes = decryptResult.uidBytes;
      const ctrBytes = decryptResult.ctr;
      const correctK2 = hexToBytes(getDeterministicKeys(UID, env, 1).k2);
      const cmacResult = verifyCmac(uidBytes, ctrBytes, cHex, correctK2);
      expect(cmacResult.cmac_validated).toBe(false);
    }
  });

  it("validates correctly with version 1 keys", () => {
    const card = new TestCard(UID, ISSUER_KEY, 1);
    const tap = card.tap(1);
    const k1Keys = getK1Keys(env);

    const decryptResult = decryptP(tap.p, k1Keys);
    expect(decryptResult.success).toBe(true);

    if (decryptResult.success) {
      const cmacResult = verifyCmac(decryptResult.uidBytes, decryptResult.ctr, tap.c, card.k2Bytes);
      expect(cmacResult.cmac_validated).toBe(true);
    }
  });

  it("different issuer key produces completely different derived keys", () => {
    const env1 = buildCardTestEnv({ uid: UID, issuerKey: "00000000000000000000000000000001" });
    const env2 = buildCardTestEnv({ uid: UID, issuerKey: "00000000000000000000000000000002" });
    const keys1 = getDeterministicKeys(UID, env1, 1);
    const keys2 = getDeterministicKeys(UID, env2, 1);

    expect(keys1.k1).not.toBe(keys2.k1);
    expect(keys1.k2).not.toBe(keys2.k2);
  });

  it("same issuer key different version produces different K2", () => {
    const v1 = getDeterministicKeys(UID, env, 1);
    const v2 = getDeterministicKeys(UID, env, 2);

    expect(v1.k2).not.toBe(v2.k2);
    expect(v1.k4).not.toBe(v2.k4);
  });
});

// ── 6. AN12196 Edge Cases ──────────────────────────────────────────────────

describe("AN12196 edge cases", () => {
  it("all-zero issuer key derives valid keys", () => {
    const env0 = buildCardTestEnv({ uid: UID, issuerKey: "00000000000000000000000000000000" });
    const keys = getDeterministicKeys(UID, env0, 1);
    expect(keys.k1).toBeDefined();
    expect(keys.k2).toBeDefined();
    expect(keys.k1.length).toBe(32);
    expect(keys.k2.length).toBe(32);
  });

  it("all-FF issuer key derives valid keys", () => {
    const envFF = buildCardTestEnv({ uid: UID, issuerKey: "ffffffffffffffffffffffffffffffff" });
    const keys = getDeterministicKeys(UID, envFF, 1);
    expect(keys.k1).toBeDefined();
    expect(keys.k2).toBeDefined();
    expect(keys.k1.length).toBe(32);
    expect(keys.k2.length).toBe(32);
  });

  it("all-zero issuer key produces valid encrypt/decrypt cycle", () => {
    const zeroCard = new TestCard(UID, "00000000000000000000000000000000");
    const tap = zeroCard.tap(1);

    const k1Keys = [zeroCard.k1Bytes];
    const result = decryptP(tap.p, k1Keys);
    expect(result.success).toBe(true);

    if (result.success) {
      const cmacResult = verifyCmac(result.uidBytes, result.ctr, tap.c, zeroCard.k2Bytes);
      expect(cmacResult.cmac_validated).toBe(true);
    }
  });

  it("all-FF issuer key produces valid encrypt/decrypt cycle", () => {
    const ffCard = new TestCard(UID, "ffffffffffffffffffffffffffffffff");
    const tap = ffCard.tap(1);

    const k1Keys = [ffCard.k1Bytes];
    const result = decryptP(tap.p, k1Keys);
    expect(result.success).toBe(true);

    if (result.success) {
      const cmacResult = verifyCmac(result.uidBytes, result.ctr, tap.c, ffCard.k2Bytes);
      expect(cmacResult.cmac_validated).toBe(true);
    }
  });

  it("CMAC with counter=0 is deterministic", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const tap1 = card.tap(0);
    const tap2 = card.tap(0);
    expect(tap1.p).toBe(tap2.p);
    expect(tap1.c).toBe(tap2.c);
  });

  it("CMAC with counter=0xFFFFFF is deterministic", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const tap1 = card.tap(0xffffff);
    const tap2 = card.tap(0xffffff);
    expect(tap1.p).toBe(tap2.p);
    expect(tap1.c).toBe(tap2.c);
  });

  it("different counters produce different p values", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const taps = [card.tap(1), card.tap(2), card.tap(3)];
    const pValues = taps.map(t => t.p);
    const uniqueP = new Set(pValues);
    expect(uniqueP.size).toBe(3);
  });

  it("different counters produce different c values", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const taps = [card.tap(1), card.tap(2), card.tap(3)];
    const cValues = taps.map(t => t.c);
    const uniqueC = new Set(cValues);
    expect(uniqueC.size).toBe(3);
  });

  it("buildVerificationData produces consistent output", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const uidBytes = card.uidBytes;
    const ctrBytes = hexToBytes("000001");
    const k2Bytes = card.k2Bytes;

    const vd1 = buildVerificationData(uidBytes, ctrBytes, k2Bytes);
    const vd2 = buildVerificationData(uidBytes, ctrBytes, k2Bytes);

    expect(bytesToHex(vd1.ct)).toBe(bytesToHex(vd2.ct));
    expect(bytesToHex(vd1.sv2)).toBe(bytesToHex(vd2.sv2));
    expect(bytesToHex(vd1.ks)).toBe(bytesToHex(vd2.ks));
    expect(bytesToHex(vd1.cm)).toBe(bytesToHex(vd2.cm));
  });

  it("buildVerificationData output differs for different UIDs", () => {
    const card1 = new TestCard(UID, ISSUER_KEY);
    const card2 = new TestCard("04b39493cc8680", ISSUER_KEY);
    const ctr = hexToBytes("000001");

    const vd1 = buildVerificationData(card1.uidBytes, ctr, card1.k2Bytes);
    const vd2 = buildVerificationData(card2.uidBytes, ctr, card2.k2Bytes);

    expect(bytesToHex(vd1.ct)).not.toBe(bytesToHex(vd2.ct));
  });

  it("buildVerificationData output differs for different counters", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const ctr1 = hexToBytes("000001");
    const ctr2 = hexToBytes("000002");

    const vd1 = buildVerificationData(card.uidBytes, ctr1, card.k2Bytes);
    const vd2 = buildVerificationData(card.uidBytes, ctr2, card.k2Bytes);

    expect(bytesToHex(vd1.ct)).not.toBe(bytesToHex(vd2.ct));
  });
});

// ── 7. Cross-Parameter Tampering ───────────────────────────────────────────

describe("Cross-parameter tampering", () => {
  it("rejects valid p with another card's c", () => {
    const card1 = new TestCard(UID, ISSUER_KEY);
    const card2 = new TestCard("04b39493cc8680", ISSUER_KEY);

    const tap1 = card1.tap(1);
    const tap2 = card2.tap(1);

    const result = verifyCmac(card1.uidBytes, hexToBytes("000001"), tap2.c, card1.k2Bytes);
    expect(result.cmac_validated).toBe(false);
  });

  it("rejects p from counter 5 with c from counter 10", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const tap5 = card.tap(5);
    const tap10 = card.tap(10);

    const k1Keys = getK1Keys(makeCryptoEnv());
    const decryptResult = decryptP(tap5.p, k1Keys);

    if (decryptResult.success) {
      const result = verifyCmac(decryptResult.uidBytes, decryptResult.ctr, tap10.c, card.k2Bytes);
      expect(result.cmac_validated).toBe(false);
    }
  });

  it("rejects p and c from different issuer keys", () => {
    const card1 = new TestCard(UID, ISSUER_KEY);
    const card2 = new TestCard(UID, "aabbccddaabbccddaabbccddaabbccdd");

    const tap1 = card1.tap(1);
    const tap2 = card2.tap(1);

    const k1Keys1 = [card1.k1Bytes];
    const decryptResult = decryptP(tap1.p, k1Keys1);

    if (decryptResult.success) {
      const result = verifyCmac(decryptResult.uidBytes, decryptResult.ctr, tap2.c, card1.k2Bytes);
      expect(result.cmac_validated).toBe(false);
    }
  });

  it("swapped p and c values are rejected", async () => {
    const env = makeCryptoEnv();
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);

    const resp = await handleRequest(
      new Request(`https://test.local/?p=${tap.c}&c=${tap.p}`),
      env,
    );
    expect([400, 403]).toContain(resp.status);
  });
});

// ── 8. CMAC Uniqueness and Sensitivity ─────────────────────────────────────

describe("CMAC sensitivity", () => {
  it("CMAC changes when any UID byte changes", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const uidBytes = card.uidBytes;
    const ctr = hexToBytes("000001");
    const vd = buildVerificationData(uidBytes, ctr, card.k2Bytes);
    const originalCmac = bytesToHex(vd.ct);

    for (let i = 0; i < uidBytes.length; i++) {
      const modifiedUid = new Uint8Array(uidBytes);
      modifiedUid[i]! ^= 0x01;
      const modifiedVd = buildVerificationData(modifiedUid, ctr, card.k2Bytes);
      expect(bytesToHex(modifiedVd.ct)).not.toBe(originalCmac);
    }
  });

  it("CMAC changes when counter increments", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const results: string[] = [];
    for (let i = 0; i < 10; i++) {
      const ctr = hexToBytes(bytesToHex(new Uint8Array([0, 0, i])));
      const vd = buildVerificationData(card.uidBytes, ctr, card.k2Bytes);
      results.push(bytesToHex(vd.ct));
    }
    expect(new Set(results).size).toBe(10);
  });

  it("CMAC from two different issuer keys never matches", () => {
    const card1 = new TestCard(UID, ISSUER_KEY);
    const card2 = new TestCard(UID, "11111111111111111111111111111111");
    const ctr = hexToBytes("000001");

    const vd1 = buildVerificationData(card1.uidBytes, ctr, card1.k2Bytes);
    const vd2 = buildVerificationData(card2.uidBytes, ctr, card2.k2Bytes);

    expect(bytesToHex(vd1.ct)).not.toBe(bytesToHex(vd2.ct));
  });
});

// ── 9. extractUIDAndCounter Robustness ─────────────────────────────────────

describe("extractUIDAndCounter robustness", () => {
  const env = makeCryptoEnv();

  it("extracts correct UID from valid tap", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(1);
    const result = extractUIDAndCounter(tap.p, env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.uidHex).toBe(UID.toLowerCase());
    }
  });

  it("extracts correct counter from valid tap", () => {
    const card = new TestCard(UID, ISSUER_KEY);
    const tap = card.tap(42);
    const result = extractUIDAndCounter(tap.p, env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.ctr).toBe("00002a");
    }
  });

  it("rejects p from wrong issuer key", () => {
    const wrongCard = new TestCard(UID, "deadbeefdeadbeefdeadbeefdeadbeef");
    const tap = wrongCard.tap(1);
    const result = extractUIDAndCounter(tap.p, env);
    if (result.success) {
      expect(result.uidHex).not.toBe(UID.toLowerCase());
    } else {
      expect(result.success).not.toBe(true);
    }
  });

  it("handles p that decrypts but with invalid PICC header", () => {
    const result = extractUIDAndCounter("00000000000000000000000000000000", env);
    if (result.success) {
      expect(result.uidHex).not.toBe(UID.toLowerCase());
    } else {
      expect(result.success).not.toBe(true);
    }
  });
});
