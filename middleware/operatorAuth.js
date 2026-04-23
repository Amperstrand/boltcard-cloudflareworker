const COOKIE_NAME = "op_session";
const SESSION_MAX_AGE = 12 * 60 * 60;
const MIN_PIN_LENGTH = 4;
const DEV_PIN = "1234";
const DEV_SESSION_SECRET = "dev-only-session-secret-do-not-use-in-production";

async function hmacSign(key, data) {
  const keyBuf = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const dataBuf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, dataBuf);
  return bufToBase64url(new Uint8Array(sig));
}

async function hmacVerify(key, data, sig) {
  const expected = await hmacSign(key, data);
  return constantTimeEqual(expected, sig);
}

function bufToBase64url(buf) {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBuf(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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

async function signSession(payload, secret) {
  const b64 = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = await hmacSign(secret, b64);
  return `${b64}.${sig}`;
}

async function verifyAndParseSession(cookieValue, secret) {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const valid = await hmacVerify(secret, b64, sig);
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
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

function buildSessionCookie(value) {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}; Path=/`;
}

function buildExpiredCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

export async function requireOperator(request, env) {
  const secret = env.OPERATOR_SESSION_SECRET || DEV_SESSION_SECRET;

  if (env.__TEST_OPERATOR_SESSION) {
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

  const session = await verifyAndParseSession(sessionCookie, secret);
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
  if (env.OPERATOR_PIN !== undefined && env.OPERATOR_PIN !== null && env.OPERATOR_PIN !== "") {
    const pin = env.OPERATOR_PIN;
    return typeof pin === "string" && pin.length >= MIN_PIN_LENGTH;
  }
  return true;
}

export function checkPin(provided, env) {
  const expected = env.OPERATOR_PIN || DEV_PIN;
  return constantTimeComparePin(provided, expected);
}

export async function createSession(env) {
  const secret = env.OPERATOR_SESSION_SECRET || DEV_SESSION_SECRET;
  const shiftId = crypto.randomUUID();
  const payload = createSessionPayload(shiftId);
  const signed = await signSession(payload, secret);
  return { cookie: buildSessionCookie(signed), shiftId };
}

export { buildExpiredCookie, COOKIE_NAME, MIN_PIN_LENGTH };

function errorHtmlResponse(message, status) {
  return new Response(`<!DOCTYPE html><html><head><title>Error</title></head><body><h1>${status}</h1><p>${message}</p></body></html>`, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}
