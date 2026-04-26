import { fetchBoltCardKeys } from "../handlers/fetchBoltCardKeys.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap, buildCardTestEnv } from "./testHelpers.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function buildEnv(cardState = "new", config = null) {
  return buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, cardState, cardConfig: config });
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

  it("resets via LNURLW without onExisting param", async () => {
    const env = buildEnv("active", {
      K2: getDeterministicKeys(UID, { ISSUER_KEY }, 1).k2,
      payment_method: "fakewallet",
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const lnurlw = `lnurlw://boltcardpoc.psbt.me/lnurl?p=${pHex}&c=${cHex}`;

    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards",
      { LNURLW: lnurlw }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(200);
  });

  it("reset flow rejects keys_delivered card state", async () => {
    const env = buildEnv("active", {
      K2: getDeterministicKeys(UID, { ISSUER_KEY }, 1).k2,
      payment_method: "fakewallet",
    });
    env.CARD_REPLAY.__cardStates.get(UID).state = "keys_delivered";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const lnurlw = `lnurlw://boltcardpoc.psbt.me/lnurl?p=${pHex}&c=${cHex}`;

    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=KeepVersion",
      { LNURLW: lnurlw }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("active or terminated");
  });

  it("reset flow rejects invalid CMAC", async () => {
    const env = buildEnv("active", {
      K2: getDeterministicKeys(UID, { ISSUER_KEY }, 1).k2,
      payment_method: "fakewallet",
    });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const lnurlw = `lnurlw://boltcardpoc.psbt.me/lnurl?p=${pHex}&c=DEADBEEFDEADBEEF`;

    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=KeepVersion",
      { LNURLW: lnurlw }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("CMAC");
  });

  it("reset flow handles terminated card", async () => {
    const env = buildEnv("active", {
      K2: getDeterministicKeys(UID, { ISSUER_KEY }, 1).k2,
      payment_method: "fakewallet",
    });
    env.CARD_REPLAY.__cardStates.get(UID).state = "terminated";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const lnurlw = `lnurlw://boltcardpoc.psbt.me/lnurl?p=${pHex}&c=${cHex}`;

    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=KeepVersion",
      { LNURLW: lnurlw }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(200);
  });

  it("reset flow rejects LNURLW missing p param", async () => {
    const env = buildEnv();
    const lnurlw = "lnurlw://example.com/?c=ABCDEF";
    const req = postRequest(
      "https://test.local/api/v1/pull-payments/test/boltcards?onExisting=KeepVersion",
      { LNURLW: lnurlw }
    );
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain("p");
  });

  it("rejects GET request", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/api/v1/pull-payments/test/boltcards", { method: "GET" });
    const res = await fetchBoltCardKeys(req, env);
    expect(res.status).toBe(405);
  });
});
