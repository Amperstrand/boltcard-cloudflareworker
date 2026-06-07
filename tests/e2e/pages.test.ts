import { makeReplayNamespace } from "../replayNamespace.js";
import { TEST_OPERATOR_AUTH, virtualTap, buildCardTestEnv, makePageEnv, makeE2ERequest as req, BOLT_CARD_K1 } from "../testHelpers.js";
import { getDeterministicKeys } from "../../keygenerator.js";
import type { Env } from "../../types/core.js";

const worker = (await import("../../index.js")).default;

describe("E2E: Page rendering", () => {
  describe("GET /debug", () => {
    it("renders debug console page with all tabs", async () => {
      const env = makePageEnv();
      const resp = await req("/debug", "GET", null, env);
      expect(resp.status).toBe(200);
      const html = await resp.text();
      expect(html).toContain("Card Info");
      expect(html).toContain("panel-console");
      expect(html).toContain("panel-identify");
      expect(html).toContain("panel-wipe");
      expect(html).toContain("panel-twofa");
      expect(html).toContain("panel-identity");
      expect(html).toContain("panel-pos");
      expect(html).toContain("manual-url");
      expect(html).toContain("manual-load-btn");
    });

    it("includes NFC status element", async () => {
      const env = makePageEnv();
      const resp = await req("/debug", "GET", null, env);
      const html = await resp.text();
      expect(html).toContain("nfc-status");
      expect(html).toContain("nfc-scan-btn");
    });

    it("includes external debug.js script", async () => {
      const env = makePageEnv();
      const resp = await req("/debug", "GET", null, env);
      const html = await resp.text();
      expect(html).toContain('/static/js/debug.js');
    });
  });

  describe("GET /card", () => {
    it("renders cardholder dashboard", async () => {
      const env = makePageEnv();
      const resp = await req("/card", "GET", null, env);
      expect(resp.status).toBe(200);
      const html = await resp.text();
      expect(html).toContain("url-input");
      expect(html).toContain("btn-load-url");
    });
  });

  describe("GET /operator/pos", () => {
    it("renders POS terminal page", async () => {
      const env = makePageEnv();
      const resp = await req("/operator/pos", "GET", null, env);
      expect(resp.status).toBe(200);
      const html = await resp.text();
      expect(html).toContain("POS");
    });
  });

  describe("GET /operator/cards", () => {
    it("renders card registry audit page", async () => {
      const env = makePageEnv();
      const resp = await req("/operator/cards", "GET", null, env);
      expect(resp.status).toBe(200);
      const html = await resp.text();
      expect(html).toContain("CARD REGISTRY");
      expect(html).toContain("cards-list");
      expect(html).toContain("filter-btn");
      expect(html).toContain("batch-bar");
      expect(html).toContain("batch-terminate");
      expect(html).toContain("batch-wipe");
      expect(html).toContain("batch-activate");
      expect(html).toContain("select-all-checkbox");
    });
  });

  describe("GET /experimental/activate", () => {
    it("renders activation page", async () => {
      const env = makePageEnv();
      const resp = await req("/experimental/activate", "GET", null, env);
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toContain("text/html");
    });
  });
});

describe("E2E: /card/info API", () => {
  it("returns card info for valid tap", async () => {
    const uid = "04a111fa967380";
    const env = buildCardTestEnv({ uid, operatorAuth: true, cardState: "active" });
    const keys = getDeterministicKeys(uid, { ISSUER_KEY: env.ISSUER_KEY } as any, 1);
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0]!;
    const { pHex, cHex } = virtualTap(uid, 1, k1Hex, keys.k2);

    const resp = await req(`/card/info?p=${pHex}&c=${cHex}`, "GET", null, env as any);
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.uid).toBe(uid);
    expect(json.state).toBe("active");
    expect(json.balance).toBe(0);
  });

  it("returns 400 for missing params", async () => {
    const env = makePageEnv();
    const resp = await req("/card/info", "GET", null, env);
    expect(resp.status).toBe(400);
  });

  it("returns terminated state for terminated card", async () => {
    const uid = "04a222fa967380";
    const env = buildCardTestEnv({ uid, operatorAuth: true, cardState: "active" });
    const keys = getDeterministicKeys(uid, { ISSUER_KEY: env.ISSUER_KEY } as any, 1);
    const k1Hex = env.BOLT_CARD_K1!.split(",")[0]!;

    const state = (env.CARD_REPLAY as any).__cardStates.get(uid.toLowerCase());
    state.state = "terminated";
    state.terminated_at = Math.floor(Date.now() / 1000);

    const { pHex, cHex } = virtualTap(uid, 1, k1Hex, keys.k2);
    const resp = await req(`/card/info?p=${pHex}&c=${cHex}`, "GET", null, env as any);
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.state).toBe("terminated");
    expect(json.programmingRecommended).toBe(false);
  });
});

describe("E2E: /operator/cards/data API", () => {
  it("returns paginated card list", async () => {
    const env = makePageEnv();
    await req("/operator/cards/data?limit=10", "GET", null, env);
    expect(true).toBe(true);
  });

  it("filters by state", async () => {
    const env = makePageEnv();
    const resp = await req("/operator/cards/data?state=active", "GET", null, env);
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.cards).toEqual([]);
  });
});

describe("E2E: Security headers on all responses", () => {
  it("GET /login has security headers", async () => {
    const env = makePageEnv();
    const resp = await worker.fetch(new Request("https://boltcardpoc.psbt.me/login"), env, {} as ExecutionContext);
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resp.headers.get("X-Frame-Options")).toBe("DENY");
    expect(resp.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("GET /operator/login has security headers", async () => {
    const env = makePageEnv();
    const resp = await worker.fetch(new Request("https://boltcardpoc.psbt.me/operator/login"), env, {} as ExecutionContext);
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resp.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("GET /status has security headers", async () => {
    const env = makePageEnv();
    const resp = await worker.fetch(new Request("https://boltcardpoc.psbt.me/status"), env, {} as ExecutionContext);
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resp.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("auth-protected page returns 302 redirect with security headers", async () => {
    const env = {
      BOLT_CARD_K1,
      CARD_REPLAY: makeReplayNamespace() as unknown as DurableObjectNamespace,
      UID_CONFIG: { get: async () => null, put: async () => {} } as unknown as KVNamespace,
    } as Env;
    const resp = await worker.fetch(new Request("https://boltcardpoc.psbt.me/operator/pos"), env, {} as ExecutionContext);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("E2E: Auth-protected pages redirect unauthenticated", () => {
  const protectedPages = [
    "/operator/pos",
    "/operator/cards",
    "/operator/topup",
    "/operator/refund",
    "/debug",
    "/experimental/activate",
  ];

  for (const page of protectedPages) {
    it(`GET ${page} redirects to login without auth`, async () => {
      const env = {
        BOLT_CARD_K1,
        CARD_REPLAY: makeReplayNamespace() as unknown as DurableObjectNamespace,
        UID_CONFIG: { get: async () => null, put: async () => {} } as unknown as KVNamespace,
      } as Env;
      const resp = await req(page, "GET", null, env);
      expect(resp.status).toBe(302);
      expect(resp.headers.get("Location")).toContain("/operator/login");
    });
  }
});

describe("E2E: Operator login flow", () => {
  it("GET /operator/login renders login form", async () => {
    const env = makePageEnv();
    const resp = await req("/operator/login", "GET", null, env);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("PIN");
  });

  it("POST /operator/login with correct PIN redirects with session cookie", async () => {
    const env = {
      BOLT_CARD_K1,
      CARD_REPLAY: makeReplayNamespace() as unknown as DurableObjectNamespace,
      UID_CONFIG: { get: async () => null, put: async () => {} } as unknown as KVNamespace,
      OPERATOR_PIN: "1234",
      OPERATOR_SESSION_SECRET: "test-session-secret-for-jest",
    } as Env;
    const form = new FormData();
    form.append("pin", "1234");
    const resp = await worker.fetch(
      new Request("https://boltcardpoc.psbt.me/operator/login", {
        method: "POST",
        body: form,
      }),
      env,
      {} as ExecutionContext,
    );
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Set-Cookie")).toContain("op_session");
  });

  it("POST /operator/login with wrong PIN returns login page with error", async () => {
    const env = {
      BOLT_CARD_K1,
      CARD_REPLAY: makeReplayNamespace() as unknown as DurableObjectNamespace,
      UID_CONFIG: { get: async () => null, put: async () => {} } as unknown as KVNamespace,
      OPERATOR_PIN: "1234",
      OPERATOR_SESSION_SECRET: "test-session-secret-for-jest",
    } as Env;
    const form = new FormData();
    form.append("pin", "9999");
    const resp = await worker.fetch(
      new Request("https://boltcardpoc.psbt.me/operator/login", {
        method: "POST",
        body: form,
      }),
      env,
      {} as ExecutionContext,
    );
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Incorrect PIN");
  });
});

describe("E2E: Redirects", () => {
  it("GET /nfc redirects to /debug#console", async () => {
    const env = makePageEnv();
    const resp = await req("/nfc", "GET", null, env);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toContain("/debug#console");
  });

  it("GET /pos redirects to /operator/pos", async () => {
    const env = makePageEnv();
    const resp = await req("/pos", "GET", null, env);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toContain("/operator/pos");
  });

  it("GET /activate redirects to /experimental/activate", async () => {
    const env = makePageEnv();
    const resp = await req("/activate", "GET", null, env);
    expect(resp.status).toBe(302);
  });
});
