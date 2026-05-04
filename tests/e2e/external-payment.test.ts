import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { VirtualCard } from "../helpers/virtualCard.js";

describe("E2E: External payment modes", () => {
  describe("CLN REST payment", () => {
    let card: VirtualCard;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(async () => {
      card = await VirtualCard.createProvisioned();

      const uid = card.uid.toLowerCase();
      card.env.CARD_REPLAY.__cardConfigs.set(uid, {
        K2: card.keys.k2,
        payment_method: "clnrest",
        clnrest: {
          host: "https://cln.example.com",
          rune: "test-rune-token",
        },
      });

      originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (urlOrReq, opts) => {
        const urlStr = typeof urlOrReq === "string" ? urlOrReq : urlOrReq instanceof Request ? urlOrReq.url : String(urlOrReq);
        if (urlStr.includes("cln.example.com")) {
          return new Response(
            JSON.stringify({ status: "complete", payment_preimage: "abc123" }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(urlOrReq, opts);
      }) as any;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("CLN REST success path: tap → callback → CLN pay → completed", async () => {
      const { response: tapResp, json: tapJson, pHex, cHex } = await card.tapRequest(1);
      expect(tapResp.status).toBe(200);
      expect(tapJson.tag).toBe("withdrawRequest");

      const invoice = "lnbc10n1clntestinvoice";
      const cbResp = await card.callback(pHex, cHex, invoice, "10000");
      expect(cbResp.status).toBe(200);
      const cbJson = await cbResp.json() as Record<string, unknown>;
      expect(cbJson.status).toBe("OK");
    });

    test("CLN REST error response (non-201) returns upstream status", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({ status: "error", message: "insufficient balance" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const { pHex, cHex } = card.tap(1);
      const cbResp = await card.callback(pHex, cHex, "lnbc10n1failinvoice", "10000");
      expect(cbResp.status).toBe(500);
    });

    test("CLN REST network error returns 500", async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error("Connection refused");
      }) as any;

      const { pHex, cHex } = card.tap(1);
      const cbResp = await card.callback(pHex, cHex, "lnbc10n1testinvoice", "10000");
      expect(cbResp.status).toBe(500);
    });

    test("CLN REST 201 but non-complete status returns 202", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({ status: "pending" }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const { pHex, cHex } = card.tap(1);
      const cbResp = await card.callback(pHex, cHex, "lnbc10n1testinvoice", "10000");
      expect(cbResp.status).toBe(202);
    });
  });

  describe("Proxy relay mode", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("proxies tap to downstream and returns response", async () => {
      globalThis.fetch = vi.fn(async (urlOrReq, opts) => {
        const urlStr = typeof urlOrReq === "string" ? urlOrReq : urlOrReq instanceof Request ? urlOrReq.url : String(urlOrReq);
        if (urlStr.includes("downstream.example.com")) {
          return new Response(
            JSON.stringify({ status: "OK", message: "proxied" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      const card = await VirtualCard.createProvisioned();

      const uid = card.uid.toLowerCase();
      card.env.CARD_REPLAY.__cardConfigs.set(uid, {
        K2: card.keys.k2,
        payment_method: "proxy",
        proxy: {
          baseurl: "https://downstream.example.com/boltcards/api/v1/scan/test-backend",
        },
      });

      const { response, json } = await card.tapRequest(1);
      expect(response.status).toBe(200);
      expect(json.status).toBe("OK");
    });

    test("proxy with CMAC deferred validation forwards request", async () => {
      globalThis.fetch = vi.fn(async (urlOrReq, opts) => {
        const urlStr = typeof urlOrReq === "string" ? urlOrReq : urlOrReq instanceof Request ? urlOrReq.url : String(urlOrReq);
        if (urlStr.includes("downstream.example.com")) {
          return new Response(
            JSON.stringify({ status: "OK" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not found", { status: 404 });
      }) as any;

      const card = await VirtualCard.createProvisioned();

      const uid = card.uid.toLowerCase();
      card.env.CARD_REPLAY.__cardConfigs.set(uid, {
        K2: card.keys.k2,
        payment_method: "proxy",
        proxy: {
          baseurl: "https://downstream.example.com/scan",
        },
      });

      const { response } = await card.tapRequest(1);
      expect(response.status).toBe(200);
    });

    test("proxy fetch failure returns 500", async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error("Network error");
      }) as any;

      const card = await VirtualCard.createProvisioned();

      const uid = card.uid.toLowerCase();
      card.env.CARD_REPLAY.__cardConfigs.set(uid, {
        K2: card.keys.k2,
        payment_method: "proxy",
        proxy: {
          baseurl: "https://downstream.example.com/scan",
        },
      });

      const { response } = await card.tapRequest(1);
      expect(response.status).toBe(500);
    });
  });
});
