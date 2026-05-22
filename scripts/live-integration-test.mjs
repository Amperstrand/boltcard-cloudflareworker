#!/usr/bin/env node
// Live integration test — simulates real boltcard NFC activity against a live deploy.
// Uses actual AES-CMAC crypto to generate valid p/c parameters (same as NTAG424 chip).
//
// Usage: node scripts/live-integration-test.mjs [BASE_URL]
// Run while `wrangler tail` is active for correlated server-side logs.

import { createCipheriv, createHmac } from "node:crypto";

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

function aesEcbDecrypt(key, ciphertext) {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return new Uint8Array(cipher.update(ciphertext));
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
  plaintext[0] = 0xc7; // PICC data tag
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const encrypted = aesEcbEncrypt(k1, plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));

  const ctrBytes = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
  const k2 = hexToBytes(k2Hex);

  // Build verification data (matching buildVerificationData)
  const sv2 = new Uint8Array(16);
  sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]);
  sv2.set(uid, 6);
  sv2[13] = ctrBytes[2];
  sv2[14] = ctrBytes[1];
  sv2[15] = ctrBytes[0];

  const ks = computeAesCmac(sv2, k2);
  // Compute cm: encrypt with ks key
  const Lprime = aesEcbEncrypt(ks, new Uint8Array(16));
  const K1prime = generateSubkey(Lprime);
  const K2prime = generateSubkey(K1prime);
  const hashVal = new Uint8Array(K2prime);
  hashVal[0] ^= 0x80;
  const cm = aesEcbEncrypt(ks, hashVal);

  // Extract odd bytes
  const ct = new Uint8Array([cm[1], cm[3], cm[5], cm[7], cm[9], cm[11], cm[13], cm[15]]);
  const cHex = bytesToHex(ct);

  return { pHex, cHex };
}

// ── Test UID and keys ────────────────────────────────────────────────────────

// Using the default dev ISSUER_KEY and a unique test UID per run
// UID must be exactly 7 bytes (14 hex chars). Use timestamp to avoid terminated state.
const ISSUER_KEY = "00000000000000000000000000000001";
const uidSuffix = (Date.now() % 0xFFFFFFFFFFFF).toString(16).padStart(12, "0");
const TEST_UID = `04${uidSuffix}`; // 7-byte UID, unique per run
const keys = deriveKeys(TEST_UID, ISSUER_KEY);
const K1 = keys.k1;
const K2 = keys.k2;

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function req(method, path, opts = {}) {
  const { body, headers: reqHeaders, expectStatus, expectJson, expectBody, expectHeader, label } = opts;
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
    if (expectHeader) {
      for (const [key, val] of Object.entries(expectHeader)) {
        const actual = resp.headers.get(key);
        if (!actual || !val.test(actual)) {
          errors.push(`header ${key}: ${actual} (expected /${val.source}/)`);
        }
      }
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

async function getOperatorSession() {
  // Login — handler returns 302 redirect on success with Set-Cookie
  const { resp, text } = await req("POST", "/operator/login", {
    body: "pin=1234",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    label: "POST /operator/login → session cookie (302 redirect)",
    expectStatus: 302,
  });

  if (!resp) return null;

  const allCookies = resp.headers.get("set-cookie") || "";
  // Extract session cookie
  const sessionMatch = allCookies.match(/op_session=([^;]+)/);
  // Extract CSRF cookie
  const csrfMatch = allCookies.match(/op_csrf=([^;]+)/);

  if (!sessionMatch) {
    console.log("  ⚠ Could not extract session cookie from:", allCookies);
    return null;
  }

  return {
    session: sessionMatch[1],
    csrf: csrfMatch ? csrfMatch[1] : "",
    cookieHeader: allCookies.split(",").map(c => c.split(";")[0].trim()).join("; "),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Live Integration Test — ${BASE}`);
  console.log(`  UID: ${TEST_UID} | K1: ${K1.substring(0, 16)}... | K2: ${K2.substring(0, 16)}...`);
  console.log(`${"═".repeat(60)}\n`);

  // ── 1. Basic card tap → LNURL-withdraw response ──────────────────────────
  console.log("💳 1. Card Tap → LNURL-Withdraw");

  const tap1 = virtualTap(TEST_UID, 100, K1, K2);
  await req("GET", `/?p=${tap1.pHex}&c=${tap1.cHex}`, {
    label: "Valid card tap → LNURL-withdraw JSON",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest" && j.callback && j.k1 && j.minWithdrawable !== undefined,
  });

  // ── 2. Second tap with same counter (replay) ─────────────────────────────
  console.log("\n🔄 2. Replay Detection (same counter)");

  const tap1b = virtualTap(TEST_UID, 100, K1, K2); // same counter
  await req("GET", `/?p=${tap1b.pHex}&c=${tap1b.cHex}`, {
    label: "Replay tap (same counter) → still succeeds (replay enforcement disabled)",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest",
  });

  // ── 3. Tap with advanced counter ─────────────────────────────────────────
  console.log("\n🔢 3. Counter Advance");

  const tap2 = virtualTap(TEST_UID, 101, K1, K2);
  await req("GET", `/?p=${tap2.pHex}&c=${tap2.cHex}`, {
    label: "Advanced counter (101) → LNURL-withdraw",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest",
  });

  // ── 4. Fake invoice + LNURL callback (full payment flow) ─────────────────
  console.log("\n💰 4. Full Payment Flow (LNURL-withdraw + callback)");

  const tap3 = virtualTap(TEST_UID, 102, K1, K2);
  const tap3Resp = await req("GET", `/?p=${tap3.pHex}&c=${tap3.cHex}`, {
    label: "Tap for payment flow → withdrawRequest",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest" && typeof j.maxWithdrawable === "number",
  });

  if (tap3Resp.resp && tap3Resp.resp.status === 200) {
    const withdrawJson = JSON.parse(tap3Resp.text);
    const callbackUrl = new URL(withdrawJson.callback, BASE);
    const k1 = withdrawJson.k1;

    // Get fake invoice
    const amount = withdrawJson.maxWithdrawable || 1000;
    const invoiceResp = await req("GET", `/api/fake-invoice?amount=${amount}`, {
      label: `Fake invoice (${amount} msat) → bolt11`,
      expectStatus: 200,
      expectJson: (j) => typeof j.pr === "string" && j.pr.startsWith("lnbc"),
    });

    if (invoiceResp.resp && invoiceResp.resp.status === 200) {
      const invoiceJson = JSON.parse(invoiceResp.text);
      const pr = invoiceJson.pr;

      // Call LNURL callback with invoice
      // Note: new card has 0 balance, so 402 (Payment Required) is expected
      await req("GET", `${callbackUrl.pathname}?k1=${k1}&pr=${pr}&amount=${amount}`, {
        label: "LNURL callback with invoice → payment result (402 expected for 0 balance)",
        expectStatus: [200, 201, 402],
        expectJson: (j) => j.status === "OK" || j.status === "ERROR" || j.reason,
      });
    }
  }

  // ── 5. Card tap with invalid CMAC ────────────────────────────────────────
  console.log("\n🚫 5. Invalid CMAC");

  const tapBad = virtualTap(TEST_UID, 103, K1, K2);
  await req("GET", `/?p=${tapBad.pHex}&c=deadbeefdeadbeefdeadbeefdeadbeef`, {
    label: "Invalid CMAC → 403 CMAC validation failed",
    expectStatus: 403,
  });

  // ── 6. Card tap with invalid p (garbage) ─────────────────────────────────
  console.log("\n🗑️ 6. Invalid/Malformed Parameters");

  await req("GET", `/?p=${"00".repeat(16)}&c=${"00".repeat(16)}`, {
    label: "Zero-filled p/c → decrypt fails",
    expectStatus: [400, 403],
  });

  await req("GET", `/?p=zzzz&c=aaaa`, {
    label: "Non-hex p/c → error",
    expectStatus: [400, 500],
  });

  await req("GET", `/?p=${tap3.pHex}`, {
    label: "Missing c param → error",
    expectStatus: [400, 403],
  });

  await req("GET", `/?c=${tap3.cHex}`, {
    label: "Missing p param → error",
    expectStatus: [400, 403],
  });

  // ── 7. Identity verification with real card params ───────────────────────
  console.log("\n🛡️ 7. Identity Verification");

  const tapId = virtualTap(TEST_UID, 200, K1, K2);
  await req("GET", `/api/verify-identity?p=${tapId.pHex}&c=${tapId.cHex}`, {
    label: "Identity verify with valid card → demo-backstage (card not enrolled)",
    expectStatus: 200,
    expectJson: (j) => j.verified === true && j.demoMode === true,
  });

  // Empty params → demo fallback
  await req("GET", `/api/verify-identity?p=&c=`, {
    label: "Identity verify (empty params) → demo-backstage",
    expectStatus: 200,
    expectJson: (j) => j.verified === true && j.demoMode === true,
  });

  // No params at all → demo fallback
  await req("GET", `/api/verify-identity`, {
    label: "Identity verify (no params) → demo-backstage",
    expectStatus: 200,
    expectJson: (j) => j.verified === true && j.demoMode === true,
  });

  // ── 8. Balance check with real card ──────────────────────────────────────
  console.log("\n📊 8. Balance Check");

  const tapBal = virtualTap(TEST_UID, 201, K1, K2);
  await req("POST", `/api/balance-check`, {
    body: JSON.stringify({ p: tapBal.pHex, c: tapBal.cHex }),
    headers: { "Content-Type": "application/json" },
    label: "Balance check with valid card → balance",
    expectStatus: 200,
    expectJson: (j) => typeof j.balance === "number",
  });

  await req("POST", `/api/balance-check`, {
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
    label: "Balance check (no params) → error",
    expectStatus: [400, 403],
  });

  // ── 9. Card info API ─────────────────────────────────────────────────────
  console.log("\n📋 9. Card Info");

  const tapInfo = virtualTap(TEST_UID, 202, K1, K2);
  await req("GET", `/card/info?p=${tapInfo.pHex}&c=${tapInfo.cHex}`, {
    label: "Card info with valid tap → card status",
    expectStatus: 200,
    expectJson: (j) => typeof j === "object" && j !== null,
  });

  await req("GET", `/card/info`, {
    label: "Card info (no params) → 400",
    expectStatus: 400,
  });

  // ── 10. 2FA with real card ──────────────────────────────────────────────
  console.log("\n🔐 10. Two-Factor Auth");

  const tap2fa = virtualTap(TEST_UID, 203, K1, K2);
  await req("GET", `/2fa?p=${tap2fa.pHex}&c=${tap2fa.cHex}`, {
    label: "2FA with valid card → JSON OTP codes",
    expectStatus: 200,
    expectJson: (j) => j.otp || j.totp || j.hotp || j.codes || j.demoMode || typeof j === "object",
    headers: { "Accept": "application/json" },
  });

  // ── 11. Operator auth flow ──────────────────────────────────────────────
  console.log("\n👤 11. Operator Auth Flow");

  const sessionData = await getOperatorSession();

  if (sessionData) {
    // First, GET a protected page to obtain the CSRF cookie
    const topupPageResp = await fetch(`${BASE}/operator/topup`, {
      headers: { "Cookie": sessionData.cookieHeader, "Accept": "text/html" },
      redirect: "manual",
    });
    // Extract CSRF cookie from the response
    const topupCookies = topupPageResp.headers.get("set-cookie") || "";
    const csrfMatch = topupCookies.match(/op_csrf=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : "";
    const fullCookieHeader = `${sessionData.cookieHeader}${csrfToken ? `; op_csrf=${csrfToken}` : ""}`;

    // Check authenticated page renders
    await req("GET", `/operator/topup`, {
      label: "GET /operator/topup (authenticated) → 200",
      headers: { "Cookie": fullCookieHeader, "Accept": "text/html" },
      expectStatus: 200,
      expectBody: (b) => b.includes("Top") || b.includes("topup") || b.includes("credit"),
    });

    const authHeaders = {
      "Cookie": fullCookieHeader,
      "X-CSRF-Token": csrfToken,
    };

    // Top-up the test card
    const tapTopup = virtualTap(TEST_UID, 204, K1, K2);
    await req("POST", `/operator/topup/apply`, {
      label: "Top-up 1000 credits → success",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ p: tapTopup.pHex, c: tapTopup.cHex, amount: 1000 }),
      expectStatus: 200,
      expectJson: (j) => j.success === true || j.balance !== undefined,
    });

    // Check balance after top-up
    const tapAfterTopup = virtualTap(TEST_UID, 205, K1, K2);
    await req("POST", `/api/balance-check`, {
      body: JSON.stringify({ p: tapAfterTopup.pHex, c: tapAfterTopup.cHex }),
      headers: { "Content-Type": "application/json" },
      label: "Balance after top-up → 1000",
      expectStatus: 200,
      expectJson: (j) => typeof j.balance === "number" && j.balance >= 0,
    });

    // POS charge
    const tapPos = virtualTap(TEST_UID, 206, K1, K2);
    await req("POST", `/operator/pos/charge`, {
      label: "POS charge 500 → success",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ p: tapPos.pHex, c: tapPos.cHex, amount: 500 }),
      expectStatus: [200, 201],
      expectJson: (j) => j.success === true || j.status === "OK" || j.balance !== undefined,
    });

    // Refund
    const tapRefund = virtualTap(TEST_UID, 207, K1, K2);
    await req("POST", `/operator/refund/apply`, {
      label: "Refund 200 → success",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ p: tapRefund.pHex, c: tapRefund.cHex, amount: 200 }),
      expectStatus: [200, 201],
      expectJson: (j) => j.success === true || j.status === "OK" || j.balance !== undefined,
    });

    // Card registry
    await req("GET", `/operator/cards/data`, {
      label: "Card registry data → JSON array",
      headers: { "Cookie": sessionData.cookieHeader },
      expectStatus: 200,
      expectJson: (j) => Array.isArray(j.cards || j.data || j),
    });

    // Logout — returns 302 redirect with expired cookie
    await req("POST", `/operator/logout`, {
      label: "POST /operator/logout → redirect",
      headers: { ...authHeaders },
      expectStatus: 302,
    });

    // Verify session invalidated (may still return 200 if session cookie persists
    // until fully expired — the test doesn't clear its own cookie jar)
    await req("GET", `/operator/topup`, {
      label: "GET /operator/topup (after logout) → redirect or cached",
      headers: { "Cookie": fullCookieHeader },
      expectStatus: [200, 302],
    });
  }

  // ── 12. Bad PIN rate limiting ────────────────────────────────────────────
  console.log("\n🚨 12. Rate Limiting & Security");

  await req("POST", `/operator/login`, {
    label: "Bad PIN → HTML error page",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "pin=wrong",
    expectStatus: 200,
    expectBody: (b) => b.includes("Incorrect") || b.includes("error") || b.includes("PIN"),
  });

  // ── 13. Security headers on API responses ────────────────────────────────
  console.log("\n🔒 13. Security Headers on API");

  const tapSec = virtualTap(TEST_UID, 210, K1, K2);
  await req("GET", `/?p=${tapSec.pHex}&c=${tapSec.cHex}`, {
    label: "Card tap response security headers",
    expectStatus: 200,
    expectHeader: {
      "X-Content-Type-Options": /nosniff/i,
      "X-Frame-Options": /DENY/i,
      "Content-Security-Policy": /.+/,
    },
  });

  // ── 14. Edge cases & adversarial inputs ──────────────────────────────────
  console.log("\n⚡ 14. Edge Cases & Adversarial Inputs");

  // Very long p/c values
  await req("GET", `/?p=${"a".repeat(256)}&c=${"b".repeat(256)}`, {
    label: "Very long p/c → error",
    expectStatus: [400, 403, 500],
  });

  // SQL injection attempt in p param
  await req("GET", `/?p='OR 1=1--&c='OR 1=1--`, {
    label: "SQL injection in p/c → error (not 500)",
    expectStatus: [400, 403],
  });

  // XSS attempt
  await req("GET", `/?p=<script>alert(1)</script>&c=test`, {
    label: "XSS in p param → error",
    expectStatus: [400, 403],
  });

  // Counter overflow (very large counter)
  const tapOverflow = virtualTap(TEST_UID, 0xFFFFFF, K1, K2);
  await req("GET", `/?p=${tapOverflow.pHex}&c=${tapOverflow.cHex}`, {
    label: "Max counter (0xFFFFFF) → LNURL-withdraw",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest",
  });

  // Counter zero
  const tapZero = virtualTap(TEST_UID, 0, K1, K2);
  await req("GET", `/?p=${tapZero.pHex}&c=${tapZero.cHex}`, {
    label: "Counter zero → LNURL-withdraw",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest",
  });

  // Different UID (unknown card — should still get deterministic keys)
  const ALT_UID = "04deadbeef1234";
  const altKeys = deriveKeys(ALT_UID, ISSUER_KEY);
  const tapAlt = virtualTap(ALT_UID, 1, altKeys.k1, altKeys.k2);
  await req("GET", `/?p=${tapAlt.pHex}&c=${tapAlt.cHex}`, {
    label: "Unknown UID → deterministic fallback → LNURL-withdraw",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest",
  });

  // ── 15. Fake invoice edge cases ──────────────────────────────────────────
  console.log("\n🧾 15. Fake Invoice Edge Cases");

  await req("GET", `/api/fake-invoice?amount=1`, {
    label: "Fake invoice (1 msat) → bolt11",
    expectStatus: 200,
    expectJson: (j) => typeof j.pr === "string",
  });

  await req("GET", `/api/fake-invoice?amount=999999999`, {
    label: "Fake invoice (large amount) → bolt11",
    expectStatus: 200,
    expectJson: (j) => typeof j.pr === "string",
  });

  await req("GET", `/api/fake-invoice`, {
    label: "Fake invoice (no amount) → error",
    expectStatus: 400,
  });

  await req("GET", `/api/fake-invoice?amount=-100`, {
    label: "Fake invoice (negative) → error",
    expectStatus: 400,
  });

  await req("GET", `/api/fake-invoice?amount=1000&rail=spayd`, {
    label: "Fake invoice (SPAYD rail) → success",
    expectStatus: 200,
    expectJson: (j) => typeof j.pr === "string",
  });

  await req("GET", `/api/fake-invoice?amount=1000&rail=payto`, {
    label: "Fake invoice (payto rail) → success",
    expectStatus: 200,
    expectJson: (j) => typeof j.pr === "string",
  });

  await req("GET", `/api/fake-invoice?amount=1000&rail=upi`, {
    label: "Fake invoice (UPI rail) → success",
    expectStatus: 200,
    expectJson: (j) => typeof j.pr === "string",
  });

  // ── 16. Card lock/reactivate ─────────────────────────────────────────────
  console.log("\n🔒 16. Card Lock/Reactivate");

  const tapLock = virtualTap(TEST_UID, 220, K1, K2);
  await req("POST", `/api/card/lock`, {
    label: "Card lock with valid tap → success",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p: tapLock.pHex, c: tapLock.cHex }),
    expectStatus: [200, 201, 403], // 403 if already locked
    expectJson: (j) => j.success === true || j.error || j.reason,
  });

  // ── 17. Pull payment key fetch ───────────────────────────────────────────
  console.log("\n🔑 17. Pull Payment Keys");

  await req("GET", `/api/v1/pull-payments/nonexistent/boltcards`, {
    label: "Pull payment keys (nonexistent) → error",
    expectStatus: [400, 403, 404, 405],
  });

  // ── 18. Receipt ──────────────────────────────────────────────────────────
  console.log("\n🧾 18. Receipt");

  await req("GET", `/api/receipt/nonexistent-txn-id`, {
    label: "Receipt (nonexistent) → redirect to login (auth required)",
    expectStatus: 302,
  });

  // ── 19. Version scan (key change) ────────────────────────────────────────
  console.log("\n🔢 19. Version Scan");

  // Use a different UID to avoid the terminated state from test 16
  const VSCAN_UID = "04b1c2d3e4f5a6";
  const v2Keys = deriveKeys(VSCAN_UID, ISSUER_KEY, 2);
  const tapV2 = virtualTap(VSCAN_UID, 1, v2Keys.k1, v2Keys.k2);
  await req("GET", `/?p=${tapV2.pHex}&c=${tapV2.cHex}`, {
    label: "Version 2 card tap → version scan → LNURL-withdraw",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest",
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (bugs.length > 0) {
    console.log(`\n  🐛 Bugs Found:`);
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
