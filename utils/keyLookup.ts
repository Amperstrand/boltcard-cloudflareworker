import { ISSUER_KEYS_BY_DOMAIN, PERCARD_KEYS } from "./generatedKeyData.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "../cryptoutils.js";
import { KEY_PROVENANCE } from "./constants.js";

interface EnvLike {
  ISSUER_KEY?: string;
  RECOVERY_ISSUER_KEYS?: string;
}

interface KeyCandidate {
  hex: string;
  label: string;
}

interface PerCardEntry {
  uid: string;
  k0?: string;
  k1: string;
  k2: string;
  k3?: string;
  k4?: string;
  card_name?: string;
}

interface ClassifyResult {
  provenance: string;
  label: string | null;
  fingerprint: string | null;
}

const PERCARD_MAP = new Map<string, PerCardEntry>(PERCARD_KEYS.map((entry) => [entry.uid, entry]));

const PUBLIC_KEY_SET = new Set<string>();
for (const domain of Object.keys(ISSUER_KEYS_BY_DOMAIN)) {
  for (const key of ISSUER_KEYS_BY_DOMAIN[domain]) {
    PUBLIC_KEY_SET.add(key.hex.toLowerCase());
  }
}

export function _getIssuerKeysForDomain(domain: string): KeyCandidate[] {
  const domainKeys = ISSUER_KEYS_BY_DOMAIN[domain] || [];
  const defaultKeys = ISSUER_KEYS_BY_DOMAIN["_default"] || [];
  return [...domainKeys, ...defaultKeys];
}

export function getAllIssuerKeyCandidates(env: EnvLike | undefined): KeyCandidate[] {
  const seen = new Set<string>();
  const result: KeyCandidate[] = [];

  const add = (hex: string, label: string) => {
    const lower = hex.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push({ hex: lower, label });
    }
  };

  if (env?.ISSUER_KEY) add(env.ISSUER_KEY, "current");

  if (env?.RECOVERY_ISSUER_KEYS) {
    for (const hex of env.RECOVERY_ISSUER_KEYS.split(",")) {
      const trimmed = hex.trim();
      if (trimmed) add(trimmed, trimmed.substring(0, 8) + "...");
    }
  }

  for (const domain of Object.keys(ISSUER_KEYS_BY_DOMAIN)) {
    for (const key of ISSUER_KEYS_BY_DOMAIN[domain]) {
      add(key.hex, key.label);
    }
  }

  return result;
}

export function getPerCardKeys(uidHex: string): PerCardEntry | null {
  return PERCARD_MAP.get(uidHex.toLowerCase()) || null;
}

export function _getPerCardDomains(): string[] {
  return [...new Set(PERCARD_KEYS.map((e) => e.card_name).filter(Boolean))] as string[];
}

export function getUniquePerCardK1s(): PerCardEntry[] {
  const seen = new Set<string>();
  const result: PerCardEntry[] = [];
  for (const entry of PERCARD_KEYS) {
    if (entry.k1 && !seen.has(entry.k1.toLowerCase())) {
      seen.add(entry.k1.toLowerCase());
      result.push(entry);
    }
  }
  return result;
}

export function fingerprintHex(hex: string): string {
  const data = new TextEncoder().encode(hex.toLowerCase());
  return bytesToHex(sha256(data)).slice(0, 16);
}

export function classifyIssuerKey(env: EnvLike | undefined, issuerKeyHex: string | undefined): ClassifyResult {
  if (!issuerKeyHex) {
    return { provenance: KEY_PROVENANCE.UNKNOWN, label: null, fingerprint: null };
  }

  const normalized = issuerKeyHex.toLowerCase();
  const fingerprint = fingerprintHex(normalized);
  const isPublic = PUBLIC_KEY_SET.has(normalized);
  const isEnvKey = env?.ISSUER_KEY && env.ISSUER_KEY.toLowerCase() === normalized;

  if (isPublic) {
    const publicLabel = findPublicKeyLabel(normalized);
    return {
      provenance: KEY_PROVENANCE.PUBLIC_ISSUER,
      label: publicLabel,
      fingerprint,
    };
  }

  if (isEnvKey) {
    return {
      provenance: KEY_PROVENANCE.ENV_ISSUER,
      label: "current",
      fingerprint,
    };
  }

  return {
    provenance: KEY_PROVENANCE.UNKNOWN,
    label: `${normalized.substring(0, 8)}...`,
    fingerprint,
  };
}

function findPublicKeyLabel(hex: string): string | null {
  for (const domain of Object.keys(ISSUER_KEYS_BY_DOMAIN)) {
    for (const key of ISSUER_KEYS_BY_DOMAIN[domain]) {
      if (key.hex.toLowerCase() === hex) {
        return key.label;
      }
    }
  }
  return null;
}
