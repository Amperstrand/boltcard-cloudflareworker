import { sha256 } from "@noble/hashes/sha2.js";
import {
  computeAesCmac,
  decryptP,
  buildVerificationData,
  verifyCmac,
  deriveKeysFromHex,
  hexToBytes,
  bytesToHex,
} from "@ntag424/crypto";
import vectorsRaw from "./conformance/ntag424-vectors/vectors.json?raw";
import vectorsDoc from "./conformance/ntag424-vectors/vectors.json";

// Reference-lock (ccid doctrine): the vendored file must be byte-identical to
// the canonical Amperstrand/ntag424-vectors copy recorded in the LOCK file.
const VECTORS_SHA256 = "522cab963c3f7db1ab9249c0d4e207b43abc0b4061323fd5c55755959a4ff65f";

interface VectorInput {
  op: string;
  [field: string]: unknown;
}

interface Vector {
  id: string;
  category: string;
  negative?: boolean;
  input: VectorInput;
  expected: { [field: string]: unknown };
}

const vectors = (vectorsDoc as { vectors: Vector[] }).vectors;
const str = (src: { [k: string]: unknown }, key: string): string => src[key] as string;

// @ntag424/crypto's public contract normalizes the SDMReadCtr to MSB-first
// (decryptP returns [msb, mid, lsb]; buildVerificationData consumes the same),
// while the vectors record the raw on-card little-endian bytes (AN12196 §3.3).
const leToApi = (leHex: string): Uint8Array => hexToBytes(leHex).reverse();
const apiToLe = (api: Uint8Array): string => bytesToHex(api.slice().reverse());

describe("ntag424-vectors cross-language conformance suite", () => {
  it("vendored vectors.json is reference-locked (sha256)", () => {
    const digest = bytesToHex(sha256(new TextEncoder().encode(vectorsRaw as string)));
    expect(digest).toBe(VECTORS_SHA256);
  });

  it("suite size matches the vendored generation", () => {
    expect(vectors.length).toBe(46);
  });

  for (const v of vectors) {
    const { id, input, expected, negative } = v;
    const op = input.op;

    it(`${id} (${op}${negative ? ", negative" : ""})`, () => {
      switch (op) {
        case "aes_cmac": {
          const mac = computeAesCmac(hexToBytes(str(input, "message")), hexToBytes(str(input, "key")));
          expect(bytesToHex(mac)).toBe(str(expected, "cmac"));
          break;
        }
        case "sv2_build": {
          const k2 = new Uint8Array(16);
          const { sv2 } = buildVerificationData(
            hexToBytes(str(input, "uid")),
            leToApi(str(input, "counter_bytes")),
            k2,
          );
          expect(bytesToHex(sv2)).toBe(str(expected, "sv2"));
          break;
        }
        case "picc_decrypt": {
          const res = decryptP(str(input, "picc_enc_data"), [hexToBytes(str(input, "key"))]);
          expect(res.success).toBe(true);
          if (res.success) {
            expect(bytesToHex(res.uidBytes)).toBe(str(expected, "uid"));
            expect(apiToLe(res.ctr)).toBe(str(expected, "counter_bytes"));
          }
          break;
        }
        case "sun_mac": {
          const { ct } = buildVerificationData(
            hexToBytes(str(input, "uid")),
            leToApi(str(input, "counter_bytes")),
            hexToBytes(str(input, "key")),
          );
          expect(bytesToHex(ct)).toBe(str(expected, "cmac_truncated"));
          break;
        }
        case "sdm_full": {
          const res = decryptP(str(input, "p"), [hexToBytes(str(input, "k1"))]);
          if (negative) {
            // negative vectors: the FULL chain (decrypt + SUN MAC binding)
            // must fail — at either stage
            if (res.success) {
              const { cmac_validated } = verifyCmac(
                res.uidBytes,
                res.ctr,
                str(input, "c"),
                hexToBytes(str(input, "k2")),
              );
              expect(cmac_validated).toBe(false);
            } else {
              expect(res.success).toBe(false);
            }
            return;
          }
          expect(res.success).toBe(true);
          if (!res.success) return;
          expect(bytesToHex(res.uidBytes)).toBe(str(expected, "uid"));
          expect(apiToLe(res.ctr)).toBe(str(expected, "counter_bytes"));
          // Pin the FULL verification chain (issue #71): sv2, the derived
          // MAC key (ks), and the untruncated CMAC (cm) are pinned in every
          // positive record — divergence in untruncated bytes must fail here.
          const verification = buildVerificationData(
            res.uidBytes,
            res.ctr,
            hexToBytes(str(input, "k2")),
          );
          expect(bytesToHex(verification.sv2)).toBe(str(expected, "sv2"));
          expect(bytesToHex(verification.ks)).toBe(str(expected, "derived_mac_key"));
          expect(bytesToHex(verification.cm)).toBe(str(expected, "full_cmac"));
          const { cmac_validated } = verifyCmac(
            res.uidBytes,
            res.ctr,
            str(input, "c"),
            hexToBytes(str(input, "k2")),
          );
          expect(cmac_validated).toBe(true);
          break;
        }
        case "derive_keys": {
          const keys = deriveKeysFromHex(
            str(input, "uid"),
            str(input, "issuer_key"),
            input.version as number,
          );
          // recovery vectors carry partial expectation sets — assert only
          // the fields the vector actually pins
          const pinned: Array<[string, string]> = [
            ["card_key", keys.cardKey],
            ["k0", keys.k0],
            ["k1", keys.k1],
            ["k2", keys.k2],
            ["k3", keys.k3],
            ["k4", keys.k4],
          ];
          for (const [field, actual] of pinned) {
            if (expected[field] !== undefined) {
              expect(actual).toBe(expected[field]);
            }
          }
          if (expected.card_id !== undefined) {
            // mirrors keygenerator.ts `id` extension over public primitives
            const idTag = hexToBytes("2d003f7b");
            const uid = hexToBytes(str(input, "uid"));
            const cardId = computeAesCmac(
              new Uint8Array([...idTag, ...uid]),
              hexToBytes(str(input, "issuer_key")),
            );
            expect(bytesToHex(cardId)).toBe(expected.card_id);
          }
          break;
        }
        default:
          throw new Error(`unknown op ${op} in vector ${id} — update this harness`);
      }
    });
  }

  it("suite accounting: 3 negative vectors ran and were rejected", () => {
    const negatives = vectors.filter((v) => v.negative === true);
    expect(negatives.length).toBe(3);
    expect(negatives.every((v) => v.input.op === "sdm_full")).toBe(true);
  });
});
