
export {};

const worker = await import("../index.js");
const defaultExport = worker.default;
import type { Env } from "../types/core.js";
import { createMockKV, TEST_OPERATOR_AUTH } from "./testHelpers.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";

function makeEnv(): Env {
  return { BOLT_CARD_K1, UID_CONFIG: createMockKV(), CARD_REPLAY: makeReplayNamespace() as unknown as DurableObjectNamespace, ...TEST_OPERATOR_AUTH } as Env;
}

describe("Security headers", () => {
  it("sets X-Content-Type-Options on HTML responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets X-Frame-Options on HTML responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets Referrer-Policy on HTML responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets Permissions-Policy on HTML responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {} as ExecutionContext,
    );
    const pp = res.headers.get("Permissions-Policy");
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
  });

  it("sets security headers on JSON error responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/", { method: "GET" }),
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets X-Request-Id on responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("sets Content-Security-Policy", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {} as ExecutionContext,
    );
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("sets security headers on 404 API responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/api/nonexistent"),
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets security headers on redirect responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/nonexistent-path"),
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets security headers on status endpoint", async () => {
    const env = { BOLT_CARD_K1, UID_CONFIG: { get: async () => null } as unknown as KVNamespace } as unknown as Env;
    const res = await defaultExport.fetch(
      new Request("https://test.local/status"),
      env,
      {} as ExecutionContext,
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets X-RateLimit-Remaining on successful responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {} as ExecutionContext,
    );
    const remaining = res.headers.get("X-RateLimit-Remaining");
    expect(remaining).toBeTruthy();
    expect(parseInt(remaining!, 10)).toBeGreaterThan(0);
  });
});