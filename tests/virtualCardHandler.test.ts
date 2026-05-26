import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { getDeterministicKeys } from "../keygenerator.js";
import { buildCardTestEnv, TEST_OPERATOR_AUTH } from "./testHelpers.js";
import type { Env } from "../types/core.js";

const TEST_UID = "04a39493cc8680";

function makeEnv(): Env {
  return buildCardTestEnv({ operatorAuth: true });
}

async function makeRequest(path: string, requestEnv: Env | null = null): Promise<Response> {
  const url = "https://test.local" + path;
  return handleRequest(new Request(url), requestEnv || makeEnv());
}

describe("GET /api/debug/virtual-card-keys", () => {
  test("returns k1/k2 for valid UID", async () => {
    const resp = await makeRequest(`/api/debug/virtual-card-keys?uid=${TEST_UID}`);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;

    expect(json.uid).toBe(TEST_UID);
    expect(json.version).toBe(1);
    expect(typeof json.k1).toBe("string");
    expect(typeof json.k2).toBe("string");
    expect(json.k1).toHaveLength(32);
    expect(json.k2).toHaveLength(32);

    // Verify keys match deterministic derivation
    const expected = getDeterministicKeys(TEST_UID, makeEnv(), 1);
    expect(json.k1).toBe(expected.k1);
    expect(json.k2).toBe(expected.k2);
  });

  test("does not expose k0, k3, k4, or cardKey", async () => {
    const resp = await makeRequest(`/api/debug/virtual-card-keys?uid=${TEST_UID}`);
    const json = await resp.text();
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed.k0).toBeUndefined();
    expect(parsed.k3).toBeUndefined();
    expect(parsed.k4).toBeUndefined();
    expect(parsed.cardKey).toBeUndefined();
    expect(parsed.id).toBeUndefined();
  });

  test("rejects missing UID with 400", async () => {
    const resp = await makeRequest("/api/debug/virtual-card-keys");
    expect(resp.status).toBe(400);
  });

  test("rejects invalid UID format (too short) with 400", async () => {
    const resp = await makeRequest("/api/debug/virtual-card-keys?uid=04a3");
    expect(resp.status).toBe(400);
  });

  test("rejects invalid UID format (non-hex) with 400", async () => {
    const resp = await makeRequest("/api/debug/virtual-card-keys?uid=04a39493cc86xx");
    expect(resp.status).toBe(400);
  });

  test("rejects invalid UID format (too long) with 400", async () => {
    const resp = await makeRequest("/api/debug/virtual-card-keys?uid=04a39493cc868011");
    expect(resp.status).toBe(400);
  });

  test("requires operator auth (redirects to login)", async () => {
    const envNoAuth = {
      CARD_REPLAY: makeReplayNamespace(),
    } as unknown as Env;
    const resp = await makeRequest(`/api/debug/virtual-card-keys?uid=${TEST_UID}`, envNoAuth);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toContain("/operator/login");
  });

  test("returns deterministic keys across calls", async () => {
    const resp1 = await makeRequest(`/api/debug/virtual-card-keys?uid=${TEST_UID}`);
    const json1 = (await resp1.json()) as Record<string, unknown>;
    const resp2 = await makeRequest(`/api/debug/virtual-card-keys?uid=${TEST_UID}`);
    const json2 = (await resp2.json()) as Record<string, unknown>;

    expect(json1.k1).toBe(json2.k1);
    expect(json1.k2).toBe(json2.k2);
  });
});
