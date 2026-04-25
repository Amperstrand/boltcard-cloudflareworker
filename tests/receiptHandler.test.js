import { describe, it, expect, beforeEach } from "@jest/globals";
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { buildCardTestEnv } from "./testHelpers.js";

const TEST_UID = "04aabbccdd7788";

function makeEnv(replay = makeReplayNamespace({ [TEST_UID]: 1 })) {
  return buildCardTestEnv({ operatorAuth: true, extraEnv: { CARD_REPLAY: replay } });
}

async function creditCard(replay, uid, amount, note) {
  const id = replay.idFromName(uid.toLowerCase());
  const stub = replay.get(id);
  return stub.fetch(new Request("https://card-replay.internal/credit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, note }),
  }));
}

async function debitCard(replay, uid, counter, amount, note) {
  const id = replay.idFromName(uid.toLowerCase());
  const stub = replay.get(id);
  return stub.fetch(new Request("https://card-replay.internal/debit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ counter, amount, note }),
  }));
}

describe("GET /api/receipt/:txnId", () => {
  let env;
  let replay;

  beforeEach(() => {
    replay = makeReplayNamespace({ [TEST_UID]: 1 });
    env = makeEnv(replay);
  });

  it("returns 400 when uid is missing", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/receipt/1", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/uid required/i);
  });

  it("returns 400 when txnId is 'receipt' (no ID segment)", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/receipt/receipt?uid=" + TEST_UID, {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/transaction id required/i);
  });

  it("returns 404 when transaction not found", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/receipt/999?uid=" + TEST_UID, {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.reason).toMatch(/not found/i);
  });

  it("returns plain-text receipt for a credit transaction", async () => {
    const creditRes = await creditCard(replay, TEST_UID, 1000, "Top-up");
    const creditData = await creditRes.json();
    const txnId = creditData.transaction.id;

    const res = await handleRequest(
      new Request(`https://test.local/api/receipt/${txnId}?uid=${TEST_UID}`, {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("RECEIPT");
    expect(text).toContain(`Transaction:  ${txnId}`);
    expect(text).toContain("1000 credits");
    expect(text).toContain("Reference:    Top-up");
    expect(text).toContain("Thank you!");
  });

  it("returns receipt without reference line when no note", async () => {
    const creditRes = await creditCard(replay, TEST_UID, 500, null);
    const creditData = await creditRes.json();
    const txnId = creditData.transaction.id;

    const res = await handleRequest(
      new Request(`https://test.local/api/receipt/${txnId}?uid=${TEST_UID}`, {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("Reference:");
  });

  it("returns receipt for a debit transaction with balance_after", async () => {
    await creditCard(replay, TEST_UID, 2000, null);
    const debitRes = await debitCard(replay, TEST_UID, 5, 750, "Payment");
    const debitData = await debitRes.json();
    const txnId = debitData.transaction.id;

    const res = await handleRequest(
      new Request(`https://test.local/api/receipt/${txnId}?uid=${TEST_UID}`, {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("750 credits");
    expect(text).toContain("1250 credits");
    expect(text).toContain("Balance:");
  });

  it("uses custom currency label", async () => {
    const customEnv = { ...env, CURRENCY_LABEL: "sats", CURRENCY_DECIMALS: "0" };
    const creditRes = await creditCard(replay, TEST_UID, 1000, null);
    const creditData = await creditRes.json();
    const txnId = creditData.transaction.id;

    const res = await handleRequest(
      new Request(`https://test.local/api/receipt/${txnId}?uid=${TEST_UID}`, {
        headers: { Cookie: "op_session=test" },
      }),
      customEnv,
    );
    const text = await res.text();
    expect(text).toContain("1000 sats");
  });

  it("requires operator auth", async () => {
    const noAuthEnv = { ...env };
    delete noAuthEnv.__TEST_OPERATOR_SESSION;
    const res = await handleRequest(
      new Request(`https://test.local/api/receipt/1?uid=${TEST_UID}`),
      noAuthEnv,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/operator/login");
  });
});
