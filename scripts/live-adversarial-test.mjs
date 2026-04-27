#!/usr/bin/env node
// Live adversarial testing against deployed boltcard-cloudflareworker.
// Proves DO-level balance enforcement and counter replay protection work in production.
//
// Usage: node scripts/live-adversarial-test.mjs [BASE_URL]
// Default: https://boltcardpoc.psbt.me

import { hexToBytes, bytesToHex, buildVerificationData } from "../cryptoutils.js";
import aesjs from "aes-js";

const BASE = process.argv[2] || "https://boltcardpoc.psbt.me";

function randomHex(bytes) {
  return Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
}

function virtualTap(uidHex, counter, k1Hex, k2Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xc7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const aes = new aesjs.ModeOfOperation.ecb(k1);
  const encrypted = aes.encrypt(plaintext);
  const pHex = bytesToHex(new Uint8Array(encrypted));
  const ctr = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
  const vd = buildVerificationData(uid, ctr, hexToBytes(k2Hex));
  const cHex = bytesToHex(vd.ct);
  return { pHex, cHex };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

let sessionCookie = "";
let csrfToken = "";

function cookieHeader() {
  let c = sessionCookie;
  if (csrfToken) c += "; op_csrf=" + csrfToken;
  return c;
}

async function apiFetch(path, options = {}) {
  const url = BASE + path;
  const headers = { ...options.headers };
  headers["Cookie"] = cookieHeader();
  if (csrfToken && (options.method === "POST" || options.method === "PUT")) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  const resp = await fetch(url, { ...options, headers, redirect: "manual" });
  const setCookies = resp.headers.getSetCookie?.() || [];
  for (const sc of setCookies) {
    const m = sc.match(/op_session=([^;]+)/);
    if (m) sessionCookie = `op_session=${m[1]}`;
    const cs = sc.match(/op_csrf=([^;]+)/);
    if (cs) csrfToken = cs[1];
  }
  return resp;
}

async function login() {
  const resp = await apiFetch("/operator/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "pin=1234",
  });
  if (resp.status !== 302 && resp.status !== 200) {
    throw new Error(`Login failed: ${resp.status}`);
  }
  // Visit operator page to get CSRF cookie
  await apiFetch("/operator/pos");
  console.log(`  ✓ Operator login + CSRF acquired`);
}

async function provisionCard(uid) {
  const resp = await apiFetch(
    "/api/v1/pull-payments/fUDXsnySxvb5LYZ1bSLiWzLjVuT/boltcards?onExisting=UpdateVersion",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ UID: uid }),
    }
  );
  if (resp.status === 200) {
    const json = await resp.json();
    return { status: resp.status, k1: json.k1, k2: json.k2 };
  }
  return { status: resp.status, k1: null, k2: null };
}

async function topUp(uid, amount, k1, k2) {
  const { pHex, cHex } = virtualTap(uid, 1, k1, k2);
  const resp = await apiFetch("/operator/topup/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p: pHex, c: cHex, amount }),
  });
  return resp;
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ ${message}`);
    failed++;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testCounterReplay() {
  console.log("\n══ 1. Counter Replay ══");
  const uid = `04${randomHex(6)}`;
  const { k1, k2 } = await provisionCard(uid);
  if (!k1) { console.log("  ⊘ Skipped (provision failed)"); return; }

  const { pHex, cHex } = virtualTap(uid, 1, k1, k2);

  const r1 = await apiFetch(`/?p=${pHex}&c=${cHex}`);
  assert(r1.status === 200, `First tap accepted (${r1.status})`);

  const r2 = await apiFetch(`/?p=${pHex}&c=${cHex}`);
  assert(r2.status === 400, `Replayed counter rejected (${r2.status})`);
}

async function testDoubleSpendCallback() {
  console.log("\n══ 2. Double-Spend via Callback ══");
  const uid = `04${randomHex(6)}`;
  const { k1, k2 } = await provisionCard(uid);
  if (!k1) { console.log("  ⊘ Skipped (provision failed)"); return; }

  const topUpResp = await topUp(uid, 10000, k1, k2);
  const topUpBody = await topUpResp.json().catch(() => ({}));
  console.log(`  Top-up: ${topUpResp.status} (balance: ${topUpBody.balance ?? "?"})`);

  const { pHex, cHex } = virtualTap(uid, 2, k1, k2);
  const step1 = await apiFetch(`/?p=${pHex}&c=${cHex}`);
  assert(step1.status === 200, `Step 1 accepted`);

  const cb1 = await apiFetch(
    `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1invoiceA&amount=1000`
  );
  const cb1Body = await cb1.json().catch(() => ({}));
  console.log(`  Callback 1: ${cb1.status} (${cb1Body.status || cb1Body.reason || "?"})`);
  assert(cb1.status === 200, `First callback accepted (${cb1.status})`);

  const cb2 = await apiFetch(
    `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1invoiceB&amount=1000`
  );
  const cb2Body = await cb2.json().catch(() => ({}));
  console.log(`  Callback 2: ${cb2.status} (${JSON.stringify(cb2Body).slice(0, 100)})`);

  // Check final balance to detect double-debit
  const tap3 = virtualTap(uid, 3, k1, k2);
  const info = await apiFetch(`/card/info?p=${tap3.pHex}&c=${tap3.cHex}`);
  const infoBody = await info.json();
  console.log(`  Final balance: ${infoBody.balance}`);

  const noDoubleDebit = infoBody.balance === 9000;
  assert(noDoubleDebit, `Only 1000 deducted (balance: ${infoBody.balance})`);
  if (!noDoubleDebit) {
    console.log(`  ⚠️  BUG: Second callback caused double-debit!`);
  }

  // Regardless of balance, check if second callback was properly rejected
  const cb2Rejected = cb2.status === 409;
  assert(cb2Rejected, `Second callback returns 409 (${cb2.status})`);
}

async function testBalanceOverdraft() {
  console.log("\n══ 3. Balance Overdraft ══");
  const uid = `04${randomHex(6)}`;
  const { k1, k2 } = await provisionCard(uid);
  if (!k1) { console.log("  ⊘ Skipped (provision failed)"); return; }
  await topUp(uid, 500, k1, k2);

  const { pHex, cHex } = virtualTap(uid, 2, k1, k2);
  await apiFetch(`/?p=${pHex}&c=${cHex}`);

  const cb = await apiFetch(
    `/boltcards/api/v1/lnurl/cb/${pHex}?k1=${cHex}&pr=lnbc10n1big&amount=99999`
  );
  const body = await cb.json().catch(() => ({}));
  assert(
    cb.status === 500 && body.status === "ERROR",
    `Overdraft rejected (${cb.status}: ${body.reason || body.status})`
  );
}

async function testExactDrain() {
  console.log("\n══ 4. Exact Balance Drain ══");
  const uid = `04${randomHex(6)}`;
  const { k1, k2 } = await provisionCard(uid);
  if (!k1) { console.log("  ⊘ Skipped (provision failed)"); return; }
  await topUp(uid, 500, k1, k2);

  const tap1 = virtualTap(uid, 2, k1, k2);
  await apiFetch(`/?p=${tap1.pHex}&c=${tap1.cHex}`);
  const cb1 = await apiFetch(
    `/boltcards/api/v1/lnurl/cb/${tap1.pHex}?k1=${tap1.cHex}&pr=lnbc10n1drain&amount=500`
  );
  assert(cb1.status === 200, `Exact drain succeeded (${cb1.status})`);

  const tap2 = virtualTap(uid, 3, k1, k2);
  await apiFetch(`/?p=${tap2.pHex}&c=${tap2.cHex}`);
  const cb2 = await apiFetch(
    `/boltcards/api/v1/lnurl/cb/${tap2.pHex}?k1=${tap2.cHex}&pr=lnbc10n1over&amount=1`
  );
  assert(cb2.status === 500, `Post-drain debit rejected (${cb2.status})`);
}

async function testPOSOverdraft() {
  console.log("\n══ 5. POS Charge Overdraft ══");
  const uid = `04${randomHex(6)}`;
  const { k1, k2 } = await provisionCard(uid);
  if (!k1) { console.log("  ⊘ Skipped (provision failed)"); return; }
  await topUp(uid, 100, k1, k2);

  const { pHex, cHex } = virtualTap(uid, 2, k1, k2);
  const resp = await apiFetch("/operator/pos/charge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p: pHex, c: cHex, amount: 9999 }),
  });
  assert(resp.status === 402, `POS overdraft rejected with 402 (${resp.status})`);
}

async function testPOSCounterReplay() {
  console.log("\n══ 6. POS Counter Replay ══");
  const uid = `04${randomHex(6)}`;
  const { k1, k2 } = await provisionCard(uid);
  if (!k1) { console.log("  ⊘ Skipped (provision failed)"); return; }
  await topUp(uid, 10000, k1, k2);

  const { pHex, cHex } = virtualTap(uid, 2, k1, k2);

  const r1 = await apiFetch("/operator/pos/charge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p: pHex, c: cHex, amount: 100 }),
  });
  assert(r1.status === 200, `First POS charge accepted (${r1.status})`);

  const r2 = await apiFetch("/operator/pos/charge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p: pHex, c: cHex, amount: 100 }),
  });
  assert(r2.status === 400, `Replayed POS charge rejected (${r2.status})`);
}

async function testInvalidCMAC() {
  console.log("\n══ 7. Invalid CMAC ══");
  const uid = `04${randomHex(6)}`;
  const { k1, k2 } = await provisionCard(uid);
  if (!k1) { console.log("  ⊘ Skipped (provision failed)"); return; }

  // First tap activates the card (keys_delivered → active)
  await apiFetch(`/?p=${virtualTap(uid, 1, k1, k2).pHex}&c=${virtualTap(uid, 1, k1, k2).cHex}`);

  // Now try with invalid CMAC
  const { pHex } = virtualTap(uid, 2, k1, k2);
  const resp = await apiFetch(`/?p=${pHex}&c=AABBCCDDEEFF0011`);
  assert(resp.status === 400, `Invalid CMAC rejected (${resp.status})`);
}

async function testCardInfoBalance() {
  console.log("\n══ 8. Card Info + Balance ══");
  const uid = `04${randomHex(6)}`;
  const { k1, k2 } = await provisionCard(uid);
  if (!k1) { console.log("  ⊘ Skipped (provision failed)"); return; }

  await topUp(uid, 1000, k1, k2);

  const { pHex, cHex } = virtualTap(uid, 2, k1, k2);
  const resp = await apiFetch(`/card/info?p=${pHex}&c=${cHex}`);
  assert(resp.status === 200, `Card info with valid tap (${resp.status})`);
  const body = await resp.json();
  assert(body.balance != null, `Balance returned: ${body.balance}`);
}

async function testConcurrentPOSCharges() {
  console.log("\n══ 9. Concurrent POS Charges (TOCTOU) ══");
  const uid = `04${randomHex(6)}`;
  const { k1, k2 } = await provisionCard(uid);
  if (!k1) { console.log("  ⊘ Skipped (provision failed)"); return; }
  await topUp(uid, 100, k1, k2);

  const { pHex, cHex } = virtualTap(uid, 2, k1, k2);
  const body = JSON.stringify({ p: pHex, c: cHex, amount: 100 });

  const [r1, r2] = await Promise.all([
    apiFetch("/operator/pos/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    apiFetch("/operator/pos/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  ]);

  const statuses = [r1.status, r2.status].sort();
  const successes = statuses.filter(s => s === 200).length;
  assert(successes === 1, `Exactly one charge succeeded (${statuses.join(", ")})`);

  const tap3 = virtualTap(uid, 3, k1, k2);
  const info = await apiFetch(`/card/info?p=${tap3.pHex}&c=${tap3.cHex}`);
  const infoBody = await info.json();
  assert(infoBody.balance === 0, `Balance is 0 after concurrent charge (${infoBody.balance})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n🔧 Live Adversarial Test — ${BASE}`);
console.log(`   Using provisioned K1/K2 per card`);
console.log(`   Real AES-CMAC via cryptoutils.js\n`);

try {
  await login();

  await testInvalidCMAC();
  await testCounterReplay();
  await testPOSCounterReplay();
  await testPOSOverdraft();
  await testDoubleSpendCallback();
  await testBalanceOverdraft();
  await testExactDrain();
  await testCardInfoBalance();
  await testConcurrentPOSCharges();
} catch (e) {
  console.error(`\n✗ Fatal: ${e.message}`);
  console.error(e.stack);
}

console.log(`\n══ Results: ${passed} passed, ${failed} failed ══`);
process.exit(failed > 0 ? 1 : 0);
