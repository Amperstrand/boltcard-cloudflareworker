import {
  requireOperator,
  validatePinConfig,
  checkPin,
  createSession,
  buildExpiredCookie,
  buildCsrfCookie,
  COOKIE_NAME,
  MIN_PIN_LENGTH,
} from "../middleware/operatorAuth.js";
import { isHttpsRequest } from "../utils/cookies.js";
import type { Env } from "../types/core.js";

const TEST_SECRET = "test-session-secret-for-jest";
const TEST_PIN = "1234";

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return { OPERATOR_PIN: TEST_PIN, OPERATOR_SESSION_SECRET: TEST_SECRET, ...overrides } as unknown as Env;
}

function makeRequest(cookies: Record<string, string> = {}) {
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new Request("http://localhost/operator/pos", {
    headers: cookies.op_session ? { Cookie: cookieStr } : {},
  });
}

async function createTestSession(env: Env) {
  const { cookie } = await createSession(env, true);
  const match = cookie.match(/op_session=([^;]+)/);
  return match![1]!;
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
    expect(checkPin("1234", makeEnv())).toBe(true);
    expect(checkPin("0000", makeEnv())).toBe(false);
  });
});

describe("createSession", () => {
  it("returns a signed cookie string", async () => {
    const { cookie, shiftId } = await createSession(makeEnv(), true);
    expect(cookie).toContain("op_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(typeof shiftId).toBe("string");
    expect(shiftId.length).toBeGreaterThan(0);
  });

  it("uses dev fallback secret when OPERATOR_SESSION_SECRET is not set", async () => {
    const env = makeEnv({ OPERATOR_SESSION_SECRET: "" });
    const { cookie, shiftId } = await createSession(env, true);
    expect(cookie).toContain("op_session=");
    expect(typeof shiftId).toBe("string");
  });
});

describe("requireOperator", () => {
  it("returns unauthorized with redirect when no cookie", async () => {
    const request = makeRequest();
    const result = await requireOperator(request, makeEnv());
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.response.status).toBe(302);
    expect(result.response.headers.get("Location")).toContain("/operator/login");
  });

  it("uses dev fallback secret when OPERATOR_SESSION_SECRET is missing", async () => {
    const request = makeRequest();
    const result = await requireOperator(request, makeEnv({ OPERATOR_SESSION_SECRET: "" }));
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.response.status).toBe(302);
    expect(result.response.headers.get("Location")).toContain("/operator/login");
  });

  it("returns unauthorized for invalid cookie", async () => {
    const request = makeRequest({ op_session: "invalid.signature" });
    const result = await requireOperator(request, makeEnv());
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.response.status).toBe(302);
  });

  it("returns authorized for valid session cookie", async () => {
    const sessionValue = await createTestSession(makeEnv());
    const request = makeRequest({ op_session: sessionValue });
    const result = await requireOperator(request, makeEnv());
    expect(result.authorized).toBe(true);
    if (!result.authorized) return;
    expect(result.session).toBeDefined();
    expect(result.session.shiftId).toBeDefined();
    expect(result.session.iat).toBeDefined();
    expect(result.session.exp).toBeDefined();
  });

  it("returns unauthorized for expired session", async () => {
    vi.useFakeTimers();
    const sessionValue = await createTestSession(makeEnv());
    vi.advanceTimersByTime(13 * 60 * 60 * 1000);
    const request = makeRequest({ op_session: sessionValue });
    const result = await requireOperator(request, makeEnv());
    expect(result.authorized).toBe(false);
    vi.useRealTimers();
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
    const cookie = buildExpiredCookie(true);
    expect(cookie).toContain("op_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });
});

describe("cookie Secure attribute follows request scheme", () => {
  it("session cookie includes Secure for https requests", async () => {
    const { cookie } = await createSession(makeEnv(), true);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("HttpOnly");
  });

  it("session cookie omits Secure for plain-http local dev", async () => {
    const { cookie } = await createSession(makeEnv(), false);
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("HttpOnly");
  });

  it("expired cookie omits Secure for plain-http local dev", () => {
    expect(buildExpiredCookie(false)).not.toContain("Secure");
    expect(buildExpiredCookie(false)).toContain("Max-Age=0");
  });

  it("CSRF cookie includes Secure on https and omits it on http", () => {
    expect(buildCsrfCookie("token-x", true)).toContain("Secure");
    expect(buildCsrfCookie("token-x", false)).not.toContain("Secure");
    expect(buildCsrfCookie("token-x", false)).toContain("op_csrf=token-x");
  });

  it("isHttpsRequest derives the flag from the request URL and fails secure", () => {
    expect(isHttpsRequest(new Request("https://boltcardpoc.psbt.me/operator"))).toBe(true);
    expect(isHttpsRequest(new Request("http://127.0.0.1:8787/operator"))).toBe(false);
    expect(isHttpsRequest(new Request("http://192.168.13.221:8787/operator"))).toBe(false);
    expect(isHttpsRequest(new Request("https://localhost:8787/operator"))).toBe(true);
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
  const prodEnv = { WORKER_ENV: "production" } as unknown as Env;

  it("validatePinConfig rejects missing PIN in production", () => {
    expect(validatePinConfig({ ...prodEnv })).toBe(false);
  });

  it("validatePinConfig rejects short PIN in production", () => {
    expect(validatePinConfig({ ...prodEnv, OPERATOR_PIN: "12" } as unknown as Env)).toBe(false);
  });

  it("validatePinConfig rejects missing SESSION_SECRET in production", () => {
    expect(validatePinConfig({ ...prodEnv, OPERATOR_PIN: "1234" } as unknown as Env)).toBe(false);
  });

  it("validatePinConfig accepts properly configured production env", () => {
    expect(validatePinConfig({ ...prodEnv, OPERATOR_PIN: "1234", OPERATOR_SESSION_SECRET: "real-secret" } as unknown as Env)).toBe(true);
  });

  it("checkPin throws in production when OPERATOR_PIN is missing", () => {
    expect(() => checkPin("1234", prodEnv)).toThrow("OPERATOR_PIN must be set in production");
  });

  it("createSession throws in production when OPERATOR_SESSION_SECRET is missing", () => {
    expect(() => createSession(prodEnv, true)).toThrow("OPERATOR_SESSION_SECRET must be set in production");
  });

  it("__TEST_OPERATOR_SESSION bypass is ignored in production", async () => {
    const prodTestEnv = { ...prodEnv, __TEST_OPERATOR_SESSION: { shiftId: "evil" } as any } as unknown as Env;
    const request = makeRequest();
    const result = await requireOperator(request, prodTestEnv);
    expect(result.authorized).toBe(false);
  });

  it("__TEST_OPERATOR_SESSION bypass works in non-production", async () => {
    const devTestEnv = { __TEST_OPERATOR_SESSION: { shiftId: "test-shift" } as any } as unknown as Env;
    const request = makeRequest();
    const result = await requireOperator(request, devTestEnv);
    expect(result.authorized).toBe(true);
    if (!result.authorized) return;
    expect(result.session.shiftId).toBe("test-shift");
  });
});
