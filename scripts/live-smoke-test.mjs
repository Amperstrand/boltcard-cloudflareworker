#!/usr/bin/env node
// Post-deploy smoke test — minimal verification that the deploy is alive.
// 5 health checks + 1 cache-bust verification. Heavy testing is done via
// `npm run test:integration` (miniflare, no network egress).
//
// Usage: node scripts/live-smoke-test.mjs [BASE_URL]
// Run after: npm run deploy

const BASE = process.argv[2] || "https://boltcardpoc.psbt.me";

let passed = 0;
let failed = 0;

async function check(method, path, opts = {}) {
  const { expectStatus = 200, expectBody, expectHeader, expectJson, headers: reqHeaders, label } = opts;
  const url = BASE + path;
  const tag = label || `${method} ${path || "/"}`;
  try {
    const resp = await fetch(url, {
      method,
      redirect: "manual",
      headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", ...reqHeaders },
    });

    let body = "";
    if (expectBody || expectJson) body = await resp.text();

    const errors = [];
    if (expectStatus !== undefined && resp.status !== expectStatus) {
      errors.push(`status ${resp.status} (expected ${expectStatus})`);
    }
    if (expectBody && !expectBody(body)) {
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
        const json = JSON.parse(body);
        if (typeof expectJson === "function" && !expectJson(json, resp.status)) {
          errors.push(`JSON check failed: ${body.substring(0, 200)}`);
        }
      } catch {
        errors.push(`invalid JSON: ${body.substring(0, 100)}`);
      }
    }

    if (errors.length === 0) {
      console.log(`  ✓ ${tag}`);
      passed++;
    } else {
      console.log(`  ✗ ${tag} — ${errors.join(", ")}`);
      failed++;
    }
    return { resp, body };
  } catch (e) {
    console.log(`  ✗ ${tag} — error: ${e.message}`);
    failed++;
    return { resp: null, body: "" };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Verify all <script src="/static/js/..."> tags have ?v= cache busting */
function allScriptsCacheBusted(html) {
  const re = /<script\s+src="\/static\/js\/([^"]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    if (!match[1].includes("?v=")) {
      console.log(`    ⚠ uncachebusted script: ${match[1]}`);
      return false;
    }
  }
  return true;
}

/** Combine a keyword check with cache-bust verification */
function pageLoads(keyword) {
  return (html) => html.includes(keyword) && allScriptsCacheBusted(html);
}

// ── Essential health checks (5 requests) ─────────────────────────────

console.log("\n🔍 Post-deploy smoke test — minimal verification\n");

// 1. Health check + security headers
await check("GET", "/status", {
  label: "Health check + security headers",
  expectStatus: 200,
  expectJson: (j) => j.status === "OK" || j.status === "ok",
  expectHeader: {
    "X-Content-Type-Options": /nosniff/i,
    "X-Frame-Options": /DENY/i,
  },
});

// 2. Login page + cache bust verification
await check("GET", "/", {
  label: "Login page loads + cache-busted JS",
  expectStatus: 200,
  expectBody: pageLoads("Login"),
});

// 3. Card dashboard + cache bust verification
await check("GET", "/card", {
  label: "Card dashboard loads + cache-busted JS",
  expectStatus: 200,
  expectBody: pageLoads("Card"),
});

// 4. API endpoint (fake invoice)
await check("GET", "/api/fake-invoice?amount=1000", {
  label: "Fake invoice API works",
  expectStatus: 200,
  expectJson: (j) => typeof j.pr === "string" && j.pr.startsWith("lnbc"),
});

// 5. Auth middleware (operator page redirects without session)
await check("GET", "/operator/pos", {
  label: "Operator auth middleware → 302",
  expectStatus: 302,
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
