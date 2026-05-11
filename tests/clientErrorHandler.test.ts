import { describe, it, expect, vi } from "vitest";
import { handleClientError } from "../handlers/clientErrorHandler.js";

function makeRequest(body: unknown, ip = "1.2.3.4"): any {
  return {
    json: () => Promise.resolve(body),
    headers: {
      get: (name: string) => name === "CF-Connecting-IP" ? ip : null,
    },
  } as any;
}

const validPayload = {
  message: "TypeError: Cannot read properties of undefined",
  stack: "TypeError: Cannot read...\n    at login.js:813:15",
  source: "onerror:https://boltcardpoc.psbt.me/static/js/login.js:813:15",
  url: "/login",
  deploy: "abc1234",
  js: "hash1,hash2",
  ts: Date.now(),
};

describe("handleClientError", () => {
  it("returns 204 for valid error report", async () => {
    const req = makeRequest(validPayload);
    const res = await handleClientError(req, {} as any);
    expect(res.status).toBe(204);
  });

  it("returns 204 for null body", async () => {
    const req = makeRequest(null);
    const res = await handleClientError(req, {} as any);
    expect(res.status).toBe(204);
  });

  it("returns 204 for missing fields", async () => {
    const req = makeRequest({});
    const res = await handleClientError(req, {} as any);
    expect(res.status).toBe(204);
  });

  it("returns 204 for partial fields", async () => {
    const req = makeRequest({ message: "Something went wrong" });
    const res = await handleClientError(req, {} as any);
    expect(res.status).toBe(204);
  });

  it("handles very long messages without error", async () => {
    const req = makeRequest({
      message: "x".repeat(10000),
      stack: "s".repeat(5000),
    });
    const res = await handleClientError(req, {} as any);
    expect(res.status).toBe(204);
  });

  describe("rate limiting", () => {
    it("returns 429 when rate limit exceeded", async () => {
      const kv = new Map<string, string>();
      const env = {
        RATE_LIMITS: {
          get: (key: string) => Promise.resolve(kv.get(key)),
          put: (key: string, value: string, opts?: { expirationTtl?: number }) => {
            kv.set(key, value);
            return Promise.resolve();
          },
        },
      } as any;

      // Exhaust the 30-request limit
      for (let i = 0; i < 30; i++) {
        const req = makeRequest(validPayload);
        const res = await handleClientError(req, env);
        expect(res.status).toBe(204);
      }

      // 31st request should be rate limited
      const req = makeRequest(validPayload);
      const res = await handleClientError(req, env);
      expect(res.status).toBe(429);
    });

    it("allows requests when RATE_LIMITS KV is not bound", async () => {
      const req = makeRequest(validPayload);
      const res = await handleClientError(req, {} as any);
      expect(res.status).toBe(204);
    });

    it("rate limits per IP", async () => {
      const kv = new Map<string, string>();
      const env = {
        RATE_LIMITS: {
          get: (key: string) => Promise.resolve(kv.get(key)),
          put: (key: string, value: string, opts?: { expirationTtl?: number }) => {
            kv.set(key, value);
            return Promise.resolve();
          },
        },
      } as any;

      // Exhaust limit from IP 1.1.1.1
      for (let i = 0; i < 30; i++) {
        const req = makeRequest(validPayload, "1.1.1.1");
        const res = await handleClientError(req, env);
        expect(res.status).toBe(204);
      }

      // IP 1.1.1.1 should be blocked
      const blockedReq = makeRequest(validPayload, "1.1.1.1");
      expect((await handleClientError(blockedReq, env)).status).toBe(429);

      // IP 2.2.2.2 should still be allowed
      const allowedReq = makeRequest(validPayload, "2.2.2.2");
      expect((await handleClientError(allowedReq, env)).status).toBe(204);
    });
  });
});
