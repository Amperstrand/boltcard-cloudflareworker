import { describe, it, expect, beforeEach } from "@jest/globals";
import { handleRequest } from "../index.js";
import { buildCardTestEnv } from "./testHelpers.js";

function makeEnv() {
  return buildCardTestEnv({ operatorAuth: true });
}

describe("GET /api/pos/menu", () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
  });

  it("returns empty menu when no menu saved", async () => {
    const res = await handleRequest(
      new Request("https://test.local/api/pos/menu", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toEqual([]);
  });

  it("returns saved menu items", async () => {
    const menu = { items: [{ name: "Coffee", price: 50 }, { name: "Tea", price: 30 }] };
    await env.UID_CONFIG.put("pos_menu:default", JSON.stringify(menu));

    const res = await handleRequest(
      new Request("https://test.local/api/pos/menu", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(2);
    expect(json.items[0].name).toBe("Coffee");
  });

  it("returns menu for specific terminal", async () => {
    const menu = { items: [{ name: "Espresso", price: 60 }] };
    await env.UID_CONFIG.put("pos_menu:terminal-42", JSON.stringify(menu));

    const res = await handleRequest(
      new Request("https://test.local/api/pos/menu?t=terminal-42", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].name).toBe("Espresso");
  });

  it("requires operator auth", async () => {
    const noAuthEnv = { ...env };
    delete noAuthEnv.__TEST_OPERATOR_SESSION;
    const res = await handleRequest(
      new Request("https://test.local/api/pos/menu"),
      noAuthEnv,
    );
    expect(res.status).toBe(302);
  });
});

describe("PUT /operator/pos/menu", () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
  });

  it("saves a valid menu", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ items: [{ name: "Latte", price: 55 }] }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.itemCount).toBe(1);
  });

  it("persists menu to KV", async () => {
    await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ items: [{ name: "Mocha", price: 65 }] }),
      }),
      env,
    );

    const raw = await env.UID_CONFIG.get("pos_menu:default");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.items[0].name).toBe("Mocha");
  });

  it("returns 400 when items is not an array", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ items: "not-array" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/must be an array/i);
  });

  it("returns 400 when item has no name", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ items: [{ price: 10 }] }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/must have a name/i);
  });

  it("returns 400 when item has invalid price", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: JSON.stringify({ items: [{ name: "Bad", price: -5 }] }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toMatch(/invalid price/i);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: "op_session=test" },
        body: "not json",
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("requires operator auth", async () => {
    const noAuthEnv = { ...env };
    delete noAuthEnv.__TEST_OPERATOR_SESSION;
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [] }),
      }),
      noAuthEnv,
    );
    expect(res.status).toBe(302);
  });
});

describe("GET /operator/pos/menu", () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
  });

  it("returns HTML menu editor page", async () => {
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Menu");
  });

  it("requires operator auth", async () => {
    const noAuthEnv = { ...env };
    delete noAuthEnv.__TEST_OPERATOR_SESSION;
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu"),
      noAuthEnv,
    );
    expect(res.status).toBe(302);
  });

  it("gracefully handles broken KV by showing empty menu", async () => {
    const brokenEnv = {
      ...env,
      UID_CONFIG: {
        get: async () => { throw new Error("KV down"); },
        put: async () => {},
      },
    };
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        headers: { Cookie: "op_session=test" },
      }),
      brokenEnv,
    );
    expect(res.status).toBe(200);
  });

  it("handles menu without items property (triggers || [] fallback)", async () => {
    await env.UID_CONFIG.put("pos_menu:default", JSON.stringify({ foo: "bar" }));
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Menu Editor");
  });

  it("renders editor with empty items list", async () => {
    await env.UID_CONFIG.put("pos_menu:default", JSON.stringify({ items: [] }));
    const res = await handleRequest(
      new Request("https://test.local/operator/pos/menu", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Menu Editor");
  });
});

describe("GET /api/pos/menu error handling", () => {
  it("gracefully handles broken KV by returning empty items", async () => {
    const env = makeEnv();
    env.UID_CONFIG = { get: async () => { throw new Error("KV exploded"); }, put: async () => {} };
    const res = await handleRequest(
      new Request("https://test.local/api/pos/menu", {
        headers: { Cookie: "op_session=test" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toEqual([]);
  });
});
