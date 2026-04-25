import { handleRequest } from "../index.js";
import { buildCardTestEnv } from "./testHelpers.js";

const env = buildCardTestEnv({ operatorAuth: true });

const VALID_UID = "040660fa967380";

async function makeRequest(path, method = "GET", body = null, requestEnv = env) {
  const url = "https://test.local" + path;
  const options = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
}

describe("GET /api/keys", () => {
  test("missing uid returns 400", async () => {
    const response = await makeRequest("/api/keys");
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/missing/i);
  });

  test("invalid uid (too short) returns 400", async () => {
    const response = await makeRequest("/api/keys?uid=abc");
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/invalid/i);
  });

  test("valid uid with format=boltcard returns boltcard response", async () => {
    const response = await makeRequest(
      `/api/keys?uid=${VALID_UID}&format=boltcard`
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
    expect(json.K0).toMatch(/^[0-9A-F]{32}$/);
    expect(json.K1).toMatch(/^[0-9A-F]{32}$/);
    expect(json.K2).toMatch(/^[0-9A-F]{32}$/);
    expect(json.K3).toMatch(/^[0-9A-F]{32}$/);
    expect(json.K4).toMatch(/^[0-9A-F]{32}$/);
    expect(json.LNURLW_BASE).toMatch(/^lnurlw:\/\//);
    expect(json.LNURLW).toMatch(/^lnurlw:\/\//);
  });

  test("valid uid without format returns keysets array", async () => {
    const response = await makeRequest(`/api/keys?uid=${VALID_UID}`);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.uid).toBe(VALID_UID.toLowerCase());
    expect(Array.isArray(json.keysets)).toBe(true);
    expect(json.keysets.length).toBeGreaterThan(0);
    const ks = json.keysets[0];
    expect(ks.k0).toBeTruthy();
    expect(ks.k1).toBeTruthy();
    expect(ks.k2).toBeTruthy();
    expect(ks.source).toBeTruthy();
  });

  test("unknown uid derives keys from default issuer (returns 200)", async () => {
    const response = await makeRequest("/api/keys?uid=99999999999999");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.uid).toBe("99999999999999");
    expect(Array.isArray(json.keysets)).toBe(true);
    expect(json.keysets.length).toBeGreaterThan(0);
  });

  test("per-card UID returns percard keyset in listing", async () => {
    const response = await makeRequest("/api/keys?uid=040a69fa967380");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.keysets.some(ks => ks.source === "percard")).toBe(true);
    const percard = json.keysets.find(ks => ks.source === "percard");
    expect(percard.k0).toBeDefined();
    expect(percard.k1).toBeDefined();
    expect(percard.k2).toBeDefined();
  });

  test("per-card UID with format=boltcard returns boltcard response", async () => {
    const response = await makeRequest("/api/keys?uid=040a69fa967380&format=boltcard");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
    expect(json.K0).toMatch(/^[0-9A-F]{32}$/);
  });

  test("per-card UID with format=boltcard via POST", async () => {
    const response = await makeRequest("/api/keys", "POST", { uid: "040a69fa967380" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
  });

  test("keysets include card_key for deterministic entries", async () => {
    const response = await makeRequest(`/api/keys?uid=${VALID_UID}`);
    expect(response.status).toBe(200);
    const json = await response.json();
    const det = json.keysets.find(ks => ks.source === "deterministic");
    expect(det).toBeDefined();
    expect(det.card_key).toMatch(/^[0-9a-f]{32}$/);
  });

  test("keysets include version info", async () => {
    const response = await makeRequest(`/api/keys?uid=${VALID_UID}`);
    expect(response.status).toBe(200);
    const json = await response.json();
    const det = json.keysets.find(ks => ks.source === "deterministic");
    expect(det.version).toBeDefined();
  });
});

describe("POST /api/keys", () => {
  test("POST with uid in body returns boltcard response", async () => {
    const response = await makeRequest("/api/keys", "POST", {
      UID: VALID_UID,
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
  });

  test("POST with lowercase uid in body works", async () => {
    const response = await makeRequest("/api/keys", "POST", {
      uid: VALID_UID.toLowerCase(),
    });
    expect(response.status).toBe(200);
  });

  test("POST with uid in query param works", async () => {
    const response = await makeRequest(
      `/api/keys?uid=${VALID_UID}`,
      "POST",
      {}
    );
    expect(response.status).toBe(200);
  });

  test("POST with invalid JSON returns 400", async () => {
    const url = "https://test.local/api/keys";
    const response = await handleRequest(
      new Request(url, {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }),
      env
    );
    expect(response.status).toBe(400);
  });

  test("POST without uid returns 400", async () => {
    const response = await makeRequest("/api/keys", "POST", {});
    expect(response.status).toBe(400);
  });

  test("POST with invalid uid returns 400", async () => {
    const response = await makeRequest("/api/keys", "POST", {
      UID: "invalid",
    });
    expect(response.status).toBe(400);
  });
});
