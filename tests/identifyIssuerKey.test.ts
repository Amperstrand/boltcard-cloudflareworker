import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { TestCard } from "@ntag424/crypto/test";
import { buildCardTestEnv, virtualTap } from "./testHelpers.js";
import type { Env } from "../types/core.js";

const BOLT_CARD_K1 = "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d";
const TEST_UID = "04a39493cc8680";
const ISSUER_KEY = "00000000000000000000000000000001";

function makeEnv(): Env {
  return buildCardTestEnv({ operatorAuth: true, extraEnv: { BOLT_CARD_K1 } });
}

async function makeRequest(path: string, method: string = "GET", body: Record<string, unknown> | null = null, requestEnv: Env | null = null): Promise<Response> {
  const url = "https://test.local" + path;
  const options: RequestInit = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv || makeEnv());
}

describe("POST /api/identify-issuer-key", () => {
  let pHex: string;
  let cHex: string;

  beforeAll(async () => {
    const card = new TestCard(TEST_UID, ISSUER_KEY);
    const tap = card.tap(1);
    pHex = tap.p;
    cHex = tap.c;
  });

  test("returns matched: true for a known issuer key", async () => {
    const resp = await makeRequest("/api/identify-issuer-key", "POST", { p: pHex, c: cHex });
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.matched).toBe(true);
    expect(json.uid).toBe(TEST_UID);
    expect(json.version).toBe(1);
    expect(json.issuerKeyFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(json.issuerKeyLabel).toBeDefined();
    expect(json.isPercard).toBe(false);
  });

  test("fingerprint is deterministic SHA-256 prefix", async () => {
    const resp1 = await makeRequest("/api/identify-issuer-key", "POST", { p: pHex, c: cHex });
    const json1 = await resp1.json() as Record<string, unknown>;
    const resp2 = await makeRequest("/api/identify-issuer-key", "POST", { p: pHex, c: cHex });
    const json2 = await resp2.json() as Record<string, unknown>;
    expect(json1.issuerKeyFingerprint).toBe(json2.issuerKeyFingerprint);
  });

  test("does not expose raw issuer key", async () => {
    const resp = await makeRequest("/api/identify-issuer-key", "POST", { p: pHex, c: cHex });
    const json = await resp.json() as Record<string, unknown>;
    const bodyStr = JSON.stringify(json);
    expect(bodyStr).not.toContain("00000000000000000000000000000001");
  });

  test("returns matched: false for unknown issuer key (random p/c)", async () => {
    const resp = await makeRequest("/api/identify-issuer-key", "POST", {
      p: "aabbccdd11223344aabbccdd11223344",
      c: "1122334455667788",
    });
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.matched).toBe(false);
  });

  test("returns 400 for missing p", async () => {
    const resp = await makeRequest("/api/identify-issuer-key", "POST", { c: cHex });
    expect(resp.status).toBe(400);
  });

  test("returns 400 for missing c", async () => {
    const resp = await makeRequest("/api/identify-issuer-key", "POST", { p: pHex });
    expect(resp.status).toBe(400);
  });

  test("returns 400 for missing body", async () => {
    const resp = await makeRequest("/api/identify-issuer-key", "POST");
    expect(resp.status).toBe(400);
  });

  test("requires operator auth (redirects to login)", async () => {
    const envNoAuth = {
      BOLT_CARD_K1: BOLT_CARD_K1,
      CARD_REPLAY: makeReplayNamespace() as any,
    } as unknown as Env;
    const resp = await makeRequest("/api/identify-issuer-key", "POST", { p: pHex, c: cHex }, envNoAuth);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toContain("/operator/login");
  });

  test("returns 500 on unexpected error", async () => {
    const brokenEnv = new Proxy(makeEnv(), {
      get(target, prop) {
        if (prop === "BOLT_CARD_K1") throw new Error("boom");
        return Reflect.get(target, prop);
      },
    }) as Env;
    const resp = await makeRequest("/api/identify-issuer-key", "POST", { p: pHex, c: cHex }, brokenEnv);
    expect(resp.status).toBe(500);
  });

  test("clamps candidates to MAX_CANDIDATES (50)", async () => {
    const env = makeEnv();
    const keyList: string[] = [];
    for (let i = 0; i < 60; i++) {
      keyList.push(i.toString(16).padStart(32, '0'));
    }
    (env as any).RECOVERY_ISSUER_KEYS = keyList.join(',');
    const resp = await makeRequest("/api/identify-issuer-key", "POST", { p: pHex, c: cHex }, env);
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.matched).toBe(true);
  });
});

describe("GET /api/bulk-wipe-keys with version parameter", () => {
  test("version defaults to 1", async () => {
    const resp = await makeRequest(
      `/api/bulk-wipe-keys?uid=${TEST_UID}&key=00000000000000000000000000000001`
    );
    const json = await resp.json() as any;
    expect(json.wipe_json.version).toBe(1);
    expect(json.boltcard_response.Version).toBe(1);
  });

  test("version=3 produces different keys than version=1", async () => {
    const resp1 = await makeRequest(
      `/api/bulk-wipe-keys?uid=${TEST_UID}&key=00000000000000000000000000000001&version=1`
    );
    const json1 = await resp1.json() as any;

    const resp3 = await makeRequest(
      `/api/bulk-wipe-keys?uid=${TEST_UID}&key=00000000000000000000000000000001&version=3`
    );
    const json3 = await resp3.json() as any;

    expect(json3.wipe_json.version).toBe(3);
    expect(json3.boltcard_response.Version).toBe(3);
    expect(json3.boltcard_response.K0).not.toBe(json1.boltcard_response.K0);
    expect(json3.boltcard_response.K2).not.toBe(json1.boltcard_response.K2);
    expect(json3.boltcard_response.K1).toBe(json1.boltcard_response.K1);
  });

  test("version=0 is accepted", async () => {
    const resp = await makeRequest(
      `/api/bulk-wipe-keys?uid=${TEST_UID}&key=00000000000000000000000000000001&version=0`
    );
    const json = await resp.json() as any;
    expect(json.wipe_json.version).toBe(0);
    expect(json.boltcard_response.Version).toBe(0);
  });
});

describe("POST /api/identify-issuer-key per-card fallback", () => {
  test("per-card UID validates via first loop with known issuer key", async () => {
    const perCardUid = "040a69fa967380";
    const perCardK1 = "3db8852a71d11fa0adb6babaf274af89";
    const perCardK2 = "ce08c57983d65fceaa571e248390790f";

    const { pHex: localPHex, cHex: localCHex } = virtualTap(perCardUid, 4, perCardK1, perCardK2);

    const perCardEnv = {
      ...makeEnv(),
      BOLT_CARD_K1: BOLT_CARD_K1 + "," + perCardK1,
    } as Env;

    const resp = await makeRequest(
      "/api/identify-issuer-key",
      "POST",
      { p: localPHex, c: localCHex },
      perCardEnv
    );

    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.matched).toBe(true);
    expect(json.uid).toBe(perCardUid);
    expect(json.isPercard).toBe(true);
    expect(json.version).toBe(1);
    expect(json.issuerKeyLabel).toBeDefined();
  });

  test("per-card fallback with wrong CMAC returns matched false", async () => {
    const perCardUid = "040a69fa967380";
    const perCardK1 = "3db8852a71d11fa0adb6babaf274af89";

    const { pHex: localPHex } = virtualTap(perCardUid, 5, perCardK1, "00000000000000000000000000000000");

    const perCardEnv = {
      ...makeEnv(),
      BOLT_CARD_K1: BOLT_CARD_K1 + "," + perCardK1,
    } as Env;

    const resp = await makeRequest(
      "/api/identify-issuer-key",
      "POST",
      { p: localPHex, c: "0000000000000000" },
      perCardEnv
    );

    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, unknown>;
    expect(json.matched).toBe(false);
  });
});
