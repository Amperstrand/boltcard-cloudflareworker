import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { TestCard } from "@ntag424/crypto/test";
import { buildCardTestEnv } from "./testHelpers.js";
import type { Env } from "../types/core.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const TEST_UID = "04996c6a926980";
const ISSUER_KEY = "00000000000000000000000000000001";

function makeEnv(uidConfig: Record<string, unknown> | null = null) {
  return buildCardTestEnv({ uid: TEST_UID, kvData: uidConfig ? JSON.stringify(uidConfig) : null, operatorAuth: true, extraEnv: { BOLT_CARD_K1 } }) as unknown as Env;
}

async function makeRequest(path: string, env: Env) {
  return handleRequest(new Request("https://test.local" + path, { method: "GET" }), env);
}

describe("Debug Page", () => {
  test("GET /debug returns HTML with 200", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/debug", env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
  });

  test("debug page renders tabbed console", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/debug", env);
    const html = await resp.text();
    expect(html).toContain("Debug Console");
    expect(html).toContain("debug-tab");
    expect(html).toContain("panel-console");
    expect(html).toContain("panel-identify");
    expect(html).toContain("panel-wipe");
    expect(html).toContain("panel-twofa");
    expect(html).toContain("panel-identity");
    expect(html).toContain("panel-pos");
    expect(html).toContain("Card Info");
  });
});

describe("Identity Page", () => {
  test("GET /identity returns HTML with 200", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/identity", env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
  });

  test("identity page contains NFC and profile elements", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/identity", env);
    const html = await resp.text();
    expect(html).toContain("IDENTITY");
    expect(html).toContain("ACCESS GRANTED");
    expect(html).toContain("ACCESS DENIED");
    expect(html).toContain('/static/js/nfc.js');
    expect(html).toContain('/static/js/identity.js');
    expect(html).toContain("btn-scan");
    expect(html).toContain("Save avatar");
    expect(html).toContain("Open 2FA demo");
  });
});

describe("Identity Verify API", () => {
  let card: TestCard;

  beforeAll(async () => {
    card = new TestCard(TEST_UID, ISSUER_KEY);
  });

  test("returns verified for valid card", async () => {
    const env = makeEnv({ payment_method: "fakewallet", K2: card.keys.k2 } as Record<string, unknown>);
    const tap = card.tap(1);

    const resp = await makeRequest(`/api/verify-identity?p=${tap.p}&c=${tap.c}`, env);
    expect(resp.status).toBe(200);

    const json = await resp.json() as Record<string, unknown>;
    expect(json.verified).toBe(true);
    expect(json.uid).toBe(TEST_UID);
    expect(json.maskedUid).toContain("0499");
    expect(json.maskedUid).toContain("6980");
    expect(json.profile).toMatchObject({
      emoji: expect.any(String),
      name: expect.stringMatching(/^Operator-/),
      role: expect.any(String),
      dept: expect.any(String),
      level: expect.stringMatching(/^Level /),
    });
  });

  test("saves a selected emoji avatar for a verified card", async () => {
    const env = makeEnv({ payment_method: "fakewallet", K2: card.keys.k2 } as Record<string, unknown>);
    const tap = card.tap(1);

    const response = await handleRequest(new Request("https://test.local/api/identity/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: tap.p, c: tap.c, emoji: "🚀" }),
    }), env);

    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect((json.profile as Record<string, unknown>).emoji).toBe("🚀");

    const verifyResp = await makeRequest(`/api/verify-identity?p=${tap.p}&c=${tap.c}`, env);
    const verifyJson = await verifyResp.json() as Record<string, unknown>;
    expect((verifyJson.profile as Record<string, unknown>).emoji).toBe("🚀");
  });

  test("rejects unsupported emoji selection", async () => {
    const env = makeEnv({ payment_method: "fakewallet", K2: card.keys.k2 } as Record<string, unknown>);
    const tap = card.tap(1);

    const response = await handleRequest(new Request("https://test.local/api/identity/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: tap.p, c: tap.c, emoji: "❌" }),
    }), env);

    expect(response.status).toBe(400);
    const json = await response.json() as Record<string, unknown>;
    expect(json.status).toBe("ERROR");
  });

  test("returns demo Backstage grant for unknown card", async () => {
    const env = makeEnv(null);
    const tap = card.tap(1);

    const resp = await makeRequest(`/api/verify-identity?p=${tap.p}&c=${tap.c}`, env);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.verified).toBe(true);
    expect(json.uid).toBe("demo-backstage");
    expect((json.profile as Record<string, unknown>).level).toBe("Backstage");
    expect(json.demoMode).toBe(true);
    expect(json.fallbackReason).toMatch(/not enrolled|not recognized/i);
  });

  test("returns demo Backstage grant for missing p parameter", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/api/verify-identity?c=abcdef", env);
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.verified).toBe(true);
    expect(json.uid).toBe("demo-backstage");
    expect((json.profile as Record<string, unknown>).level).toBe("Backstage");
    expect(json.demoMode).toBe(true);
    expect(json.fallbackReason).toContain("Missing card parameters");
  });

  test("returns demo Backstage grant for missing c parameter", async () => {
    const env = makeEnv();
    const resp = await makeRequest("/api/verify-identity?p=abcdef", env);
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.verified).toBe(true);
    expect(json.uid).toBe("demo-backstage");
    expect((json.profile as Record<string, unknown>).level).toBe("Backstage");
    expect(json.demoMode).toBe(true);
    expect(json.fallbackReason).toContain("Missing card parameters");
  });
});
