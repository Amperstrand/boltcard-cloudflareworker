import { describe, test, expect, beforeEach, vi } from "vitest";
import { VirtualCard } from "../helpers/virtualCard.js";
import { getDeterministicKeys } from "../../keygenerator.js";

describe("Virtual Card — Full Lifecycle Scenarios", () => {
  describe("Fakewallet: provision → topup → pay → check balance → wipe → re-provision", () => {
    let card: VirtualCard;

    beforeEach(async () => {
      card = await VirtualCard.createProvisioned();
      await card.credit(100000);
    });

    test("complete happy path lifecycle", async () => {
      expect(await card.getCardState()).toBe("active");
      expect(await card.getBalance()).toBe(100000);

      for (let i = 0; i < 5; i++) {
        const { cbResp } = await card.fullPayment(1000);
        expect(cbResp.status).toBe(200);
      }

      expect(await card.getBalance()).toBe(95000);
      expect(card.counter).toBe(5);

      const wipeResp = await card.wipe();
      expect(wipeResp.status).toBe(200);
      expect(await card.getCardState()).toBe("terminated");

      const { response: blocked } = await card.tapRequest(6);
      expect(blocked.status).toBe(403);

      const result = await card.provision();
      expect(result.version).toBe(2);
      await card.activateViaDO(2);

      await card.credit(50000);
      const { cbResp: newPay } = await card.fullPayment(5000);
      expect(newPay.status).toBe(200);
    });

    test("drain card to zero balance", async () => {
      const { cbResp } = await card.fullPayment(100000);
      expect(cbResp.status).toBe(200);
      expect(await card.getBalance()).toBe(0);

      // Next payment attempt should fail (insufficient balance)
      const { cbResp: over } = await card.fullPayment(1);
      expect([400, 402, 500]).toContain(over.status);
    });

    test("incrementing counters across multiple sessions", async () => {
      for (let i = 0; i < 3; i++) {
        const { cbResp } = await card.fullPayment(1000);
        expect(cbResp.status).toBe(200);
      }
      expect(card.counter).toBe(3);

      for (let i = 0; i < 4; i++) {
        const { cbResp } = await card.fullPayment(1000);
        expect(cbResp.status).toBe(200);
      }
      expect(card.counter).toBe(7);
      expect(await card.getBalance()).toBe(100000 - 7000);
    });

    test("replay attack is rejected with 409 to prevent double-debit", async () => {
      const { pHex, cHex } = card.tap(1);
      const tap1 = await card.request(`/?p=${pHex}&c=${cHex}`);
      expect(tap1.status).toBe(200);

      const cb1 = await card.callback(pHex, cHex, "lnbc10n1test", "10000");
      expect(cb1.status).toBe(200);

      const tapReplay = await card.request(`/?p=${pHex}&c=${cHex}`);
      expect(tapReplay.status).toBe(200);

      const cbReplay = await card.callback(pHex, cHex, "lnbc10n1test", "10000");
      expect(cbReplay.status).toBe(409);
    });

    test("rapid sequential payments", async () => {
      const promises = [];
      for (let i = 1; i <= 10; i++) {
        const { pHex, cHex } = card.tap(i);
        const promise = card.callback(pHex, cHex, `lnbc10n1rapid${i}`, "1000");
        promises.push(promise);
      }
      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.status === 200).length;
      const conflicts = results.filter((r) => r.status === 409).length;
      expect(successes + conflicts).toBe(10);
      expect(successes).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Auto-discovery lifecycle", () => {
    test("unknown card → first tap → discovered → callback → second tap", async () => {
      const card = await VirtualCard.createDiscovered();

      expect(card.env.CARD_REPLAY.__cardStates.has(card.uid)).toBe(false);

      const { response: tap1, json: json1 } = await card.tapRequest(1);
      expect(tap1.status).toBe(200);
      expect(json1.tag).toBe("withdrawRequest");

      expect(await card.getCardState()).toBe("discovered");

      await card.credit(50000);
      const { pHex, cHex } = card.tap(1);
      const cb = await card.callback(pHex, cHex, "lnbc10n1discovered", "10000");
      expect(cb.status).toBe(200);

      const { response: tap2 } = await card.tapRequest(2);
      expect(tap2.status).toBe(200);

      const { response: replay } = await card.tapRequest(1);
      expect(replay.status).toBe(200);
    });
  });

  describe("POS (LNURL-pay) lifecycle", () => {
    let card: VirtualCard;
    let originalFetch: typeof global.fetch;

    beforeEach(async () => {
      originalFetch = global.fetch;
      global.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes(".well-known/lnurlp")) {
          return new Response(
            JSON.stringify({
              callback: "https://getalby.com/lnurlp/test/callback",
              tag: "payRequest",
              minSendable: 1000,
              maxSendable: 100000000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("callback") && urlStr.includes("amount=")) {
          return new Response(
            JSON.stringify({ pr: "lnbc10n1posinvoice", routes: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      card = await VirtualCard.createProvisioned({
        cardType: "pos",
        lightningAddress: "test@getalby.com",
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test("POS tap returns payRequest, callback returns invoice", async () => {
      const { response: tapResp, json: tapJson, pHex, cHex } = await card.tapRequest(1);
      expect(tapResp.status).toBe(200);
      expect(tapJson.tag).toBe("payRequest");
      expect(tapJson.minSendable).toBe(1000);

      const cbResp = await card.lnurlPayCallback(pHex, cHex, 1000);
      expect(cbResp.status).toBe(200);
      const cbJson = (await cbResp.json()) as Record<string, unknown>;
      expect(cbJson.pr).toBe("lnbc10n1posinvoice");
    });

    test("POS replay callback continues while replay enforcement is disabled", async () => {
      const { pHex, cHex } = card.tap(1);
      const cb1 = await card.lnurlPayCallback(pHex, cHex, 1000);
      expect(cb1.status).toBe(200);

      const cb2 = await card.lnurlPayCallback(pHex, cHex, 1000);
      expect(cb2.status).toBe(200);
    });
  });

  describe("Card state transitions", () => {
    test("active card can be tapped", async () => {
      const card = await VirtualCard.createProvisioned();
      await card.credit(50000);
      const { response } = await card.tapRequest(1);
      expect(response.status).toBe(200);
    });

    test("terminated card tap is rejected", async () => {
      const card = await VirtualCard.createProvisioned();
      card.setCardState("terminated");
      const { response } = await card.tapRequest(1);
      expect(response.status).toBe(403);
    });

    test("keys_delivered card auto-activates on first tap", async () => {
      const card = VirtualCard.createRaw();
      const replay = card.env.CARD_REPLAY;
      const uid = card.uid.toLowerCase();

      replay.__cardStates.set(uid, {
        state: "keys_delivered",
        latest_issued_version: 1,
        active_version: null,
        activated_at: null,
        terminated_at: null,
        keys_delivered_at: Math.floor(Date.now() / 1000),
        wipe_keys_fetched_at: null,
        balance: 0,
      });

      const keys = getDeterministicKeys(card.uid, { ISSUER_KEY: card.issuerKey } as any, 1);
      card.keys = keys;
      card.version = 1;

      replay.__cardConfigs.set(uid, { K2: keys.k2, payment_method: "fakewallet" });

      const { response } = await card.tapRequest(1);
      expect([200, 409]).toContain(response.status);
    });
  });

  describe("Multi-card scenarios", () => {
    test("two independent cards can pay simultaneously", async () => {
      const card1 = await VirtualCard.createProvisioned();
      const card2 = await VirtualCard.createProvisioned();
      await card1.credit(50000);
      await card2.credit(50000);

      const { cbResp: pay1 } = await card1.fullPayment(1000);
      const { cbResp: pay2 } = await card2.fullPayment(2000);

      expect(pay1.status).toBe(200);
      expect(pay2.status).toBe(200);
      expect(await card1.getBalance()).toBe(49000);
      expect(await card2.getBalance()).toBe(48000);
    });
  });

  describe("Edge cases", () => {
    test("zero balance card can still tap (returns withdrawRequest)", async () => {
      const card = await VirtualCard.createProvisioned();
      const { json } = await card.tapRequest(1);
      expect(json.tag).toBe("withdrawRequest");
    });

    test("card with no DO state falls back to deterministic keys", async () => {
      const card = await VirtualCard.createDiscovered();
      const { response } = await card.tapRequest(1);
      expect([200, 409]).toContain(response.status);
    });

    test("very high counter value works correctly", async () => {
      const card = await VirtualCard.createProvisioned();
      await card.credit(1000000);
      card.counter = 999;
      const { cbResp } = await card.fullPayment(1000);
      expect(cbResp.status).toBe(200);
      expect(card.counter).toBe(1000);
    });
  });

  describe("Version migration", () => {
    test("v1 card → wipe → re-provision v2 → old keys rejected", async () => {
      const card = await VirtualCard.createProvisioned();
      await card.credit(10000);
      const v1K2 = card.keys.k2;

      await card.wipe();
      expect(await card.getCardState()).toBe("terminated");

      const result = await card.provision();
      expect(result.version).toBe(2);
      const v2K2 = result.keys.k2;
      expect(v2K2).not.toBe(v1K2);

      await card.activateViaDO(2);
      await card.credit(5000);

      const { response: goodTap } = await card.tapRequest(1);
      expect(goodTap.status).toBe(200);

      const oldKeys = { ...card.keys, k2: v1K2 };
      card.keys = oldKeys;
      card.version = 1;
      const { response: oldKeyTap } = await card.tapRequest(2);
      expect(oldKeyTap.status).toBe(403);
    });
  });

  describe("Batch operations", () => {
    test("terminate cards via batch endpoint using shared DO namespace", async () => {
      const card1 = await VirtualCard.createProvisioned();
      const card2 = await VirtualCard.createProvisioned();
      const card3 = await VirtualCard.createProvisioned();

      await card1.credit(1000);
      await card2.credit(2000);
      await card3.credit(3000);

      const resp = await card1.request("/operator/cards/batch", "POST", {
        action: "terminate",
        uids: [card1.uid],
      });

      expect(resp.status).toBe(200);
      const json = (await resp.json()) as Record<string, unknown>;
      expect(json.results).toBeDefined();

      expect(await card1.getCardState()).toBe("terminated");

      const resp2 = await card2.request("/operator/cards/batch", "POST", {
        action: "terminate",
        uids: [card2.uid],
      });
      expect(resp2.status).toBe(200);
      expect(await card2.getCardState()).toBe("terminated");

      expect(await card3.getCardState()).toBe("active");
    });
  });

  describe("Balance across wipe cycle", () => {
    test("balance persists across terminate → re-provision → activate", async () => {
      const card = await VirtualCard.createProvisioned();
      await card.credit(5000);

      await card.wipe();
      expect(await card.getCardState()).toBe("terminated");
      expect(await card.getBalance()).toBe(5000);

      const result = await card.provision();
      await card.activateViaDO(result.version);

      expect(await card.getBalance()).toBe(5000);
    });
  });
});
