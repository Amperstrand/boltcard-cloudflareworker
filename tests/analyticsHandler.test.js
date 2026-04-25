import { describe, it, expect, beforeEach } from "@jest/globals";
import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";

const TEST_UID = "04aabbccdd7788";

function makeEnv(replay = makeReplayNamespace({ [TEST_UID]: 1 })) {
  return {
    BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
    CARD_REPLAY: replay,
    ...TEST_OPERATOR_AUTH,
  };
}

async function recordTap(replay, uid, counter, amountMsat, status) {
  const id = replay.idFromName(uid.toLowerCase());
  const stub = replay.get(id);
  await stub.fetch(new Request("https://card-replay.internal/record-tap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ counterValue: counter, amountMsat, bolt11: "lnbc_test" }),
  }));
  if (status !== "pending") {
    await stub.fetch(new Request("https://card-replay.internal/update-tap-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counter, status }),
    }));
  }
}

describe("GET /experimental/analytics", () => {
  it("returns HTML analytics page", async () => {
    const res = await handleRequest(
      new Request("https://test.local/experimental/analytics", {
        headers: { Cookie: "op_session=test" },
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("ANALYTICS");
    expect(html).toContain("Card Lookup");
  });

  it("requires operator auth", async () => {
    const env = makeEnv();
    delete env.__TEST_OPERATOR_SESSION;
    const res = await handleRequest(
      new Request("https://test.local/experimental/analytics"),
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/operator/login");
  });
});

describe("GET /experimental/analytics/data", () => {
  let replay;

  beforeEach(() => {
    replay = makeReplayNamespace({ [TEST_UID]: 1 });
  });

  it("returns 400 when uid is missing", async () => {
    const res = await handleRequest(
      new Request("https://test.local/experimental/analytics/data", {
        headers: { Cookie: "op_session=test" },
      }),
      makeEnv(replay),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/missing uid/i);
  });

  it("returns zero analytics for card with no taps", async () => {
    const res = await handleRequest(
      new Request(`https://test.local/experimental/analytics/data?uid=${TEST_UID}`, {
        headers: { Cookie: "op_session=test" },
      }),
      makeEnv(replay),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totalTaps).toBe(0);
    expect(json.completedMsat).toBe(0);
    expect(json.failedMsat).toBe(0);
    expect(json.pendingMsat).toBe(0);
  });

  it("returns aggregated analytics for card with taps", async () => {
    await recordTap(replay, TEST_UID, 2, 1000, "completed");
    await recordTap(replay, TEST_UID, 3, 2000, "completed");
    await recordTap(replay, TEST_UID, 4, 500, "failed");

    const res = await handleRequest(
      new Request(`https://test.local/experimental/analytics/data?uid=${TEST_UID}`, {
        headers: { Cookie: "op_session=test" },
      }),
      makeEnv(replay),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totalTaps).toBe(3);
    expect(json.completedMsat).toBe(3000);
    expect(json.completedTaps).toBe(2);
    expect(json.failedMsat).toBe(500);
    expect(json.failedTaps).toBe(1);
  });

  it("includes pending taps in analytics", async () => {
    await recordTap(replay, TEST_UID, 2, 1000, "pending");

    const res = await handleRequest(
      new Request(`https://test.local/experimental/analytics/data?uid=${TEST_UID}`, {
        headers: { Cookie: "op_session=test" },
      }),
      makeEnv(replay),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totalTaps).toBe(1);
    expect(json.pendingMsat).toBe(1000);
    expect(json.pendingTaps).toBe(1);
  });

  it("requires operator auth", async () => {
    const env = makeEnv(replay);
    delete env.__TEST_OPERATOR_SESSION;
    const res = await handleRequest(
      new Request(`https://test.local/experimental/analytics/data?uid=${TEST_UID}`),
      env,
    );
    expect(res.status).toBe(302);
  });
});
