import type { Env } from "../types/core.js";
import { logger } from "./logger.js";

// ─── base64url (no Buffer on Workers) ───────────────────────────────────────

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64urlEncodeString(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str));
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type VcAlgorithm = "ES256" | "EdDSA";

const VC_ROLES = ["Administrator", "Specialist", "Technician", "Director"];
const VC_DEPTS = ["Engineering", "Security", "Operations", "Command"];

export function buildCredentialProfile(uidHex: string): VcProfile {
  const hex = (uidHex || "00000000").padEnd(8, "0");
  const p0 = parseInt(hex.substring(0, 2), 16) || 0;
  const p1 = parseInt(hex.substring(2, 4), 16) || 0;
  const p2 = parseInt(hex.substring(4, 6), 16) || 0;
  return {
    name: "Operator-" + hex.substring(0, 4).toUpperCase(),
    role: VC_ROLES[p0 % VC_ROLES.length]!,
    dept: VC_DEPTS[p1 % VC_DEPTS.length]!,
    level: "Level " + ((p2 % 5) + 1),
  };
}

export interface VcCredentialSubject {
  cardUid: string;
  name: string;
  role: string;
  department: string;
  clearance: string;
}

export interface VcPayload {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  vc: {
    "@context": readonly ["https://www.w3.org/ns/credentials/v2"];
    type: readonly ["VerifiableCredential", "BoltcardAccessBadge"];
    issuer: string;
    validFrom: string;
    credentialSubject: VcCredentialSubject;
  };
}

export interface VcProfile {
  name: string;
  role: string;
  dept: string;
  level: string;
}

interface AlgorithmKeys {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
  didKey: string;
}

const VC_TTL_SECONDS = 3600;
const KV_KEY = "vc_issuer_keys";

let cachedKeys: AlgorithmKeys | null = null;

// ─── did:key encoding ─────────────────────────────────────────────────────────

function encodeDidKey(publicRaw: Uint8Array, alg: VcAlgorithm): string {
  let prefixed: Uint8Array;
  if (alg === "EdDSA") {
    prefixed = new Uint8Array(2 + publicRaw.length);
    prefixed[0] = 0xed;
    prefixed[1] = 0x01;
    prefixed.set(publicRaw, 2);
  } else {
    prefixed = new Uint8Array(2 + publicRaw.length);
    prefixed[0] = 0x81;
    prefixed[1] = 0x24;
    prefixed.set(publicRaw, 2);
  }
  return "did:key:z" + base64urlEncode(prefixed);
}

// ─── Key management (KV-backed) ───────────────────────────────────────────────

async function loadOrCreateKeys(env: Env, alg: VcAlgorithm): Promise<AlgorithmKeys> {
  if (cachedKeys) return cachedKeys;

  try {
    const stored = await env.UID_CONFIG.get(KV_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { privateRaw: number[]; publicRaw: number[] };
      const privateBytes = new Uint8Array(parsed.privateRaw);
      const publicBytes = new Uint8Array(parsed.publicRaw);
      const keys = await importKeys(privateBytes, publicBytes, alg);
      cachedKeys = { ...keys, publicRaw: publicBytes, didKey: encodeDidKey(publicBytes, alg) };
      logger.info("VC issuer keys loaded from KV", { alg, didKey: cachedKeys.didKey });
      return cachedKeys;
    }
  } catch (err: unknown) {
    logger.warn("Failed to load VC issuer keys from KV, generating new", { error: String(err) });
  }

  const generated = await generateKeys(alg);
  const privateRaw = new Uint8Array(await crypto.subtle.exportKey("pkcs8", generated.privateKey) as ArrayBuffer);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", generated.publicKey) as ArrayBuffer);

  try {
    await env.UID_CONFIG.put(KV_KEY, JSON.stringify({
      privateRaw: Array.from(privateRaw),
      publicRaw: Array.from(publicRaw),
    }));
  } catch (err: unknown) {
    logger.error("Failed to persist VC issuer keys to KV", { error: String(err) });
  }

  cachedKeys = { ...generated, publicRaw, didKey: encodeDidKey(publicRaw, alg) };
  logger.info("VC issuer keys generated and stored", { alg, didKey: cachedKeys.didKey });
  return cachedKeys;
}

async function generateKeys(alg: VcAlgorithm): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  if (alg === "EdDSA") {
    return crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;
  }
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

async function importKeys(privateBytes: Uint8Array, publicBytes: Uint8Array, alg: VcAlgorithm): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  if (alg === "EdDSA") {
    const privateKey = await crypto.subtle.importKey("pkcs8", privateBytes, "Ed25519", true, ["sign"]);
    const publicKey = await crypto.subtle.importKey("raw", publicBytes, "Ed25519", true, ["verify"]);
    return { publicKey, privateKey };
  }
  const privateKey = await crypto.subtle.importKey("pkcs8", privateBytes, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const publicKey = await crypto.subtle.importKey("raw", publicBytes, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  return { publicKey, privateKey };
}

export function _resetCachedIssuerKeys(): void {
  cachedKeys = null;
}

export async function getIssuerDid(env: Env): Promise<string> {
  const keys = await loadOrCreateKeys(env, "ES256");
  return keys.didKey;
}

// ─── VC-JWT issuance ─────────────────────────────────────────────────────────

export async function issueVcJwt(
  env: Env,
  uidHex: string,
  profile: VcProfile,
  alg: VcAlgorithm = "ES256",
): Promise<string> {
  const keys = await loadOrCreateKeys(env, alg);
  const now = Math.floor(Date.now() / 1000);

  const payload: VcPayload = {
    iss: keys.didKey,
    sub: "boltcard:" + uidHex,
    iat: now,
    exp: now + VC_TTL_SECONDS,
    vc: {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential", "BoltcardAccessBadge"],
      issuer: keys.didKey,
      validFrom: new Date(now * 1000).toISOString(),
      credentialSubject: {
        cardUid: uidHex,
        name: profile.name,
        role: profile.role,
        department: profile.dept,
        clearance: profile.level,
      },
    },
  };

  const header = { typ: "JWT", alg, kid: "#0" };
  const headerB64 = base64urlEncodeString(JSON.stringify(header));
  const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
  const signingInput = headerB64 + "." + payloadB64;
  const signingInputBytes = new TextEncoder().encode(signingInput);

  const signAlg = alg === "EdDSA" ? "Ed25519" : { name: "ECDSA", hash: "SHA-256" };
  const signatureBuf = await crypto.subtle.sign(signAlg, keys.privateKey, signingInputBytes);
  const signatureB64 = base64urlEncode(new Uint8Array(signatureBuf));

  return signingInput + "." + signatureB64;
}

// ─── VC-JWT verification ──────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  payload?: VcPayload;
  error?: string;
}

export async function verifyVcJwt(env: Env, jwt: string): Promise<VerifyResult> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Malformed JWT: expected 3 parts" };
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: VcPayload;

  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64))) as Record<string, unknown>;
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64))) as VcPayload;
  } catch {
    return { valid: false, error: "Failed to decode JWT header or payload" };
  }

  const alg = header.alg as VcAlgorithm;
  if (alg !== "ES256" && alg !== "EdDSA") {
    return { valid: false, error: "Unsupported algorithm: expected ES256 or EdDSA" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    return { valid: false, error: "Credential expired", payload };
  }

  const keys = await loadOrCreateKeys(env, alg);
  const signature = base64urlDecode(signatureB64);
  const signingInput = new TextEncoder().encode(headerB64 + "." + payloadB64);

  const verifyAlg = alg === "EdDSA" ? "Ed25519" : { name: "ECDSA", hash: "SHA-256" };
  let signatureValid: boolean;
  try {
    signatureValid = await crypto.subtle.verify(verifyAlg, keys.publicKey, signature, signingInput);
  } catch {
    return { valid: false, error: "Signature verification failed" };
  }

  if (!signatureValid) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true, payload };
}

// ─── Decode (no verification) ─────────────────────────────────────────────────

export function decodeVcJwt(jwt: string): { header: unknown; payload: VcPayload } | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0]!)));
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1]!))) as VcPayload;
    return { header, payload };
  } catch {
    return null;
  }
}

// ─── Data Integrity Proof (JCS + Ed25519) ──────────────────────────────────────
//
// Uses RFC 8785 JCS canonicalization instead of URDNA2015 to avoid the
// heavy rdf-canonize + jsonld dependency chain. Produces deterministic,
// verifiable proofs with real Ed25519 signatures via native WebCrypto.

function jcsCanonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(jcsCanonicalize).join(",") + "]";
  const sorted = Object.keys(value as Record<string, unknown>).sort();
  const parts = sorted.map((k) => JSON.stringify(k) + ":" + jcsCanonicalize((value as Record<string, unknown>)[k]));
  return "{" + parts.join(",") + "}";
}

export interface DataIntegrityProof {
  type: "DataIntegrityProof";
  cryptosuite: "jcs-eddsa-2025";
  verificationMethod: string;
  proofValue: string;
  created: string;
  proofPurpose: "assertionMethod";
}

export interface VerifiableCredentialWithProof {
  "@context": readonly ["https://www.w3.org/ns/credentials/v2"];
  type: readonly ["VerifiableCredential", "BoltcardAccessBadge"];
  issuer: string;
  validFrom: string;
  credentialSubject: VcCredentialSubject;
  proof: DataIntegrityProof;
}

export async function issueDataIntegrityProof(
  env: Env,
  uidHex: string,
  profile: VcProfile,
): Promise<VerifiableCredentialWithProof> {
  const keys = await loadOrCreateKeys(env, "EdDSA");
  const now = new Date().toISOString();

  const credential: Omit<VerifiableCredentialWithProof, "proof"> = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "BoltcardAccessBadge"],
    issuer: keys.didKey,
    validFrom: now,
    credentialSubject: {
      cardUid: uidHex,
      name: profile.name,
      role: profile.role,
      department: profile.dept,
      clearance: profile.level,
    },
  };

  const canonical = jcsCanonicalize(credential);
  const hashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const signature = await crypto.subtle.sign("Ed25519", keys.privateKey, hashed);
  const proofValue = base64urlEncode(new Uint8Array(signature));

  return {
    ...credential,
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "jcs-eddsa-2025",
      verificationMethod: keys.didKey + "#" + keys.didKey.split(":").pop(),
      proofValue,
      created: now,
      proofPurpose: "assertionMethod",
    },
  };
}

export async function verifyDataIntegrityProof(
  env: Env,
  vc: VerifiableCredentialWithProof,
): Promise<VerifyResult> {
  const proof = vc.proof;
  if (!proof || proof.type !== "DataIntegrityProof" || proof.cryptosuite !== "jcs-eddsa-2025") {
    return { valid: false, error: "Unsupported proof format" };
  }

  const { proof: _omit, ...credentialWithoutProof } = vc;
  void _omit;

  const canonical = jcsCanonicalize(credentialWithoutProof);
  const hashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const signature = base64urlDecode(proof.proofValue);

  const keys = await loadOrCreateKeys(env, "EdDSA");
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify("Ed25519", keys.publicKey, signature, hashed);
  } catch {
    return { valid: false, error: "Signature verification failed" };
  }

  if (!valid) return { valid: false, error: "Invalid proof signature" };
  return { valid: true };
}

// ─── SD-JWT (Selective Disclosure for JWTs, RFC 9901) ──────────────────────────

export interface SdDisclosure {
  claimName: string;
  claimValue: string;
  disclosure: string;
}

export interface SdJwtVerifyResult extends VerifyResult {
  disclosures?: SdDisclosure[];
}

export async function issueSdJwt(
  env: Env,
  uidHex: string,
  profile: VcProfile,
  alg: VcAlgorithm = "ES256",
): Promise<string> {
  const keys = await loadOrCreateKeys(env, alg);
  const now = Math.floor(Date.now() / 1000);

  const selectableClaims: Array<[string, string]> = [
    ["name", profile.name],
    ["role", profile.role],
    ["department", profile.dept],
    ["clearance", profile.level],
  ];

  const disclosures: string[] = [];
  const sdHashes: string[] = [];

  for (const [claimName, claimValue] of selectableClaims) {
    const salt = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const disclosureJson = JSON.stringify([salt, claimName, claimValue]);
    const disclosureEncoded = base64urlEncode(new TextEncoder().encode(disclosureJson));
    disclosures.push(disclosureEncoded);
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(disclosureEncoded));
    sdHashes.push(base64urlEncode(new Uint8Array(hashBuf)));
  }

  const payload = {
    iss: keys.didKey,
    sub: "boltcard:" + uidHex,
    iat: now,
    exp: now + VC_TTL_SECONDS,
    _sd_alg: "sha-256",
    vc: {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential", "BoltcardAccessBadge"],
      issuer: keys.didKey,
      validFrom: new Date(now * 1000).toISOString(),
      credentialSubject: {
        cardUid: uidHex,
        _sd: sdHashes,
        _sd_alg: "sha-256",
      },
    },
  };

  const header = { typ: "JWT", alg, kid: "#0" };
  const headerB64 = base64urlEncodeString(JSON.stringify(header));
  const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
  const signingInput = headerB64 + "." + payloadB64;

  const signAlg = alg === "EdDSA" ? "Ed25519" : { name: "ECDSA", hash: "SHA-256" };
  const signatureBuf = await crypto.subtle.sign(signAlg, keys.privateKey, new TextEncoder().encode(signingInput));
  const signatureB64 = base64urlEncode(new Uint8Array(signatureBuf));

  return signingInput + "." + signatureB64 + "~" + disclosures.join("~");
}

export async function verifySdJwt(env: Env, sdJwt: string): Promise<SdJwtVerifyResult> {
  const tildeIndex = sdJwt.indexOf("~");
  if (tildeIndex === -1) {
    return { valid: false, error: "Not an SD-JWT (no ~ separator)" };
  }

  const jwt = sdJwt.substring(0, tildeIndex);
  const disclosureParts = sdJwt.substring(tildeIndex + 1).split("~").filter(Boolean);

  const jwtResult = await verifyVcJwt(env, jwt);
  if (!jwtResult.valid) return jwtResult;

  const decoded = decodeVcJwt(jwt);
  if (!decoded) return { valid: false, error: "Failed to decode JWT payload" };

  const credentialSubject = decoded.payload.vc.credentialSubject as unknown as Record<string, unknown>;
  const sdHashes = credentialSubject._sd as string[] | undefined;
  if (!sdHashes || !Array.isArray(sdHashes)) {
    return { valid: true, payload: decoded.payload, disclosures: [] };
  }

  const disclosures: SdDisclosure[] = [];
  for (const disclosureEncoded of disclosureParts) {
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(disclosureEncoded));
    const hash = base64urlEncode(new Uint8Array(hashBuf));
    if (!sdHashes.includes(hash)) {
      return { valid: false, error: "Disclosure hash not found in _sd array" };
    }
    try {
      const decodedDisclosure = JSON.parse(new TextDecoder().decode(base64urlDecode(disclosureEncoded))) as [string, string, string];
      disclosures.push({ claimName: decodedDisclosure[1]!, claimValue: decodedDisclosure[2]!, disclosure: disclosureEncoded });
    } catch {
      return { valid: false, error: "Failed to decode disclosure" };
    }
  }

  return { valid: true, payload: decoded.payload, disclosures };
}
