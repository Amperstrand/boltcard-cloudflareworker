import { fetchBoltCardKeys } from "../handlers/fetchBoltCardKeys.js";
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

function buildEnv(cardState = "new", config = null) {
  const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
  const replay = makeReplayNamespace();

  if (cardState === "active") {
    replay.__activate(UID, 1);
  } else if (cardState === "keys_delivered") {
    replay.__cardStates.set(UID, {
      state: "keys_delivered",
      latest_issued_version: 1,
      active_version: null,
      activated_at: null,
      terminated_at: null,
      keys_delivered_at: Math.floor(Date.now() / 1000),
      wipe_keys_fetched_at: null,
      balance: 0,
    });
  }

  if (config) {
    replay.__cardConfigs.set(UID, config);
  }

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

function postRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("fetchBoltCardKeys", () => {
  it("rejects non-POST methods", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/api/v1/pull-payments/test/boltcards", {
      method: "GET",
    });
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(405);
  });

  it("rejects invalid JSON body", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/api/v1/pull-payments/test/boltcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(400);
  });

  it("rejects missing UID and LNURLW", async () => {
    const env = buildEnv();
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards",
      {}
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("UID");
  });

  it("rejects invalid UID format", async () => {
    const env = buildEnv();
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=UpdateVersion",
      { UID: "ZZZZZZ" }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("UID");
  });

  it("programs a new card with fakewallet defaults", async () => {
    const env = buildEnv("new");
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=UpdateVersion",
      { UID }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
    expect(body.K0).toMatch(/^[0-9a-fA-F]{32}$/);
    expect(body.K1).toMatch(/^[0-9a-fA-F]{32}$/);
    expect(body.K2).toMatch(/^[0-9a-fA-F]{32}$/);
    expect(body.K3).toMatch(/^[0-9a-fA-F]{32}$/);
    expect(body.K4).toMatch(/^[0-9a-fA-F]{32}$/);
    expect(body.LNURLW).toContain("lnurlw://");
  });

  it("rejects programming an active card with 409", async () => {
    const env = buildEnv("active");
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=UpdateVersion",
      { UID }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toContain("active");
  });

  it("re-delivers keys for keys_delivered card (idempotent)", async () => {
    const env = buildEnv("keys_delivered");
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=UpdateVersion",
      { UID }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
  });

  it("programs a POS card with lnurlpay", async () => {
    const env = buildEnv("new");
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=UpdateVersion&card_type=pos&lightning_address=test@example.com",
      { UID }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.LNURLW).toContain("lnurlp://");

    const storedConfig = env.CARD_REPLAY.__cardConfigs.get(UID);
    expect(storedConfig.payment_method).toBe("lnurlpay");
  });

  it("rejects POS card without lightning_address", async () => {
    const env = buildEnv("new");
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=UpdateVersion&card_type=pos",
      { UID }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("lightning_address");
  });

  it("programs a 2FA card", async () => {
    const env = buildEnv("new");
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=UpdateVersion&card_type=2fa",
      { UID }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.LNURLW).toContain("/2fa");

    const storedConfig = env.CARD_REPLAY.__cardConfigs.get(UID);
    expect(storedConfig.payment_method).toBe("twofactor");
  });

  it("resets via LNURLW KeepVersion flow", async () => {
    const env = buildEnv("active", {
      K2: getDeterministicKeys(UID, { ISSUER_KEY }, 1).k2,
      payment_method: "fakewallet",
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const lnurlw = `lnurlw://boltcardpoc.psbt.me/lnurl?p=${pHex}&c=${cHex}`;

    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=KeepVersion",
      { LNURLW: lnurlw }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
  });

  it("rejects KeepVersion with UID but no LNURLW", async () => {
    const env = buildEnv();
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=KeepVersion",
      { UID }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("LNURLW");
  });

  it("rejects UpdateVersion without UID", async () => {
    const env = buildEnv();
    const lnurlw = "lnurlw://example.com/?p=ABC&c=DEF";
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=UpdateVersion",
      { LNURLW: lnurlw }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("UID");
  });
});
