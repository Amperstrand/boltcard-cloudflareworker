#!/usr/bin/env node
// Live lifecycle state machine test — tests every card state transition against a live deploy.
// Provisions fresh cards, walks through the full lifecycle, and verifies each state change.
//
// Usage: node scripts/live-lifecycle-test.mjs [BASE_URL]
// Default: https://boltcardpoc.psbt.me

import { createCipheriv } from "node:crypto";

const BASE = process.argv[2] || "https://boltcardpoc.psbt.me";
const PULL_PAYMENT_ID = "fUDXsnySxvb5LYZ1bSLiWzLjVuT";
const ISSUER_KEY = "00000000000000000000000000000001";

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

// ── UID generator ────────────────────────────────────────────────────────────

function makeUid() {
  const uidSuffix = (Date.now() % 0xFFFFFFFFFFFF).toString(16).padStart(12, "0");
  return `04${uidSuffix}`;
}

// Unique counter pool per card — never reuse
let _counter = 1;
function nextCounter() {
  return _counter++;
}

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
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Live Lifecycle State Machine Test — ${BASE}`);
  console.log(`  Testing every card state transition in order`);
  console.log(`${"═".repeat(70)}\n`);

  // ── Operator login ─────────────────────────────────────────────────────
  console.log("🔑 Operator Login");

  const sessionData = await getOperatorSession();
  if (!sessionData) {
    console.log("\n  ✗ FATAL: Cannot obtain operator session. Aborting.\n");
    process.exit(2);
  }

  // Visit operator page to ensure CSRF cookie is set
  const topupPageResp = await fetch(`${BASE}/operator/topup`, {
    headers: { "Cookie": sessionData.cookieHeader, "Accept": "text/html" },
    redirect: "manual",
  });
  const topupCookies = topupPageResp.headers.get("set-cookie") || "";
  const csrfMatch = topupCookies.match(/op_csrf=([^;]+)/);
  const csrfToken = csrfMatch ? csrfMatch[1] : "";
  const fullCookieHeader = `${sessionData.cookieHeader}${csrfToken ? `; op_csrf=${csrfToken}` : ""}`;

  const authHeaders = {
    "Cookie": fullCookieHeader,
    "X-CSRF-Token": csrfToken,
    "Content-Type": "application/json",
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 1–15: MAIN CARD LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  const CARD_UID = makeUid();
  console.log(`\n📋 Main Lifecycle Card UID: ${CARD_UID}`);

  // ── 1. Provision card ──────────────────────────────────────────────────
  console.log("\n── Step 1: Provision card via pull-payments API");

  // Derive keys to know K1/K2 (provision API returns them too, but we derive for independence)
  const cardKeys = deriveKeys(CARD_UID, ISSUER_KEY);
  let provisionedK1 = cardKeys.k1;
  let provisionedK2 = cardKeys.k2;

  const provisionResp = await req(
    "POST",
    `/api/v1/pull-payments/${PULL_PAYMENT_ID}/boltcards?onExisting=UpdateVersion`,
    {
      body: JSON.stringify({ UID: CARD_UID }),
      headers: { "Content-Type": "application/json" },
      label: "Provision card → keys returned",
      expectStatus: 200,
      expectJson: (j) => typeof j.k1 === "string" && typeof j.k2 === "string",
    }
  );

  // Use server-returned keys if available (they may differ by version)
  if (provisionResp.resp && provisionResp.resp.status === 200) {
    try {
      const provJson = JSON.parse(provisionResp.text);
      provisionedK1 = provJson.k1;
      provisionedK2 = provJson.k2;
      console.log(`    K1: ${provisionedK1.substring(0, 16)}... K2: ${provisionedK2.substring(0, 16)}...`);
    } catch {
      // Fall back to derived keys
    }
  }

  // ── 2. First tap (keys_delivered → active) ─────────────────────────────
  console.log("\n── Step 2: First tap (keys_delivered → active)");

  const ctr1 = nextCounter();
  const tap1 = virtualTap(CARD_UID, ctr1, provisionedK1, provisionedK2);
  const tap1Resp = await req("GET", `/?p=${tap1.pHex}&c=${tap1.cHex}`, {
    label: "First tap → LNURL-withdraw response (activates card)",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest" && j.callback && j.k1,
  });

  // ── 3. Check state — should be active/discovered ───────────────────────
  console.log("\n── Step 3: Verify card state is active/discovered");

  const ctr3 = nextCounter();
  const tapInfo3 = virtualTap(CARD_UID, ctr3, provisionedK1, provisionedK2);
  await req("GET", `/card/info?p=${tapInfo3.pHex}&c=${tapInfo3.cHex}`, {
    label: "Card info → state is active or discovered",
    expectStatus: 200,
    expectJson: (j) => j.state === "active" || j.state === "discovered",
  });

  // ── 4. Top-up ──────────────────────────────────────────────────────────
  console.log("\n── Step 4: Top-up 5000 credits");

  const ctr4 = nextCounter();
  const tap4 = virtualTap(CARD_UID, ctr4, provisionedK1, provisionedK2);
  await req("POST", "/operator/topup/apply", {
    body: JSON.stringify({ p: tap4.pHex, c: tap4.cHex, amount: 5000 }),
    headers: authHeaders,
    label: "Top-up 5000 → success",
    expectStatus: 200,
    expectJson: (j) => j.success === true || j.balance !== undefined,
  });

  // ── 5. Verify balance after top-up ─────────────────────────────────────
  console.log("\n── Step 5: Verify balance = 5000 after top-up");

  const ctr5 = nextCounter();
  const tap5 = virtualTap(CARD_UID, ctr5, provisionedK1, provisionedK2);
  let balanceAfterTopup = 0;
  const balResp5 = await req("GET", `/card/info?p=${tap5.pHex}&c=${tap5.cHex}`, {
    label: "Balance check → 5000",
    expectStatus: 200,
    expectJson: (j) => {
      balanceAfterTopup = j.balance;
      return typeof j.balance === "number" && j.balance === 5000;
    },
  });

  // ── 6. POS charge ──────────────────────────────────────────────────────
  console.log("\n── Step 6: POS charge 1000 credits");

  const ctr6 = nextCounter();
  const tap6 = virtualTap(CARD_UID, ctr6, provisionedK1, provisionedK2);
  await req("POST", "/operator/pos/charge", {
    body: JSON.stringify({ p: tap6.pHex, c: tap6.cHex, amount: 1000 }),
    headers: authHeaders,
    label: "POS charge 1000 → success",
    expectStatus: [200, 201],
    expectJson: (j) => j.success === true || j.status === "OK" || j.balance !== undefined,
  });

  // ── 7. Verify balance after POS charge ─────────────────────────────────
  console.log("\n── Step 7: Verify balance = 4000 after POS charge");

  const ctr7 = nextCounter();
  const tap7 = virtualTap(CARD_UID, ctr7, provisionedK1, provisionedK2);
  await req("GET", `/card/info?p=${tap7.pHex}&c=${tap7.cHex}`, {
    label: "Balance after charge → 4000",
    expectStatus: 200,
    expectJson: (j) => typeof j.balance === "number" && j.balance === 4000,
  });

  // ── 8. Full LNURL payment flow ─────────────────────────────────────────
  console.log("\n── Step 8: Full LNURL payment flow");

  const ctr8 = nextCounter();
  const tap8 = virtualTap(CARD_UID, ctr8, provisionedK1, provisionedK2);
  const withdrawResp = await req("GET", `/?p=${tap8.pHex}&c=${tap8.cHex}`, {
    label: "Tap for LNURL payment → withdrawRequest",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest" && typeof j.maxWithdrawable === "number",
  });

  let balanceBeforePayment = 4000;

  if (withdrawResp.resp && withdrawResp.resp.status === 200) {
    const withdrawJson = JSON.parse(withdrawResp.text);
    const callbackUrl = new URL(withdrawJson.callback, BASE);
    const k1 = withdrawJson.k1;

    // Get fake invoice — use a specific amount
    const paymentAmount = 1500;
    const invoiceResp = await req("GET", `/api/fake-invoice?amount=${paymentAmount}`, {
      label: `Fake invoice (${paymentAmount} msat) → bolt11`,
      expectStatus: 200,
      expectJson: (j) => typeof j.pr === "string" && j.pr.startsWith("lnbc"),
    });

    if (invoiceResp.resp && invoiceResp.resp.status === 200) {
      const invoiceJson = JSON.parse(invoiceResp.text);
      const pr = invoiceJson.pr;

      // Call LNURL callback with invoice
      await req("GET", `${callbackUrl.pathname}?k1=${k1}&pr=${pr}&amount=${paymentAmount}`, {
        label: "LNURL callback with invoice → payment processed",
        expectStatus: 200,
        expectJson: (j) => j.status === "OK",
      });
    }
  }

  // ── 9. Verify balance decreased after LNURL payment ────────────────────
  console.log("\n── Step 9: Verify balance decreased after LNURL payment");

  const ctr9 = nextCounter();
  const tap9 = virtualTap(CARD_UID, ctr9, provisionedK1, provisionedK2);
  let balanceAfterPayment = 4000;
  const balResp9 = await req("GET", `/card/info?p=${tap9.pHex}&c=${tap9.cHex}`, {
    label: "Balance after LNURL payment → < 4000",
    expectStatus: 200,
    expectJson: (j) => {
      balanceAfterPayment = j.balance;
      return typeof j.balance === "number" && j.balance < 4000;
    },
  });

  // ── 10. Refund partial ─────────────────────────────────────────────────
  console.log("\n── Step 10: Refund 500 credits");

  const ctr10 = nextCounter();
  const tap10 = virtualTap(CARD_UID, ctr10, provisionedK1, provisionedK2);
  await req("POST", "/operator/refund/apply", {
    body: JSON.stringify({ p: tap10.pHex, c: tap10.cHex, amount: 500 }),
    headers: authHeaders,
    label: "Refund 500 → success",
    expectStatus: [200, 201],
    expectJson: (j) => j.success === true || j.status === "OK" || j.balance !== undefined,
  });

  // ── 11. Verify balance decreased after refund ─────────────────────────
  console.log("\n── Step 11: Verify balance decreased after refund");

  const ctr11 = nextCounter();
  const tap11 = virtualTap(CARD_UID, ctr11, provisionedK1, provisionedK2);
  let balanceAfterRefund = 0;
  await req("GET", `/card/info?p=${tap11.pHex}&c=${tap11.cHex}`, {
    label: `Balance after refund → decreased by 500`,
    expectStatus: 200,
    expectJson: (j) => {
      balanceAfterRefund = j.balance;
      return typeof j.balance === "number" && j.balance === balanceAfterPayment - 500;
    },
  });

  // ── 12. Terminate card ─────────────────────────────────────────────────
  console.log("\n── Step 12: Terminate card (cardholder self-lock)");

  const ctr12 = nextCounter();
  const tap12 = virtualTap(CARD_UID, ctr12, provisionedK1, provisionedK2);
  await req("POST", "/api/card/lock", {
    body: JSON.stringify({ p: tap12.pHex, c: tap12.cHex }),
    headers: { "Content-Type": "application/json" },
    label: "Card lock → success (terminated)",
    expectStatus: 200,
    expectJson: (j) => j.success === true && j.state === "terminated",
  });

  // ── 13. Verify terminated card rejected on tap ─────────────────────────
  console.log("\n── Step 13: Verify terminated card rejected on tap");

  const ctr13 = nextCounter();
  const tap13 = virtualTap(CARD_UID, ctr13, provisionedK1, provisionedK2);
  await req("GET", `/?p=${tap13.pHex}&c=${tap13.cHex}`, {
    label: "Tap terminated card → 403 error",
    expectStatus: 403,
  });

  // Also verify /card/info still works but shows terminated
  await req("GET", `/card/info?p=${tap13.pHex}&c=${tap13.cHex}`, {
    label: "Card info on terminated card → state=terminated",
    expectStatus: 200,
    expectJson: (j) => j.state === "terminated" && j.reactivationAvailable === true,
  });

  // ── 14. Reactivate card ────────────────────────────────────────────────
  console.log("\n── Step 14: Reactivate terminated card");

  const ctr14 = nextCounter();
  const tap14 = virtualTap(CARD_UID, ctr14, provisionedK1, provisionedK2);
  let reactivateVersion = 0;
  await req("POST", "/api/card/reactivate", {
    body: JSON.stringify({ p: tap14.pHex, c: tap14.cHex }),
    headers: { "Content-Type": "application/json" },
    label: "Reactivate card → keys_delivered state",
    expectStatus: 200,
    expectJson: (j) => {
      reactivateVersion = j.version || 0;
      return j.success === true && j.state === "keys_delivered";
    },
  });

  // ── 15. Verify reactivated card works (first tap after reactivation) ───
  console.log("\n── Step 15: Verify reactivated card works after re-tap");

  // After reactivation, keys may have changed version — derive new keys
  const newVersion = reactivateVersion > 1 ? reactivateVersion : 2;
  const reactivatedKeys = deriveKeys(CARD_UID, ISSUER_KEY, newVersion);
  // Try with provisioned keys first (same version), then with new version
  let reactivatedK1 = provisionedK1;
  let reactivatedK2 = provisionedK2;

  const ctr15 = nextCounter();
  let tap15 = virtualTap(CARD_UID, ctr15, reactivatedK1, reactivatedK2);
  let tap15Result = await req("GET", `/?p=${tap15.pHex}&c=${tap15.cHex}`, {
    label: "First tap after reactivate → LNURL-withdraw",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest",
  });

  // If the first attempt failed (key version mismatch), try with reactivated-version keys
  if (!tap15Result.resp || tap15Result.resp.status !== 200) {
    console.log("    Retrying with reactivated-version keys...");
    reactivatedK1 = reactivatedKeys.k1;
    reactivatedK2 = reactivatedKeys.k2;
    const ctr15b = nextCounter();
    tap15 = virtualTap(CARD_UID, ctr15b, reactivatedK1, reactivatedK2);
    tap15Result = await req("GET", `/?p=${tap15.pHex}&c=${tap15.cHex}`, {
      label: "First tap after reactivate (versioned keys) → LNURL-withdraw",
      expectStatus: 200,
      expectJson: (j) => j.tag === "withdrawRequest",
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 16: PENDING STATE TEST
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n── Step 16: Pending state (provisioned but never tapped)");

  const PENDING_UID = makeUid();
  // Pause briefly to ensure unique timestamp
  await new Promise(r => setTimeout(r, 10));

  const pendingKeys = deriveKeys(PENDING_UID, ISSUER_KEY);

  await req(
    "POST",
    `/api/v1/pull-payments/${PULL_PAYMENT_ID}/boltcards?onExisting=UpdateVersion`,
    {
      body: JSON.stringify({ UID: PENDING_UID }),
      headers: { "Content-Type": "application/json" },
      label: "Provision pending card → keys returned",
      expectStatus: 200,
      expectJson: (j) => typeof j.k1 === "string" && typeof j.k2 === "string",
    }
  );

  // Check state — should be pending or keys_delivered (provisioned but never tapped)
  const ctrPendingInfo = nextCounter();
  const tapPendingInfo = virtualTap(PENDING_UID, ctrPendingInfo, pendingKeys.k1, pendingKeys.k2);
  await req("GET", `/card/info?p=${tapPendingInfo.pHex}&c=${tapPendingInfo.cHex}`, {
    label: "Pending card info → state is pending or keys_delivered",
    expectStatus: 200,
    expectJson: (j) => j.state === "pending" || j.state === "keys_delivered",
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 17: COUNTER EDGE — counter=0
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n── Step 17: Counter edge case — counter=0");

  const ZERO_CTR_UID = makeUid();
  await new Promise(r => setTimeout(r, 10));
  const zeroKeys = deriveKeys(ZERO_CTR_UID, ISSUER_KEY);

  // Provision the card
  const zeroProvResp = await req(
    "POST",
    `/api/v1/pull-payments/${PULL_PAYMENT_ID}/boltcards?onExisting=UpdateVersion`,
    {
      body: JSON.stringify({ UID: ZERO_CTR_UID }),
      headers: { "Content-Type": "application/json" },
      label: "Provision counter=0 card → keys returned",
      expectStatus: 200,
      expectJson: (j) => typeof j.k1 === "string",
    }
  );

  // Use server-returned keys if available
  let zeroK1 = zeroKeys.k1;
  let zeroK2 = zeroKeys.k2;
  if (zeroProvResp.resp && zeroProvResp.resp.status === 200) {
    try {
      const provJson = JSON.parse(zeroProvResp.text);
      zeroK1 = provJson.k1;
      zeroK2 = provJson.k2;
    } catch { /* use derived */ }
  }

  // Tap with counter=0
  const tapZero = virtualTap(ZERO_CTR_UID, 0, zeroK1, zeroK2);
  await req("GET", `/?p=${tapZero.pHex}&c=${tapZero.cHex}`, {
    label: "Counter=0 tap → LNURL-withdraw",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest",
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 18: COUNTER EDGE — max counter 0xFFFFFF
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n── Step 18: Counter edge case — max counter 0xFFFFFF (16777215)");

  const MAX_CTR_UID = makeUid();
  await new Promise(r => setTimeout(r, 10));
  const maxKeys = deriveKeys(MAX_CTR_UID, ISSUER_KEY);

  // Provision the card
  const maxProvResp = await req(
    "POST",
    `/api/v1/pull-payments/${PULL_PAYMENT_ID}/boltcards?onExisting=UpdateVersion`,
    {
      body: JSON.stringify({ UID: MAX_CTR_UID }),
      headers: { "Content-Type": "application/json" },
      label: "Provision max-counter card → keys returned",
      expectStatus: 200,
      expectJson: (j) => typeof j.k1 === "string",
    }
  );

  let maxK1 = maxKeys.k1;
  let maxK2 = maxKeys.k2;
  if (maxProvResp.resp && maxProvResp.resp.status === 200) {
    try {
      const provJson = JSON.parse(maxProvResp.text);
      maxK1 = provJson.k1;
      maxK2 = provJson.k2;
    } catch { /* use derived */ }
  }

  // Tap with counter=0xFFFFFF (16777215)
  const tapMax = virtualTap(MAX_CTR_UID, 0xFFFFFF, maxK1, maxK2);
  await req("GET", `/?p=${tapMax.pHex}&c=${tapMax.cHex}`, {
    label: "Counter=0xFFFFFF (16777215) tap → LNURL-withdraw",
    expectStatus: 200,
    expectJson: (j) => j.tag === "withdrawRequest",
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (bugs.length > 0) {
    console.log(`\n  🐛 Failures:`);
    for (const bug of bugs) {
      console.log(`    ✗ ${bug.test}: ${bug.errors.join(", ")}`);
    }
  }
  console.log(`${"═".repeat(70)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(2);
});
