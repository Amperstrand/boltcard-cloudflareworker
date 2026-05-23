// Integration test helpers — runs full Worker HTTP pipeline via exports.default.fetch()
// in miniflare with real SQLite DO + KV. Zero network egress.
//
// Usage: import { apiFetch, operatorLogin, provisionCard, ... } from "./helpers.js";

import { exports } from "cloudflare:workers";
import { virtualTap as _virtualTap } from "../testHelpers.js";
import { getDeterministicKeys } from "../../keygenerator.js";
import type { Env } from "../../types/core.js";

// ── Constants ────────────────────────────────────────────────────────────────

const PULL_PAYMENT_ID = "fUDXsnySxvb5LYZ1bSLiWzLjVuT";
const ISSUER_KEY = "00000000000000000000000000000001";
const OPERATOR_PIN = "1234";

// ── Unique ID generation ─────────────────────────────────────────────────────

let uidSeq = 0;

/** Generate a unique 7-byte UID (14 hex chars) */
export function makeUid(seed?: number): string {
  uidSeq++;
  const base = (Date.now() % 0xffffffffffff).toString(16).padStart(12, "0");
  const suffix = (seed ?? uidSeq).toString(16).padStart(2, "0");
  return `04${base.slice(0, 10)}${suffix}`;
}

// ── Key derivation ───────────────────────────────────────────────────────────

export function deriveKeys(uidHex: string, version = 1) {
  return getDeterministicKeys(uidHex, { ISSUER_KEY } as Env, version);
}

// ── Virtual tap (re-export from testHelpers) ─────────────────────────────────

export function virtualTap(uidHex: string, counter: number, k1Hex: string, k2Hex: string) {
  return _virtualTap(uidHex, counter, k1Hex, k2Hex);
}

// ── Session management ───────────────────────────────────────────────────────

let sessionCookie = "";
let csrfToken = "";

function buildCookieHeader(): string {
  let c = sessionCookie;
  if (csrfToken) c += "; op_csrf=" + csrfToken;
  return c;
}

export function resetSession(): void {
  sessionCookie = "";
  csrfToken = "";
}

// ── Low-level Worker fetch ───────────────────────────────────────────────────

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  contentType?: string;
}

/** Fire an HTTP request through the full Worker pipeline (router → handlers → DO → KV). */
export async function apiFetch(path: string, options: FetchOptions = {}): Promise<Response> {
  const { method = "GET", headers = {}, body = null, contentType } = options;

  const reqHeaders: Record<string, string> = { ...headers };
  if (sessionCookie) reqHeaders["Cookie"] = buildCookieHeader();
  if (csrfToken && (method === "POST" || method === "PUT")) {
    reqHeaders["X-CSRF-Token"] = csrfToken;
  }
  if (contentType) reqHeaders["Content-Type"] = contentType;

  const req = new Request(`http://localhost${path}`, {
    method,
    headers: reqHeaders,
    body: body || undefined,
    redirect: "manual",
  });

  const resp = await exports.default.fetch(req);

  // Capture cookies from Set-Cookie response headers
  const allCookies: string[] =
    typeof (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (resp.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  for (const sc of allCookies) {
    const m = sc.match(/op_session=([^;]+)/);
    if (m) sessionCookie = `op_session=${m[1]}`;
    const cs = sc.match(/op_csrf=([^;]+)/);
    if (cs && cs[1]) csrfToken = cs[1];
  }

  return resp;
}

// ── Auth flow ────────────────────────────────────────────────────────────────

/** Login as operator and acquire session + CSRF cookies. */
export async function operatorLogin(): Promise<void> {
  resetSession();

  // Step 1: POST /operator/login → 302 with session cookie
  const loginResp = await apiFetch("/operator/login", {
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: `pin=${OPERATOR_PIN}`,
  });

  expect(loginResp.status).toBe(302);

  // Step 2: GET an operator page to acquire CSRF cookie
  await apiFetch("/operator/pos");
}

// ── Card operations ──────────────────────────────────────────────────────────

/** Provision a card via pull-payments API. Returns K1/K2 from server response. */
export async function provisionCard(uid: string): Promise<{ k1: string; k2: string; status: number }> {
  const resp = await apiFetch(
    `/api/v1/pull-payments/${PULL_PAYMENT_ID}/boltcards?onExisting=UpdateVersion`,
    {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ UID: uid }),
    },
  );

  if (resp.status === 200) {
    const json = (await resp.json()) as { k1: string; k2: string };
    return { k1: json.k1, k2: json.k2, status: resp.status };
  }
  return { k1: "", k2: "", status: resp.status };
}

/** Top-up a card with credits. Requires operator login first. */
export async function topUp(
  uid: string,
  amount: number,
  k1: string,
  k2: string,
  counter = 1,
): Promise<Response> {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  return apiFetch("/operator/topup/apply", {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({ p: pHex, c: cHex, amount }),
  });
}

/** POS charge — debit a card. Requires operator login first. */
export async function posCharge(
  uid: string,
  amount: number,
  k1: string,
  k2: string,
  counter: number,
): Promise<Response> {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  return apiFetch("/operator/pos/charge", {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({ p: pHex, c: cHex, amount }),
  });
}

/** Simulate a card tap (GET / with p and c params). Returns LNURL-withdraw response. */
export async function cardTap(
  uid: string,
  k1: string,
  k2: string,
  counter: number,
): Promise<Response> {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  return apiFetch(`/?p=${pHex}&c=${cHex}`);
}

/** Refund a card (partial or full). Requires operator login first. */
export async function refund(
  uid: string,
  amount: number | null,
  k1: string,
  k2: string,
  counter: number,
): Promise<Response> {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  const body: Record<string, unknown> = { p: pHex, c: cHex };
  if (amount !== null) body.amount = amount;
  return apiFetch("/operator/refund/apply", {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** Get card info (balance, state, history). */
export async function cardInfo(
  uid: string,
  k1: string,
  k2: string,
  counter: number,
): Promise<Response> {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  return apiFetch(`/card/info?p=${pHex}&c=${cHex}`);
}

/** LNURL callback — submit a payment invoice for processing. */
export async function lnurlCallback(
  pHex: string,
  cHex: string,
  pr: string,
  amount: number,
): Promise<Response> {
  return apiFetch(
    `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=${pr}&amount=${amount}`,
  );
}

/** Get a fake bolt11 invoice for testing LNURL flow. */
export async function fakeInvoice(amount: number): Promise<Response> {
  return apiFetch(`/api/fake-invoice?amount=${amount}`);
}

// ── Counter management ───────────────────────────────────────────────────────

let globalCounter = 1;

/** Get the next unique counter value. Never reuse within a test suite. */
export function nextCounter(): number {
  return globalCounter++;
}

/** Reset counter for a fresh test suite. */
export function resetCounter(): void {
  globalCounter = 1;
}

/** Reset all state between test suites. */
export function resetAll(): void {
  resetSession();
  resetCounter();
  uidSeq = 0;
}
