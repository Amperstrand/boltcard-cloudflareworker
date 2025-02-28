// Helper: Convert Uint8Array to Hex String
function toHexString(uint8arr) {
  return Array.from(uint8arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Function to perform the Pseudo-Random Function (PRF) using HMAC and SHA-256
async function PRF(key, message) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  // Import the key using HMAC and SHA-256 algorithm
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign", "verify"]
  );

  // Compute the HMAC (message authentication code)
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  return new Uint8Array(signature);
}

// Function to generate CardKey using IssuerKey, UID, and Version
async function generateCardKey(issuerKey, uid, version) {
  // Prepare the version as a 4-byte little-endian array
  const versionBuffer = new ArrayBuffer(4);
  new DataView(versionBuffer).setUint32(0, version, true); // Little-endian encoding

  // Concatenate IssuerKey, UID, and VersionBuffer into a single message
  const message = new Uint8Array([...issuerKey, ...uid, ...new Uint8Array(versionBuffer)]);
  // We decode the message into a string for our PRF function
  return PRF(issuerKey, new TextDecoder().decode(message));
}

// Function to generate the full set of keys (K0, K1, K2, K3, K4, and ID)
async function generateKeys(cardKey, issuerKey, uid) {
  // Derive keys using the PRF with fixed hex string messages
  const k0 = await PRF(new TextDecoder().decode(cardKey), "2d003f76");
  const k1 = await PRF(new TextDecoder().decode(issuerKey), "2d003f77");
  const k2 = await PRF(new TextDecoder().decode(cardKey), "2d003f78");
  const k3 = await PRF(new TextDecoder().decode(cardKey), "2d003f79");
  const k4 = await PRF(new TextDecoder().decode(cardKey), "2d003f7a");

  // Derive ID using IssuerKey and UID
  const id = await PRF(new TextDecoder().decode(issuerKey), "2d003f7b" + new TextDecoder().decode(uid));

  return { k0, k1, k2, k3, k4, id };
}

// Main function to generate the keys for a BoltCard and return them as hex strings
export async function generateBoltCardKeys() {
  // Hardcoded values
  const issuerKey = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]); // IssuerKey: 00000000000000000000000000000001
  const uid = new Uint8Array([0x04, 0xa3, 0x94, 0x93, 0xcc, 0x86, 0x80]); // UID: 04a39493cc8680
  const version = 1; // Version: 1

  // Generate CardKey
  const cardKey = await generateCardKey(issuerKey, uid, version);

  // Generate all keys
  const keys = await generateKeys(cardKey, issuerKey, uid);

  console.log("Generated Keys:");
  console.log("K0:", toHexString(keys.k0));
  console.log("K1:", toHexString(keys.k1));
  console.log("K2:", toHexString(keys.k2));
  console.log("K3:", toHexString(keys.k3));
  console.log("K4:", toHexString(keys.k4));
  console.log("ID:", toHexString(keys.id));
  console.log("CardKey:", toHexString(cardKey));

  // Return all keys as hex strings
  return {
    k0: toHexString(keys.k0),
    k1: toHexString(keys.k1),
    k2: toHexString(keys.k2),
    k3: toHexString(keys.k3),
    k4: toHexString(keys.k4),
    id: toHexString(keys.id),
    cardKey: toHexString(cardKey)
  };
}
