import { getAllIssuerKeyCandidates, _getIssuerKeysForDomain, getPerCardKeys, _getPerCardDomains, getUniquePerCardK1s, fingerprintHex, classifyIssuerKey } from "../utils/keyLookup.js";
import { PERCARD_KEYS } from "../utils/generatedKeyData.js";
import { KEY_PROVENANCE } from "../utils/constants.js";

describe("keyLookup — issuer key lookup", () => {
  test("returns default keys for unknown domain", () => {
    const keys = _getIssuerKeysForDomain("unknown.example.com");
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const hexes = keys.map((k) => k.hex);
    expect(hexes).toContain("00000000000000000000000000000000");
    expect(hexes).toContain("00000000000000000000000000000001");
  });

  test("returns domain-specific keys plus defaults", () => {
    const keys = _getIssuerKeysForDomain("boltcardpoc.psbt.me");
    const labels = keys.map((k) => k.label);
    expect(labels).toContain("boltpoc-1");
    expect(labels).toContain("boltpoc-2");
    expect(labels).toContain("boltpoc-3");
    expect(labels).toContain("all-zeros");
    expect(labels).toContain("dev-01");
  });

  test("defaults are always appended after domain keys", () => {
    const keys = _getIssuerKeysForDomain("boltcardpoc.psbt.me");
    const defaultLabels = keys.filter((k) => k.label === "all-zeros" || k.label === "dev-01");
    expect(defaultLabels.length).toBe(2);
  });
});

describe("keyLookup — getAllIssuerKeyCandidates", () => {
  test("includes env ISSUER_KEY first", () => {
    const env = { ISSUER_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
    const candidates = getAllIssuerKeyCandidates(env);
    expect(candidates[0].hex).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(candidates[0].label).toBe("current");
  });

  test("includes RECOVERY_ISSUER_KEYS from env", () => {
    const env = { RECOVERY_ISSUER_KEYS: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,cccccccccccccccccccccccccccccccc" };
    const candidates = getAllIssuerKeyCandidates(env);
    const hexes = candidates.map((c) => c.hex);
    expect(hexes).toContain("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(hexes).toContain("cccccccccccccccccccccccccccccccc");
  });

  test("deduplicates keys", () => {
    const env = { ISSUER_KEY: "00000000000000000000000000000001" };
    const candidates = getAllIssuerKeyCandidates(env);
    const count01 = candidates.filter((c) => c.hex === "00000000000000000000000000000001").length;
    expect(count01).toBe(1);
  });

  test("returns CSV keys when no env set", () => {
    const candidates = getAllIssuerKeyCandidates({});
    const hexes = candidates.map((c) => c.hex);
    expect(hexes).toContain("b0733959686c5da274123084b5c07820");
    expect(hexes).toContain("00000000000000000000000000000000");
  });
});

describe("keyLookup — per-card keys", () => {
  test("returns null for unknown UID", () => {
    expect(getPerCardKeys("deadbeefdead")).toBeNull();
  });

  test("returns per-card entry by UID", () => {
    const entry = getPerCardKeys("040a69fa967380");
    expect(entry).not.toBeNull();
    expect(entry.k0).toBe("d6672015edcef27c2615e76be0f3f4a2");
    expect(entry.k1).toBe("3db8852a71d11fa0adb6babaf274af89");
    expect(entry.k2).toBe("ce08c57983d65fceaa571e248390790f");
  });

  test("lookup is case-insensitive", () => {
    const upper = getPerCardKeys("040A69FA967380");
    const lower = getPerCardKeys("040a69fa967380");
    expect(upper).toEqual(lower);
  });

  test("all 104 per-card entries are loaded", () => {
    expect(PERCARD_KEYS.length).toBe(104);
  });
});

describe("keyLookup — _getPerCardDomains", () => {
  test("returns array of unique non-empty card names", () => {
    const domains = _getPerCardDomains();
    expect(Array.isArray(domains)).toBe(true);
    expect(new Set(domains).size).toBe(domains.length);
  });

  test("filters out empty card names", () => {
    const domains = _getPerCardDomains();
    expect(domains.every(d => typeof d === "string" && d.length > 0)).toBe(true);
  });
});

describe("keyLookup — getUniquePerCardK1s", () => {
  test("deduplicates by k1 case-insensitively", () => {
    const unique = getUniquePerCardK1s();
    const k1Lower = unique.map(e => e.k1.toLowerCase());
    expect(new Set(k1Lower).size).toBe(k1Lower.length);
  });

  test("returns subset of PERCARD_KEYS", () => {
    const unique = getUniquePerCardK1s();
    expect(unique.length).toBeLessThanOrEqual(PERCARD_KEYS.length);
  });

  test("skips entries without k1", () => {
    const unique = getUniquePerCardK1s();
    expect(unique.every(e => e.k1)).toBe(true);
  });
});

describe("keyLookup — fingerprintHex", () => {
  test("returns 16-char hex prefix of sha256", () => {
    const fp = fingerprintHex("abcdef0123456789");
    expect(fp).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(fp)).toBe(true);
  });

  test("is deterministic", () => {
    expect(fingerprintHex("test")).toBe(fingerprintHex("test"));
  });

  test("is case-insensitive", () => {
    expect(fingerprintHex("ABC")).toBe(fingerprintHex("abc"));
  });

  test("produces different fingerprints for different inputs", () => {
    expect(fingerprintHex("aaaa")).not.toBe(fingerprintHex("bbbb"));
  });
});

describe("keyLookup — classifyIssuerKey", () => {
  test("classifies public key from generatedKeyData", () => {
    const env = {};
    const result = classifyIssuerKey(env, "00000000000000000000000000000000");
    expect(result.provenance).toBe(KEY_PROVENANCE.PUBLIC_ISSUER);
    expect(result.label).toBe("all-zeros");
    expect(result.fingerprint).toHaveLength(16);
  });

  test("classifies domain-specific public key", () => {
    const env = {};
    const result = classifyIssuerKey(env, "b0733959686c5da274123084b5c07820");
    expect(result.provenance).toBe(KEY_PROVENANCE.PUBLIC_ISSUER);
    expect(result.label).toBe("boltpoc-1");
  });

  test("classifies env key that is not public as env_issuer", () => {
    const env = { ISSUER_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
    const result = classifyIssuerKey(env, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result.provenance).toBe(KEY_PROVENANCE.ENV_ISSUER);
    expect(result.label).toBe("current");
  });

  test("classifies public key even when it matches env ISSUER_KEY", () => {
    const env = { ISSUER_KEY: "00000000000000000000000000000000" };
    const result = classifyIssuerKey(env, "00000000000000000000000000000000");
    expect(result.provenance).toBe(KEY_PROVENANCE.PUBLIC_ISSUER);
  });

  test("classifies unknown key not in env or public set", () => {
    const env = { ISSUER_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
    const result = classifyIssuerKey(env, "ffffffffffffffffffffffffffffffff");
    expect(result.provenance).toBe(KEY_PROVENANCE.UNKNOWN);
    expect(result.label).toContain("ffffffff");
  });

  test("returns unknown for null/undefined key", () => {
    const result = classifyIssuerKey({}, null);
    expect(result.provenance).toBe(KEY_PROVENANCE.UNKNOWN);
    expect(result.label).toBeNull();
    expect(result.fingerprint).toBeNull();
  });

  test("is case-insensitive", () => {
    const upper = classifyIssuerKey({}, "00000000000000000000000000000000");
    const lower = classifyIssuerKey({}, "00000000000000000000000000000000".toUpperCase());
    expect(upper.provenance).toBe(lower.provenance);
    expect(upper.fingerprint).toBe(lower.fingerprint);
  });
});
