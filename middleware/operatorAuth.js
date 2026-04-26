import { base64url } from "@scure/base";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getCookieValue, constantTimeEqual } from "../utils/cookies.js";
import { OPERATOR_SESSION_MAX_AGE, OPERATOR_CSRF_MAX_AGE } from "../utils/constants.js";

const COOKIE_NAME = "op_session";
const CSRF_COOKIE_NAME = "op_csrf";
const SESSION_MAX_AGE = OPERATOR_SESSION_MAX_AGE;
const CSRF_MAX_AGE = OPERATOR_CSRF_MAX_AGE;
const MIN_PIN_LENGTH = 4;
const DEV_PIN = "1234";
const DEV_SESSION_SECRET = "dev-only-session-secret-do-not-use-in-production";

function hmacSign(key, data) {
  const keyBuf = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const dataBuf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const sig = hmac(sha256, keyBuf, dataBuf);
  return base64url.encode(sig);
}

function hmacVerify(key, data, sig) {
  const expected = hmacSign(key, data);
  return constantTimeEqual(expected, sig);
}

function constantTimeComparePin(provided, expected) {
  const a = String(provided || "");
  const b = String(expected || "");
  return constantTimeEqual(a, b);
}

function createSessionPayload(shiftId) {
  return JSON.stringify({
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    shiftId: shiftId || crypto.randomUUID(),
  });
}

function signSession(payload, secret) {
  const b64 = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = hmacSign(secret, b64);
  return `${b64}.${sig}`;
}

function verifyAndParseSession(cookieValue, secret) {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const valid = hmacVerify(secret, b64, sig);
  if (!valid) return null;

  try {
    const payload = JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || now > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getSessionCookie(request) {
  return getCookieValue(request.headers.get("Cookie"), COOKIE_NAME);
}

function buildSessionCookie(value) {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}; Path=/`;
}

function buildExpiredCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

export function requireOperator(request, env) {
  const secret = env.OPERATOR_SESSION_SECRET || DEV_SESSION_SECRET;

  if (env.__TEST_OPERATOR_SESSION && env.WORKER_ENV !== "production") {
    return { authorized: true, session: env.__TEST_OPERATOR_SESSION };
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL(request.url);
    const returnUrl = encodeURIComponent(url.pathname + url.search);
    return {
      authorized: false,
      response: new Response(null, {
        status: 302,
        headers: { Location: `/operator/login?return=${returnUrl}` },
      }),
    };
  }

  const session = verifyAndParseSession(sessionCookie, secret);
  if (!session) {
    const url = new URL(request.url);
    const returnUrl = encodeURIComponent(url.pathname + url.search);
    return {
      authorized: false,
      response: new Response(null, {
        status: 302,
        headers: { Location: `/operator/login?return=${returnUrl}` },
      }),
    };
  }

  return { authorized: true, session };
}

export function validatePinConfig(env) {
  if (env.WORKER_ENV === "production") {
    if (!env.OPERATOR_PIN || typeof env.OPERATOR_PIN !== "string" || env.OPERATOR_PIN.length < MIN_PIN_LENGTH) {
      return false;
    }
    if (!env.OPERATOR_SESSION_SECRET || typeof env.OPERATOR_SESSION_SECRET !== "string") {
      return false;
    }
  }
  if (env.OPERATOR_PIN !== undefined && env.OPERATOR_PIN !== null && env.OPERATOR_PIN !== "") {
    const pin = env.OPERATOR_PIN;
    return typeof pin === "string" && pin.length >= MIN_PIN_LENGTH;
  }
  return true;
}

export function checkPin(provided, env) {
  if (env.WORKER_ENV === "production" && !env.OPERATOR_PIN) {
    throw new Error("OPERATOR_PIN must be set in production");
  }
  const expected = env.OPERATOR_PIN || DEV_PIN;
  return constantTimeComparePin(provided, expected);
}

export function createSession(env) {
  if (env.WORKER_ENV === "production" && !env.OPERATOR_SESSION_SECRET) {
    throw new Error("OPERATOR_SESSION_SECRET must be set in production");
  }
  const secret = env.OPERATOR_SESSION_SECRET || DEV_SESSION_SECRET;
  const shiftId = crypto.randomUUID();
  const payload = createSessionPayload(shiftId);
  const signed = signSession(payload, secret);
  return { cookie: buildSessionCookie(signed), shiftId };
}

export { buildExpiredCookie, COOKIE_NAME, MIN_PIN_LENGTH, CSRF_COOKIE_NAME };

export function buildCsrfCookie(token) {
  return `${CSRF_COOKIE_NAME}=${token}; Secure; SameSite=Strict; Max-Age=${CSRF_MAX_AGE}; Path=/`;
}

