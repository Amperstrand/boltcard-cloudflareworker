// Ported from scripts/live-csrf-regression-test.mjs
// Tests CSRF protection, operator auth, menu CRUD, and batch card operations.
// Runs via miniflare with real SQLite DO + KV. Zero network egress.

import {
  apiFetch,
  operatorLogin,
  provisionCard,
  topUp,
  cardTap,
  cardInfo,
  nextCounter,
  makeUid,
  deriveKeys,
  resetSession,
} from "./helpers.js";

// ── Operator Login Flow ──────────────────────────────────────────────────────

describe("Operator Login Flow", () => {
  it("POST /operator/login with correct PIN → 302", async () => {
    resetSession();
    const resp = await apiFetch("/operator/login", {
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: "pin=1234",
    });
    expect(resp.status).toBe(302);
  });

  it("POST /operator/login with wrong PIN → 200 (re-renders with error)", async () => {
    resetSession();
    const resp = await apiFetch("/operator/login", {
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: "pin=9999",
    });
    // Login page re-renders with error message (200), not a distinct error status
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Incorrect PIN");
  });

  it("GET /operator without session → redirect to /operator/login", async () => {
    resetSession();
    const resp = await apiFetch("/operator", {
      headers: { Accept: "text/html" },
    });
    expect(resp.status).toBe(302);
    const location = resp.headers.get("Location") || "";
    expect(location).toContain("/operator/login");
  });

  it("GET /operator/topup without session → 302 redirect", async () => {
    resetSession();
    const resp = await apiFetch("/operator/topup", {
      headers: { Accept: "text/html" },
    });
    expect(resp.status).toBe(302);
  });
});

// ── CSRF Protection ──────────────────────────────────────────────────────────

describe("CSRF Protection", () => {
  it("POST /operator/topup/apply without CSRF token → 403", async () => {
    resetSession();
    // Login to acquire session cookie but skip CSRF page fetch
    const loginResp = await apiFetch("/operator/login", {
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: "pin=1234",
    });
    expect(loginResp.status).toBe(302);
    // sessionCookie is now set; csrfToken is still empty → no X-CSRF-Token header
    const resp = await apiFetch("/operator/topup/apply", {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ uid: "04deadbeef1234", amount: 100 }),
    });
    expect(resp.status).toBe(403);
  });

  it("POST /operator/topup/apply with valid CSRF token → 200", async () => {
    resetSession();
    await operatorLogin();

    const uid = makeUid();
    const keys = deriveKeys(uid);

    // Provision card via pull-payments API (pending state)
    const prov = await provisionCard(uid);
    expect(prov.status).toBe(200);

    // Tap card to transition pending → discovered
    const tapResp = await cardTap(uid, prov.k1, prov.k2, nextCounter());
    expect(tapResp.status).toBe(200);

    // Top-up with valid CSRF token
    const resp = await topUp(uid, 1000, prov.k1, prov.k2, nextCounter());
    expect(resp.status).toBe(200);
  });

  it("POST /operator/pos/charge with wrong CSRF token → 403", async () => {
    resetSession();
    // Login to acquire session cookie but skip CSRF page fetch
    const loginResp = await apiFetch("/operator/login", {
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: "pin=1234",
    });
    expect(loginResp.status).toBe(302);
    // sessionCookie is set; csrfToken is empty so auto-CSRF won't fire.
    // Manually add a wrong X-CSRF-Token (stays because csrfToken is empty).
    const resp = await apiFetch("/operator/pos/charge", {
      method: "POST",
      contentType: "application/json",
      headers: { "X-CSRF-Token": "invalid-csrf-token-12345" },
      body: JSON.stringify({ uid: "04deadbeef1234", amount: 500 }),
    });
    expect(resp.status).toBe(403);
  });

  it("POST /operator/pos/charge without any cookies → 302", async () => {
    resetSession();
    const resp = await apiFetch("/operator/pos/charge", {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ uid: "04deadbeef1234", amount: 500 }),
    });
    expect(resp.status).toBe(302);
  });
});

// ── Menu CRUD ─────────────────────────────────────────────────────────────────

describe("Menu CRUD", () => {
  it("GET /api/pos/menu → returns menu (or empty)", async () => {
    resetSession();
    await operatorLogin();
    const resp = await apiFetch("/api/pos/menu");
    expect(resp.status).toBe(200);
    const json: Record<string, unknown> = await resp.json();
    const items = Array.isArray(json) ? json : json.items;
    expect(Array.isArray(items)).toBe(true);
  });

  it("PUT /operator/pos/menu with valid session + CSRF → 200", async () => {
    resetSession();
    await operatorLogin();
    const resp = await apiFetch("/operator/pos/menu", {
      method: "PUT",
      contentType: "application/json",
      body: JSON.stringify({ items: [{ name: "Test Coffee", price: 500 }] }),
    });
    expect(resp.status).toBe(200);
  });

  it("GET /api/pos/menu → returns updated menu with both items", async () => {
    resetSession();
    await operatorLogin();

    // Write two-item menu
    const putResp = await apiFetch("/operator/pos/menu", {
      method: "PUT",
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { name: "Test Tea", price: 300 },
          { name: "Test Cake", price: 800 },
        ],
      }),
    });
    expect(putResp.status).toBe(200);

    // Read back and verify both items
    const getResp = await apiFetch("/api/pos/menu");
    expect(getResp.status).toBe(200);
    const json: Record<string, unknown> = await getResp.json();
    const rawItems = Array.isArray(json) ? json : json.items;
    const items = rawItems as Array<{ name: string }>;
    const names = items.map((i) => i.name);
    expect(names).toContain("Test Tea");
    expect(names).toContain("Test Cake");
  });

  it("PUT /operator/pos/menu without auth → redirect", async () => {
    resetSession();
    const resp = await apiFetch("/operator/pos/menu", {
      method: "PUT",
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
    expect([302, 403]).toContain(resp.status);
  });
});

// ── Batch Card Operations ────────────────────────────────────────────────────

describe("Batch Card Operations", () => {
  let uid1 = "";
  let uid2 = "";
  let keys1: ReturnType<typeof deriveKeys> | null = null;
  let keys2: ReturnType<typeof deriveKeys> | null = null;

  beforeAll(async () => {
    resetSession();
    await operatorLogin();

    uid1 = makeUid();
    uid2 = makeUid();
    keys1 = deriveKeys(uid1);
    keys2 = deriveKeys(uid2);

    // Provision both cards via pull-payments API (pending state)
    const prov1 = await provisionCard(uid1);
    const prov2 = await provisionCard(uid2);
    expect(prov1.status).toBe(200);
    expect(prov2.status).toBe(200);

    // Tap each card to transition pending → discovered
    const tap1 = await cardTap(uid1, prov1.k1, prov1.k2, nextCounter());
    expect(tap1.status).toBe(200);
    const tap2 = await cardTap(uid2, prov2.k1, prov2.k2, nextCounter());
    expect(tap2.status).toBe(200);
  });

  it("POST /operator/cards/batch with terminate action → success", async () => {
    const resp = await apiFetch("/operator/cards/batch", {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ uids: [uid1, uid2], action: "terminate" }),
    });
    expect(resp.status).toBe(200);
    const json: Record<string, unknown> = await resp.json();
    expect(Array.isArray(json.results)).toBe(true);
    const results = json.results as Array<{ status: string }>;
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status === "terminated" || r.status === "skipped").toBe(true);
    }
  });

  it("cards are terminated after batch operation", async () => {
    const info1 = await cardInfo(uid1, keys1!.k1, keys1!.k2, nextCounter());
    expect(info1.status).toBe(200);
    expect((await info1.json() as Record<string, unknown>).state).toBe("terminated");

    const info2 = await cardInfo(uid2, keys2!.k1, keys2!.k2, nextCounter());
    expect(info2.status).toBe(200);
    expect((await info2.json() as Record<string, unknown>).state).toBe("terminated");
  });

  it("batch activate restores a card", async () => {
    const resp = await apiFetch("/operator/cards/batch", {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ uids: [uid1], action: "activate" }),
    });
    expect(resp.status).toBe(200);
    const json: Record<string, unknown> = await resp.json();
    expect(Array.isArray(json.results)).toBe(true);
    expect((json.results as unknown[]).length).toBe(1);
  });

  it("POST /operator/cards/batch without auth → redirect", async () => {
    resetSession();
    const resp = await apiFetch("/operator/cards/batch", {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ uids: ["04deadbeef1234"], action: "terminate" }),
    });
    expect([302, 403]).toContain(resp.status);
  });
});
