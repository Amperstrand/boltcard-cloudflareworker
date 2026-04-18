import { getAllIssuerKeyCandidates, getIssuerKeysForDomain, getPerCardKeys, getPerCardDomains } from "../utils/keyLookup.js";
import { PERCARD_KEYS } from "../utils/generatedKeyData.js";

describe("keyLookup — issuer key lookup", () => {
  test("returns default keys for unknown domain", () => {
    const keys = getIssuerKeysForDomain("unknown.example.com");
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const hexes = keys.map((k) => k.hex);
    expect(hexes).toContain("00000000000000000000000000000000");
    expect(hexes).toContain("00000000000000000000000000000001");
  });

  test("returns domain-specific keys plus defaults", () => {
    const keys = getIssuerKeysForDomain("boltcardpoc.psbt.me");
    const labels = keys.map((k) => k.label);
    expect(labels).toContain("boltpoc-1");
    expect(labels).toContain("boltpoc-2");
    expect(labels).toContain("boltpoc-3");
    expect(labels).toContain("all-zeros");
    expect(labels).toContain("dev-01");
  });

  test("defaults are always appended after domain keys", () => {
    const keys = getIssuerKeysForDomain("boltcardpoc.psbt.me");
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
