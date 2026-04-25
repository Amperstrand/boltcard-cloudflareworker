import { handleLnurlw } from "../handlers/lnurlwHandler.js";
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

function buildEnv(paymentMethod = "fakewallet", extraConfig = {}) {
  const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
  const replay = makeReplayNamespace();
  replay.__activate(UID, 1);
  const config = {
    K2: keys.k2,
    payment_method: paymentMethod,
    ...extraConfig,
  };
  replay.__cardConfigs.set(UID, config);

  return {
    ISSUER_KEY,
    BOLT_CARD_K1: keys.k1,
    CARD_REPLAY: replay,
    UID_CONFIG: {
      get: async () => null,
      put: async () => {},
    },
  };
}

function tapRequest(uid, counter, k1, k2, baseUrl = "https://test.local") {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  return new Request(`${baseUrl}/?p=${pHex}&c=${cHex}`);
}

describe("handleLnurlw", () => {
  it("returns error when p is missing", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/?c=ABCDEF0123456789");
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("p and c");
  });

  it("returns error when c is missing", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/?p=4E2E289D945A66BB13377A728884E867");
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
  });

  it("returns error for invalid p (decryption failure)", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/?p=0000000000&c=ABCDEF0123456789");
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
  });

  it("returns fakewallet withdraw response for valid tap", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("withdrawRequest");
    expect(body.callback).toContain("/boltcards/api/v1/lnurl/cb/");
    expect(body.k1).toBeDefined();
    expect(body.minWithdrawable).toBe(1);
    expect(body.maxWithdrawable).toBe(1000000);
    expect(body.defaultDescription).toContain("Boltcard payment");
  });

  it("returns clnrest withdraw response for valid tap", async () => {
    const env = buildEnv("clnrest", {
      clnrest: {
        protocol: "https",
        host: "https://cln.example.com",
        port: 3001,
        rune: "test",
      },
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("withdrawRequest");
    expect(body.minWithdrawable).toBe(1000);
    expect(body.maxWithdrawable).toBe(1000);
  });

  it("rejects replay with same counter", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req1 = tapRequest(UID, 3, keys.k1, keys.k2);
    const res1 = await handleLnurlw(req1, env);
    expect(res1.status).toBe(200);

    const req2 = tapRequest(UID, 3, keys.k1, keys.k2);
    const res2 = await handleLnurlw(req2, env);
    expect(res2.status).toBe(400);
    const body = await res2.json();
    expect(body.reason).toContain("replay");
  });

  it("rejects replay with lower counter", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req1 = tapRequest(UID, 5, keys.k1, keys.k2);
    const res1 = await handleLnurlw(req1, env);
    expect(res1.status).toBe(200);

    const req2 = tapRequest(UID, 3, keys.k1, keys.k2);
    const res2 = await handleLnurlw(req2, env);
    expect(res2.status).toBe(400);
  });

  it("rejects terminated card", async () => {
    const env = buildEnv("fakewallet");
    env.CARD_REPLAY.__cardStates.get(UID).state = "terminated";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toContain("terminated");
  });

  it("rejects invalid CMAC", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const req = new Request(`https://test.local/?p=${pHex}&c=DEADBEEFDEADBEEF`);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("CMAC");
  });

  it("returns error for unsupported payment method", async () => {
    const env = buildEnv("unknown_method");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("Unsupported payment method");
  });

  it("handles legacy new state cards with version 1", async () => {
    const env = buildEnv("fakewallet");
    env.CARD_REPLAY.__cardStates.get(UID).state = "new";
    env.CARD_REPLAY.__cardStates.get(UID).active_version = null;
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("withdrawRequest");
  });

  it("accepts sequential taps with increasing counter", async () => {
    const env = buildEnv("fakewallet");
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);

    for (let counter = 2; counter <= 5; counter++) {
      const req = tapRequest(UID, counter, keys.k1, keys.k2);
      const res = await handleLnurlw(req, env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tag).toBe("withdrawRequest");
    }
  });

  it("returns lnurlpay pay request for lnurlpay payment method", async () => {
    const env = buildEnv("lnurlpay", {
      lightning_address: "test@example.com",
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const req = tapRequest(UID, 2, keys.k1, keys.k2);
    const res = await handleLnurlw(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag).toBe("payRequest");
  });
});
