import { jest } from "@jest/globals";
import { handleProxy } from "../handlers/proxyHandler.js";

const UID = "04a39493cc8680";

describe("handleProxy", () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "OK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  afterEach(() => {
    globalThis.fetch.mockRestore();
  });

  it("proxies GET request to target with p and c params", async () => {
    const req = new Request("https://test.local/?p=ABCD&c=EFGH");
    const res = await handleProxy(req, UID, "ABCD", "EFGH", "https://backend.example.com/tap", {});

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const proxiedReq = globalThis.fetch.mock.calls[0][0];
    const proxiedUrl = new URL(proxiedReq.url);
    expect(proxiedUrl.origin).toBe("https://backend.example.com");
    expect(proxiedUrl.searchParams.get("p")).toBe("ABCD");
    expect(proxiedUrl.searchParams.get("c")).toBe("EFGH");
    expect(proxiedReq.headers.get("X-BoltCard-UID")).toBe(UID);
  });

  it("sets CMAC validation headers", async () => {
    const req = new Request("https://test.local/");
    await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {
      cmacValidated: true,
      validationDeferred: false,
    });

    const proxiedReq = globalThis.fetch.mock.calls[0][0];
    expect(proxiedReq.headers.get("X-BoltCard-CMAC-Validated")).toBe("true");
    expect(proxiedReq.headers.get("X-BoltCard-CMAC-Deferred")).toBe("false");
  });

  it("sets deferred headers when CMAC not locally validated", async () => {
    const req = new Request("https://test.local/");
    await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {
      cmacValidated: false,
      validationDeferred: true,
    });

    const proxiedReq = globalThis.fetch.mock.calls[0][0];
    expect(proxiedReq.headers.get("X-BoltCard-CMAC-Validated")).toBe("false");
    expect(proxiedReq.headers.get("X-BoltCard-CMAC-Deferred")).toBe("true");
  });

  it("returns proxy response body and status", async () => {
    const body = JSON.stringify({ tag: "withdrawRequest", k1: "test" });
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const req = new Request("https://test.local/");
    const res = await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {});
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tag).toBe("withdrawRequest");
  });

  it("returns 500 on proxy fetch error", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error("Connection refused"));

    const req = new Request("https://test.local/");
    const res = await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.reason).toContain("Proxy error");
  });

  it("passes through non-200 status from backend", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response("Not Found", { status: 404 })
    );

    const req = new Request("https://test.local/");
    const res = await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {});
    expect(res.status).toBe(404);
  });

  it("uses manual redirect mode", async () => {
    const req = new Request("https://test.local/");
    await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {});

    const proxiedReq = globalThis.fetch.mock.calls[0][0];
    expect(proxiedReq.redirect).toBe("manual");
  });

  it("forwards POST body to target", async () => {
    const req = new Request("https://test.local/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice: "lnbc10n1test" }),
    });
    const res = await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {});
    expect(res.status).toBe(200);

    const proxiedReq = globalThis.fetch.mock.calls[0][0];
    expect(proxiedReq.method).toBe("POST");
    const body = await proxiedReq.text();
    expect(body).toContain("lnbc10n1test");
  });

  it("handles body read error gracefully", async () => {
    const req = new Request("https://test.local/", { method: "POST" });
    Object.defineProperty(req, 'clone', { value: () => { throw new Error("stream error"); } });
    const res = await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {});
    expect(res.status).toBe(200);
  });

  it("works without verification parameter (default)", async () => {
    const req = new Request("https://test.local/?p=ABCD&c=EFGH");
    const res = await handleProxy(req, UID, "ABCD", "EFGH", "https://backend.example.com/tap");
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("filters sensitive request headers from upstream", async () => {
    const req = new Request("https://test.local/", {
      headers: {
        "Content-Type": "application/json",
        "Cookie": "session=secret123",
        "Authorization": "Bearer token",
        "X-CSRF-Token": "abc",
        "User-Agent": "test",
      },
    });
    await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {});

    const proxiedReq = globalThis.fetch.mock.calls[0][0];
    expect(proxiedReq.headers.get("Content-Type")).toBe("application/json");
    expect(proxiedReq.headers.get("User-Agent")).toBe("test");
    expect(proxiedReq.headers.get("Cookie")).toBeNull();
    expect(proxiedReq.headers.get("Authorization")).toBeNull();
    expect(proxiedReq.headers.get("X-CSRF-Token")).toBeNull();
  });

  it("filters upstream response headers", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response("OK", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Powered-By": "Express",
          "Server": "nginx/1.0",
          "X-BoltCard-Custom": "allowed",
        },
      })
    );

    const req = new Request("https://test.local/");
    const res = await handleProxy(req, UID, "p", "c", "https://backend.example.com/tap", {});
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("X-BoltCard-Custom")).toBe("allowed");
    expect(res.headers.get("X-Powered-By")).toBeNull();
    expect(res.headers.get("Server")).toBeNull();
  });
});
