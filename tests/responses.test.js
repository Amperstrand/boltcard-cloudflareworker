import { describe, it, expect, jest } from "@jest/globals";
import { jsonResponse, _buildErrorPayload, errorResponse, htmlResponse, buildBoltCardResponse, parseJsonBody, buildResetDeeplink } from "../utils/responses.js";

describe("jsonResponse", () => {
  it("returns JSON with 200 status", () => {
    const res = jsonResponse({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("returns JSON with custom status", () => {
    const res = jsonResponse({ error: "not found" }, 404);
    expect(res.status).toBe(404);
  });

  it("serializes data correctly", async () => {
    const res = jsonResponse({ foo: "bar", count: 42 });
    expect(await res.json()).toEqual({ foo: "bar", count: 42 });
  });
});

describe("_buildErrorPayload", () => {
  it("builds error from string", () => {
    const payload = _buildErrorPayload("something failed");
    expect(payload.status).toBe("ERROR");
    expect(payload.reason).toBe("something failed");
    expect(payload.error).toBe("something failed");
    expect(payload.success).toBe(false);
  });

  it("extracts message from Error object", () => {
    const payload = _buildErrorPayload(new Error("boom"));
    expect(payload.reason).toBe("boom");
  });

  it("merges extra fields", () => {
    const payload = _buildErrorPayload("fail", { code: 42 });
    expect(payload.code).toBe(42);
    expect(payload.status).toBe("ERROR");
  });
});

describe("errorResponse", () => {
  it("returns JSON error with 400 status by default", () => {
    const res = errorResponse("bad request");
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("returns JSON error with custom status", () => {
    const res = errorResponse("unauthorized", 401);
    expect(res.status).toBe(401);
  });

  it("includes error payload in body", async () => {
    const res = errorResponse("test error", 400, { detail: "info" });
    const body = await res.json();
    expect(body.status).toBe("ERROR");
    expect(body.detail).toBe("info");
  });
});

describe("htmlResponse", () => {
  it("returns HTML with 200 status", () => {
    const res = htmlResponse("<h1>Hello</h1>");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html");
  });

  it("returns HTML with custom status", () => {
    const res = htmlResponse("<h1>Error</h1>", 500);
    expect(res.status).toBe(500);
  });

  it("returns body as-is", async () => {
    const res = htmlResponse("<p>test</p>");
    expect(await res.text()).toBe("<p>test</p>");
  });
});

describe("buildBoltCardResponse", () => {
  const keys = { k0: "aa", k1: "bb", k2: "cc", k3: "dd", k4: "ee" };

  it("builds response with correct structure", () => {
    const res = buildBoltCardResponse(keys, "04a39493cc8680", "https://example.com");
    expect(res.CARD_NAME).toBe("UID 04A39493CC8680");
    expect(res.ID).toBe("1");
    expect(res.Version).toBe(1);
    expect(res.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
  });

  it("uppercases K0-K4 keys", () => {
    const res = buildBoltCardResponse(keys, "04a39493cc8680", "https://example.com");
    expect(res.K0).toBe("AA");
    expect(res.K4).toBe("EE");
  });

  it("lowercases k0-k4 keys", () => {
    const res = buildBoltCardResponse(keys, "04a39493cc8680", "https://example.com");
    expect(res.k0).toBe("aa");
    expect(res.k4).toBe("ee");
  });

  it("strips protocol and adds trailing slash for LNURLW", () => {
    const res = buildBoltCardResponse(keys, "04a39493cc8680", "https://example.com");
    expect(res.LNURLW_BASE).toBe("lnurlw://example.com/");
    expect(res.lnurlw_base).toBe("lnurlw://example.com/");
  });

  it("strips http protocol", () => {
    const res = buildBoltCardResponse(keys, "04a39493cc8680", "http://localhost:8787");
    expect(res.LNURLW_BASE).toBe("lnurlw://localhost:8787/");
  });

  it("supports custom version", () => {
    const res = buildBoltCardResponse(keys, "04a39493cc8680", "https://example.com", 2);
    expect(res.Version).toBe(2);
  });
});

describe("parseJsonBody", () => {
  it("parses valid JSON body", async () => {
    const request = { json: jest.fn().mockResolvedValue({ foo: "bar" }) };
    const result = await parseJsonBody(request);
    expect(result).toEqual({ foo: "bar" });
  });

  it("propagates JSON parse errors", async () => {
    const request = { json: jest.fn().mockRejectedValue(new Error("invalid json")) };
    await expect(parseJsonBody(request)).rejects.toThrow("invalid json");
  });
});

describe("buildResetDeeplink", () => {
  it("builds deeplink with URL-encoded endpoint", () => {
    const result = buildResetDeeplink("https://example.com/experimental/wipe?uid=123");
    expect(result).toBe("boltcard://reset?url=https%3A%2F%2Fexample.com%2Fexperimental%2Fwipe%3Fuid%3D123");
  });

  it("handles simple URL", () => {
    const result = buildResetDeeplink("https://example.com/wipe");
    expect(result).toBe("boltcard://reset?url=https%3A%2F%2Fexample.com%2Fwipe");
  });
});
