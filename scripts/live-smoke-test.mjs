#!/usr/bin/env node
// Lightweight post-deploy smoke test — verifies public endpoints return expected status codes.
// Usage: node scripts/live-smoke-test.mjs [BASE_URL]

const BASE = process.argv[2] || "https://boltcardpoc.psbt.me";

let passed = 0;
let failed = 0;

async function check(method, path, expectedStatus, bodyCheck) {
  const url = BASE + path;
  try {
    const resp = await fetch(url, { method, redirect: "manual" });
    let body = "";
    if (bodyCheck) body = await resp.text();

    const statusOk = resp.status === expectedStatus;
    const bodyOk = !bodyCheck || bodyCheck(body);
    const ok = statusOk && bodyOk;

    if (ok) {
      console.log(`✓ ${method} ${path || "/"} → ${expectedStatus}`);
      passed++;
    } else {
      const reason = !statusOk ? `got ${resp.status}` : "body check failed";
      console.log(`✗ ${method} ${path || "/"} → expected ${expectedStatus} (${reason})`);
      failed++;
    }
  } catch (e) {
    console.log(`✗ ${method} ${path || "/"} → error: ${e.message}`);
    failed++;
  }
}

console.log(`\n🔧 Smoke Test — ${BASE}\n`);

await check("GET", "/status", 200, (b) => /ok|healthy/i.test(b));
await check("GET", "/card", 200);
await check("GET", "/operator/login", 200);
await check("GET", "/", 200);
await check(
  "GET",
  "/?p=00000000000000000000000000000000&c=00000000000000000000000000000000",
  400
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
