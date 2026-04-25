import { describe, it, expect } from "@jest/globals";
import { handleRequest } from "../index.js";
import { buildCardTestEnv } from "./testHelpers.js";

function makeEnv(overrides = {}) {
  return buildCardTestEnv({ operatorAuth: true, extraEnv: overrides });
}

describe("GET /operator/login", () => {
  it("returns HTML login page", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/login"),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Operator");
  });

  it("includes return URL in the page when provided", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/login?return=/operator/refund"),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/operator/refund");
  });
});

describe("POST /operator/login", () => {
  it("returns 500 when PIN not configured", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "pin=1234",
      }),
      makeEnv({ OPERATOR_PIN: "12" }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.reason).toMatch(/not configured/i);
  });

  it("returns HTML with error when PIN is empty", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "pin=",
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/required/i);
  });

  it("returns HTML with error on wrong PIN", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "pin=9999",
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/incorrect/i);
  });

  it("returns 302 redirect with session cookie on correct PIN", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "pin=1234",
      }),
      makeEnv(),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/operator/pos");
    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toContain("op_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("redirects to return URL when provided in form", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "pin=1234&return=/operator/refund",
      }),
      makeEnv(),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/operator/refund");
  });

  it("returns 400 for invalid form data", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/login", {
        method: "POST",
        body: "not-form-data",
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/invalid form/i);
  });

  it("returns 429 when rate limited", async () => {
    const kvStore = {};
    const rateLimitedEnv = makeEnv({
      RATE_LIMITS: {
        get: async (key) => kvStore[key] ?? null,
        put: async (key, val) => { kvStore[key] = val; },
      },
    });

    for (let i = 0; i < 6; i++) {
      await handleRequest(
        new Request("https://test.local/operator/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "CF-Connecting-IP": "1.2.3.4",
          },
          body: "pin=9999",
        }),
        rateLimitedEnv,
      );
    }

    const res = await handleRequest(
      new Request("https://test.local/operator/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": "1.2.3.4",
        },
        body: "pin=1234",
      }),
      rateLimitedEnv,
    );
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.reason).toMatch(/too many/i);
  });
});

describe("POST /operator/logout", () => {
  it("returns 302 to login page with expired cookie", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/logout", {
        method: "POST",
        headers: { Cookie: "op_session=test" },
      }),
      makeEnv(),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/operator/login");
    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toContain("op_session=");
    expect(cookie).toContain("Max-Age=0");
  });
});
