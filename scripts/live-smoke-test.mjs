#!/usr/bin/env node
// Post-deploy smoke test — minimal verification that the deploy is alive.
// Only hits ~10 endpoints to confirm routes respond correctly.
// Heavy testing is done via `npm run test:integration` (miniflare, no network).
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
  } catch (e) {
    console.log(`  ✗ ${tag} — error: ${e.message}`);
    failed++;
  }
}

// ── Essential health checks (10 requests total) ─────────────────────────────

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

// 2. Login page
await check("GET", "/", {
  label: "Login page loads",
  expectStatus: 200,
  expectBody: (b) => b.includes("Login"),
});

// 3. Operator login page
await check("GET", "/operator/login", {
  label: "Operator login page loads",
  expectStatus: 200,
  expectBody: (b) => b.includes("PIN") || b.includes("Operator"),
});

// 4. Auth middleware (operator page redirects without session)
await check("GET", "/operator/pos", {
  label: "Operator page requires auth → 302",
  expectStatus: 302,
});

// 5. Card dashboard
await check("GET", "/card", {
  label: "Card dashboard loads",
  expectStatus: 200,
  expectBody: (b) => b.includes("Card"),
});

// 6. Identity page
await check("GET", "/identity", {
  label: "Identity page loads",
  expectStatus: 200,
  expectBody: (b) => b.includes("IDENTITY"),
});

// 7. API endpoint (fake invoice)
await check("GET", "/api/fake-invoice?amount=1000", {
  label: "Fake invoice API works",
  expectStatus: 200,
  expectJson: (j) => typeof j.pr === "string" && j.pr.startsWith("lnbc"),
});

// 8. Static JS asset
await check("GET", "/static/js/nfc.js", {
  label: "Static JS serves correctly",
  expectStatus: 200,
  expectBody: (b) => b.includes("createNfcScanner"),
});

// 9. Redirect works
await check("GET", "/pos", {
  label: "Short URL redirect → 302",
  expectStatus: 302,
});

// 10. Favicon
await check("GET", "/favicon.ico", {
  label: "Favicon → 204",
  expectStatus: 204,
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
