import { handleRefundApply, handleRefundPage } from "../handlers/refundHandler.js";
import { handleTopupApply, handleTopupPage } from "../handlers/topupHandler.js";
import { handlePosCharge } from "../handlers/posChargeHandler.js";
import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { creditCard } from "../replayProtection.js";
import aesjs from "aes-js";

const UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function virtualTap(uidHex, counter, k1Hex, k2Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xc7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));
  const ctrHex = bytesToHex(new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]));
  const vd = buildVerificationData(uid, hexToBytes(ctrHex), hexToBytes(k2Hex));
  const cHex = bytesToHex(vd.ct);
  return { pHex, cHex };
}

function buildEnv(balance = 0) {
  const keys = getDeterministicKeys(UID, { ISSUER_KEY }, 1);
  const replay = makeReplayNamespace();
  replay.__activate(UID, 1);
  replay.__cardConfigs.set(UID, { K2: keys.k2, payment_method: "fakewallet" });
  if (balance > 0) {
    replay.__cardStates.get(UID).balance = balance;
  }
  return {
    ISSUER_KEY,
    BOLT_CARD_K1: keys.k1,
    CARD_REPLAY: replay,
    UID_CONFIG: { get: async () => null, put: async () => {} },
  };
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
});
