import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { resolveLightningAddress } from "../utils/lightningAddress.js";

describe("resolveLightningAddress", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const payRequest = (overrides = {}) => ({
    tag: "payRequest",
    callback: "https://example.com/cb",
    minSendable: 1000,
    maxSendable: 1000000,
    ...overrides,
  });

  it("rejects non-string lightning address", async () => {
    await expect(resolveLightningAddress(123, 1000)).rejects.toThrow("must be a string");
  });

  it("rejects invalid format (missing @)", async () => {
    await expect(resolveLightningAddress("nouser", 1000)).rejects.toThrow("Invalid Lightning Address format");
  });

  it("rejects empty user part", async () => {
    await expect(resolveLightningAddress("@example.com", 1000)).rejects.toThrow("Invalid Lightning Address format");
  });

  it("rejects empty domain part", async () => {
    await expect(resolveLightningAddress("user@", 1000)).rejects.toThrow("Invalid Lightning Address format");
  });

  it("rejects non-integer amount", async () => {
    await expect(resolveLightningAddress("user@example.com", 1.5)).rejects.toThrow("Invalid amountMsat");
  });

  it("rejects zero amount", async () => {
    await expect(resolveLightningAddress("user@example.com", 0)).rejects.toThrow("Invalid amountMsat");
  });

  it("rejects negative amount", async () => {
    await expect(resolveLightningAddress("user@example.com", -1)).rejects.toThrow("Invalid amountMsat");
  });

  it("rejects non-JSON response", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("not json")),
    });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("invalid JSON response");
  });

  it("rejects HTTP error with reason", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ reason: "not found" }),
    });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("returned HTTP 404 - not found");
  });

  it("rejects LNURL ERROR status", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ERROR", reason: "user not found" }),
    });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("LNURL error");
  });

  it("rejects invalid tag", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payRequest({ tag: "withdrawRequest" }),
    });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("invalid tag: withdrawRequest");
  });

  it("rejects missing callback", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payRequest({ callback: undefined }),
    });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("missing callback URL");
  });

  it("rejects amount below minSendable", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payRequest({ minSendable: 10000 }),
    });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("outside allowed range");
  });

  it("rejects amount above maxSendable", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payRequest({ maxSendable: 1000 }),
    });
    await expect(resolveLightningAddress("user@example.com", 2000)).rejects.toThrow("outside allowed range");
  });

  it("rejects invalid callback URL", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payRequest({ callback: "not-a-url" }),
    });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("invalid callback URL");
  });

  it("rejects missing minSendable/maxSendable", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payRequest({ minSendable: undefined, maxSendable: undefined }),
    });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("missing minSendable or maxSendable");
  });

  it("rejects missing pr in invoice response", async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => payRequest() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ routes: [] }) });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("missing pr");
  });

  it("rejects HTTP error from callback", async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => payRequest() })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("Lightning Address callback failed");
  });

  it("handles network failure", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(resolveLightningAddress("user@example.com", 1000)).rejects.toThrow("failed to fetch");
  });

  it("returns invoice on success", async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => payRequest() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pr: "lnbc1000u1p3hkx7e", routes: [] }) });

    const result = await resolveLightningAddress("user@example.com", 50000);

    expect(result.pr).toBe("lnbc1000u1p3hkx7e");
    expect(result.routes).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[1][0]).toContain("amount=50000");
  });

  it("encodes special characters in user part", async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => payRequest() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pr: "lnbc...", routes: [] }) });

    await resolveLightningAddress("user+tag@example.com", 1000);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("user%2Btag");
  });

});
