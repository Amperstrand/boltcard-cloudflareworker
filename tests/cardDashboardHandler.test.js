import { handleCardPage, handleCardInfo } from "../handlers/cardDashboardHandler.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { virtualTap, buildCardTestEnv } from "./testHelpers.js";

const UID = "ff000000000001";
const ISSUER_KEY = "00000000000000000000000000000001";

describe("handleCardPage", () => {
  it("renders card dashboard HTML", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/card");
    const res = await handleCardPage(req, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("MY CARD");
    expect(html).toContain("/card/info");
  });
});

describe("handleCardInfo", () => {
  it("returns error when p is missing", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/card/info?c=ABCDEF");
    const res = await handleCardInfo(req, env);
    expect(res.status).toBe(400);
  });

  it("returns error when c is missing", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const req = new Request("https://test.local/card/info?p=ABCDEF");
    const res = await handleCardInfo(req, env);
    expect(res.status).toBe(400);
  });

  it("returns card info for valid tap", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, paymentMethod: "fakewallet" });
    env.CARD_REPLAY.__cardStates.get(UID).key_provenance = "public_issuer";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 1, keys.k1, keys.k2);

    const req = new Request(`https://test.local/card/info?p=${pHex}&c=${cHex}`);
    const res = await handleCardInfo(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.uid).toBe(UID);
    expect(body.maskedUid).toBeDefined();
    expect(body.state).toBe("active");
    expect(body.balance).toBeDefined();
    expect(body.recentTaps).toBeDefined();
    expect(body.programmingRecommended).toBe(true);
    expect(body.keyProvenance).toBe("public_issuer");
  });

  it("returns terminated state without error", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, cardState: "active" });
    const state = env.CARD_REPLAY.__cardStates.get(UID);
    state.state = "terminated";
    state.key_provenance = null;

    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 1, keys.k1, keys.k2);

    const req = new Request(`https://test.local/card/info?p=${pHex}&c=${cHex}`);
    const res = await handleCardInfo(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.state).toBe("terminated");
    expect(body.programmingRecommended).toBe(false);
  });

  it("returns 403 for invalid CMAC", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex } = virtualTap(UID, 1, keys.k1, keys.k2);

    const req = new Request(`https://test.local/card/info?p=${pHex}&c=00000000000000000000000000000000`);
    const res = await handleCardInfo(req, env);
    expect(res.status).toBe(403);
  });

  it("shows programmingRecommended for public_issuer provenance", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    env.CARD_REPLAY.__cardStates.get(UID).key_provenance = "public_issuer";

    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 1, keys.k1, keys.k2);

    const req = new Request(`https://test.local/card/info?p=${pHex}&c=${cHex}`);
    const res = await handleCardInfo(req, env);
    const body = await res.json();
    expect(body.programmingRecommended).toBe(true);
    expect(body.keyProvenance).toBe("public_issuer");
  });

  it("does not recommend programming for env_issuer provenance", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    env.CARD_REPLAY.__cardStates.get(UID).key_provenance = "env_issuer";

    const keys = getDeterministicKeys(UID, { ISSUER_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, 1);
    const { pHex, cHex } = virtualTap(UID, 1, keys.k1, keys.k2);

    const req = new Request(`https://test.local/card/info?p=${pHex}&c=${cHex}`);
    const res = await handleCardInfo(req, env);
    const body = await res.json();
    expect(body.programmingRecommended).toBe(false);
  });

  it("includes key label and fingerprint when available", async () => {
    const env = buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY });
    env.CARD_REPLAY.__cardStates.get(UID).key_label = "dev-01";
    env.CARD_REPLAY.__cardStates.get(UID).key_fingerprint = "abc123";

    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 1, keys.k1, keys.k2);

    const req = new Request(`https://test.local/card/info?p=${pHex}&c=${cHex}`);
    const res = await handleCardInfo(req, env);
    const body = await res.json();
    expect(body.keyLabel).toBe("dev-01");
    expect(body.keyFingerprint).toBe("abc123");
  });
});
