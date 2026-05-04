import { describe, test, expect, beforeEach } from "vitest";
import { VirtualCard } from "../helpers/virtualCard.js";

describe("E2E: Operator flows", () => {
  describe("Top-up", () => {
    let card: VirtualCard;

    beforeEach(async () => {
      card = await VirtualCard.createProvisioned();
    });

    test("tops up card with valid tap and amount", async () => {
      expect(await card.getBalance()).toBe(0);

      const resp = await card.operatorTopup(5000);
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.success).toBe(true);
      expect(json.amount).toBe(5000);
      expect(json.balance).toBe(5000);
      expect(await card.getBalance()).toBe(5000);
    });

    test("multiple top-ups accumulate balance", async () => {
      await card.operatorTopup(1000);
      await card.operatorTopup(2000);
      await card.operatorTopup(3000);
      expect(await card.getBalance()).toBe(6000);
    });

    test("rejects zero amount", async () => {
      const resp = await card.operatorTopup(0);
      expect(resp.status).toBe(400);
      expect(await card.getBalance()).toBe(0);
    });

    test("rejects negative amount", async () => {
      const resp = await card.operatorTopup(-100);
      expect(resp.status).toBe(400);
    });

    test("rejects non-integer amount", async () => {
      const { pHex, cHex } = card.tap();
      const resp = await card.request("/operator/topup/apply", "POST", {
        p: pHex,
        c: cHex,
        amount: "abc",
      });
      expect(resp.status).toBe(400);
    });

    test("records transaction in history", async () => {
      await card.operatorTopup(1000);
      const txns = await card.getTransactions();
      expect(txns.length).toBeGreaterThanOrEqual(1);
      const topup = txns.find((t) => t.amount === 1000);
      expect(topup).toBeDefined();
      expect(topup!.note).toContain("topup");
    });
  });

  describe("Refund", () => {
    let card: VirtualCard;

    beforeEach(async () => {
      card = await VirtualCard.createProvisioned();
      await card.credit(10000);
    });

    test("partial refund reduces balance", async () => {
      const resp = await card.operatorRefund(3000);
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.success).toBe(true);
      expect(json.amount).toBe(3000);
      expect(json.balance).toBe(7000);
      expect(await card.getBalance()).toBe(7000);
    });

    test("full refund drains balance to zero", async () => {
      const resp = await card.operatorRefund(0, true);
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.amount).toBe(10000);
      expect(json.balance).toBe(0);
      expect(await card.getBalance()).toBe(0);
    });

    test("full refund on zero balance returns zero", async () => {
      const uid = card.uid.toLowerCase();
      const state = card.env.CARD_REPLAY.__cardStates.get(uid);
      state!.balance = 0;

      const resp = await card.operatorRefund(0, true);
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.amount).toBe(0);
    });

    test("rejects refund exceeding balance", async () => {
      const resp = await card.operatorRefund(20000);
      expect(resp.status).toBe(400);
      expect(await card.getBalance()).toBe(10000);
    });

    test("rejects zero amount partial refund", async () => {
      const resp = await card.operatorRefund(0, false);
      expect(resp.status).toBe(400);
    });

    test("records refund transaction", async () => {
      await card.operatorRefund(1000);
      const txns = await card.getTransactions();
      const refund = txns.find((t) => t.amount === -1000);
      expect(refund).toBeDefined();
      expect(refund!.note).toContain("refund");
    });
  });

  describe("POS charge", () => {
    let card: VirtualCard;

    beforeEach(async () => {
      card = await VirtualCard.createProvisioned();
      await card.credit(10000);
    });

    test("charges card with sufficient balance", async () => {
      const resp = await card.operatorPosCharge(3000);
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.success).toBe(true);
      expect(json.amount).toBe(3000);
      expect(json.balance).toBe(7000);
      expect(json.note).toContain("pos");
    });

    test("charges exact balance (drains to zero)", async () => {
      const resp = await card.operatorPosCharge(10000);
      expect(resp.status).toBe(200);
      expect(await card.getBalance()).toBe(0);
    });

    test("rejects charge exceeding balance", async () => {
      const resp = await card.operatorPosCharge(20000);
      expect(resp.status).toBe(402);
      expect(await card.getBalance()).toBe(10000);
    });

    test("rejects zero amount", async () => {
      const resp = await card.operatorPosCharge(0);
      expect(resp.status).toBe(400);
    });

    test("includes items in transaction note", async () => {
      const items = [
        { name: "coffee", qty: 2 },
        { name: "bagel", qty: 1 },
      ];
      const resp = await card.operatorPosCharge(1500, items);
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.note).toContain("coffee:2");
      expect(json.note).toContain("bagel:1");
    });

    test("uses custom terminal ID", async () => {
      const resp = await card.operatorPosCharge(500, undefined, "bar-42");
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.note).toContain("bar-42");
    });

    test("returns transaction ID", async () => {
      const resp = await card.operatorPosCharge(1000);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.txnId).toBeDefined();
      expect(json.txnId).not.toBeNull();
    });
  });

  describe("Combined operator session", () => {
    let card: VirtualCard;

    beforeEach(async () => {
      card = await VirtualCard.createProvisioned();
    });

    test("full session: topup → charge → refund → verify balance", async () => {
      await card.operatorTopup(10000);
      expect(await card.getBalance()).toBe(10000);

      await card.operatorPosCharge(3500);
      expect(await card.getBalance()).toBe(6500);

      await card.operatorRefund(500);
      expect(await card.getBalance()).toBe(6000);

      await card.operatorPosCharge(6000);
      expect(await card.getBalance()).toBe(0);
    });

    test("topup after full drain restores balance", async () => {
      await card.operatorTopup(5000);
      await card.operatorPosCharge(5000);
      expect(await card.getBalance()).toBe(0);

      await card.operatorTopup(10000);
      expect(await card.getBalance()).toBe(10000);
    });
  });
});
