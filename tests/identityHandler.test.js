import { handleIdentityVerify, handleIdentityProfileUpdate } from "../handlers/identityHandler.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap, buildCardTestEnv } from "./testHelpers.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function buildEnv(kvData = null) {
  return buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, kvData });
}

function buildEnvWithKvThrow() {
  return buildCardTestEnv({
    uid: UID,
    issuerKey: ISSUER_KEY,
    extraEnv: {
      UID_CONFIG: {
        get: async () => { throw new Error("KV exploded"); },
        put: async () => {},
      },
    },
  });
}

describe("handleIdentityVerify", () => {
  it("returns verified:true for enrolled card with valid CMAC", async () => {
    const env = buildEnv(JSON.stringify({ identity_profile: { emoji: "🚀" } }));
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(`https://test.local/api/verify-identity?p=${pHex}&c=${cHex}`);
    const res = await handleIdentityVerify(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.uid).toBe(UID);
    expect(body.maskedUid).toContain("···");
    expect(body.profile).toBeDefined();
    expect(body.profile.emoji).toBe("🚀");
    expect(body.keyProvenance).toBeDefined();
    expect(body.programmingRecommended).toBeDefined();
  });

  it("returns verified:false for card not in KV", async () => {
    const env = buildEnv(null);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(`https://test.local/api/verify-identity?p=${pHex}&c=${cHex}`);
    const res = await handleIdentityVerify(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.reason).toContain("not enrolled");
  });

  it("returns 400 for missing p and c", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/api/verify-identity");
    const res = await handleIdentityVerify(req, env);
    expect(res.status).toBe(400);
  });

  it("returns verified:false for invalid CMAC", async () => {
    const env = buildEnv(JSON.stringify({ identity_profile: {} }));
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(`https://test.local/api/verify-identity?p=${pHex}&c=DEADBEEFDEADBEEF`);
    const res = await handleIdentityVerify(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.reason).toContain("authentication failed");
  });

  it("returns deterministic profile from UID", async () => {
    const env = buildEnv(JSON.stringify({}));
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const req = new Request(`https://test.local/api/verify-identity?p=${pHex}&c=${cHex}`);
    const res = await handleIdentityVerify(req, env);
    const body = await res.json();
    expect(body.profile.name).toContain("Operator-");
    expect(body.profile.role).toBeDefined();
    expect(body.profile.dept).toBeDefined();
    expect(body.profile.level).toMatch(/^Level \d$/);
  });
});

describe("handleIdentityProfileUpdate", () => {
  it("updates emoji for enrolled card", async () => {
    const env = buildEnv(JSON.stringify({}));
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request("https://test.local/api/identity/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex, emoji: "🦄" }),
    });
    const res = await handleIdentityProfileUpdate(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.profile.emoji).toBe("🦄");
  });

  it("rejects invalid emoji", async () => {
    const env = buildEnv(JSON.stringify({}));
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const req = new Request("https://test.local/api/identity/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex, emoji: "INVALID" }),
    });
    const res = await handleIdentityProfileUpdate(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/api/identity/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleIdentityProfileUpdate(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects unenrolled card", async () => {
    const env = buildEnv(null);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 4, keys.k1, keys.k2);
    const req = new Request("https://test.local/api/identity/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex, emoji: "🚀" }),
    });
    const res = await handleIdentityProfileUpdate(req, env);
    const body = await res.json();
    expect(body.verified).toBe(false);
  });
});

describe("identityHandler branch coverage", () => {
  it("handles non-JSON KV enrollment value (parseIdentityRecord catch)", async () => {
    const env = buildEnv("not-json-but-truthy");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(`https://test.local/api/verify-identity?p=${pHex}&c=${cHex}`);
    const res = await handleIdentityVerify(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.profile).toBeDefined();
  });

  it("returns 500 when KV get throws", async () => {
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const env = buildEnvWithKvThrow();
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(`https://test.local/api/verify-identity?p=${pHex}&c=${cHex}`);
    const res = await handleIdentityVerify(req, env);
    expect(res.status).toBe(500);
  });

  it("returns verified:false when getUidConfig returns null (production, no issuer key)", async () => {
    const devKey = "00000000000000000000000000000001";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY: devKey }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const env = buildCardTestEnv({
      uid: UID,
      issuerKey: devKey,
      kvData: null,
      cardState: "new",
      extraEnv: {
        WORKER_ENV: "production",
      },
    });
    delete env.ISSUER_KEY;
    const req = new Request(`https://test.local/api/verify-identity?p=${pHex}&c=${cHex}`);
    const res = await handleIdentityVerify(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.reason).toContain("Card not recognized");
  });

  it("returns 400 when decryption fails", async () => {
    const env = buildEnv(JSON.stringify({}));
    const req = new Request("https://test.local/api/verify-identity?p=AABBCCDD11223344AABBCCDD11223344&c=1122334455667788");
    const res = await handleIdentityVerify(req, env);
    expect(res.status).toBe(400);
  });

  it("uses fallback emoji when record has invalid emoji", async () => {
    const env = buildEnv(JSON.stringify({ identity_profile: { emoji: "INVALID" } }));
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(`https://test.local/api/verify-identity?p=${pHex}&c=${cHex}`);
    const res = await handleIdentityVerify(req, env);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.profile.emoji).toBeDefined();
    expect(body.profile.emoji).not.toBe("INVALID");
  });

  it("handles profile update for card with existing identity_profile", async () => {
    const env = buildEnv(JSON.stringify({ identity_profile: { emoji: "🚀" }, extra: "data" }));
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request("https://test.local/api/identity/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: pHex, c: cHex, emoji: "🦊" }),
    });
    const res = await handleIdentityProfileUpdate(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.profile.emoji).toBe("🦊");
  });
});
