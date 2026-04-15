/**
 * keygenerator.js — Deterministic key derivation for BoltCard (K0-K4)
 *
 * Generates NTAG 424 DNA AES-128 keys from a master IssuerKey and card UID.
 * The derivation uses AES-CMAC as a PRF with domain-separation tags.
 *
 * Key roles per NXP AN12196 and boltcard.org protocol:
 *   K0 — Application master key (AuthenticateEV2First with key 0x00)
 *   K1 — SDM meta read key (encrypts PICCENCData / `p` parameter).
 *         Derived from IssuerKey directly (not CardKey) → shared across card fleet.
 *   K2 — SDM file read key (used for SDMMAC / `c` parameter verification).
 *         Per-card via CardKey.
 *   K3 — SDM read access key (reserved per NTAG424 SDMAccessRights config)
 *   K4 — SDM read/write access key (reserved per NTAG424 SDMAccessRights config)
 *
 * CardKey diversification:
 *   CardKey = CMAC(IssuerKey, "2d003f75" || UID || version_le32)
 *
 * Per-card keys (K0, K2-K4) use CardKey; fleet-wide K1 uses IssuerKey directly.
 * This allows decrypting `p` for any card without per-UID lookup (K1 is shared).
 *
 * Ref: docs/ntag424_llm_context.md §8.6 (authentication), §8.12 (key changes)
 * Ref: docs/boltcard-protocol.md §5 (key derivation)
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
