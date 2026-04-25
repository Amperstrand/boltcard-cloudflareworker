import { handleRefundApply, handleRefundPage } from "../handlers/refundHandler.js";
import { handleTopupApply, handleTopupPage } from "../handlers/topupHandler.js";
import { handlePosCharge } from "../handlers/posChargeHandler.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { creditCard } from "../replayProtection.js";
import { virtualTap, buildCardTestEnv } from "./testHelpers.js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function buildEnv(balance = 0) {
  return buildCardTestEnv({ uid: UID, issuerKey: ISSUER_KEY, balance });
}

function makeRequest(body, path = "/operator/test") {
  return new Request(`https://test.local${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "test" },
    body: JSON.stringify(body),
  });
}

describe("handleRefundPage", () => {
  it("returns HTML response", () => {
    const req = new Request("https://test.local/operator/refund");
    const res = handleRefundPage(req, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});

describe("handleRefundApply", () => {
  it("rejects invalid JSON body", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/operator/refund/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleRefundApply(req, env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });

  it("rejects missing amount for partial refund", async () => {
    const env = buildEnv(1000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const res = await handleRefundApply(makeRequest({ p: pHex, c: cHex }), env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });

  it("processes partial refund", async () => {
    const env = buildEnv(1000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const res = await handleRefundApply(makeRequest({ p: pHex, c: cHex, amount: 300 }), env, { shiftId: "test" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.amount).toBe(300);
    expect(body.balance).toBe(700);
    expect(body.note).toContain("refund:");
  });

  it("processes full refund", async () => {
    const env = buildEnv(1000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const res = await handleRefundApply(makeRequest({ p: pHex, c: cHex, fullRefund: true }), env, { shiftId: "test" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.amount).toBe(1000);
    expect(body.balance).toBe(0);
  });

  it("full refund on zero balance returns zero", async () => {
    const env = buildEnv(0);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 4, keys.k1, keys.k2);
    const res = await handleRefundApply(makeRequest({ p: pHex, c: cHex, fullRefund: true }), env, { shiftId: "test" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.amount).toBe(0);
  });

  it("rejects refund exceeding balance", async () => {
    const env = buildEnv(100);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 5, keys.k1, keys.k2);
    const res = await handleRefundApply(makeRequest({ p: pHex, c: cHex, amount: 500 }), env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid card tap", async () => {
    const env = buildEnv();
    const res = await handleRefundApply(makeRequest({ p: "", c: "", amount: 100 }), env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });
});

describe("handleTopupPage", () => {
  it("returns HTML response", () => {
    const req = new Request("https://test.local/operator/topup");
    const res = handleTopupPage(req, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});

describe("handleTopupApply", () => {
  it("rejects invalid JSON body", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/operator/topup/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleTopupApply(req, env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid amount", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const res = await handleTopupApply(makeRequest({ p: pHex, c: cHex, amount: -5 }), env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });

  it("tops up card balance", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const res = await handleTopupApply(makeRequest({ p: pHex, c: cHex, amount: 500 }), env, { shiftId: "test" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.amount).toBe(500);
    expect(body.balance).toBe(500);
    expect(body.note).toContain("topup:");
  });

  it("respects MAX_TOPUP_AMOUNT env var", async () => {
    const env = buildEnv();
    env.MAX_TOPUP_AMOUNT = "100";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const res = await handleTopupApply(makeRequest({ p: pHex, c: cHex, amount: 500 }), env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });

  it("allows top-up within MAX_TOPUP_AMOUNT", async () => {
    const env = buildEnv();
    env.MAX_TOPUP_AMOUNT = "1000";
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 4, keys.k1, keys.k2);
    const res = await handleTopupApply(makeRequest({ p: pHex, c: cHex, amount: 500 }), env, { shiftId: "test" });
    expect(res.status).toBe(200);
  });

  it("rejects invalid card tap", async () => {
    const env = buildEnv();
    const res = await handleTopupApply(makeRequest({ p: "", c: "", amount: 100 }), env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });
});

describe("handlePosCharge", () => {
  it("rejects invalid JSON body", async () => {
    const env = buildEnv();
    const req = new Request("https://test.local/operator/pos/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handlePosCharge(req, env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid amount", async () => {
    const env = buildEnv();
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const res = await handlePosCharge(makeRequest({ p: pHex, c: cHex, amount: -5 }), env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });

  it("charges card with sufficient balance", async () => {
    const env = buildEnv(1000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const res = await handlePosCharge(makeRequest({ p: pHex, c: cHex, amount: 300, terminalId: "pos-1" }), env, { shiftId: "test" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.amount).toBe(300);
    expect(body.balance).toBe(700);
    expect(body.note).toContain("pos:");
    expect(body.note).toContain("pos-1");
  });

  it("returns 402 for insufficient balance", async () => {
    const env = buildEnv(100);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 3, keys.k1, keys.k2);
    const res = await handlePosCharge(makeRequest({ p: pHex, c: cHex, amount: 500 }), env, { shiftId: "test" });
    expect(res.status).toBe(402);
  });

  it("includes items in note", async () => {
    const env = buildEnv(1000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const { pHex, cHex } = virtualTap(UID, 4, keys.k1, keys.k2);
    const items = [{ name: "beer", qty: 2 }];
    const res = await handlePosCharge(makeRequest({ p: pHex, c: cHex, amount: 200, items, terminalId: "bar" }), env, { shiftId: "test" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note).toContain("beer:2");
  });

  it("rejects invalid card tap", async () => {
    const env = buildEnv();
    const res = await handlePosCharge(makeRequest({ p: "", c: "", amount: 100 }), env, { shiftId: "test" });
    expect(res.status).toBe(400);
  });

  it("returns 402 when debitCard returns insufficient reason", async () => {
    const env = buildEnv(1000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const origGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    env.CARD_REPLAY.get = (id) => {
      const obj = origGet(id);
      return {
        fetch: async (request) => {
          const url = new URL(request.url);
          if (request.method === "POST" && url.pathname === "/debit") {
            return Response.json({ ok: false, reason: "Insufficient balance" });
          }
          return obj.fetch(request);
        },
      };
    };
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const res = await handlePosCharge(makeRequest({ p: pHex, c: cHex, amount: 300 }), env, { shiftId: "test" });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toContain("Insufficient balance");
  });

  it("returns 500 when debitCard returns non-insufficient failure", async () => {
    const env = buildEnv(1000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const origGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    env.CARD_REPLAY.get = (id) => {
      const obj = origGet(id);
      return {
        fetch: async (request) => {
          const url = new URL(request.url);
          if (request.method === "POST" && url.pathname === "/debit") {
            return Response.json({ ok: false, reason: "Unknown error" });
          }
          return obj.fetch(request);
        },
      };
    };
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const res = await handlePosCharge(makeRequest({ p: pHex, c: cHex, amount: 300 }), env, { shiftId: "test" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Unknown error");
  });

  it("returns 500 when getBalance throws", async () => {
    const env = buildEnv(1000);
    const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
    const origGet = env.CARD_REPLAY.get.bind(env.CARD_REPLAY);
    env.CARD_REPLAY.get = (id) => {
      const obj = origGet(id);
      return {
        fetch: async (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/balance") {
            throw new Error("DO connection failed");
          }
          return obj.fetch(request);
        },
      };
    };
    const { pHex, cHex } = virtualTap(UID, 2, keys.k1, keys.k2);
    const res = await handlePosCharge(makeRequest({ p: pHex, c: cHex, amount: 300 }), env, { shiftId: "test" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("DO connection failed");
  });
});
