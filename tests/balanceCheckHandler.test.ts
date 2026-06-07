
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { TestCard } from "@ntag424/crypto/test";
import { TEST_OPERATOR_AUTH, buildCardTestEnv } from "./testHelpers.js";
import type { Env } from "../types/core.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const TEST_UID = "04aabbccdd7788";
const ISSUER_KEY = "00000000000000000000000000000001";

function makeEnv(replay: ReturnType<typeof makeReplayNamespace> = makeReplayNamespace({ [TEST_UID]: 1 })) {
  return buildCardTestEnv({ operatorAuth: true, extraEnv: { CARD_REPLAY: replay, BOLT_CARD_K1 } });
}

async function provisionCard(env: ReturnType<typeof buildCardTestEnv>, replay: ReturnType<typeof makeReplayNamespace>, balance = 0) {
  const keys = getDeterministicKeys(TEST_UID, env as unknown as Env);
  const config = { K2: keys.k2, payment_method: "fakewallet" };
  env.UID_CONFIG.put(TEST_UID, JSON.stringify(config));
  if (balance > 0) {
    const id = replay.idFromName(TEST_UID.toLowerCase());
    const stub = replay.get(id);
    await stub.fetch(new Request("https://card-replay.internal/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: balance, note: "init" }),
    }));
  }
}

describe("POST /api/balance-check", () => {
  let env: ReturnType<typeof buildCardTestEnv>;
  let replay: ReturnType<typeof makeReplayNamespace>;
  let keys: ReturnType<typeof getDeterministicKeys>;

  beforeEach(async () => {
    replay = makeReplayNamespace({ [TEST_UID]: 1 });
    env = makeEnv(replay);
    keys = getDeterministicKeys(TEST_UID, { BOLT_CARD_K1 } as unknown as Env);
    await provisionCard(env, replay, 5000);
  });

  it("returns balance for valid card tap", async () => {
    const card = new TestCard(TEST_UID, ISSUER_KEY);
    const tap = card.tap(2);

    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: tap.p, c: tap.c }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.balance).toBe(5000);
    expect(json.uidHex).toBe(TEST_UID);
  });

  it("returns 400 when p is missing", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ c: "0000000000000000" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when c is missing", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.reason).toMatch(/invalid json/i);
  });

  it("returns 400 when card cannot be decrypted", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", c: "FFFFFFFFFFFFFFFF" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when CMAC validation fails", async () => {
    const card = new TestCard(TEST_UID, ISSUER_KEY);
    const tap = card.tap(2);
    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: tap.p, c: "0000000000000000" }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("returns zero balance for card with no transactions", async () => {
    const emptyReplay = makeReplayNamespace({ [TEST_UID]: 1 });
    const emptyEnv = makeEnv(emptyReplay);
    await provisionCard(emptyEnv, emptyReplay, 0);

    const card = new TestCard(TEST_UID, ISSUER_KEY);
    const tap = card.tap(2);

    const res = await handleRequest(
      new Request("https://test.local/api/balance-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: tap.p, c: tap.c }),
      }),
      emptyEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.balance).toBe(0);
  });
});
