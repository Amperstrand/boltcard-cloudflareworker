/**
 * SDM Simulator Tests + AN10922 Key Diversification Vectors
 *
 * Implements a SimulatedNTAG424 class that models card-side SDM behavior
 * (AN12196 §3.4) and validates against spec test vectors.
 *
 * Also tests key derivation properties and AN10922 diversification concepts.
 */

import { describe, it, expect } from "vitest";
import { ecb } from "@noble/ciphers/aes";
import {
  hexToBytes,
  bytesToHex,
  computeAesCmac,
  decryptP,
  verifyCmac,
  buildVerificationData,
} from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap } from "./testHelpers.js";

// ---------------------------------------------------------------------------
// SimulatedNTAG424 — models card-side SDM per NXP AN12196 §3.4
// ---------------------------------------------------------------------------

/**
 * Models the NTAG424 DNA Secure Dynamic Messaging protocol.
 *
 * When a phone reads an NTAG424 card, the chip:
 * 1. Increments its SDMReadCounter (24-bit)
 * 2. Builds PICCData = 0xC7 || UID(7B) || SDMReadCtr(3B) || padding(5B)
 * 3. Encrypts PICCData with K_SDMMetaRead (=K1) via AES-ECB → PICCENCData (p=)
 * 4. Derives session key: KSesSDMFileReadMAC = CMAC(K_SDMFileRead, SV2)
 * 5. Computes CMAC over a transformed block → extracts odd bytes → MACt (c=)
 *
 * SV2 per AN12196 Table 1:
 *   3CC3 0001 0080 UID(7B) SDMReadCtr(3B)
 */
class SimulatedNTAG424 {
  private readonly uid: Uint8Array;
  private readonly kSdmMetaRead: Uint8Array; // K1
  private readonly kSdmFileRead: Uint8Array; // K2
  private counter: number;

  constructor(uidHex: string, k1Hex: string, k2Hex: string) {
    if (!/^[0-9a-fA-F]{14}$/.test(uidHex)) {
      throw new Error("UID must be 7 bytes (14 hex chars)");
    }
    if (!/^[0-9a-fA-F]{32}$/.test(k1Hex)) {
      throw new Error("K1 must be 16 bytes (32 hex chars)");
    }
    if (!/^[0-9a-fA-F]{32}$/.test(k2Hex)) {
      throw new Error("K2 must be 16 bytes (32 hex chars)");
    }
    this.uid = hexToBytes(uidHex);
    this.kSdmMetaRead = hexToBytes(k1Hex);
    this.kSdmFileRead = hexToBytes(k2Hex);
    this.counter = 0;
  }

  /**
   * Simulate a card tap.
   * @param counter - Override counter value (otherwise auto-increments from 1)
   */
  tap(counter?: number): { p: string; c: string } {
    if (counter !== undefined) {
      this.counter = counter;
    } else {
      this.counter++;
    }

    // Step 1: Build PICCData plaintext (16 bytes)
    const piccData = new Uint8Array(16);
    piccData[0] = 0xc7; // PICCDataTag
    piccData.set(this.uid, 1); // UID bytes 1-7
    piccData[8] = this.counter & 0xff; // counter LSB
    piccData[9] = (this.counter >> 8) & 0xff; // counter middle
    piccData[10] = (this.counter >> 16) & 0xff; // counter MSB
    // bytes 11-15 remain zero padding

    // Step 2: AES-ECB encrypt PICCData with K_SDMMetaRead → p
    const cipher = ecb(this.kSdmMetaRead, { disablePadding: true });
    const encrypted = cipher.encrypt(piccData);
    const p = bytesToHex(encrypted);

    // Step 3: Derive session key KSesSDMFileReadMAC = CMAC(K2, SV2)
    const sv2 = this.buildSV2();
    const sessionKey = computeAesCmac(sv2, this.kSdmFileRead);

    // Step 4: Compute Cm from session key (double subkey derivation)
    const cm = this.computeCm(sessionKey);

    // Step 5: Extract odd bytes → MACt (8 bytes)
    const ct = new Uint8Array([
      cm[1]!,
      cm[3]!,
      cm[5]!,
      cm[7]!,
      cm[9]!,
      cm[11]!,
      cm[13]!,
      cm[15]!,
    ]);
    const c = bytesToHex(ct);

    return { p, c };
  }

  /** Get current counter value */
  getCounter(): number {
    return this.counter;
  }

  /**
   * Build SV2 per AN12196 Table 1:
   * Bytes: 3CC3 0001 0080 UID(7B) SDMReadCtr(3B)
   */
  private buildSV2(): Uint8Array {
    const sv2 = new Uint8Array(16);
    sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80], 0);
    sv2.set(this.uid, 6);
    // Counter in SV2: matches verify.ts sv2[13]=ctr[2](LSB), sv2[14]=ctr[1](mid), sv2[15]=ctr[0](MSB)
    sv2[13] = this.counter & 0xff;
    sv2[14] = (this.counter >> 8) & 0xff;
    sv2[15] = (this.counter >> 16) & 0xff;
    return sv2;
  }

  /**
   * Compute Cm from session key Ks.
   * This is the double subkey derivation from AN12196 §3.3:
   *   L' = AES-ECB(Ks, 0^16)
   *   K1' = double(L')
   *   K2' = double(K1')  (= HK1)
   *   Cm = AES-ECB(Ks, K2' XOR 80^1 || 0^15)
   */
  private computeCm(ks: Uint8Array): Uint8Array {
    // L' = AES(Ks, 0)
    const zeroBlock = new Uint8Array(16);
    const lPrime = ecb(ks, { disablePadding: true }).encrypt(zeroBlock);

    // K1' = double(L')
    const k1Prime = this.doubleSubkey(new Uint8Array(lPrime));

    // HK1 = double(K1')
    const hk1 = this.doubleSubkey(k1Prime);

    // XOR first byte with 0x80
    const hashVal = new Uint8Array(hk1);
    hashVal[0]! ^= 0x80;

    // Cm = AES(Ks, hashVal) — new cipher instance required by @noble/ciphers
    return ecb(ks, { disablePadding: true }).encrypt(hashVal);
  }

  /**
   * ANSI X9.63 / NIST SP 800-108 key doubling:
   * left-shift by 1 bit, XOR with 0x87 if carry out.
   */
  private doubleSubkey(input: Uint8Array): Uint8Array {
    const result = new Uint8Array(input.length);
    let carry = 0;
    for (let i = input.length - 1; i >= 0; i--) {
      const msb = input[i]! >> 7;
      result[i] = ((input[i]! << 1) & 0xff) | carry;
      carry = msb;
    }
    if (carry) {
      result[result.length - 1]! ^= 0x87;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Helper: generate random hex strings
// ---------------------------------------------------------------------------
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  // Simple deterministic pseudo-random for reproducibility
  for (let i = 0; i < bytes; i++) {
    arr[i] = (i * 17 + 42) & 0xff;
  }
  return bytesToHex(arr);
}

function generateRandomUid(index: number): string {
  // 7 bytes, first byte always 04 (NTAG424)
  const arr = new Uint8Array(7);
  arr[0] = 0x04;
  for (let i = 1; i < 7; i++) {
    arr[i] = (index * 13 + i * 37 + 0xa5) & 0xff;
  }
  return bytesToHex(arr);
}

function generateRandomKey(index: number): string {
  const arr = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    arr[i] = (index * 7 + i * 23 + 0x3c) & 0xff;
  }
  return bytesToHex(arr);
}

// ===========================================================================
// TEST SUITES
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. SimulatedNTAG424 class construction
// ---------------------------------------------------------------------------
describe("SimulatedNTAG424 construction", () => {
  it("accepts valid 7-byte UID and 16-byte keys", () => {
    const sim = new SimulatedNTAG424(
      "04DE5F1EACC040",
      "00000000000000000000000000000000",
      "00000000000000000000000000000000"
    );
    expect(sim.getCounter()).toBe(0);
  });

  it("rejects invalid UID length", () => {
    expect(() => new SimulatedNTAG424("04DE5F", "00000000000000000000000000000000", "00000000000000000000000000000000"))
      .toThrow("UID must be 7 bytes");
  });

  it("rejects empty UID", () => {
    expect(() => new SimulatedNTAG424("", "00000000000000000000000000000000", "00000000000000000000000000000000"))
      .toThrow("UID must be 7 bytes");
  });

  it("rejects non-hex UID", () => {
    expect(() => new SimulatedNTAG424("04DE5F1EACC04G", "00000000000000000000000000000000", "00000000000000000000000000000000"))
      .toThrow();
  });

  it("rejects invalid K1 length", () => {
    expect(() => new SimulatedNTAG424("04DE5F1EACC040", "AABBCC", "00000000000000000000000000000000"))
      .toThrow("K1 must be 16 bytes");
  });

  it("rejects invalid K2 length", () => {
    expect(() => new SimulatedNTAG424("04DE5F1EACC040", "00000000000000000000000000000000", "AABBCC"))
      .toThrow("K2 must be 16 bytes");
  });
});

// ---------------------------------------------------------------------------
// 2. AN12196 Table 4 — Spec Test Vector
// ---------------------------------------------------------------------------
describe("AN12196 Table 4 test vector", () => {
  const uid = "04DE5F1EACC040";
  const k1 = "00000000000000000000000000000000";
  const k2 = "00000000000000000000000000000000";
  const counter = 61; // 0x3D

  const expectedPICCENCData = "ef963ff7828658a599f3041510671e88";
  const expectedMACt = "94eed9ee65337086";

  it("decrypting spec PICCENCData yields correct UID and counter", () => {
    const pBytes = hexToBytes(expectedPICCENCData);
    const keyBytes = hexToBytes(k1);
    const decrypted = new Uint8Array(ecb(keyBytes, { disablePadding: true }).decrypt(pBytes));

    expect(decrypted[0]).toBe(0xc7);
    expect(bytesToHex(decrypted.slice(1, 8))).toBe(uid.toLowerCase());
    expect(decrypted[8]).toBe(counter & 0xff);
    expect(decrypted[9]).toBe((counter >> 8) & 0xff);
    expect(decrypted[10]).toBe((counter >> 16) & 0xff);
    // AN12196 PICCData includes extra SDM fields at bytes [11-15] (e.g. SDMReadCtrLimit)
    // that the boltcard protocol does not use — our implementation zeros those bytes
  });

  it("simulator CMAC matches AN12196 spec MACt", () => {
    const sim = new SimulatedNTAG424(uid, k1, k2);
    const { c } = sim.tap(counter);
    expect(c).toBe(expectedMACt);
  });

  it("verifyCmac validates the spec MACt", () => {
    const uidBytes = hexToBytes(uid);
    const ctrBytes = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
    const result = verifyCmac(uidBytes, ctrBytes, expectedMACt, hexToBytes(k2));
    expect(result.cmac_validated).toBe(true);
  });

  it("simulator decrypt round-trip for spec UID/counter", () => {
    // p= differs from AN12196 spec because spec PICCData has extra SDM fields at [11-15];
    // our simulator zeros those bytes. Both are valid — decryptP only uses bytes 0-10.
    const sim = new SimulatedNTAG424(uid, k1, k2);
    const { p } = sim.tap(counter);

    const decrypted = decryptP(p, [hexToBytes(k1)]);
    expect(decrypted.success).toBe(true);
    if (decrypted.success) {
      expect(bytesToHex(decrypted.uidBytes)).toBe(uid.toLowerCase());
      const recoveredCounter = (decrypted.ctr[0]! << 16) | (decrypted.ctr[1]! << 8) | decrypted.ctr[2]!;
      expect(recoveredCounter).toBe(counter);
    }
  });

  it("spec PICCENCData is also decryptable by our decryptP", () => {
    const decrypted = decryptP(expectedPICCENCData, [hexToBytes(k1)]);
    expect(decrypted.success).toBe(true);
    if (decrypted.success) {
      expect(bytesToHex(decrypted.uidBytes)).toBe(uid.toLowerCase());
      const recoveredCounter = (decrypted.ctr[0]! << 16) | (decrypted.ctr[1]! << 8) | decrypted.ctr[2]!;
      expect(recoveredCounter).toBe(counter);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. AN12196 Table 1 & 2 — SV2 and Session Key Derivation
// ---------------------------------------------------------------------------
describe("AN12196 SV2 construction", () => {
  it("builds correct SV2 layout: 3CC3 0001 0080 UID Ctr", () => {
    const uid = "04DE5F1EACC040";
    const k1 = "00000000000000000000000000000000";
    const k2 = "00000000000000000000000000000000";
    const counter = 0x3d;

    // buildVerificationData constructs the same SV2
    const uidBytes = hexToBytes(uid);
    const ctrBytes = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
    const { sv2 } = buildVerificationData(uidBytes, ctrBytes, hexToBytes(k2));

    // Verify SV2 layout
    expect(sv2[0]).toBe(0x3c);
    expect(sv2[1]).toBe(0xc3);
    expect(sv2[2]).toBe(0x00);
    expect(sv2[3]).toBe(0x01);
    expect(sv2[4]).toBe(0x00);
    expect(sv2[5]).toBe(0x80);
    // UID at bytes 6-12
    expect(bytesToHex(sv2.slice(6, 13))).toBe(uid.toLowerCase());
    // Counter at bytes 13-15: [LSB, mid, MSB] per verify.ts convention
    expect(sv2[13]).toBe(counter & 0xff);
    expect(sv2[14]).toBe((counter >> 8) & 0xff);
    expect(sv2[15]).toBe((counter >> 16) & 0xff);
  });

  it("session key derivation matches between simulator and library", () => {
    const uid = "04DE5F1EACC040";
    const k2 = "00000000000000000000000000000000";
    const counter = 0x3d;

    const uidBytes = hexToBytes(uid);
    const ctrBytes = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
    const { ks } = buildVerificationData(uidBytes, ctrBytes, hexToBytes(k2));

    // Simulator's session key via computeAesCmac(SV2, K2)
    const sv2 = new Uint8Array(16);
    sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80], 0);
    sv2.set(uidBytes, 6);
    sv2[13] = counter & 0xff;
    sv2[14] = (counter >> 8) & 0xff;
    sv2[15] = (counter >> 16) & 0xff;

    const simSessionKey = computeAesCmac(sv2, hexToBytes(k2));
    expect(bytesToHex(simSessionKey)).toBe(bytesToHex(ks));
  });
});

// ---------------------------------------------------------------------------
// 4. Cross-verification: SimulatedNTAG424 vs virtualTap
// ---------------------------------------------------------------------------
describe("SimulatedNTAG424 vs virtualTap cross-verification", () => {
  const testCases: Array<{ uid: string; counter: number; label: string }> = [
    { uid: "04DE5F1EACC040", counter: 1, label: "spec UID counter=1" },
    { uid: "04DE5F1EACC040", counter: 61, label: "spec UID counter=61" },
    { uid: "04DE5F1EACC040", counter: 0, label: "spec UID counter=0" },
    { uid: "04DE5F1EACC040", counter: 0xffffff, label: "spec UID counter=max" },
    { uid: "04a39493cc8680", counter: 1, label: "default test UID counter=1" },
    { uid: "04a39493cc8680", counter: 100, label: "default test UID counter=100" },
    { uid: "04782e21801d80", counter: 42, label: "AN10922 UID counter=42" },
    { uid: "01020304050607", counter: 255, label: "sequential UID counter=255" },
  ];

  for (const { uid, counter, label } of testCases) {
    it(`produces same p and c as virtualTap: ${label}`, () => {
      const k1 = "00000000000000000000000000000000";
      const k2 = "00000000000000000000000000000000";

      const sim = new SimulatedNTAG424(uid, k1, k2);
      const simResult = sim.tap(counter);

      const vtResult = virtualTap(uid, counter, k1, k2);

      expect(simResult.p).toBe(vtResult.pHex);
      expect(simResult.c).toBe(vtResult.cHex);
    });
  }

  it("produces same output for 10 random counter values", () => {
    const uid = "04a39493cc8680";
    const k1 = "00000000000000000000000000000000";
    const k2 = "00000000000000000000000000000000";

    for (let counter = 0; counter < 10; counter++) {
      const sim = new SimulatedNTAG424(uid, k1, k2);
      const simResult = sim.tap(counter);
      const vtResult = virtualTap(uid, counter, k1, k2);
      expect(simResult.p, `counter=${counter} p`).toBe(vtResult.pHex);
      expect(simResult.c, `counter=${counter} c`).toBe(vtResult.cHex);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Decrypt + Verify Round-Trip (Simulator → Server)
// ---------------------------------------------------------------------------
describe("Simulator → Server decrypt + verify round-trip", () => {
  it("round-trips with all-zero keys", () => {
    const uid = "04DE5F1EACC040";
    const k1 = "00000000000000000000000000000000";
    const k2 = "00000000000000000000000000000000";

    const sim = new SimulatedNTAG424(uid, k1, k2);
    const { p, c } = sim.tap(1);

    const decrypted = decryptP(p, [hexToBytes(k1)]);
    expect(decrypted.success).toBe(true);
    if (decrypted.success) {
      expect(bytesToHex(decrypted.uidBytes)).toBe(uid.toLowerCase());
      const ctr = (decrypted.ctr[0]! << 16) | (decrypted.ctr[1]! << 8) | decrypted.ctr[2]!;
      expect(ctr).toBe(1);
    }

    const verified = verifyCmac(
      hexToBytes(uid),
      new Uint8Array([0, 0, 1]),
      c,
      hexToBytes(k2)
    );
    expect(verified.cmac_validated).toBe(true);
  });

  it("round-trips with non-zero keys", () => {
    const uid = "04a39493cc8680";
    const k1 = "55da174c9608993dc27bb3f30a4a7314";
    const k2 = "0c3b25d92b38ae443229dd59ad34b85d";

    const sim = new SimulatedNTAG424(uid, k1, k2);
    const { p, c } = sim.tap(42);

    const decrypted = decryptP(p, [hexToBytes(k1)]);
    expect(decrypted.success).toBe(true);
    if (decrypted.success) {
      expect(bytesToHex(decrypted.uidBytes)).toBe(uid.toLowerCase());
      const ctr = (decrypted.ctr[0]! << 16) | (decrypted.ctr[1]! << 8) | decrypted.ctr[2]!;
      expect(ctr).toBe(42);
    }

    const verified = verifyCmac(
      hexToBytes(uid),
      new Uint8Array([0, 0, 42]),
      c,
      hexToBytes(k2)
    );
    expect(verified.cmac_validated).toBe(true);
  });

  it("100 random (uid, k1, k2, counter) triples all pass round-trip", () => {
    for (let i = 0; i < 100; i++) {
      const uid = generateRandomUid(i);
      const k1 = generateRandomKey(i * 2);
      const k2 = generateRandomKey(i * 2 + 1);
      const counter = i % 0xffffff;

      const sim = new SimulatedNTAG424(uid, k1, k2);
      const { p, c } = sim.tap(counter);

      // Decrypt
      const decrypted = decryptP(p, [hexToBytes(k1)]);
      expect(decrypted.success, `decrypt uid=${uid} counter=${counter} i=${i}`).toBe(true);
      if (decrypted.success) {
        expect(bytesToHex(decrypted.uidBytes), `uid match i=${i}`).toBe(uid.toLowerCase());
        const ctr = (decrypted.ctr[0]! << 16) | (decrypted.ctr[1]! << 8) | decrypted.ctr[2]!;
        expect(ctr, `counter match i=${i}`).toBe(counter);
      }

      // Verify CMAC
      const ctrBytes = new Uint8Array([
        (counter >> 16) & 0xff,
        (counter >> 8) & 0xff,
        counter & 0xff,
      ]);
      const verified = verifyCmac(hexToBytes(uid), ctrBytes, c, hexToBytes(k2));
      expect(verified.cmac_validated, `cmac valid i=${i}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Auto-increment behavior
// ---------------------------------------------------------------------------
describe("SimulatedNTAG424 auto-increment", () => {
  it("auto-increments counter starting from 1", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    expect(sim.getCounter()).toBe(0);

    sim.tap();
    expect(sim.getCounter()).toBe(1);

    sim.tap();
    expect(sim.getCounter()).toBe(2);
  });

  it("produces different p values for successive taps (counter changes)", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");

    const tap1 = sim.tap();
    const tap2 = sim.tap();
    const tap3 = sim.tap();

    // Different counter → different encryption
    expect(tap1.p).not.toBe(tap2.p);
    expect(tap2.p).not.toBe(tap3.p);
    expect(tap1.c).not.toBe(tap2.c);
    expect(tap2.c).not.toBe(tap3.c);
  });

  it("allows explicit counter override", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");

    const tapA = sim.tap(42);
    expect(sim.getCounter()).toBe(42);

    const tapB = sim.tap(99);
    expect(sim.getCounter()).toBe(99);

    // Same counter produces same output
    const tapA2 = sim.tap(42);
    expect(tapA.p).toBe(tapA2.p);
    expect(tapA.c).toBe(tapA2.c);
  });
});

// ---------------------------------------------------------------------------
// 7. Key Derivation — Deterministic Properties
// ---------------------------------------------------------------------------
describe("Key derivation deterministic properties", () => {
  const testEnv = { ISSUER_KEY: "00000000000000000000000000000001" } as unknown as import("../types/core.js").Env;

  it("produces same keys for same inputs", () => {
    const keys1 = getDeterministicKeys("04a39493cc8680", testEnv);
    const keys2 = getDeterministicKeys("04a39493cc8680", testEnv);
    expect(keys1.k0).toBe(keys2.k0);
    expect(keys1.k1).toBe(keys2.k1);
    expect(keys1.k2).toBe(keys2.k2);
    expect(keys1.k3).toBe(keys2.k3);
    expect(keys1.k4).toBe(keys2.k4);
    expect(keys1.id).toBe(keys2.id);
  });

  it("produces different k2 for different UIDs", () => {
    const keys1 = getDeterministicKeys("04a39493cc8680", testEnv);
    const keys2 = getDeterministicKeys("04DE5F1EACC040", testEnv);
    expect(keys1.k2).not.toBe(keys2.k2);
  });

  it("k1 is the same for all UIDs with same issuer key (derived from issuerKey only)", () => {
    const keys1 = getDeterministicKeys("04a39493cc8680", testEnv);
    const keys2 = getDeterministicKeys("04DE5F1EACC040", testEnv);
    expect(keys1.k1).toBe(keys2.k1);
  });

  it("produces all 5 different keys (k0-k4)", () => {
    const keys = getDeterministicKeys("04a39493cc8680", testEnv);
    const allKeys = [keys.k0, keys.k1, keys.k2, keys.k3, keys.k4];
    const unique = new Set(allKeys);
    expect(unique.size).toBe(5);
  });

  it("cardKey differs from all derived keys", () => {
    const keys = getDeterministicKeys("04a39493cc8680", testEnv);
    expect(keys.cardKey).not.toBe(keys.k0);
    expect(keys.cardKey).not.toBe(keys.k1);
    expect(keys.cardKey).not.toBe(keys.k2);
    expect(keys.cardKey).not.toBe(keys.k3);
    expect(keys.cardKey).not.toBe(keys.k4);
  });

  it("id is deterministic for same UID", () => {
    const keys1 = getDeterministicKeys("04a39493cc8680", testEnv);
    const keys2 = getDeterministicKeys("04a39493cc8680", testEnv);
    expect(keys1.id).toBe(keys2.id);
  });

  it("id differs for different UIDs", () => {
    const keys1 = getDeterministicKeys("04a39493cc8680", testEnv);
    const keys2 = getDeterministicKeys("04DE5F1EACC040", testEnv);
    expect(keys1.id).not.toBe(keys2.id);
  });

  it("10 different UIDs produce 10 unique k2 values", () => {
    const k2Set = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const uid = generateRandomUid(i);
      const keys = getDeterministicKeys(uid, testEnv);
      k2Set.add(keys.k2);
    }
    expect(k2Set.size).toBe(10);
  });

  it("10 different UIDs produce 10 unique id values", () => {
    const idSet = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const uid = generateRandomUid(i);
      const keys = getDeterministicKeys(uid, testEnv);
      idSet.add(keys.id);
    }
    expect(idSet.size).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 8. AN10922 Key Diversification Concepts
// ---------------------------------------------------------------------------
describe("AN10922 key diversification concepts", () => {
  /**
   * Our keygenerator.ts uses AES-CMAC-based diversification (not AN10922 §2.2.1):
   *
   * AN10922 §2.2.1:
   *   input = UID(7) || AID(3) || SystemIdentifier(7) → 17 bytes
   *   diversified = AES-ENC(masterKey, input padded to 16 bytes)
   *
   * Our scheme (in @ntag424/crypto keys.ts):
   *   cardKey = CMAC(issuerKey, 2d003f75 || UID(7) || version(4))
   *   k0 = CMAC(cardKey, 2d003f76)
   *   k1 = CMAC(issuerKey, 2d003f77)   ← unique: uses issuerKey, not cardKey
   *   k2 = CMAC(cardKey, 2d003f78)
   *   k3 = CMAC(cardKey, 2d003f79)
   *   k4 = CMAC(cardKey, 2d003f7a)
   *
   * Both are deterministic key diversification but with different constructions.
   * AN10922 uses AES-ECB encryption; ours uses AES-CMAC (RFC 4493).
   */

  it("documents difference: our scheme uses CMAC not AES-ECB", () => {
    const masterKey = "00112233445566778899AABBCCDDEEFF";
    const uid = "04782e21801d80";

    // AN10922 §2.2.1 would do: diversified = AES-ECB(masterKey, paddedInput)
    // Our scheme does: cardKey = CMAC(issuerKey, prefix || uid || version)
    // These are fundamentally different constructions

    const ourKeys = getDeterministicKeys(
      uid,
      { ISSUER_KEY: masterKey } as unknown as import("../types/core.js").Env
    );

    // Verify our keys are well-formed (32 hex chars = 16 bytes)
    expect(ourKeys.k0).toMatch(/^[0-9a-f]{32}$/);
    expect(ourKeys.k1).toMatch(/^[0-9a-f]{32}$/);
    expect(ourKeys.k2).toMatch(/^[0-9a-f]{32}$/);
    expect(ourKeys.k3).toMatch(/^[0-9a-f]{32}$/);
    expect(ourKeys.k4).toMatch(/^[0-9a-f]{32}$/);

    // AN10922 expected output: A8DD63A3B89D54B37CA802473FDA9175
    // Our scheme produces different output because it uses CMAC, not AES-ECB
    expect(ourKeys.cardKey).not.toBe("a8dd63a3b89d54b37ca802473fda9175");
  });

  it("k1 derivation uses issuerKey directly (not cardKey)", () => {
    // From keys.ts: k1 = CMAC(issuerKey, 2d003f77)
    // This means k1 is the same for ALL cards with the same issuer key
    const env = { ISSUER_KEY: "00000000000000000000000000000001" } as unknown as import("../types/core.js").Env;
    const keys1 = getDeterministicKeys("04a39493cc8680", env);
    const keys2 = getDeterministicKeys("04DE5F1EACC040", env);
    // k1 is derived from issuerKey only, so it's the same for all cards
    expect(keys1.k1).toBe(keys2.k1);
  });

  it("k2 derivation uses cardKey (unique per card)", () => {
    const env = { ISSUER_KEY: "00000000000000000000000000000001" } as unknown as import("../types/core.js").Env;
    const keys1 = getDeterministicKeys("04a39493cc8680", env);
    const keys2 = getDeterministicKeys("04DE5F1EACC040", env);
    // k2 is derived from cardKey, which includes UID, so different per card
    expect(keys1.k2).not.toBe(keys2.k2);
  });

  it("version parameter changes derived keys", () => {
    const uid = "04a39493cc8680";
    const issuerKey = "00000000000000000000000000000001";
    // We need to call deriveKeysFromHex with different versions
    // getDeterministicKeys uses version=1 by default
    const keysV1 = getDeterministicKeys(uid, { ISSUER_KEY: issuerKey } as unknown as import("../types/core.js").Env, 1);
    const keysV2 = getDeterministicKeys(uid, { ISSUER_KEY: issuerKey } as unknown as import("../types/core.js").Env, 2);

    // Different versions should produce different cardKey → different k2
    expect(keysV1.cardKey).not.toBe(keysV2.cardKey);
    expect(keysV1.k2).not.toBe(keysV2.k2);
  });

  it("version changes k2 but not k1", () => {
    const uid = "04a39493cc8680";
    const issuerKey = "00000000000000000000000000000001";
    const keysV1 = getDeterministicKeys(uid, { ISSUER_KEY: issuerKey } as unknown as import("../types/core.js").Env, 1);
    const keysV2 = getDeterministicKeys(uid, { ISSUER_KEY: issuerKey } as unknown as import("../types/core.js").Env, 2);

    // k1 is derived from issuerKey (version-independent), so stays same
    expect(keysV1.k1).toBe(keysV2.k1);
    // k2 is derived from cardKey (version-dependent), so changes
    expect(keysV1.k2).not.toBe(keysV2.k2);
  });
});

// ---------------------------------------------------------------------------
// 9. AN10922 AES-CMAC Diversification Invariants
// ---------------------------------------------------------------------------
describe("AES-CMAC diversification invariants", () => {
  it("CMAC of same input with same key is always identical", () => {
    const key = hexToBytes("00000000000000000000000000000001");
    const msg = hexToBytes("2d003f7804a39493cc868000000001");
    for (let i = 0; i < 5; i++) {
      const cmac = computeAesCmac(msg, key);
      expect(bytesToHex(cmac)).toBe(bytesToHex(computeAesCmac(msg, key)));
    }
  });

  it("CMAC output is always 16 bytes", () => {
    const key = hexToBytes("00000000000000000000000000000001");
    const msg = hexToBytes("2d003f78");
    const cmac = computeAesCmac(msg, key);
    expect(cmac.length).toBe(16);
  });

  it("different CMAC keys produce different outputs", () => {
    const msg = hexToBytes("2d003f7804a39493cc8680");
    const key1 = hexToBytes("00000000000000000000000000000001");
    const key2 = hexToBytes("00000000000000000000000000000002");
    const cmac1 = computeAesCmac(msg, key1);
    const cmac2 = computeAesCmac(msg, key2);
    expect(bytesToHex(cmac1)).not.toBe(bytesToHex(cmac2));
  });

  it("different CMAC messages produce different outputs", () => {
    const key = hexToBytes("00000000000000000000000000000001");
    const msg1 = hexToBytes("2d003f7804a39493cc8680");
    const msg2 = hexToBytes("2d003f7804DE5F1EACC040");
    const cmac1 = computeAesCmac(msg1, key);
    const cmac2 = computeAesCmac(msg2, key);
    expect(bytesToHex(cmac1)).not.toBe(bytesToHex(cmac2));
  });

  it("CMAC prefix 2d003f75-2d003f7a are all distinct", () => {
    const key = hexToBytes("00000000000000000000000000000001");
    const prefixes = ["2d003f75", "2d003f76", "2d003f77", "2d003f78", "2d003f79", "2d003f7a"];
    const outputs = new Set<string>();
    for (const prefix of prefixes) {
      const cmac = computeAesCmac(hexToBytes(prefix), key);
      outputs.add(bytesToHex(cmac));
    }
    expect(outputs.size).toBe(prefixes.length);
  });
});

// ---------------------------------------------------------------------------
// 10. PICC Data Format Validation
// ---------------------------------------------------------------------------
describe("PICC data format", () => {
  it("byte 0 is always 0xC7 (PICCDataTag)", () => {
    const k1 = "00000000000000000000000000000000";
    const k2 = "00000000000000000000000000000000";
    const uid = "04a39493cc8680";

    const sim = new SimulatedNTAG424(uid, k1, k2);
    const { p } = sim.tap(1);

    const decrypted = decryptP(p, [hexToBytes(k1)]);
    expect(decrypted.success).toBe(true);
    if (decrypted.success) {
      // After decryption, verify the structure
      // The PICCDataTag 0xC7 was checked internally by decryptP
      // (it only returns success if decrypted[0] === 0xC7)
      expect(decrypted.uidBytes.length).toBe(7);
      expect(decrypted.ctr.length).toBe(3);
    }
  });

  it("counter bytes are in correct order after decryption", () => {
    const k1 = "00000000000000000000000000000000";
    const k2 = "00000000000000000000000000000000";
    const uid = "04a39493cc8680";

    // Test specific counter values to verify byte ordering
    const counters = [0, 1, 255, 256, 65535, 65536, 0xffffff];
    for (const counter of counters) {
      const sim = new SimulatedNTAG424(uid, k1, k2);
      const { p } = sim.tap(counter);

      const decrypted = decryptP(p, [hexToBytes(k1)]);
      expect(decrypted.success, `counter=${counter}`).toBe(true);
      if (decrypted.success) {
        // ctr is [MSB, mid, LSB]
        const recovered = (decrypted.ctr[0]! << 16) | (decrypted.ctr[1]! << 8) | decrypted.ctr[2]!;
        expect(recovered, `counter=${counter}`).toBe(counter);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 11. AES-ECB Encryption Properties
// ---------------------------------------------------------------------------
describe("AES-ECB encryption properties", () => {
  it("same plaintext + same key = same ciphertext", () => {
    const key = hexToBytes("00000000000000000000000000000000");
    const plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(hexToBytes("04a39493cc8680"), 1);
    plaintext[8] = 1;

    const ct1 = ecb(key, { disablePadding: true }).encrypt(plaintext);
    const ct2 = ecb(key, { disablePadding: true }).encrypt(plaintext);
    expect(bytesToHex(new Uint8Array(ct1))).toBe(bytesToHex(new Uint8Array(ct2)));
  });

  it("different keys produce different ciphertext", () => {
    const plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(hexToBytes("04a39493cc8680"), 1);
    plaintext[8] = 1;

    const key1 = hexToBytes("00000000000000000000000000000000");
    const key2 = hexToBytes("00000000000000000000000000000001");

    const ct1 = ecb(key1, { disablePadding: true }).encrypt(plaintext);
    const ct2 = ecb(key2, { disablePadding: true }).encrypt(plaintext);
    expect(bytesToHex(new Uint8Array(ct1))).not.toBe(bytesToHex(new Uint8Array(ct2)));
  });

  it("ECB encryption is reversible", () => {
    const key = hexToBytes("00000000000000000000000000000000");
    const plaintext = new Uint8Array(16);
    plaintext[0] = 0xc7;
    plaintext.set(hexToBytes("04DE5F1EACC040"), 1);
    plaintext[8] = 61;

    const ct = new Uint8Array(ecb(key, { disablePadding: true }).encrypt(plaintext));
    const pt = ecb(key, { disablePadding: true }).decrypt(ct);
    expect(new Uint8Array(pt)).toEqual(plaintext);
  });
});

// ---------------------------------------------------------------------------
// 12. Edge Cases
// ---------------------------------------------------------------------------
describe("Edge cases", () => {
  it("counter = 0 is valid", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    const { p, c } = sim.tap(0);
    expect(p.length).toBe(32);
    expect(c.length).toBe(16);

    const decrypted = decryptP(p, [hexToBytes("00000000000000000000000000000000")]);
    expect(decrypted.success).toBe(true);
  });

  it("counter = 0xFFFFFF (max) is valid", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    const { p, c } = sim.tap(0xffffff);
    expect(p.length).toBe(32);
    expect(c.length).toBe(16);

    const decrypted = decryptP(p, [hexToBytes("00000000000000000000000000000000")]);
    expect(decrypted.success).toBe(true);
    if (decrypted.success) {
      const ctr = (decrypted.ctr[0]! << 16) | (decrypted.ctr[1]! << 8) | decrypted.ctr[2]!;
      expect(ctr).toBe(0xffffff);
    }
  });

  it("p is always 32 hex chars (16 bytes)", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    for (let i = 0; i < 10; i++) {
      const { p } = sim.tap(i);
      expect(p.length).toBe(32);
    }
  });

  it("c is always 16 hex chars (8 bytes)", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    for (let i = 0; i < 10; i++) {
      const { c } = sim.tap(i);
      expect(c.length).toBe(16);
    }
  });

  it("wrong K1 fails decryption", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    const { p } = sim.tap(1);

    const wrongK1 = hexToBytes("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    const decrypted = decryptP(p, [wrongK1]);
    expect(decrypted.success).toBe(false);
  });

  it("wrong K2 fails CMAC verification", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    const { c } = sim.tap(1);

    const wrongK2 = hexToBytes("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    const verified = verifyCmac(
      hexToBytes("04a39493cc8680"),
      new Uint8Array([0, 0, 1]),
      c,
      wrongK2
    );
    expect(verified.cmac_validated).toBe(false);
  });

  it("wrong UID fails CMAC verification", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    const { c } = sim.tap(1);

    const verified = verifyCmac(
      hexToBytes("04DE5F1EACC040"), // wrong UID
      new Uint8Array([0, 0, 1]),
      c,
      hexToBytes("00000000000000000000000000000000")
    );
    expect(verified.cmac_validated).toBe(false);
  });

  it("wrong counter fails CMAC verification", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    const { c } = sim.tap(1);

    const verified = verifyCmac(
      hexToBytes("04a39493cc8680"),
      new Uint8Array([0, 0, 2]), // wrong counter
      c,
      hexToBytes("00000000000000000000000000000000")
    );
    expect(verified.cmac_validated).toBe(false);
  });

  it("corrupted p parameter fails decryption", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    const { p } = sim.tap(1);

    // Corrupt first byte
    const corruptedP = "ff" + p.slice(2);
    const decrypted = decryptP(corruptedP, [hexToBytes("00000000000000000000000000000000")]);
    expect(decrypted.success).toBe(false);
  });

  it("corrupted c parameter fails verification", () => {
    const sim = new SimulatedNTAG424("04a39493cc8680", "00000000000000000000000000000000", "00000000000000000000000000000000");
    const { c } = sim.tap(1);

    // Corrupt first byte
    const corruptedC = "ff" + c.slice(2);
    const verified = verifyCmac(
      hexToBytes("04a39493cc8680"),
      new Uint8Array([0, 0, 1]),
      corruptedC,
      hexToBytes("00000000000000000000000000000000")
    );
    expect(verified.cmac_validated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13. Full Pipeline: Derived Keys → Simulator Tap → Decrypt + Verify
// ---------------------------------------------------------------------------
describe("Full pipeline: derived keys → simulator → decrypt + verify", () => {
  const testEnv = { ISSUER_KEY: "00000000000000000000000000000001" } as unknown as import("../types/core.js").Env;

  it("deterministic keys round-trip through simulator", () => {
    const uid = "04a39493cc8680";
    const keys = getDeterministicKeys(uid, testEnv);

    const sim = new SimulatedNTAG424(uid, keys.k1, keys.k2);
    const { p, c } = sim.tap(1);

    // Decrypt with derived K1
    const decrypted = decryptP(p, [hexToBytes(keys.k1)]);
    expect(decrypted.success).toBe(true);
    if (decrypted.success) {
      expect(bytesToHex(decrypted.uidBytes)).toBe(uid.toLowerCase());
    }

    // Verify with derived K2
    const verified = verifyCmac(
      hexToBytes(uid),
      new Uint8Array([0, 0, 1]),
      c,
      hexToBytes(keys.k2)
    );
    expect(verified.cmac_validated).toBe(true);
  });

  it("10 different UIDs all round-trip through simulator", () => {
    for (let i = 0; i < 10; i++) {
      const uid = generateRandomUid(i);
      const keys = getDeterministicKeys(uid, testEnv);

      const sim = new SimulatedNTAG424(uid, keys.k1, keys.k2);
      const counter = i + 1;
      const { p, c } = sim.tap(counter);

      const decrypted = decryptP(p, [hexToBytes(keys.k1)]);
      expect(decrypted.success, `uid=${uid} i=${i}`).toBe(true);
      if (decrypted.success) {
        expect(bytesToHex(decrypted.uidBytes), `uid match i=${i}`).toBe(uid.toLowerCase());
      }

      const ctrBytes = new Uint8Array([
        (counter >> 16) & 0xff,
        (counter >> 8) & 0xff,
        counter & 0xff,
      ]);
      const verified = verifyCmac(hexToBytes(uid), ctrBytes, c, hexToBytes(keys.k2));
      expect(verified.cmac_validated, `cmac i=${i}`).toBe(true);
    }
  });

  it("different issuer key produces different derived keys", () => {
    const uid = "04a39493cc8680";
    const env1 = { ISSUER_KEY: "00000000000000000000000000000001" } as unknown as import("../types/core.js").Env;
    const env2 = { ISSUER_KEY: "00000000000000000000000000000002" } as unknown as import("../types/core.js").Env;

    const keys1 = getDeterministicKeys(uid, env1);
    const keys2 = getDeterministicKeys(uid, env2);

    expect(keys1.k1).not.toBe(keys2.k1);
    expect(keys1.k2).not.toBe(keys2.k2);
  });

  it("wrong issuer key's simulator tap fails with correct issuer's keys", () => {
    const uid = "04a39493cc8680";
    const env1 = { ISSUER_KEY: "00000000000000000000000000000001" } as unknown as import("../types/core.js").Env;
    const env2 = { ISSUER_KEY: "00000000000000000000000000000002" } as unknown as import("../types/core.js").Env;

    const wrongKeys = getDeterministicKeys(uid, env2);
    const correctKeys = getDeterministicKeys(uid, env1);

    // Simulate tap with WRONG issuer's keys
    const sim = new SimulatedNTAG424(uid, wrongKeys.k1, wrongKeys.k2);
    const { p, c } = sim.tap(1);

    // Try to decrypt with CORRECT issuer's K1
    const decrypted = decryptP(p, [hexToBytes(correctKeys.k1)]);
    expect(decrypted.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 14. TestCard (@ntag424/crypto/test) cross-verification
// ---------------------------------------------------------------------------
describe("TestCard from @ntag424/crypto cross-verification", () => {
  // Import TestCard dynamically-style to verify compatibility
  const { TestCard } = require("@ntag424/crypto/test") as { TestCard: typeof import("@ntag424/crypto/test").TestCard };

  it("SimulatedNTAG424 matches TestCard for same inputs", () => {
    const uid = "04a39493cc8680";
    const issuerKey = "00000000000000000000000000000001";

    const testCard = new TestCard(uid, issuerKey);
    const testCardKeys = testCard.keys;

    const sim = new SimulatedNTAG424(uid, testCardKeys.k1, testCardKeys.k2);
    const counter = 42;

    const simResult = sim.tap(counter);
    const tcResult = testCard.tap(counter);

    expect(simResult.p).toBe(tcResult.p);
    expect(simResult.c).toBe(tcResult.c);
  });

  it("SimulatedNTAG424 matches TestCard for 5 different UIDs", () => {
    const issuerKey = "00000000000000000000000000000001";

    for (let i = 0; i < 5; i++) {
      const uid = generateRandomUid(i);
      const testCard = new TestCard(uid, issuerKey);
      const testCardKeys = testCard.keys;

      const sim = new SimulatedNTAG424(uid, testCardKeys.k1, testCardKeys.k2);
      const counter = i * 10 + 1;

      const simResult = sim.tap(counter);
      const tcResult = testCard.tap(counter);

      expect(simResult.p, `p uid=${uid}`).toBe(tcResult.p);
      expect(simResult.c, `c uid=${uid}`).toBe(tcResult.c);
    }
  });
});
