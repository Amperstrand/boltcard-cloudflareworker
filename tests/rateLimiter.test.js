import { describe, it, expect, jest } from "@jest/globals";
import { checkRateLimit } from "../rateLimiter.js";

function createMockKV() {
  const store = new Map();
  return {
    get: jest.fn((key) => Promise.resolve(store.get(key) || null)),
    put: jest.fn((key, value) => { store.set(key, value); return Promise.resolve(); }),
  };
}

function createRequest(ip = "1.2.3.4") {
  return { headers: { get: (name) => name === "CF-Connecting-IP" ? ip : null } };
}

describe("checkRateLimit", () => {
  it("allows all requests when no KV binding", async () => {
    const result = await checkRateLimit(createRequest(), {});
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(100);
    expect(result.resetAt).toBe(0);
  });

  it("allows request under limit", async () => {
    const kv = createMockKV();
    const env = { RATE_LIMITS: kv };
    const result = await checkRateLimit(createRequest(), env, { maxRequests: 5, windowSeconds: 60 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it("tracks requests across multiple calls", async () => {
    const kv = createMockKV();
    const env = { RATE_LIMITS: kv };
    const req = createRequest();
    const r1 = await checkRateLimit(req, env, { maxRequests: 3, windowSeconds: 60 });
    expect(r1.remaining).toBe(2);
    const r2 = await checkRateLimit(req, env, { maxRequests: 3, windowSeconds: 60 });
    expect(r2.remaining).toBe(1);
  });

  it("rejects request at limit", async () => {
    const kv = createMockKV();
    const env = { RATE_LIMITS: kv };
    const req = createRequest();
    await checkRateLimit(req, env, { maxRequests: 2, windowSeconds: 60 });
    await checkRateLimit(req, env, { maxRequests: 2, windowSeconds: 60 });
    const result = await checkRateLimit(req, env, { maxRequests: 2, windowSeconds: 60 });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("returns correct resetAt timestamp", async () => {
    const kv = createMockKV();
    const env = { RATE_LIMITS: kv };
    const now = Math.floor(Date.now() / 1000);
    const windowSeconds = 60;
    const result = await checkRateLimit(createRequest(), env, { maxRequests: 5, windowSeconds });
    const windowStart = now - (now % windowSeconds);
    expect(result.resetAt).toBe((windowStart + windowSeconds) * 1000);
  });

  it("uses unknown IP when CF-Connecting-IP is missing", async () => {
    const kv = createMockKV();
    const env = { RATE_LIMITS: kv };
    const req = { headers: { get: () => null } };
    await checkRateLimit(req, env, { maxRequests: 5, windowSeconds: 60 });
    expect(kv.put).toHaveBeenCalledWith(expect.stringContaining("unknown:"), expect.any(String), expect.any(Object));
  });

  it("sets TTL to 2x windowSeconds", async () => {
    const kv = createMockKV();
    const env = { RATE_LIMITS: kv };
    await checkRateLimit(createRequest(), env, { maxRequests: 5, windowSeconds: 60 });
    expect(kv.put).toHaveBeenCalledWith(expect.any(String), expect.any(String), { expirationTtl: 120 });
  });

  it("isolates different IPs", async () => {
    const kv = createMockKV();
    const env = { RATE_LIMITS: kv };
    const r1 = await checkRateLimit(createRequest("1.1.1.1"), env, { maxRequests: 1, windowSeconds: 60 });
    expect(r1.allowed).toBe(true);
    const r2 = await checkRateLimit(createRequest("2.2.2.2"), env, { maxRequests: 1, windowSeconds: 60 });
    expect(r2.allowed).toBe(true);
  });
});
