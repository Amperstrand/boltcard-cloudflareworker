import AES from "aes-js";
import { hexToBytes, bytesToHex } from "./cryptoutils.js";

// Hardcoded Issuer Key (16 bytes)
const ISSUER_KEY = hexToBytes("00000000000000000000000000000001");

// AES-CMAC Manual Implementation
async function aesCmac(key, message) {
  const aesEcb = new AES.ModeOfOperation.ecb(key); // AES-ECB mode (Cloudflare-compatible)
  const blockSize = 16;
  const zeroBlock = new Uint8Array(blockSize);

  // Step 1: Compute L = AES-ECB(key, 0^16)
  const L = aesEcb.encrypt(zeroBlock);

  // Step 2: Generate K1, K2 (subkeys)
  function shiftAndXor(input) {
    const output = new Uint8Array(input.length);
    let carry = 0;
    for (let i = input.length - 1; i >= 0; i--) {
      const bit = input[i] >> 7; // Extract MSB
      output[i] = ((input[i] << 1) & 0xff) | carry;
      carry = bit;
    }
    if (carry) output[input.length - 1] ^= 0x87; // XOR last byte with 0x87 if carry
    return output;
  }
  
  const K1 = shiftAndXor(L);
  const K2 = shiftAndXor(K1);

  // Step 3: Padding and XOR
  let M_last;
  if (message.length === blockSize) {
    M_last = xorArrays(message, K1);
  } else {
    const padded = new Uint8Array(blockSize).fill(0);
    padded.set(message);
    padded[message.length] = 0x80; // Append 0x80
    M_last = xorArrays(padded, K2);
  }

  // Step 4: Compute AES-CMAC = AES-ECB(key, M_last)
  return aesEcb.encrypt(M_last);
}

// XOR helper function
function xorArrays(a, b) {
  return a.map((v, i) => v ^ b[i]);
}

// Generate deterministic BoltCard keys
export async function getDeterministicKeys(uidHex) {
  if (!uidHex || uidHex.length !== 14) {
    throw new Error("Invalid UID: Must be 7 bytes in hex (14 characters)");
  }

  const uid = hexToBytes(uidHex);
  const version = new Uint8Array([1, 0, 0, 0]); // Version 1 in little-endian format

  console.log("Generating deterministic keys for UID:", uidHex);

  // Generate CardKey
  const cardKey = await aesCmac(ISSUER_KEY, new Uint8Array([...hexToBytes("2d003f75"), ...uid, ...version]));

  // Generate application keys (K0-K4)
  const k0 = await aesCmac(cardKey, hexToBytes("2d003f76"));
  const k1 = await aesCmac(ISSUER_KEY, hexToBytes("2d003f77"));
  const k2 = await aesCmac(cardKey, hexToBytes("2d003f78"));
  const k3 = await aesCmac(cardKey, hexToBytes("2d003f79"));
  const k4 = await aesCmac(cardKey, hexToBytes("2d003f7a"));

  // Generate ID
  const id = await aesCmac(ISSUER_KEY, new Uint8Array([...hexToBytes("2d003f7b"), ...uid]));

  console.log("Generated Keys:");
  console.log("K0:", bytesToHex(k0));
  console.log("K1:", bytesToHex(k1));
  console.log("K2:", bytesToHex(k2));
  console.log("K3:", bytesToHex(k3));
  console.log("K4:", bytesToHex(k4));
  console.log("ID:", bytesToHex(id));
  console.log("CardKey:", bytesToHex(cardKey));

  // Return keys as hex
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
