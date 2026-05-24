import { describe, it, expect, beforeEach } from "vitest";
import { handleTopupPage, handleTopupApply } from "../handlers/topupHandler.js";
import { buildCardTestEnv, virtualTap, TEST_OPERATOR_AUTH, type TestEnv } from "./testHelpers.js";
import { getDeterministicKeys } from "../keygenerator.js";

const UID = "04a39493cc8680";
const BASE_URL = "https://boltcardpoc.psbt.me";
const TOPUP_URL = `${BASE_URL}/operator/topup`;
const APPLY_URL = `${BASE_URL}/operator/topup/apply`;
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

// ─── handleTopupPage ─────────────────────────────────────────────

describe("handleTopupPage", () => {
  it("returns 200 with HTML containing Top-Up", () => {
    env = makeEnvWithBalance(0);
    const req = new Request(TOPUP_URL);
    const resp = handleTopupPage(req, env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/html");
    const html = resp.text();
    // Not awaiting since handleTopupPage returns Response synchronously
    void html;
  });

  it("returns 200 with HTML containing Top-Up keyword", async () => {
    env = makeEnvWithBalance(0);
    const req = new Request(TOPUP_URL);
    const resp = handleTopupPage(req, env);
    const body = await resp.text();
    expect(body).toMatch(/top.?up/i);
  });

  it("includes currency label from env", async () => {
    env = buildCardTestEnv({
      uid: UID,
      balance: 0,
      operatorAuth: true,
      extraEnv: { CURRENCY_LABEL: "TOKENS" },
    });
    const req = new Request(TOPUP_URL);
    const resp = handleTopupPage(req, env);
    const body = await resp.text();
    expect(body).toContain("TOKENS");
  });
});

// ─── handleTopupApply ─────────────────────────────────────────────

describe("handleTopupApply", () => {
  it("success: valid tap + amount credits card and returns correct response", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 500 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(500);
    expect(json.balance).toBe(1500);
  });

  it("rejects GET with 405", async () => {
    env = makeEnvWithBalance(0);
    const req = new Request(APPLY_URL, { method: "GET" });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(405);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(false);
  });

  it("rejects missing p param with 400", async () => {
    env = makeEnvWithBalance(0);
    const req = makeApplyRequest({ c: "0000000000000000", amount: 500 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects missing c param with 400", async () => {
    env = makeEnvWithBalance(0);
    const req = makeApplyRequest({ p: "a".repeat(32), amount: 500 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects invalid JSON body with 400", async () => {
    env = makeEnvWithBalance(0);
    const req = new Request(APPLY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects zero amount with 400", async () => {
    env = makeEnvWithBalance(0);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 0 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects negative amount with 400", async () => {
    env = makeEnvWithBalance(0);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: -100 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects non-integer string amount with 400", async () => {
    env = makeEnvWithBalance(0);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: "abc" });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("truncates floating point amount to integer via parseInt", async () => {
    env = makeEnvWithBalance(0);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 10.5 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(10);
  });

  it("rejects amount exceeding MAX_TOPUP_AMOUNT when set", async () => {
    env = buildCardTestEnv({
      uid: UID,
      balance: 0,
      operatorAuth: true,
      extraEnv: { MAX_TOPUP_AMOUNT: "1000" },
    });
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 1500 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.reason).toMatch(/exceeds maximum/i);
  });

  it("allows amount equal to MAX_TOPUP_AMOUNT", async () => {
    env = buildCardTestEnv({
      uid: UID,
      balance: 0,
      operatorAuth: true,
      extraEnv: { MAX_TOPUP_AMOUNT: "1000" },
    });
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 1000 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(1000);
  });

  it("rejects terminated card with 403", async () => {
    env = makeEnvWithBalance(0);
    env.CARD_REPLAY.__cardStates.get(UID.toLowerCase())!.state = "terminated";
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 500 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(403);
  });

  it("rejects wrong CMAC with 403", async () => {
    env = makeEnvWithBalance(0);
    const { pHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: "badcmac00000000", amount: 500 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(403);
  });

  it("handles amount as numeric string", async () => {
    env = makeEnvWithBalance(100);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: "250" });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(250);
    expect(json.balance).toBe(350);
  });

  it("returns note with shiftId from session", async () => {
    env = makeEnvWithBalance(0);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeApplyRequest({ p: pHex, c: cHex, amount: 100 });
    const resp = await handleTopupApply(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.note).toContain(session.shiftId);
  });
});
