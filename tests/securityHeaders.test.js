import { describe, it, expect } from "@jest/globals";

const worker = await import("../index.js");
const defaultExport = worker.default;

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";

function makeEnv() {
  return { BOLT_CARD_K1 };
}

describe("Security headers", () => {
  it("sets X-Content-Type-Options on HTML responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {},
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets X-Frame-Options on HTML responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {},
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets Referrer-Policy on HTML responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {},
    );
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets Permissions-Policy on HTML responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {},
    );
    const pp = res.headers.get("Permissions-Policy");
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
  });

  it("sets security headers on JSON error responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/", { method: "GET" }),
      makeEnv(),
      {},
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets X-Request-Id on responses", async () => {
    const res = await defaultExport.fetch(
      new Request("https://test.local/login"),
      makeEnv(),
      {},
    );
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });
});
