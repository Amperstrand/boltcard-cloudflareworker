import { handleIdentityVerify, handleIdentityProfileUpdate } from "../handlers/identityHandler.js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import aesjs from "aes-js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function virtualTap(uidHex, counter, k1Hex, k2Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xc7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));
  const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
  const vd = buildVerificationData(uid, hexToBytes(ctrHex), hexToBytes(k2Hex));
  const cHex = bytesToHex(vd.ct);
  return { pHex, cHex };
}

function buildEnv(kvData = null) {
  const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
  const replay = makeReplayNamespace();
  replay.__activate(UID, 1);
  replay.__cardConfigs.set(UID, { K2: keys.k2, payment_method: "fakewallet" });

  const kvStore = {};
  if (kvData) kvStore[UID] = kvData;

  return {
    ISSUER_KEY,
    BOLT_CARD_K1: keys.k1,
    CARD_REPLAY: replay,
    UID_CONFIG: {
      get: async (key) => kvStore[key] ?? null,
      put: async (key, val) => { kvStore[key] = val; },
    },
  };
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
