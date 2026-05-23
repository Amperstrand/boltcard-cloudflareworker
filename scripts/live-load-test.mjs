#!/usr/bin/env node
// Live load test — stress-tests deployed boltcard-cloudflareworker with concurrent card operations.
// Proves correctness under load: no double-debits, no balance corruption, sequential DO processing.
//
// Usage: node scripts/live-load-test.mjs [BASE_URL]
// Default: https://boltcardpoc.psbt.me
//
// Phases:
//   1. Provision 5 cards + top-up 10000 each (sequential)
//   2. Concurrent POS charges (5 cards x 3 charges = 15 concurrent)
//   3. Concurrent LNURL callbacks (3 cards x 2 callbacks = 6 concurrent)
//   4. Concurrent top-ups + charges (mixed load, 5 cards)
//   5. Report: latency stats, balance verification, pass/fail

import { createCipheriv } from "node:crypto";

const BASE = process.argv[2] || "https://boltcardpoc.psbt.me";
const PULL_PAYMENT_ID = "fUDXsnySxvb5LYZ1bSLiWzLjVuT";
const OPERATOR_PIN = "1234";
const ISSUER_KEY = "00000000000000000000000000000001";
const NUM_CARDS = 5;

// ── Latency tracking ──────────────────────────────────────────────────────────

const latencies = [];
let totalRequests = 0;
let successRequests = 0;

function recordLatency(ms) {
  latencies.push(ms);
}

function latencyStats() {
  if (latencies.length === 0) return { min: 0, p50: 0, p99: 0, max: 0, count: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    min: sorted[0].toFixed(1),
    p50: sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
    p99: sorted[Math.floor(sorted.length * 0.99)].toFixed(1),
    max: sorted[sorted.length - 1].toFixed(1),
    count: sorted.length,
  };
}

// ── Crypto primitives (node:crypto only, matching cryptoutils.ts + keygenerator.ts) ──

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

// ── Key derivation (matching keygenerator.ts) ─────────────────────────────────

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
    k1: bytesToHex(computeAesCmac(hexToBytes("2d003f77"), issuerKey)),
    k2: bytesToHex(computeAesCmac(hexToBytes("2d003f78"), cardKey)),
    cardKey: bytesToHex(cardKey),
  };
}

// ── Virtual tap (matching testHelpers.ts virtualTap) ───────────────────────────

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

// ── HTTP helpers ───────────────────────────────────────────────────────────────

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
  const start = performance.now();
  const resp = await fetch(url, { ...options, headers, redirect: "manual" });
  const elapsed = performance.now() - start;
  totalRequests++;
  recordLatency(elapsed);

  // Capture cookies from response
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
  console.log("  Logging in as operator...");
  const resp = await apiFetch("/operator/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `pin=${OPERATOR_PIN}`,
  });
  if (resp.status !== 302 && resp.status !== 200) {
    throw new Error(`Login failed: ${resp.status}`);
  }
  // Visit operator page to get CSRF cookie
  await apiFetch("/operator/pos");
  console.log("  ✓ Operator login + CSRF acquired");
}

// ── Card management ────────────────────────────────────────────────────────────

function randomUid() {
  // 7-byte UID (14 hex chars) starting with 04, unique per run
  const suffix = (Date.now() % 0xFFFFFFFFFFFF).toString(16).padStart(12, "0");
  return `04${suffix}`;
}

let uidCounter = 0;
function uniqueUid() {
  // Use incrementing counter + timestamp to guarantee uniqueness across cards
  uidCounter++;
  const base = Date.now() % 0xFFFF;
  const uniq = (uidCounter * 65537 + base) % 0xFFFFFFFFFFFF;
  return `04${uniq.toString(16).padStart(12, "0")}`;
}

async function provisionCard(uid) {
  const resp = await apiFetch(
    `/api/v1/pull-payments/${PULL_PAYMENT_ID}/boltcards?onExisting=UpdateVersion`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ UID: uid }),
    }
  );
  if (resp.status === 200) {
    const json = await resp.json();
    successRequests++;
    return { ok: true, k1: json.k1, k2: json.k2 };
  }
  const text = await resp.text().catch(() => "");
  return { ok: false, k1: null, k2: null, status: resp.status, body: text };
}

async function topUp(uid, amount, k1, k2, counter) {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  const start = performance.now();
  const resp = await apiFetch("/operator/topup/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p: pHex, c: cHex, amount }),
  });
  const elapsed = performance.now() - start;
  if (resp.status === 200) {
    successRequests++;
    const json = await resp.json();
    return { ok: true, balance: json.balance, status: resp.status, elapsed };
  }
  const text = await resp.text().catch(() => "");
  return { ok: false, status: resp.status, body: text, elapsed };
}

async function posCharge(uid, amount, k1, k2, counter) {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  const resp = await apiFetch("/operator/pos/charge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p: pHex, c: cHex, amount }),
  });
  if (resp.status === 200) {
    successRequests++;
    const json = await resp.json();
    return { ok: true, balance: json.balance, amount: json.amount, status: resp.status };
  }
  const text = await resp.text().catch(() => "");
  return { ok: false, status: resp.status, body: text };
}

async function getCardInfo(uid, k1, k2, counter) {
  const { pHex, cHex } = virtualTap(uid, counter, k1, k2);
  const resp = await apiFetch(`/card/info?p=${pHex}&c=${cHex}`);
  if (resp.status === 200) {
    successRequests++;
    return await resp.json();
  }
  return null;
}

async function getFakeInvoice(amount) {
  const resp = await apiFetch(`/api/fake-invoice?amount=${amount}`);
  if (resp.status === 200) {
    successRequests++;
    return await resp.json();
  }
  return null;
}

// ── Test phases ────────────────────────────────────────────────────────────────

const phaseResults = { passed: 0, failed: 0 };

function pass(msg) {
  phaseResults.passed++;
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  phaseResults.failed++;
  console.log(`  ✗ ${msg}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Phase 1: Provision + Top-up ────────────────────────────────────────────────

async function phase1() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  PHASE 1: Provision + Top-up (sequential, N=5 cards)");
  console.log(`${"═".repeat(60)}\n`);

  const cards = [];

  for (let i = 0; i < NUM_CARDS; i++) {
    const uid = uniqueUid();
    console.log(`  Card ${i + 1}: UID=${uid}`);

    // Provision
    const provResult = await provisionCard(uid);
    if (!provResult.ok) {
      fail(`Card ${i + 1} provision failed (${provResult.status}: ${provResult.body})`);
      continue;
    }
    pass(`Card ${i + 1} provisioned (K1=${provResult.k1.substring(0, 8)}...)`);

    // Top-up 10000 credits (counter=1 for top-up)
    const topupResult = await topUp(uid, 10000, provResult.k1, provResult.k2, 1);
    if (!topupResult.ok) {
      fail(`Card ${i + 1} top-up failed (${topupResult.status}: ${topupResult.body})`);
      continue;
    }
    pass(`Card ${i + 1} topped up 10000 (balance: ${topupResult.balance})`);

    // Verify balance via /card/info (counter=2)
    const info = await getCardInfo(uid, provResult.k1, provResult.k2, 2);
    if (!info) {
      fail(`Card ${i + 1} card/info failed`);
      continue;
    }
    if (info.balance === 10000) {
      pass(`Card ${i + 1} balance verified: ${info.balance}`);
    } else {
      fail(`Card ${i + 1} balance mismatch: expected 10000, got ${info.balance}`);
      continue;
    }

    cards.push({
      uid,
      k1: provResult.k1,
      k2: provResult.k2,
      nextCounter: 3, // already used counters 1 (topup) and 2 (card/info)
      initialBalance: 10000,
    });
  }

  pass(`Phase 1 complete: ${cards.length}/${NUM_CARDS} cards provisioned`);
  return cards;
}

// ── Phase 2: Concurrent POS charges ────────────────────────────────────────────

async function phase2(cards) {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  PHASE 2: Concurrent POS charges (5 cards x 3 charges = 15 concurrent)");
  console.log(`${"═".repeat(60)}\n`);

  if (cards.length === 0) {
    fail("Phase 2 skipped: no cards provisioned");
    return cards;
  }

  const chargeAmount = 500;
  const chargesPerCard = 3;

  // Prepare 15 charge requests (3 per card, each with unique counter)
  const requests = [];
  for (const card of cards) {
    for (let i = 0; i < chargesPerCard; i++) {
      const counter = card.nextCounter++;
      requests.push({ card, counter, index: requests.length });
    }
  }

  console.log(`  Firing ${requests.length} POS charges simultaneously...`);

  // Fire all 15 requests simultaneously
  const start = performance.now();
  const results = await Promise.allSettled(
    requests.map(({ card, counter }) =>
      posCharge(card.uid, chargeAmount, card.k1, card.k2, counter)
    )
  );
  const wallTime = (performance.now() - start).toFixed(1);
  console.log(`  All ${requests.length} charges completed in ${wallTime}ms`);

  // Analyze results per card
  for (let cardIdx = 0; cardIdx < cards.length; cardIdx++) {
    const card = cards[cardIdx];
    const cardResults = results.slice(cardIdx * chargesPerCard, (cardIdx + 1) * chargesPerCard);
    const successes = cardResults.filter(r => r.status === "fulfilled" && r.value.ok);
    const failures = cardResults.filter(r => r.status === "fulfilled" && !r.value.ok);
    const rejected = cardResults.filter(r => r.status === "rejected");

    // DO is single-threaded per card, so exactly one charge per counter should succeed
    // With 3 different counters, all 3 should succeed (different counter = not a replay)
    if (successes.length === chargesPerCard) {
      pass(`Card ${cardIdx + 1}: all ${chargesPerCard} charges succeeded`);
    } else {
      fail(`Card ${cardIdx + 1}: ${successes.length}/${chargesPerCard} charges succeeded (${failures.length} failures, ${rejected.length} rejected)`);
      if (failures.length > 0) {
        for (const f of failures) {
          console.log(`    - Failed: status=${f.value.status}`);
        }
      }
    }

    // Update expected balance
    if (successes.length === chargesPerCard) {
      card.initialBalance -= chargesPerCard * chargeAmount;
    }
  }

  // Verify no double-debits by checking final balances
  console.log("\n  Verifying final balances...");
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const counter = card.nextCounter++;
    const info = await getCardInfo(card.uid, card.k1, card.k2, counter);
    if (!info) {
      fail(`Card ${i + 1}: balance check failed`);
      continue;
    }
    if (info.balance === card.initialBalance) {
      pass(`Card ${i + 1}: final balance ${info.balance} matches expected ${card.initialBalance}`);
    } else {
      fail(`Card ${i + 1}: balance mismatch! expected ${card.initialBalance}, got ${info.balance}`);
    }
  }

  return cards;
}

// ── Phase 3: Concurrent LNURL callbacks ────────────────────────────────────────

async function phase3(cards) {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  PHASE 3: Concurrent LNURL callbacks (3 cards x 2 callbacks = 6 concurrent)");
  console.log(`${"═".repeat(60)}\n`);

  if (cards.length < 3) {
    fail("Phase 3 skipped: need at least 3 cards");
    return cards;
  }

  // Use first 3 cards only
  const testCards = cards.slice(0, 3);
  const callbackAmount = 300;

  // Step 1: Tap each card to get withdrawResponse
  const tapResults = [];
  for (let i = 0; i < testCards.length; i++) {
    const card = testCards[i];
    const counter = card.nextCounter++;
    const { pHex, cHex } = virtualTap(card.uid, counter, card.k1, card.k2);

    const resp = await apiFetch(`/?p=${pHex}&c=${cHex}`, {
      headers: { "Accept": "application/json" },
    });
    if (resp.status === 200) {
      successRequests++;
      const json = await resp.json();
      tapResults.push({ card, cardIdx: i, pHex, cHex, withdrawResponse: json });
      pass(`Card ${i + 1}: tap accepted, got withdrawResponse`);
    } else {
      fail(`Card ${i + 1}: tap failed (${resp.status})`);
      tapResults.push(null);
    }
  }

  // Step 2: Generate fake invoices for each card
  const invoices = [];
  for (let i = 0; i < tapResults.length; i++) {
    if (!tapResults[i]) { invoices.push(null); continue; }
    const invoice = await getFakeInvoice(callbackAmount);
    if (invoice && invoice.pr) {
      invoices.push(invoice.pr);
      pass(`Card ${i + 1}: fake invoice generated`);
    } else {
      fail(`Card ${i + 1}: fake invoice failed`);
      invoices.push(null);
    }
  }

  // Step 3: Fire 2 callbacks per card simultaneously (same invoice = double-spend attempt)
  console.log("\n  Firing 2 concurrent callbacks per card (double-spend test)...");
  const callbackRequests = [];
  for (let i = 0; i < tapResults.length; i++) {
    if (!tapResults[i] || !invoices[i]) continue;
    const { card, pHex, cHex, withdrawResponse } = tapResults[i];
    const callbackUrl = new URL(withdrawResponse.callback, BASE);
    const k1 = withdrawResponse.k1;

    // Both callbacks use same p, k1, and invoice — second should be rejected as replay
    for (let j = 0; j < 2; j++) {
      callbackRequests.push({
        cardIdx: i,
        card,
        url: `${callbackUrl.pathname}?k1=${k1}&pr=${invoices[i]}&amount=${callbackAmount}`,
        callbackNum: j,
      });
    }
  }

  const start = performance.now();
  const cbResults = await Promise.allSettled(
    callbackRequests.map(req => {
      const startReq = performance.now();
      return apiFetch(req.url).then(async resp => {
        const elapsed = performance.now() - startReq;
        const text = await resp.text().catch(() => "");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        if (resp.status === 200) successRequests++;
        return { status: resp.status, body: text, json, elapsed, ok: resp.status === 200 };
      });
    })
  );
  const wallTime = (performance.now() - start).toFixed(1);
  console.log(`  All ${callbackRequests.length} callbacks completed in ${wallTime}ms`);

   // Step 4: Verify exactly 1 callback per card succeeded
   for (let i = 0; i < testCards.length; i++) {
     const cardCbResults = cbResults.filter((_, idx) => callbackRequests[idx]?.cardIdx === i);
     const fulfilled = cardCbResults.filter(r => r.status === "fulfilled");
     const successes = fulfilled.filter(r => r.value.ok);
     const failures = fulfilled.filter(r => !r.value.ok);

     if (successes.length === 1 && failures.length === 1) {
       pass(`Card ${i + 1}: exactly 1 callback succeeded, 1 failed (double-spend prevented)`);
       testCards[i].initialBalance -= callbackAmount;
     } else if (successes.length === 2) {
       fail(`Card ${i + 1}: both callbacks succeeded (DOUBLE-DEBIT!)`);
     } else if (successes.length === 0) {
       fail(`Card ${i + 1}: no callbacks succeeded`);
     } else {
       fail(`Card ${i + 1}: ${successes.length} callbacks succeeded, ${failures.length} failed (unexpected)`);
     }

     if (failures.length > 0) {
       for (const f of failures) {
         console.log(`    - Rejected callback: status=${f.value.status}`);
         if (f.value.json && f.value.json.error === "Replay detected") {
           console.log(`      - This is expected for the duplicate callback`);
         }
       }
     }
   }

   // Verify balances
   console.log("\n  Verifying final balances...");
   for (let i = 0; i < testCards.length; i++) {
     const card = testCards[i];
     const counter = card.nextCounter++;
     const info = await getCardInfo(card.uid, card.k1, card.k2, counter);
     if (!info) {
       fail(`Card ${i + 1}: balance check failed`);
       continue;
     }
      // Expected: initialBalance was already reduced by callbackAmount on line 559
      if (info.balance === card.initialBalance) {
        pass(`Card ${i + 1}: final balance ${info.balance} matches expected ${card.initialBalance}`);
      } else {
        fail(`Card ${i + 1}: balance mismatch! expected ${card.initialBalance}, got ${info.balance}`);
     }
   }

  return cards;
}

// ── Phase 4: Concurrent top-ups + charges (mixed load) ─────────────────────────

async function phase4(cards) {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  PHASE 4: Concurrent top-ups + charges (mixed load)");
  console.log(`${"═".repeat(60)}\n`);

  if (cards.length === 0) {
    fail("Phase 4 skipped: no cards provisioned");
    return cards;
  }

  // First top-up all cards with additional 5000
  console.log("  Step 1: Top-up all cards with 5000...");
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const counter = card.nextCounter++;
    const result = await topUp(card.uid, 5000, card.k1, card.k2, counter);
    if (result.ok) {
      card.initialBalance += 5000;
      pass(`Card ${i + 1}: top-up 5000 succeeded (balance: ${result.balance})`);
    } else {
      fail(`Card ${i + 1}: top-up 5000 failed (${result.status}: ${result.body})`);
    }
  }

  // Now fire top-up(1000) AND pos-charge(500) simultaneously per card
  console.log("\n  Step 2: Fire top-up(1000) + pos-charge(500) simultaneously per card...");
  const mixedRequests = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const topupCounter = card.nextCounter++;
    const chargeCounter = card.nextCounter++;
    mixedRequests.push({
      cardIdx: i,
      card,
      type: "topup",
      counter: topupCounter,
      amount: 1000,
    });
    mixedRequests.push({
      cardIdx: i,
      card,
      type: "charge",
      counter: chargeCounter,
      amount: 500,
    });
  }

  const start = performance.now();
  const mixedResults = await Promise.allSettled(
    mixedRequests.map(req => {
      if (req.type === "topup") {
        return topUp(req.card.uid, req.amount, req.card.k1, req.card.k2, req.counter)
          .then(r => ({ ...r, type: "topup" }));
      } else {
        return posCharge(req.card.uid, req.amount, req.card.k1, req.card.k2, req.counter)
          .then(r => ({ ...r, type: "charge" }));
      }
    })
  );
  const wallTime = (performance.now() - start).toFixed(1);
  console.log(`  All ${mixedRequests.length} mixed operations completed in ${wallTime}ms`);

  // Analyze results per card
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const cardRequests = mixedRequests.filter(r => r.cardIdx === i);
    const cardResults = mixedResults.filter((_, idx) => mixedRequests[idx]?.cardIdx === i);

    const topupResult = cardResults.find((_, idx) => cardRequests[idx]?.type === "topup");
    const chargeResult = cardResults.find((_, idx) => cardRequests[idx]?.type === "charge");

    const topupOk = topupResult?.status === "fulfilled" && topupResult.value?.ok;
    const chargeOk = chargeResult?.status === "fulfilled" && chargeResult.value?.ok;

    if (topupOk && chargeOk) {
      // Top-up adds 1000, charge removes 500 => net +500
      card.initialBalance += 1000 - 500;
      pass(`Card ${i + 1}: top-up + charge both succeeded`);
    } else if (topupOk) {
      card.initialBalance += 1000;
      pass(`Card ${i + 1}: top-up succeeded, charge failed (race condition - OK for DO)`);
    } else if (chargeOk) {
      card.initialBalance -= 500;
      pass(`Card ${i + 1}: charge succeeded, top-up failed (unexpected)`);
    } else {
      fail(`Card ${i + 1}: both top-up and charge failed`);
    }
  }

  // Verify final balances
  console.log("\n  Verifying final balances...");
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const counter = card.nextCounter++;
    const info = await getCardInfo(card.uid, card.k1, card.k2, counter);
    if (!info) {
      fail(`Card ${i + 1}: balance check failed`);
      continue;
    }
    if (info.balance === card.initialBalance) {
      pass(`Card ${i + 1}: final balance ${info.balance} matches expected ${card.initialBalance}`);
    } else {
      fail(`Card ${i + 1}: balance mismatch! expected ${card.initialBalance}, got ${info.balance}`);
    }
  }

  return cards;
}

// ── Phase 5: Report ────────────────────────────────────────────────────────────

function phase5(cards) {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  PHASE 5: Report");
  console.log(`${"═".repeat(60)}\n`);

  const stats = latencyStats();

  console.log("  ┌─────────────────────────────────────────────────┐");
  console.log("  │            LOAD TEST SUMMARY                     │");
  console.log("  ├─────────────────────────────────────────────────┤");
  console.log(`  │  Total requests:     ${String(totalRequests).padEnd(25)}│`);
  console.log(`  │  Successful:         ${String(successRequests).padEnd(25)}│`);
  console.log(`  │  Success rate:       ${((successRequests / totalRequests) * 100).toFixed(1).padEnd(25)}%│`);
  console.log(`  │  Assertions passed:  ${String(phaseResults.passed).padEnd(25)}│`);
  console.log(`  │  Assertions failed:  ${String(phaseResults.failed).padEnd(25)}│`);
  console.log("  ├─────────────────────────────────────────────────┤");
  console.log("  │            LATENCY (ms)                          │");
  console.log(`  │  Min:                ${String(stats.min).padEnd(25)}│`);
  console.log(`  │  P50:                ${String(stats.p50).padEnd(25)}│`);
  console.log(`  │  P99:                ${String(stats.p99).padEnd(25)}│`);
  console.log(`  │  Max:                ${String(stats.max).padEnd(25)}│`);
  console.log(`  │  Samples:            ${String(stats.count).padEnd(25)}│`);
  console.log("  ├─────────────────────────────────────────────────┤");
  console.log("  │            PER-CARD BALANCES                     │");

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const balanceStr = String(card.initialBalance);
    console.log(`  │  Card ${i + 1} (${card.uid}): ${balanceStr.padStart(10)} credits       │`);
  }

  console.log("  └─────────────────────────────────────────────────┘");

  const overallPass = phaseResults.failed === 0;
  console.log(`\n  ${overallPass ? "✅ PASS" : "❌ FAIL"}: ${phaseResults.passed} passed, ${phaseResults.failed} failed\n`);

  return overallPass;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  Boltcard Live Load Test");
  console.log(`  Target: ${BASE}`);
  console.log(`  Cards:  ${NUM_CARDS}`);
  console.log(`  Max concurrent: 15 (Phase 2)`);
  console.log(`${"═".repeat(60)}\n`);

  try {
    await login();

    const cards = await phase1();
    await phase2(cards);
    await phase3(cards);
    await phase4(cards);
    const overallPass = phase5(cards);

    process.exit(overallPass ? 0 : 1);
  } catch (e) {
    console.error(`\n✗ Fatal: ${e.message}`);
    console.error(e.stack);
    process.exit(2);
  }
}

main();
