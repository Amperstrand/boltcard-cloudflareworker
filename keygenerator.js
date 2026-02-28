import { computeAesCmac, hexToBytes, bytesToHex } from "./cryptoutils.js";



const DEBUG = false;
/**
 * Deterministic Key Generation:
 * Generates keys for a BoltCard using the given UID and a fixed Issuer Key and Version.
 * 
 * Process:
 *   CardKey = PRF(IssuerKey, "2d003f75" || UID || Version)
 *   K0 = PRF(CardKey, "2d003f76")
 *   K1 = PRF(IssuerKey, "2d003f77")
 *   K2 = PRF(CardKey, "2d003f78")
 *   K3 = PRF(CardKey, "2d003f79")
 *   K4 = PRF(CardKey, "2d003f7a")
 *   ID = PRF(IssuerKey, "2d003f7b" || UID)
 * 
 * @param {string} uidHex - The UID as a 14-character hex string (7 bytes).
 * @param {object} [env] - The Cloudflare Workers env object (optional, for ISSUER_KEY).
 * @param {number} version - The version number (default 1).
 * @returns {Promise<Object>} An object with keys: k0, k1, k2, k3, k4, id, cardKey (all hex strings).
 */
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
