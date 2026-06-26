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
