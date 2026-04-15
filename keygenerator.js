/**
 * keygenerator.js — Deterministic key derivation for BoltCard (K0-K4)
 *
 * Implements the deterministic key generation scheme from:
 *   https://github.com/boltcard/boltcard/blob/main/docs/DETERMINISTIC.md
 *   https://github.com/btcpayserver/BTCPayServer.BoltCardTools
 *
 * Generates NTAG 424 DNA AES-128 keys from a master IssuerKey and card UID.
 * The derivation uses AES-CMAC (NIST SP 800-38B) as a PRF with domain-separation tags.
 *
 * Key roles per the boltcard DETERMINISTIC.md spec:
 *   K0 — App Master Key. Only key permitted to change application keys.
 *   K1 — Encryption key for PICCData (the `p` parameter).
 *         Derived from IssuerKey directly (not CardKey) → shared across card fleet.
 *         This allows decrypting `p` for any card without per-UID database lookup.
 *   K2 — Authentication key for SUN MAC (the `c` parameter). Per-card via CardKey.
 *   K3 — Not used in BoltCard protocol but configured per NXP AN12196 recommendations.
 *         Derived independently as a unique per-card key via CardKey (NOT set equal to K1/K2).
 *   K4 — Not used in BoltCard protocol but configured per NXP AN12196 recommendations.
 *         Derived independently as a unique per-card key via CardKey (NOT set equal to K1/K2).
 *
 * NOTE on K3/K4: Some implementations (e.g., certain LNBits configurations) set K3=K1
 * and K4=K2 as a simplification. This deviates from the deterministic spec, which derives
 * each key independently. Our implementation follows the spec — all 5 keys are unique.
 *
 * CardKey diversification:
 *   CardKey = CMAC(IssuerKey, "2d003f75" || UID || version_le32)
 *
 * ID derivation (for database lookups without exposing raw UID):
 *   ID = CMAC(IssuerKey, "2d003f7b" || UID)
 *
 * Ref: docs/ntag424_llm_context.md §8.6 (authentication), §8.12 (key changes)
 */
import { computeAesCmac, hexToBytes, bytesToHex } from "./cryptoutils.js";

const DEBUG = false;

export async function getDeterministicKeys(uidHex, env, version = 1) {
  if (!uidHex || uidHex.length !== 14) {
    throw new Error(`Invalid UID: "${uidHex}" is not exactly 7 bytes (14 hex characters). Received ${uidHex ? uidHex.length : 'no'} characters.`);

  }

  // Get issuer key from env or fall back to development key
  const issuerKeyHex = (env && env.ISSUER_KEY) ? env.ISSUER_KEY : "00000000000000000000000000000001";
  const ISSUER_KEY = hexToBytes(issuerKeyHex);

  const uid = hexToBytes(uidHex);
  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, version, true); // Little-endian

  if (DEBUG) console.log("Generating deterministic keys for UID:", uidHex);

  // Generate CardKey
  const cardKeyMessage = new Uint8Array([
    ...hexToBytes("2d003f75"),
    ...uid,
    ...versionBytes
  ]);
  const cardKey = computeAesCmac(cardKeyMessage, ISSUER_KEY);

  // Generate application keys
  const k0 = computeAesCmac(hexToBytes("2d003f76"), cardKey);
  const k1 = computeAesCmac(hexToBytes("2d003f77"), ISSUER_KEY);
  const k2 = computeAesCmac(hexToBytes("2d003f78"), cardKey);
  const k3 = computeAesCmac(hexToBytes("2d003f79"), cardKey);
  const k4 = computeAesCmac(hexToBytes("2d003f7a"), cardKey);

  // Generate ID using IssuerKey and UID
  const idMessage = new Uint8Array([
    ...hexToBytes("2d003f7b"),
    ...uid
  ]);
  const id = computeAesCmac(idMessage, ISSUER_KEY);

  if (DEBUG) {
    console.log("Generated Keys:");
    console.log("K0:", bytesToHex(k0));
    console.log("K1:", bytesToHex(k1));
    console.log("K2:", bytesToHex(k2));
    console.log("K3:", bytesToHex(k3));
    console.log("K4:", bytesToHex(k4));
    console.log("ID:", bytesToHex(id));
    console.log("CardKey:", bytesToHex(cardKey));
  } else {
    console.log("✅ Keys generated for UID:", uidHex);
  }

  return {
    k0: bytesToHex(k0),
    k1: bytesToHex(k1),
    k2: bytesToHex(k2),
    k3: bytesToHex(k3),
    k4: bytesToHex(k4),
    id: bytesToHex(id),
    cardKey: bytesToHex(cardKey),
  };
}
