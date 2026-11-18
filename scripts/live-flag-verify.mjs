#!/usr/bin/env node
// Live flag-posture verification against a deployed worker (ops#26 lineage).
//
//   node scripts/live-flag-verify.mjs https://boltcardpoc.psbt.me            # default-off record
//   node scripts/live-flag-verify.mjs https://boltcard-staging.psbt.me      # armed-posture probes (needs flags set)
//
// Deterministic taps on the designed anonymous path (UID 04dead00c0ffee,
// public dev-01 issuer key), node:crypto AES + the repo's own
// @ntag424/crypto derivation — the scripts/live-adversarial-test.mjs lineage.
// All probes are bounded: no hardware, no funds at risk (fakewallet credits),
// fresh counters per request so REPLAY_ENFORCE never burns a probe.

import { createCipheriv } from "node:crypto";
import { deriveKeysFromHex } from "@ntag424/crypto";

const BASE = process.argv[2];
if (!BASE) {
  console.error("usage: node scripts/live-flag-verify.mjs <base-url>");
  process.exit(2);
}
const UID = "04dead00c0ffee";
const ISSUER = "00000000000000000000000000000001"; // public dev-01 (generatedKeyData.js)

const ts = () => new Date().toISOString();
const log = (m) => console.log(`[${ts()}] ${m}`);
const results = [];

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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

// scripts/live-adversarial-test.mjs virtualTap() lineage
function virtualTap(uidHex, counter, k1Hex, k2Hex) {
  const k1 = hexToBytes(k1Hex);
  const uid = hexToBytes(uidHex);
  const plaintext = new Uint8Array(16);
  plaintext[0] = 0xc7;
  plaintext.set(uid, 1);
  plaintext[8] = counter & 0xff;
  plaintext[9] = (counter >> 8) & 0xff;
  plaintext[10] = (counter >> 16) & 0xff;
  const pHex = bytesToHex(aesEcbEncrypt(k1, plaintext));

  const ctrBytes = new Uint8Array([(counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]);
  const k2 = hexToBytes(k2Hex);
  const sv2 = new Uint8Array(16);
  sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]);
  sv2.set(uid, 6);
  sv2[13] = ctrBytes[2];
  sv2[14] = ctrBytes[1];
  sv2[15] = ctrBytes[0];
  const ks = computeAesCmac(sv2, k2);
  const K1prime = generateSubkey(aesEcbEncrypt(ks, new Uint8Array(16)));
  const hashVal = new Uint8Array(generateSubkey(K1prime));
  hashVal[0] ^= 0x80;
  const cm = aesEcbEncrypt(ks, hashVal);
  const ct = new Uint8Array(8);
  for (let i = 0; i < 8; i++) ct[i] = cm[2 * i + 1];
  return { pHex, cHex: bytesToHex(ct) };
}

let ctr = 9000 + Math.floor(Math.random() * 500);
function tap() {
  ctr += 1;
  const keys = deriveKeysFromHex(UID, ISSUER, 1);
  return { ...virtualTap(UID, ctr, keys.k1, keys.k2), counter: ctr };
}

async function jsonOf(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

function record(name, expect, observed, detail) {
  const isPosture = typeof expect === "string" && expect.includes("/");
  const pass = String(observed) === String(expect);
  const label = isPosture ? "POSTURE" : pass ? "PASS" : "DIFF";
  results.push({ t: ts(), name, expect, observed, pass: isPosture ? null : pass, detail });
  log(`${label} ${name}: expected ${expect}, observed ${observed}${detail ? " — " + detail : ""}`);
}

// ── posture probes ───────────────────────────────────────────────────────────
async function step1(t) {
  const r = await fetch(`${BASE}/?p=${t.pHex}&c=${t.cHex}`);
  return { http: r.status, body: await jsonOf(r), t };
}

async function main() {
  log(`flag-posture verification against ${BASE}`);
  const st = await fetch(`${BASE}/status`);
  record("/status health", 200, st.status);

  // 1. fresh tap + k1 shape (k1=c default vs K1_FRESH random 32-hex)
  const s1 = await step1(tap());
  record("step-1 fresh tap", 200, s1.http);
  const k1 = s1.body?.k1 ?? "";
  record("k1 shape", "see detail", `len=${k1.length} eqC=${k1 === s1.t.cHex}`, `k1=${k1} c=${s1.t.cHex}`);

  // 2. same-tap replay (idempotent default vs 409 under REPLAY_ENFORCE)
  const s2 = await fetch(`${BASE}/?p=${s1.t.pHex}&c=${s1.t.cHex}`).then((r) => r.status);
  record("step-1 replay", "default-off: 200 / armed: 409", s2);

  // 3. host pinning: port variant reaches the worker with url.host host:port
  const t3 = tap();
  const r8443 = await fetch(`${BASE}:8443/?p=${t3.pHex}&c=${t3.cHex}`).then((r) => r.status).catch((e) => String(e));
  record("url.host port-variant (:8443)", "default-off: 200 / armed: 400", r8443);

  // 4. host pinning scope: /status is not on the pinned surface
  const rStat = await fetch(`${BASE}:8443/status`).then((r) => r.status).catch((e) => String(e));
  record("/status :8443 (unpinned surface)", 200, rStat);

  console.log(`\n${"-".repeat(60)}`);
  const hard = results.filter((r) => r.pass !== null);
  const failed = hard.filter((r) => !r.pass).length;
  console.log(`${hard.length - failed}/${hard.length} hard assertions met; ${results.length - hard.length} posture observations above.`);
  console.log(JSON.stringify(results, null, 2));
}

await main();
