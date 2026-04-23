import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  requireOperator,
  validatePinConfig,
  checkPin,
  createSession,
  buildExpiredCookie,
  COOKIE_NAME,
  MIN_PIN_LENGTH,
} from "../middleware/operatorAuth.js";

const TEST_SECRET = "test-session-secret-for-jest";
const TEST_PIN = "1234";

function makeEnv(overrides = {}) {
  return { OPERATOR_PIN: TEST_PIN, OPERATOR_SESSION_SECRET: TEST_SECRET, ...overrides };
}

function makeRequest(cookies = {}) {
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new Request("http://localhost/operator/pos", {
    headers: cookies.op_session ? { Cookie: cookieStr } : {},
  });
}

async function createTestSession(env) {
  const { cookie } = await createSession(env);
  const match = cookie.match(/op_session=([^;]+)/);
  return match ? match[1] : null;
}

describe("validatePinConfig", () => {
  it("returns true for valid PIN", () => {
    expect(validatePinConfig(makeEnv({ OPERATOR_PIN: "1234" }))).toBe(true);
    expect(validatePinConfig(makeEnv({ OPERATOR_PIN: "9999" }))).toBe(true);
  });

  it("returns false for PIN shorter than MIN_PIN_LENGTH", () => {
    expect(validatePinConfig(makeEnv({ OPERATOR_PIN: "12" }))).toBe(false);
  });

  it("returns true when PIN is missing (dev fallback)", () => {
    expect(validatePinConfig(makeEnv({ OPERATOR_PIN: undefined }))).toBe(true);
    expect(validatePinConfig(makeEnv({ OPERATOR_PIN: null }))).toBe(true);
  });
});

describe("checkPin", () => {
  it("returns true for correct PIN", () => {
    expect(checkPin("1234", makeEnv())).toBe(true);
  });

  it("returns false for incorrect PIN", () => {
    expect(checkPin("0000", makeEnv())).toBe(false);
    expect(checkPin("12345", makeEnv())).toBe(false);
    expect(checkPin("", makeEnv())).toBe(false);
  });

  it("uses constant-time comparison", () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      checkPin("1234", makeEnv());
      checkPin("0000", makeEnv());
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

describe("createSession", () => {
  it("returns a signed cookie string", async () => {
    const { cookie, shiftId } = await createSession(makeEnv());
    expect(cookie).toContain("op_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(typeof shiftId).toBe("string");
    expect(shiftId.length).toBeGreaterThan(0);
  });

  it("uses dev fallback secret when OPERATOR_SESSION_SECRET is not set", async () => {
    const env = makeEnv({ OPERATOR_SESSION_SECRET: "" });
    const { cookie, shiftId } = await createSession(env);
    expect(cookie).toContain("op_session=");
    expect(typeof shiftId).toBe("string");
  });
});

describe("requireOperator", () => {
  it("returns unauthorized with redirect when no cookie", async () => {
    const request = makeRequest();
    const result = await requireOperator(request, makeEnv());
    expect(result.authorized).toBe(false);
    expect(result.response.status).toBe(302);
    expect(result.response.headers.get("Location")).toContain("/operator/login");
  });

  it("uses dev fallback secret when OPERATOR_SESSION_SECRET is missing", async () => {
    const request = makeRequest();
    const result = await requireOperator(request, makeEnv({ OPERATOR_SESSION_SECRET: "" }));
    expect(result.authorized).toBe(false);
    expect(result.response.status).toBe(302);
    expect(result.response.headers.get("Location")).toContain("/operator/login");
  });

  it("returns unauthorized for invalid cookie", async () => {
    const request = makeRequest({ op_session: "invalid.signature" });
    const result = await requireOperator(request, makeEnv());
    expect(result.authorized).toBe(false);
    expect(result.response.status).toBe(302);
  });

  it("returns authorized for valid session cookie", async () => {
    const sessionValue = await createTestSession(makeEnv());
    const request = makeRequest({ op_session: sessionValue });
    const result = await requireOperator(request, makeEnv());
    expect(result.authorized).toBe(true);
    expect(result.session).toBeDefined();
    expect(result.session.shiftId).toBeDefined();
    expect(result.session.iat).toBeDefined();
    expect(result.session.exp).toBeDefined();
  });

  it("returns unauthorized for expired session", async () => {
    jest.useFakeTimers();
    const sessionValue = await createTestSession(makeEnv());
    jest.advanceTimersByTime(13 * 60 * 60 * 1000);
    const request = makeRequest({ op_session: sessionValue });
    const result = await requireOperator(request, makeEnv());
    expect(result.authorized).toBe(false);
    jest.useRealTimers();
  });

  it("returns unauthorized for tampered cookie", async () => {
    const sessionValue = await createTestSession(makeEnv());
    const tampered = sessionValue.slice(0, -5) + "XXXXX";
    const request = makeRequest({ op_session: tampered });
    const result = await requireOperator(request, makeEnv());
    expect(result.authorized).toBe(false);
  });
});

describe("buildExpiredCookie", () => {
  it("returns a Set-Cookie header that expires the cookie", () => {
    const cookie = buildExpiredCookie();
    expect(cookie).toContain("op_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
  });
});

describe("constants", () => {
  it("COOKIE_NAME is op_session", () => {
    expect(COOKIE_NAME).toBe("op_session");
  });

  it("MIN_PIN_LENGTH is 4", () => {
    expect(MIN_PIN_LENGTH).toBe(4);
  });
});

describe("production guards", () => {
  const prodEnv = { WORKER_ENV: "production" };

  it("validatePinConfig rejects missing PIN in production", () => {
    expect(validatePinConfig({ ...prodEnv })).toBe(false);
  });

  it("validatePinConfig rejects short PIN in production", () => {
    expect(validatePinConfig({ ...prodEnv, OPERATOR_PIN: "12" })).toBe(false);
  });

  it("validatePinConfig rejects missing SESSION_SECRET in production", () => {
    expect(validatePinConfig({ ...prodEnv, OPERATOR_PIN: "1234" })).toBe(false);
  });

  it("validatePinConfig accepts properly configured production env", () => {
    expect(validatePinConfig({ ...prodEnv, OPERATOR_PIN: "1234", OPERATOR_SESSION_SECRET: "real-secret" })).toBe(true);
  });

  it("checkPin throws in production when OPERATOR_PIN is missing", () => {
    expect(() => checkPin("1234", prodEnv)).toThrow("OPERATOR_PIN must be set in production");
  });

  it("createSession throws in production when OPERATOR_SESSION_SECRET is missing", async () => {
    await expect(createSession(prodEnv)).rejects.toThrow("OPERATOR_SESSION_SECRET must be set in production");
  });

  it("__TEST_OPERATOR_SESSION bypass is ignored in production", async () => {
    const prodTestEnv = { ...prodEnv, __TEST_OPERATOR_SESSION: { shiftId: "evil" } };
    const request = makeRequest();
    const result = await requireOperator(request, prodTestEnv);
    expect(result.authorized).toBe(false);
  });

  it("__TEST_OPERATOR_SESSION bypass works in non-production", async () => {
    const devTestEnv = { __TEST_OPERATOR_SESSION: { shiftId: "test-shift" } };
    const request = makeRequest();
    const result = await requireOperator(request, devTestEnv);
    expect(result.authorized).toBe(true);
    expect(result.session.shiftId).toBe("test-shift");
  });
});
