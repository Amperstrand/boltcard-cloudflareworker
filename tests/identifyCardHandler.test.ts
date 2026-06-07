
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { TestCard } from "@ntag424/crypto/test";
import { buildCardTestEnv } from "./testHelpers.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const TEST_UID = "04aabbccdd7788";
const ISSUER_KEY = "00000000000000000000000000000001";

function makeEnv(replay = makeReplayNamespace({ [TEST_UID]: 1 })) {
  return buildCardTestEnv({ operatorAuth: true, extraEnv: { CARD_REPLAY: replay, BOLT_CARD_K1 } });
}

let card: TestCard;
let keys: { k2: string };

beforeAll(() => {
  card = new TestCard(TEST_UID, ISSUER_KEY);
  keys = getDeterministicKeys(TEST_UID, { BOLT_CARD_K1 } as any);
});

describe("POST /api/identify-card", () => {
  it("returns error when p is missing", async () => {
    const env = makeEnv();
    const tap = card.tap(2);
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ c: tap.c }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.reason).toMatch(/missing.*p.*c/i);
  });

  it("returns error when c is missing", async () => {
    const env = makeEnv();
    const tap = card.tap(2);
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.reason).toMatch(/missing.*p.*c/i);
  });

  it("returns error when p cannot be decrypted", async () => {
    const env = makeEnv();
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", c: "FFFFFFFFFFFFFFFF" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.reason).toMatch(/unable to decode/i);
  });

  it("returns card identification with matched deterministic source", async () => {
    const env = makeEnv();
    const counter = 2;
    const tap = card.tap(counter);

    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.uid).toBe(TEST_UID);
    expect(json.counter).toBe(counter);
    expect(json.card_state).toBe("active");
    expect(json.matched as boolean).toBeTruthy();
    expect((json.matched as Record<string, unknown>).source).toBe("config");
    expect((json.matched as Record<string, unknown>).cmac_validated).toBe(true);
    expect(Array.isArray((json.all_attempts as unknown[]))).toBe(true);
    expect((json.all_attempts as unknown[]).length).toBeGreaterThan(0);
  });

  it("returns matched null when CMAC does not validate", async () => {
    const env = makeEnv();
    const tap = card.tap(2);
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: "0000000000000000" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.uid).toBe(TEST_UID);
    expect(json.matched as boolean).toBeNull();
    expect((json.all_attempts as unknown[]).length).toBeGreaterThan(0);
  });

  it("reports active_version from card state", async () => {
    const replay = makeReplayNamespace({ [TEST_UID]: 1 });
    replay.__activate(TEST_UID, 3);
    const env = makeEnv(replay);

    const counter = 2;
    const version3Card = new TestCard(TEST_UID, ISSUER_KEY, 3);
    const tap = version3Card.tap(counter);

    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c }),
      }),
      env,
    );
    const json = await res.json() as Record<string, unknown>;
    expect(json.active_version).toBe(3);
    expect((json.matched as Record<string, unknown>).version).toBe(3);
  });

  it("returns unknown card_state when no DO state exists", async () => {
    const env = makeEnv(makeReplayNamespace());
    const counter = 2;
    const tap = card.tap(counter);

    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ p: tap.p, c: tap.c }),
      }),
      env,
    );
    const json = await res.json() as Record<string, unknown>;
    expect(json.card_state).toBe("new");
  });

  it("accepts p and c from query string", async () => {
    const env = makeEnv();
    const counter = 2;
    const tap = card.tap(counter);

    const res = await handleRequest(
      new Request(`https://test.local/api/identify-card?p=${tap.p}&c=${tap.c}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.uid).toBe(TEST_UID);
    expect(json.matched as boolean).toBeTruthy();
  });

  it("requires operator auth", async () => {
    const env = makeEnv();
    delete env.__TEST_OPERATOR_SESSION;
    const res = await handleRequest(
      new Request("https://test.local/api/identify-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: "a", c: "b" }),
      }),
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/operator/login");
  });
});