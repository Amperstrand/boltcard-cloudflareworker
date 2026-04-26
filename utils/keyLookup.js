import { ISSUER_KEYS_BY_DOMAIN, PERCARD_KEYS } from "./generatedKeyData.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "../cryptoutils.js";
import { KEY_PROVENANCE } from "./constants.js";

const PERCARD_MAP = new Map(PERCARD_KEYS.map((entry) => [entry.uid, entry]));

const PUBLIC_KEY_SET = new Set();
for (const domain of Object.keys(ISSUER_KEYS_BY_DOMAIN)) {
  for (const key of ISSUER_KEYS_BY_DOMAIN[domain]) {
    PUBLIC_KEY_SET.add(key.hex.toLowerCase());
  }
}

export function _getIssuerKeysForDomain(domain) {
  const domainKeys = ISSUER_KEYS_BY_DOMAIN[domain] || [];
  const defaultKeys = ISSUER_KEYS_BY_DOMAIN["_default"] || [];
  return [...domainKeys, ...defaultKeys];
}

export function getAllIssuerKeyCandidates(env) {
  const seen = new Set();
  const result = [];

  const add = (hex, label) => {
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

export function getPerCardKeys(uidHex) {
  return PERCARD_MAP.get(uidHex.toLowerCase()) || null;
}

export function _getPerCardDomains() {
  return [...new Set(PERCARD_KEYS.map((e) => e.card_name).filter(Boolean))];
}

export function getUniquePerCardK1s() {
  const seen = new Set();
  const result = [];
  for (const entry of PERCARD_KEYS) {
    if (entry.k1 && !seen.has(entry.k1.toLowerCase())) {
      seen.add(entry.k1.toLowerCase());
      result.push(entry);
    }
  }
  return result;
}

export function fingerprintHex(hex) {
  const data = new TextEncoder().encode(hex.toLowerCase());
  return bytesToHex(sha256(data)).slice(0, 16);
}

export function classifyIssuerKey(env, issuerKeyHex) {
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

function findPublicKeyLabel(hex) {
  for (const domain of Object.keys(ISSUER_KEYS_BY_DOMAIN)) {
    for (const key of ISSUER_KEYS_BY_DOMAIN[domain]) {
      if (key.hex.toLowerCase() === hex) {
        return key.label;
      }
    }
  }
  return null;
}
