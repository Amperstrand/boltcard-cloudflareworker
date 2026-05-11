import { describe, it, expect, vi } from "vitest";
import { handleClientError } from "../handlers/clientErrorHandler.js";

function makeRequest(body: unknown): any {
  return {
    json: () => Promise.resolve(body),
    headers: {
      get: (name: string) => name === "CF-Connecting-IP" ? "1.2.3.4" : null,
    },
  } as any;
}

const mockEnv = {} as any;

describe("handleClientError", () => {
  it("returns 204 for valid error report", async () => {
    const req = makeRequest({
      message: "TypeError: Cannot read properties of undefined",
      stack: "TypeError: Cannot read...\n    at login.js:813:15",
      source: "onerror:https://boltcardpoc.psbt.me/static/js/login.js:813:15",
      url: "/login",
      deploy: "abc1234",
      js: "hash1,hash2",
      ts: Date.now(),
    });
    const res = await handleClientError(req, mockEnv);
    expect(res.status).toBe(204);
  });

  it("returns 204 for null body", async () => {
    const req = makeRequest(null);
    const res = await handleClientError(req, mockEnv);
    expect(res.status).toBe(204);
  });

  it("returns 204 for missing fields", async () => {
    const req = makeRequest({});
    const res = await handleClientError(req, mockEnv);
    expect(res.status).toBe(204);
  });

  it("returns 204 for partial fields", async () => {
    const req = makeRequest({ message: "Something went wrong" });
    const res = await handleClientError(req, mockEnv);
    expect(res.status).toBe(204);
  });

  it("handles very long messages without error", async () => {
    const req = makeRequest({
      message: "x".repeat(10000),
      stack: "s".repeat(5000),
    });
    const res = await handleClientError(req, mockEnv);
    expect(res.status).toBe(204);
  });
});
