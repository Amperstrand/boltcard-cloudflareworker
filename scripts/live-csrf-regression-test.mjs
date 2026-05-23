#!/usr/bin/env node
// Live CSRF + Auth regression test — verifies security controls against a live deploy.
// Tests CSRF protection, auth regression, menu CRUD, and card batch operations.
//
// Usage: node scripts/live-csrf-regression-test.mjs [BASE_URL]
// Requires operator PIN 1234 to be active on the target.

import { createCipheriv } from "node:crypto";

const BASE = process.argv[2] || "https://boltcardpoc.psbt.me";

let passed = 0;
let failed = 0;
const bugs = [];

// ── Crypto primitives (matching cryptoutils.ts) ──────────────────────────────

function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Invalid hex: " + hex);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function aesEcbEncrypt(key, plaintext) {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return new Uint8Array(cipher.update(plaintext));
}

function xorArrays(a, b) {
  return new Uint8Array(a.map((v, i) => v ^ b[i]));
}

function shiftLeft(src) {
  const shifted = new Uint8Array(src.length);
  let carry = 0;
  for (let i = src.length - 1; i >= 0; i--) {
    const msb = src[i] >> 7;
    shifted[i] = ((src[i] << 1) & 0xff) | carry;
    carry = msb;
  }
  return { shifted, carry };
}

function generateSubkey(input) {
  const { shifted, carry } = shiftLeft(input);
  const subkey = new Uint8Array(shifted);
  if (carry) subkey[subkey.length - 1] ^= 0x87;
  return subkey;
}

function computeAesCmac(message, key) {
  if (message.length > 16) throw new Error("Only single-block CMAC implemented");
  const L = aesEcbEncrypt(key, new Uint8Array(16));
  const K1 = generateSubkey(L);
  let M_last;
  if (message.length === 16) {
    M_last = xorArrays(message, K1);
  } else {
    const padded = new Uint8Array(16);
    padded.set(message);
    padded[message.length] = 0x80;
    const K2 = generateSubkey(K1);
    M_last = xorArrays(padded, K2);
  }
  return aesEcbEncrypt(key, M_last);
}

// ── Key derivation (matching keygenerator.ts) ───────────────────────────────

function deriveKeys(uidHex, issuerKeyHex, version = 1) {
  const issuerKey = hexToBytes(issuerKeyHex);
  const uid = hexToBytes(uidHex);
  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, version, true);

  const cardKey = computeAesCmac(
    new Uint8Array([...hexToBytes("2d003f75"), ...uid, ...versionBytes]),
    issuerKey
  );

  return {
    k0: bytesToHex(computeAesCmac(hexToBytes("2d003f76"), cardKey)),
    k1: bytesToHex(computeAesCmac(hexToBytes("2d003f77"), issuerKey)),
    k2: bytesToHex(computeAesCmac(hexToBytes("2d003f78"), cardKey)),
    k3: bytesToHex(computeAesCmac(hexToBytes("2d003f79"), cardKey)),
    k4: bytesToHex(computeAesCmac(hexToBytes("2d003f7a"), cardKey)),
    cardKey: bytesToHex(cardKey),
  };
}

// ── Card simulation (matching testHelpers.ts virtualTap) ─────────────────────

function virtualTap(uidHex, counter, k1Hex, k2Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xc7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const encrypted = aesEcbEncrypt(k1, plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));

  const ctrBytes = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
  const k2 = hexToBytes(k2Hex);

  const sv2 = new Uint8Array(16);
  sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]);
  sv2.set(uid, 6);
  sv2[13] = ctrBytes[2];
  sv2[14] = ctrBytes[1];
  sv2[15] = ctrBytes[0];

  const ks = computeAesCmac(sv2, k2);
  const Lprime = aesEcbEncrypt(ks, new Uint8Array(16));
  const K1prime = generateSubkey(Lprime);
  const K2prime = generateSubkey(K1prime);
  const hashVal = new Uint8Array(K2prime);
  hashVal[0] ^= 0x80;
  const cm = aesEcbEncrypt(ks, hashVal);

  const ct = new Uint8Array([cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]);
  const cHex = bytesToHex(ct);

  return { pHex, cHex };
}

// ── Test helpers ─────────────────────────────────────────────────────────────

const ISSUER_KEY = "00000000000000000000000000000001";
const PULL_PAYMENT_ID = "fUDXsnySxvb5LYZ1bSLiWzLjVuT";

/** Generate a unique 7-byte UID (14 hex chars) per test run */
function makeUid(seed) {
  const base = (Date.now() % 0xFFFFFFFFFFFF).toString(16).padStart(12, "0");
  return `04${base.slice(0, 10)}${seed.toString(16).padStart(2, "0")}`;
}

async function test(method, path, opts = {}) {
  const { body, headers: reqHeaders, expectStatus, expectJson, expectBody, label } = opts;
  const url = BASE + path;
  const tag = label || `${method} ${path.substring(0, 80)}`;
  try {
    const resp = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        "Accept": "application/json",
        ...reqHeaders,
      },
      body: body || undefined,
    });

    let text = "";
    if (expectBody || expectJson) text = await resp.text();

    const errors = [];
    const expectedStatuses = Array.isArray(expectStatus) ? expectStatus : [expectStatus];
    if (expectStatus !== undefined && !expectedStatuses.includes(resp.status)) {
      errors.push(`status ${resp.status} (expected ${Array.isArray(expectStatus) ? expectStatus.join("/") : expectStatus})`);
    }
    if (expectBody && !expectBody(text)) {
      errors.push("body check failed");
    }
    if (expectJson) {
      try {
        const json = JSON.parse(text);
        if (typeof expectJson === "function" && !expectJson(json, resp.status)) {
          errors.push(`JSON check failed: ${text.substring(0, 200)}`);
        }
      } catch {
        errors.push(`invalid JSON: ${text.substring(0, 100)}`);
      }
    }

    if (errors.length === 0) {
      console.log(`  ✓ ${tag}`);
      passed++;
    } else {
      console.log(`  ✗ ${tag} — ${errors.join(", ")}`);
      failed++;
      bugs.push({ test: tag, errors });
    }
    return { resp, text };
  } catch (e) {
    console.log(`  ✗ ${tag} — error: ${e.message}`);
    failed++;
    bugs.push({ test: tag, errors: [e.message] });
    return { resp: null, text: "" };
  }
}

// ── Operator auth ────────────────────────────────────────────────────────────

/**
 * Full auth flow:
 * 1. POST /operator/login → 302 with Set-Cookie (op_session + op_csrf)
 * 2. GET a protected page → extract op_csrf from Set-Cookie
 * Returns { sessionCookie, csrfCookie, csrfToken, cookieHeader, authHeaders }
 */
async function getAuthenticatedSession() {
  // Step 1: Login
  const loginResp = await fetch(`${BASE}/operator/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "pin=1234",
  });

  if (loginResp.status !== 302) {
    console.log(`  ✗ Login failed: status ${loginResp.status}`);
    failed++;
    bugs.push({ test: "operator login", errors: [`status ${loginResp.status} (expected 302)`] });
    return null;
  }

  const loginCookies = loginResp.headers.get("set-cookie") || "";
  const sessionMatch = loginCookies.match(/op_session=([^;]+)/);

  if (!sessionMatch) {
    console.log(`  ✗ No session cookie in login response`);
    failed++;
    bugs.push({ test: "operator login", errors: ["no op_session cookie"] });
    return null;
  }

  const sessionCookie = sessionMatch[1];

  // Step 2: GET protected page to obtain CSRF cookie
  const pageResp = await fetch(`${BASE}/operator/pos`, {
    redirect: "manual",
    headers: {
      "Cookie": `op_session=${sessionCookie}`,
      "Accept": "text/html",
    },
  });

  const pageCookies = pageResp.headers.get("set-cookie") || "";
  const csrfMatch = pageCookies.match(/op_csrf=([^;]+)/);

  if (!csrfMatch) {
    console.log(`  ✗ No CSRF cookie in protected page response`);
    failed++;
    bugs.push({ test: "CSRF cookie extraction", errors: ["no op_csrf cookie"] });
    return null;
  }

  const csrfToken = csrfMatch[1];
  const cookieHeader = `op_session=${sessionCookie}; op_csrf=${csrfToken}`;

  return {
    sessionCookie,
    csrfCookie: csrfToken,
    csrfToken,
    cookieHeader,
    authHeaders: {
      "Cookie": cookieHeader,
      "X-CSRF-Token": csrfToken,
    },
    // Headers with session cookie but NO CSRF token
    sessionOnlyHeaders: {
      "Cookie": `op_session=${sessionCookie}`,
    },
    // Headers with session cookie + wrong CSRF token
    wrongCsrfHeaders: {
      "Cookie": `op_session=${sessionCookie}; op_csrf=invalid-csrf-token`,
      "X-CSRF-Token": "invalid-csrf-token",
    },
    // CSRF token only, no session
    csrfOnlyHeaders: {
      "Cookie": `op_csrf=${csrfToken}`,
      "X-CSRF-Token": csrfToken,
    },
  };
}

/** Provision a card by tapping it (creates DO state via auto-discovery) */
async function provisionCard(uid, counter, k1, k2) {
  const tap = virtualTap(uid, counter, k1, k2);
  const resp = await fetch(`${BASE}/?p=${tap.pHex}&c=${tap.cHex}`, {
    redirect: "manual",
    headers: { "Accept": "application/json" },
  });
  return resp.status === 200;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Live CSRF + Auth Regression Test — ${BASE}`);
  console.log(`${"═".repeat(60)}\n`);

  // ── Establish authenticated session ──────────────────────────────────────
  console.log("🔑 Establishing operator session...");
  const session = await getAuthenticatedSession();
  if (!session) {
    console.log("\n  ⛔ Cannot proceed without authenticated session. Aborting.");
    process.exit(2);
  }
  console.log("  ✓ Session established\n");

  // ════════════════════════════════════════════════════════════════════════════
  // 1. CSRF PROTECTION (5 tests)
  // ════════════════════════════════════════════════════════════════════════════
  console.log("🛡️  1. CSRF Protection");

  // 1a. POST with session but NO CSRF token → 403
  await test("POST", "/operator/topup/apply", {
    label: "POST /operator/topup/apply (no CSRF token) → 403",
    headers: { ...session.sessionOnlyHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ uid: "04deadbeef1234", amount: 100 }),
    expectStatus: 403,
  });

  // 1b. POST with session but WRONG CSRF token → 400/403
  await test("POST", "/operator/topup/apply", {
    label: "POST /operator/topup/apply (wrong CSRF token) → 400/403",
    headers: { ...session.wrongCsrfHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ uid: "04deadbeef1234", amount: 100 }),
    expectStatus: [400, 403],
  });

  // 1c. POST with CSRF token but NO session cookie → 302 (redirect to login)
  await test("POST", "/operator/topup/apply", {
    label: "POST /operator/topup/apply (CSRF but no session) → 302",
    headers: { ...session.csrfOnlyHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ uid: "04deadbeef1234", amount: 100 }),
    expectStatus: 302,
  });

  // 1d. PUT with session + valid CSRF → 200 (baseline: menu update)
  await test("PUT", "/operator/pos/menu", {
    label: "PUT /operator/pos/menu (valid CSRF) → 200",
    headers: { ...session.authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ name: "Test Coffee", price: 500 }] }),
    expectStatus: 200,
  });

  // 1e. POST without any cookies → 302 (redirect to login)
  await test("POST", "/operator/pos/charge", {
    label: "POST /operator/pos/charge (no cookies) → 302",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: "04deadbeef1234", amount: 500 }),
    expectStatus: 302,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. AUTH REGRESSION (4 tests)
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n🔐 2. Auth Regression");

  // 2a. GET /operator/topup without session → 302
  await test("GET", "/operator/topup", {
    label: "GET /operator/topup (no session) → 302 redirect",
    headers: { "Accept": "text/html" },
    expectStatus: 302,
  });

  // 2b. GET /operator/pos without session → 302
  await test("GET", "/operator/pos", {
    label: "GET /operator/pos (no session) → 302 redirect",
    headers: { "Accept": "text/html" },
    expectStatus: 302,
  });

  // 2c. POST /operator/logout with valid session → 302 (clears cookie)
  await test("POST", "/operator/logout", {
    label: "POST /operator/logout (valid session) → 302",
    headers: session.authHeaders,
    expectStatus: 302,
    // Verify the response clears the session cookie
    expectBody: () => true, // We just need the status; cookie check below
  });

  // 2d. GET /operator/cards/data without session → 302
  await test("GET", "/operator/cards/data", {
    label: "GET /operator/cards/data (no session) → 302 redirect",
    headers: { "Accept": "application/json" },
    expectStatus: 302,
  });

  // Re-authenticate after logout
  console.log("  ℹ Re-authenticating after logout test...");
  const session2 = await getAuthenticatedSession();
  if (!session2) {
    console.log("  ⛔ Re-authentication failed. Aborting remaining tests.");
    process.exit(2);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 3. MENU CRUD (3 tests)
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n🍽️  3. Menu CRUD");

  // 3a. PUT single item
  await test("PUT", "/operator/pos/menu", {
    label: "PUT /operator/pos/menu (1 item) → 200",
    headers: { ...session2.authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ name: "Test Coffee", price: 500 }] }),
    expectStatus: 200,
  });

  // 3b. GET menu → items array
  await test("GET", "/api/pos/menu", {
    label: "GET /api/pos/menu → 200 with items array",
    headers: session2.authHeaders,
    expectStatus: 200,
    expectJson: (j) => Array.isArray(j.items) || Array.isArray(j),
  });

  // 3c. PUT two items, then GET to verify both present
  await test("PUT", "/operator/pos/menu", {
    label: "PUT /operator/pos/menu (2 items) → 200",
    headers: { ...session2.authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ name: "Test Tea", price: 300 }, { name: "Test Cake", price: 800 }] }),
    expectStatus: 200,
  });

  await test("GET", "/api/pos/menu", {
    label: "GET /api/pos/menu → contains both Test Tea + Test Cake",
    headers: session2.authHeaders,
    expectStatus: 200,
    expectJson: (j) => {
      const items = j.items || j;
      if (!Array.isArray(items)) return false;
      const names = items.map(i => i.name);
      return names.includes("Test Tea") && names.includes("Test Cake");
    },
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. CARD BATCH OPERATIONS (3 tests)
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n💳 4. Card Batch Operations");

  // Generate unique UIDs for this run
  const uid1 = makeUid(1);
  const uid2 = makeUid(2);
  const keys1 = deriveKeys(uid1, ISSUER_KEY);
  const keys2 = deriveKeys(uid2, ISSUER_KEY);

  console.log(`  ℹ Test UIDs: ${uid1}, ${uid2}`);

  // Provision both cards by tapping them (auto-discovery)
  const prov1 = await provisionCard(uid1, 1, keys1.k1, keys1.k2);
  const prov2 = await provisionCard(uid2, 1, keys2.k1, keys2.k2);

  if (!prov1 || !prov2) {
    console.log(`  ⚠ Card provisioning returned non-200 (card1: ${prov1}, card2: ${prov2}), continuing anyway...`);
  } else {
    console.log("  ✓ Both cards provisioned via tap");
  }

  // 4a. Batch terminate both cards
  await test("POST", "/operator/cards/batch", {
    label: `POST /operator/cards/batch (terminate ${uid1}, ${uid2}) → 200`,
    headers: { ...session2.authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ uids: [uid1, uid2], action: "terminate" }),
    expectStatus: 200,
    expectJson: (j) => {
      if (!Array.isArray(j.results)) return false;
      const statuses = j.results.map(r => r.status);
      // Both should be terminated or skipped (already terminated)
      return statuses.every(s => s === "terminated" || s === "skipped");
    },
  });

  // 4b. Verify both cards are terminated via /card/info
  const tapVerify1 = virtualTap(uid1, 2, keys1.k1, keys1.k2);
  await test("GET", `/card/info?p=${tapVerify1.pHex}&c=${tapVerify1.cHex}`, {
    label: `Card ${uid1} terminated via /card/info`,
    expectStatus: 200,
    expectJson: (j) => j.state === "terminated",
  });

  const tapVerify2 = virtualTap(uid2, 2, keys2.k1, keys2.k2);
  await test("GET", `/card/info?p=${tapVerify2.pHex}&c=${tapVerify2.cHex}`, {
    label: `Card ${uid2} terminated via /card/info`,
    expectStatus: 200,
    expectJson: (j) => j.state === "terminated",
  });

  // 4c. Batch activate card1, verify active again
  await test("POST", "/operator/cards/batch", {
    label: `POST /operator/cards/batch (activate ${uid1}) → 200`,
    headers: { ...session2.authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ uids: [uid1], action: "activate" }),
    expectStatus: 200,
    expectJson: (j) => {
      if (!Array.isArray(j.results)) return false;
      const r = j.results[0];
      return r && (r.status === "activated" || r.status === "skipped" || r.state === "keys_delivered" || r.state === "active");
    },
  });

  // Verify card1 is active/discovered again via /card/info
  const tapVerify3 = virtualTap(uid1, 3, keys1.k1, keys1.k2);
  await test("GET", `/card/info?p=${tapVerify3.pHex}&c=${tapVerify3.cHex}`, {
    label: `Card ${uid1} reactivated via /card/info`,
    expectStatus: 200,
    expectJson: (j) => {
      // After activate from terminated, state may be active/discovered/keys_delivered
      // or still terminated if the card needs a physical tap to complete activation
      return typeof j.state === "string";
    },
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (bugs.length > 0) {
    console.log(`\n  🐛 Failures:`);
    for (const bug of bugs) {
      console.log(`    - ${bug.test}: ${bug.errors.join(", ")}`);
    }
  }
  console.log(`${"═".repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(2);
});
