import { describe, test, expect, beforeEach } from "vitest";
import { VirtualCard } from "../helpers/virtualCard.js";
import { getDeterministicKeys } from "../../keygenerator.js";
import type { Env } from "../../types/core.js";

describe("E2E: Cardholder self-service", () => {
  describe("Card lock", () => {
    let card: VirtualCard;

    beforeEach(async () => {
      card = await VirtualCard.createProvisioned();
      await card.credit(5000);
    });

    test("locks active card via NFC tap", async () => {
      const resp = await card.lock();
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.success).toBe(true);
      expect(json.state).toBe("terminated");
      expect(await card.getCardState()).toBe("terminated");
    });

    test("locked card cannot be tapped (403 at tap stage)", async () => {
      await card.lock();
      const { response } = await card.tapRequest();
      expect(response.status).toBe(403);
    });

    test("locked card balance is preserved", async () => {
      await card.lock();
      expect(await card.getBalance()).toBe(5000);
    });

    test("rejects lock on already terminated card", async () => {
      await card.lock();
      const resp = await card.lock();
      expect(resp.status).toBe(400);
    });

    test("rejects lock on new card (state='new')", async () => {
      const rawCard = VirtualCard.createRaw();
      const keys = getDeterministicKeys(
        rawCard.uid,
        { ISSUER_KEY: rawCard.issuerKey } as unknown as Env,
        1
      );
      rawCard.keys = keys;
      rawCard.version = 1;

      const resp = await rawCard.lock();
      expect(resp.status).toBe(400);
    });

    test("invalid CMAC rejected on lock", async () => {
      const { pHex } = card.tap();
      const resp = await card.request("/api/card/lock", "POST", {
        p: pHex,
        c: "00000000000000000000000000000000",
      });
      expect(resp.status).toBe(403);
    });

    test("missing p/c parameters rejected", async () => {
      const resp = await card.request("/api/card/lock", "POST", {});
      expect(resp.status).toBe(400);
    });
  });

  describe("Card reactivate", () => {
    let card: VirtualCard;

    beforeEach(async () => {
      card = await VirtualCard.createProvisioned();
      await card.credit(5000);
    });

    test("reactivates terminated card via NFC tap", async () => {
      await card.lock();
      expect(await card.getCardState()).toBe("terminated");

      const resp = await card.reactivate();
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.success).toBe(true);
      expect(json.state).toBe("keys_delivered");
      expect(json.version as number).toBeGreaterThan(card.version - 1);
    });

    test("reactivated card gets new version", async () => {
      const originalVersion = card.version;
      await card.lock();
      const resp = await card.reactivate();
      const json = await resp.json() as Record<string, unknown>;
      expect(json.version as number).toBeGreaterThan(originalVersion);
    });

    test("reactivate preserves balance", async () => {
      await card.lock();
      expect(await card.getBalance()).toBe(5000);

      await card.reactivate();
      expect(await card.getBalance()).toBe(5000);
    });

    test("rejects reactivate on active card", async () => {
      const resp = await card.reactivate();
      expect(resp.status).toBe(400);
    });

    test("full lock-reactivate-activate-pay cycle", async () => {
      await card.operatorTopup(10000);
      expect(await card.getBalance()).toBe(15000);

      await card.lock();
      expect(await card.getCardState()).toBe("terminated");

      const reactivateResp = await card.reactivate();
      const json = await reactivateResp.json() as Record<string, unknown>;
      const newVersion = json.version as number;

      const newKeys = getDeterministicKeys(card.uid, card.env, newVersion);
      card.keys = newKeys;
      card.version = newVersion;
      await card.activateViaDO(newVersion);

      const uid = card.uid.toLowerCase();
      card.env.CARD_REPLAY.__cardConfigs.set(uid, {
        K2: newKeys.k2,
        payment_method: "fakewallet",
      });

      const { cbResp } = await card.fullPayment(3000);
      expect(cbResp.status).toBe(200);
      expect(await card.getBalance()).toBe(12000);
    });
  });
});
