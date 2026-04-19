import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const env = {
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  CARD_REPLAY: makeReplayNamespace(),
};

// Test vector: p/c that decrypts with K1=55da174c9608993dc27bb3f30a4a7314
const VALID_P = "4E2E289D945A66BB13377A728884E867";
const VALID_C = "E19CCB1FED8892CE";

async function makeRequest(path, method = "GET", body = null, requestEnv = env) {
  const url = "https://test.local" + path;
  const options = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
}

describe("GET /login", () => {
  test("returns HTML login page", async () => {
    const response = await makeRequest("/login");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("NFC LOGIN");
    expect(html).toContain("NTAG424");
  });
});

describe("POST /login (handleLoginVerify)", () => {
  test("missing p returns 400", async () => {
    const response = await makeRequest("/login", "POST", { c: VALID_C });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/missing p or c/i);
  });

  test("missing c returns 400", async () => {
    const response = await makeRequest("/login", "POST", { p: VALID_P });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
  });

  test("missing both p and c returns 400", async () => {
    const response = await makeRequest("/login", "POST", {});
    expect(response.status).toBe(400);
  });

  test("invalid p that cannot be decrypted returns 400", async () => {
    const response = await makeRequest("/login", "POST", {
      p: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
      c: "FFFFFFFFFFFFFFFF",
    });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/could not decrypt/i);
  });

  test("valid p/c returns success with uidHex and keys", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.uidHex).toBeTruthy();
    expect(json.uidHex).toMatch(/^[0-9a-f]{14}$/);
    expect(typeof json.k0).toBe("string");
    expect(typeof json.k1).toBe("string");
    expect(typeof json.k2).toBe("string");
    expect(typeof json.k3).toBe("string");
    expect(typeof json.k4).toBe("string");
    expect(json.k0).toMatch(/^[0-9a-f]{32}$/);
    expect(json.k1).toMatch(/^[0-9a-f]{32}$/);
    expect(json.k2).toMatch(/^[0-9a-f]{32}$/);
    expect(json.k3).toMatch(/^[0-9a-f]{32}$/);
    expect(json.k4).toMatch(/^[0-9a-f]{32}$/);
    expect(typeof json.cmacValid).toBe("boolean");
  });

  test("valid p with wrong c returns success but cmacValid false", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: "0000000000000000",
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.cmacValid).toBe(false);
  });

  test("response includes counterValue", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(typeof json.counterValue).toBe("number");
    expect(json.counterValue).toBeGreaterThan(0);
  });

  test("response includes ndef URL", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(json.ndef).toMatch(/^https:\/\//);
    expect(json.ndef).toContain("p=");
    expect(json.ndef).toContain("c=");
  });

  test("response includes cardType", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(typeof json.cardType).toBe("string");
  });

  test("response includes issuerKey label", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(typeof json.issuerKey).toBe("string");
    expect(json.issuerKey.length).toBeGreaterThan(0);
  });

  test("response includes timestamp", async () => {
    const response = await makeRequest("/login", "POST", {
      p: VALID_P,
      c: VALID_C,
    });
    const json = await response.json();
    expect(typeof json.timestamp).toBe("number");
    expect(json.timestamp).toBeGreaterThan(0);
  });

  test("malformed JSON body returns 500", async () => {
    const url = "https://test.local/login";
    const response = await handleRequest(
      new Request(url, {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }),
      env
    );
    expect(response.status).toBe(500);
  });
});
