import { describe, it, expect, beforeEach } from "vitest";
import { handleRefundPage, handleRefundApply } from "../handlers/refundHandler.js";
import { buildCardTestEnv, virtualTap, TEST_OPERATOR_AUTH, type TestEnv } from "./testHelpers.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { MAX_BALANCE } from "../utils/constants.js";

const UID = "04a39493cc8680";
const BASE_URL = "https://boltcardpoc.psbt.me";
const REFUND_URL = `${BASE_URL}/operator/refund`;
const APPLY_URL = `${BASE_URL}/operator/refund/apply`;
const session = TEST_OPERATOR_AUTH.__TEST_OPERATOR_SESSION;

let env: TestEnv;
let counter: number;

beforeEach(() => {
  counter = 1;
});

function makeEnvWithBalance(balance: number): TestEnv {
  return buildCardTestEnv({ uid: UID, balance, operatorAuth: true });
}

function tapParams(ctr: number, testEnv: TestEnv) {
  const k1Hex = testEnv.BOLT_CARD_K1!.split(",")[0]!;
  const keys = getDeterministicKeys(UID, testEnv, 1);
  return virtualTap(UID, ctr, k1Hex, keys.k2);
}

function makeApplyRequest(body: Record<string, unknown>): Request {
  return new Request(APPLY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── handleRefundPage ─────────────────────────────────────────────

describe("handleRefundPage", () => {
  it("returns 200 with HTML containing Refund keyword", async () => {
    env = makeEnvWithBalance(0);
    const req = new Request(REFUND_URL);
    const resp = handleRefundPage(req, env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/html");
    const body = await resp.text();
    expect(body).toMatch(/refund/i);
  });

  it("includes currency label from env", async () => {
    env = buildCardTestEnv({
      uid: UID,
      balance: 0,
      operatorAuth: true,
      extraEnv: { CURRENCY_LABEL: "GBP" },
    });
    const req = new Request(REFUND_URL);
    const resp = handleRefundPage(req, env);
    const body = await resp.text();
    expect(body).toContain("GBP");
  });
});

// ─── handleRefundApply ─────────────────────────────────────────────

describe("handleRefundApply", () => {
  it("success: partial refund credits card and returns correct response", async () => {
    env = makeEnvWithBalance(5000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 2000 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(2000);
    expect(json.balance).toBe(7000);
  });

  it("success: full refund credits entire balance on top", async () => {
    env = makeEnvWithBalance(7500);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, fullRefund: true });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(7500);
    expect(json.balance).toBe(15000);
  });

  it("full refund with zero balance returns amount 0", async () => {
    env = makeEnvWithBalance(0);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, fullRefund: true });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(0);
  });

  it("rejects GET with 405", async () => {
    env = makeEnvWithBalance(0);
    const req = new Request(APPLY_URL, { method: "GET" });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(405);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(false);
  });

  it("rejects missing p param with 400", async () => {
    env = makeEnvWithBalance(1000);
    const req = makeApplyRequest({ c: "0000000000000000", amount: 100 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects missing c param with 400", async () => {
    env = makeEnvWithBalance(1000);
    const req = makeApplyRequest({ p: "a".repeat(32), amount: 100 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects invalid JSON body with 400", async () => {
    env = makeEnvWithBalance(1000);
    const req = new Request(APPLY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects invalid amount for partial refund with 400", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 0 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects negative amount for partial refund with 400", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: -100 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects non-integer string amount for partial refund with 400", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: "abc" });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects terminated card with 403", async () => {
    env = makeEnvWithBalance(1000);
    env.CARD_REPLAY.__cardStates.get(UID.toLowerCase())!.state = "terminated";
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 500 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(403);
  });

  it("rejects wrong CMAC with 403", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: "badcmac00000000", amount: 500 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(403);
  });

  it("refund always succeeds regardless of amount (credits, not debits)", async () => {
    env = makeEnvWithBalance(500);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 1000 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(1000);
    expect(json.balance).toBe(1500);
  });

  it("returns note with shiftId from session", async () => {
    env = makeEnvWithBalance(2000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 500 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.note).toContain(session.shiftId);
  });

  it("handles amount as numeric string", async () => {
    env = makeEnvWithBalance(3000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: "1000" });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(1000);
    expect(json.balance).toBe(4000);
  });

  it("partial refund ignores fullRefund when false", async () => {
    env = makeEnvWithBalance(5000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 2000, fullRefund: false });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(2000);
    expect(json.balance).toBe(7000);
  });

  it("rejects partial refund that would exceed MAX_BALANCE", async () => {
    env = makeEnvWithBalance(MAX_BALANCE - 100);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 500 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(500);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(false);
  });

  it("allows partial refund that brings balance to exactly MAX_BALANCE", async () => {
    env = makeEnvWithBalance(MAX_BALANCE - 100);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 100 });
    const resp = await handleRefundApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.balance).toBe(MAX_BALANCE);
  });
});
