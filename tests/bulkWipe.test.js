import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";
import { TEST_OPERATOR_AUTH } from "./testHelpers.js";

const env = {
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  CARD_REPLAY: makeReplayNamespace(),
  ...TEST_OPERATOR_AUTH,
};

const VALID_UID = "040660fa967380";
const VALID_KEY = "00000000000000000000000000000001";

async function makeRequest(path, method = "GET", body = null, requestEnv = env) {
  const url = "https://test.local" + path;
  const options = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
}

describe("GET /api/bulk-wipe-keys", () => {
  test("valid request returns 200 with uid, boltcard_response, wipe_json, reset_deeplink", async () => {
    const response = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=${VALID_KEY}`
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toHaveProperty("uid", VALID_UID);
    expect(json).toHaveProperty("boltcard_response");
    expect(json).toHaveProperty("wipe_json");
    expect(json).toHaveProperty("reset_deeplink");
  });

  test("boltcard_response has correct format", async () => {
    const response = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=${VALID_KEY}`
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    const br = json.boltcard_response;

    expect(br.CARD_NAME).toContain(VALID_UID.toUpperCase());
    expect(br.K0).toMatch(/^[0-9A-F]{32}$/);
    expect(br.K1).toMatch(/^[0-9A-F]{32}$/);
    expect(br.K2).toMatch(/^[0-9A-F]{32}$/);
    expect(br.K3).toMatch(/^[0-9A-F]{32}$/);
    expect(br.K4).toMatch(/^[0-9A-F]{32}$/);
    expect(br.PROTOCOL_NAME).toBe("NEW_BOLT_CARD_RESPONSE");
    expect(br.PROTOCOL_VERSION).toBe("1");
    expect(br.LNURLW_BASE).toMatch(/^lnurlw:\/\//);
    expect(br.LNURLW).toMatch(/^lnurlw:\/\//);
  });

  test("wipe_json has correct format", async () => {
    const response = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=${VALID_KEY}`
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    const wj = json.wipe_json;

    expect(wj.version).toBe(1);
    expect(wj.action).toBe("wipe");
    expect(wj.k0).toMatch(/^[0-9a-f]{32}$/);
    expect(wj.k1).toMatch(/^[0-9a-f]{32}$/);
    expect(wj.k2).toMatch(/^[0-9a-f]{32}$/);
    expect(wj.k3).toMatch(/^[0-9a-f]{32}$/);
    expect(wj.k4).toMatch(/^[0-9a-f]{32}$/);
  });

  test("reset_deeplink starts with boltcard://reset?url= and decodes to correct endpoint", async () => {
    const response = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=${VALID_KEY}`
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.reset_deeplink).toMatch(/^boltcard:\/\/reset\?url=/);

    const urlParam = json.reset_deeplink.replace(/^boltcard:\/\/reset\?url=/, "");
    const decodedUrl = decodeURIComponent(urlParam);
    expect(decodedUrl).toContain("/api/bulk-wipe-keys");
    expect(decodedUrl).toContain(`uid=${VALID_UID}`);
    expect(decodedUrl).toContain(`key=${VALID_KEY}`);
  });

  test("deterministic: same uid+key produces same K0-K4", async () => {
    const res1 = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=${VALID_KEY}`
    );
    const json1 = await res1.json();

    const res2 = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=${VALID_KEY}`
    );
    const json2 = await res2.json();

    expect(json1.boltcard_response.K0).toBe(json2.boltcard_response.K0);
    expect(json1.boltcard_response.K1).toBe(json2.boltcard_response.K1);
    expect(json1.boltcard_response.K2).toBe(json2.boltcard_response.K2);
    expect(json1.boltcard_response.K3).toBe(json2.boltcard_response.K3);
    expect(json1.boltcard_response.K4).toBe(json2.boltcard_response.K4);
  });

  test("missing uid returns 400", async () => {
    const response = await makeRequest(
      `/api/bulk-wipe-keys?key=${VALID_KEY}`
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("uid");
  });

  test("missing key returns 400", async () => {
    const response = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}`
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("key");
  });

  test("invalid uid (wrong length) returns 400", async () => {
    const response = await makeRequest(
      `/api/bulk-wipe-keys?uid=040660&key=${VALID_KEY}`
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("uid");
  });

  test("invalid key (wrong length) returns 400", async () => {
    const response = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=abc`
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("key");
  });

  test("different keys produce different K1 for same UID", async () => {
    const keyA = "00000000000000000000000000000000";
    const keyB = "00000000000000000000000000000001";

    const resA = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=${keyA}`
    );
    const jsonA = await resA.json();

    const resB = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=${keyB}`
    );
    const jsonB = await resB.json();

    expect(jsonA.boltcard_response.K1).not.toBe(jsonB.boltcard_response.K1);
  });

  test("POST with JSON body key produces same result as GET", async () => {
    const getRes = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}&key=${VALID_KEY}`
    );
    const getJson = await getRes.json();

    const postRes = await makeRequest(
      `/api/bulk-wipe-keys?uid=${VALID_UID}`,
      "POST",
      { key: VALID_KEY }
    );
    const postJson = await postRes.json();

    expect(postRes.status).toBe(200);
    expect(postJson.boltcard_response.K0).toBe(getJson.boltcard_response.K0);
    expect(postJson.boltcard_response.K2).toBe(getJson.boltcard_response.K2);
  });
});

describe("GET /experimental/bulkwipe", () => {
  test("returns HTML bulk wipe page with key options", async () => {
    const response = await makeRequest("/experimental/bulkwipe");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Bulk");
    expect(html).toContain("optgroup");
  });

  test("returns same result on second call (fingerprint cache)", async () => {
    const res1 = await makeRequest("/experimental/bulkwipe");
    const res2 = await makeRequest("/experimental/bulkwipe");
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const html1 = await res1.text();
    const html2 = await res2.text();
    expect(html1).toBe(html2);
  });
});
