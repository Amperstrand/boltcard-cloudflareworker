// Type declarations for auto-generated generatedKeyData.js
// Regenerate: node scripts/build_keys.js

interface IssuerKeyEntry {
  hex: string;
  label: string;
}

interface PerCardKeyEntry {
  uid: string;
  k0?: string;
  k1: string;
  k2: string;
  k3?: string;
  k4?: string;
  card_name?: string;
}

export const ISSUER_KEYS_BY_DOMAIN: Record<string, IssuerKeyEntry[]>;
export const PERCARD_KEYS: PerCardKeyEntry[];
