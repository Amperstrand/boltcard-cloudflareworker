import { describe, it, expect, beforeEach } from "vitest";
import { handlePosCharge } from "../handlers/posChargeHandler.js";
import { buildCardTestEnv, virtualTap, TEST_OPERATOR_AUTH, type TestEnv } from "./testHelpers.js";
import { getDeterministicKeys } from "../keygenerator.js";

const UID = "04a39493cc8680";
const BASE_URL = "https://boltcardpoc.psbt.me";
const CHARGE_URL = `${BASE_URL}/operator/pos/charge`;
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

function makeChargeRequest(body: Record<string, unknown>): Request {
  return new Request(CHARGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── handlePosCharge ─────────────────────────────────────────────

describe("handlePosCharge", () => {
  it("success: valid tap + amount debits card and returns correct response", async () => {
    env = makeEnvWithBalance(10000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: 2000 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(2000);
    expect(json.balance).toBe(8000);
    expect(json.txnId).toBeDefined();
  });

  it("rejects GET with 405", async () => {
    env = makeEnvWithBalance(1000);
    const req = new Request(CHARGE_URL, { method: "GET" });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(405);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(false);
  });

  it("rejects missing p param with 400", async () => {
    env = makeEnvWithBalance(1000);
    const req = makeChargeRequest({ c: "0000000000000000", amount: 100 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects missing c param with 400", async () => {
    env = makeEnvWithBalance(1000);
    const req = makeChargeRequest({ p: "a".repeat(32), amount: 100 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects invalid JSON body with 400", async () => {
    env = makeEnvWithBalance(1000);
    const req = new Request(CHARGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects zero amount with 400", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: 0 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects negative amount with 400", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: -500 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects non-integer string amount with 400", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: "xyz" });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(400);
  });

  it("rejects insufficient balance with 402 and currentBalance", async () => {
    env = makeEnvWithBalance(500);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: 1000 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(402);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(false);
    expect(json.currentBalance).toBe(500);
  });

  it("rejects terminated card with 403", async () => {
    env = makeEnvWithBalance(1000);
    env.CARD_REPLAY.__cardStates.get(UID.toLowerCase())!.state = "terminated";
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: 100 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(403);
  });

  it("rejects wrong CMAC with 403", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: "badcmac00000000", amount: 100 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(403);
  });

  it("success with items array — note includes item info", async () => {
    env = makeEnvWithBalance(5000);
    const { pHex, cHex } = tapParams(++counter, env);
    const items = [
      { name: "Coffee", price: 300, qty: 2 },
      { name: "Bagel", price: 200, qty: 1 },
    ];
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: 800, items });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    const note = json.note as string;
    expect(note).toContain("Coffee:2");
    expect(note).toContain("Bagel:1");
  });

  it("success with terminalId — note includes terminalId", async () => {
    env = makeEnvWithBalance(5000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({
      p: pHex,
      c: cHex,
      amount: 500,
      terminalId: "terminal-42",
    });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    const note = json.note as string;
    expect(note).toContain("terminal-42");
  });

  it("defaults terminalId to 'unknown' in note", async () => {
    env = makeEnvWithBalance(5000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: 500 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    const note = json.note as string;
    expect(note).toContain("unknown");
  });

  it("drains balance to zero with exact amount", async () => {
    env = makeEnvWithBalance(1000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: 1000 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.balance).toBe(0);
  });

  it("handles amount as numeric string", async () => {
    env = makeEnvWithBalance(3000);
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: "1000" });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json.amount).toBe(1000);
    expect(json.balance).toBe(2000);
  });

  it("rejects amount exceeding MAX_TOPUP_AMOUNT when set", async () => {
    env = makeEnvWithBalance(50000);
    (env as Record<string, unknown>).MAX_TOPUP_AMOUNT = "1000";
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: 5000 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(false);
    expect(json.error).toContain("exceeds maximum");
  });

  it("allows charge at exactly MAX_TOPUP_AMOUNT", async () => {
    env = makeEnvWithBalance(5000);
    (env as Record<string, unknown>).MAX_TOPUP_AMOUNT = "1000";
    const { pHex, cHex } = tapParams(++counter, env);
    const req = makeChargeRequest({ p: pHex, c: cHex, amount: 1000 });
    const resp = await handlePosCharge(req, env, session);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
  });
});
