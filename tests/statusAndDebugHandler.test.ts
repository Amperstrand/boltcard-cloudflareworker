import { describe, it, expect } from "vitest";
import { handleStatus } from "../handlers/statusHandler.js";
import { handleDebugPage } from "../handlers/debugHandler.js";
import type { Env } from "../types/core.js";

function makeRequest(url = "https://boltcardpoc.psbt.me/status") {
  return new Request(url);
}

function makeKvMock(behavior = "working") {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => {
      if (behavior === "error") throw new Error("KV down");
      return store.get(key);
    },
    put: async (key: string, value: string) => {
      if (behavior === "error") throw new Error("KV down");
      store.set(key, value);
    },
    delete: async (key: string) => {
      if (behavior === "error") throw new Error("KV down");
      store.delete(key);
    },
  };
}

describe("handleStatus", () => {
  it("returns OK with working KV status", async () => {
    const env = { UID_CONFIG: makeKvMock("working") } as unknown as Env;
    const res = await handleStatus(makeRequest(), env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("OK");
    expect(body.kv_status).toBe("working");
  });

  it("returns ERROR when KV health check fails", async () => {
    const env = { UID_CONFIG: makeKvMock("error") } as unknown as Env;
    const res = await handleStatus(makeRequest(), env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ERROR");
    expect(body.kv_status).toBe("error");
  });

  it("returns ERROR when KV returns wrong value", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async () => "wrong",
      put: async (key: string, value: string) => store.set(key, value),
      delete: async () => {},
    };
    const env = { UID_CONFIG: kv } as unknown as Env;
    const res = await handleStatus(makeRequest(), env);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("OK");
    expect(body.kv_status).toBe("not working");
  });

  it("redirects to /login when no UID_CONFIG", async () => {
    const res = await handleStatus(makeRequest(), {} as Env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects to /login when env is null", async () => {
    const res = await handleStatus(makeRequest(), null as unknown as Env);
    expect(res.status).toBe(302);
  });

  it("uses request origin for redirect", async () => {
    const res = await handleStatus(makeRequest("https://example.com/status"), null as unknown as Env);
    expect(res.headers.get("location")).toBe("https://example.com/login");
  });
});

describe("handleDebugPage", () => {
  it("returns HTML response", async () => {
    const req = new Request("https://boltcardpoc.psbt.me/debug");
    const res = await handleDebugPage(req);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Debug Console");
  });

  it("passes host to template", async () => {
    const req = new Request("https://example.com/debug", {
      headers: { Host: "example.com" },
    });
    const res = await handleDebugPage(req);
    const html = await res.text();
    expect(html).toContain("example.com");
  });
});
