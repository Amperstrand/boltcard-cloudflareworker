import { handleRequest } from "../index.js";
import { makeReplayNamespace } from "./replayNamespace.js";

const baseEnv = {
  BOLT_CARD_K1: "55da174c9608993dc27bb3f30a4a7314,0c3b25d92b38ae443229dd59ad34b85d",
  CARD_REPLAY: makeReplayNamespace(),
};

const VALID_P = "4E2E289D945A66BB13377A728884E867";
const VALID_C = "E19CCB1FED8892CE";
const TEST_UID = "04996c6a926980";

async function makeRequest(path, method = "GET", body = null, requestEnv = baseEnv) {
  const url = "https://test.local" + path;
  const options = { method };
  if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  return handleRequest(new Request(url, options), requestEnv);
}

function makeKvEnv(uidConfig) {
  const replay = makeReplayNamespace();
  const kvStore = { ...uidConfig };
  Object.entries(kvStore).forEach(([uid, config]) => {
    replay.__cardConfigs.set(uid.toLowerCase(), JSON.parse(config));
  });
  return {
    ...baseEnv,
    UID_CONFIG: {
      get: async (key) => kvStore[key] ?? null,
      put: async (key, value) => { kvStore[key] = value; },
    },
    CARD_REPLAY: replay,
  };
}

describe("GET /2fa", () => {
  test("missing p returns 400", async () => {
    const response = await makeRequest("/2fa?c=" + VALID_C);
    expect(response.status).toBe(400);
  });

  test("missing c returns 400", async () => {
    const response = await makeRequest("/2fa?p=" + VALID_P);
    expect(response.status).toBe(400);
  });

  test("invalid p that cannot decrypt returns 400", async () => {
    const response = await makeRequest(
      "/2fa?p=FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF&c=FFFFFFFFFFFFFFFF"
    );
    expect(response.status).toBe(400);
  });

  test("valid p/c with KV config returns 200 HTML with OTP codes", async () => {
    const kvEnv = makeKvEnv({
      [TEST_UID]: JSON.stringify({
        K2: "B45775776CB224C75BCDE7CA3704E933",
        payment_method: "twofactor",
      }),
    });
    const response = await makeRequest(
      `/2fa?p=${VALID_P}&c=${VALID_C}`,
      "GET",
      null,
      kvEnv
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("2FA CODES");
    expect(html).toContain("TOTP");
    expect(html).toContain("HOTP");
    expect(html).toMatch(/\d{6}/);
  });

  test("valid p/c with wrong K2 in KV returns 403", async () => {
    const kvEnv = makeKvEnv({
      [TEST_UID]: JSON.stringify({
        K2: "00000000000000000000000000000000",
        payment_method: "twofactor",
      }),
    });
    const response = await makeRequest(
      `/2fa?p=${VALID_P}&c=${VALID_C}`,
      "GET",
      null,
      kvEnv
    );
    expect(response.status).toBe(403);
  });

  test("valid p/c with correct K2 in KV returns 200 HTML with OTP codes", async () => {
    const kvEnv = makeKvEnv({
      [TEST_UID]: JSON.stringify({
        K2: "B45775776CB224C75BCDE7CA3704E933",
        payment_method: "twofactor",
      }),
    });
    const response = await makeRequest(
      `/2fa?p=${VALID_P}&c=${VALID_C}`,
      "GET",
      null,
      kvEnv
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("TOTP");
    expect(html).toContain("HOTP");
    expect(html).toMatch(/\d{6}/);
  });
});
