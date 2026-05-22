#!/usr/bin/env node
// Post-deploy smoke test — exercises every public endpoint against a live deploy.
// Run while `wrangler tail` is active to see correlated server-side logs.
// Usage: node scripts/live-smoke-test.mjs [BASE_URL]

const BASE = process.argv[2] || "https://boltcardpoc.psbt.me";

let passed = 0;
let failed = 0;

async function check(method, path, opts = {}) {
  const { expectStatus = 200, expectBody, expectHeader, expectJson, body: reqBody, headers: reqHeaders, label } = opts;
  const url = BASE + path;
  const tag = label || `${method} ${path || "/"}`;
  try {
    const resp = await fetch(url, {
      method,
      redirect: "manual",
      headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", ...reqHeaders },
      body: reqBody || undefined,
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

// ── Public pages ──────────────────────────────────────────────────────────────
console.log("\n📄 Public pages");

await check("GET", "/", { label: "GET / → login page", expectStatus: 200, expectBody: (b) => b.includes("Login") });
await check("GET", "/card", { label: "GET /card → cardholder dashboard", expectStatus: 200, expectBody: (b) => b.includes("Card") });
await check("GET", "/identity", { label: "GET /identity → identity demo", expectStatus: 200, expectBody: (b) => b.includes("IDENTITY") });
await check("GET", "/login", { label: "GET /login → NFC login page", expectStatus: 200, expectBody: (b) => b.includes("Login") });
await check("GET", "/status", { label: "GET /status → health check", expectStatus: 200, expectJson: (j) => j.status === "OK" || j.status === "ok" });

// ── Card tap entry point ──────────────────────────────────────────────────────
console.log("\n💳 Card tap entry point");

// Browser Accept header → identity page
await check("GET", "/?p=00000000000000000000000000000000&c=00000000000000000000000000000000", {
  label: "GET /?p=..&c=.. (browser) → identity page",
  expectStatus: 200,
  expectBody: (b) => b.includes("IDENTITY"),
});

// JSON Accept header → LNURLW handler (should reject bad card)
await check("GET", "/?p=00000000000000000000000000000000&c=00000000000000000000000000000000", {
  label: "GET /?p=..&c=.. (wallet) → LNURLW error",
  expectStatus: 400,
  headers: { "Accept": "application/json" },
});

// No params → login page
await check("GET", "/", {
  label: "GET / (no params) → login page",
  expectStatus: 200,
  expectBody: (b) => b.includes("Login"),
});

// ── Identity API ─────────────────────────────────────────────────────────────
console.log("\n🛡️  Identity API");

await check("GET", "/api/verify-identity?p=&c=", {
  label: "verify-identity (empty params) → demo-backstage",
  expectStatus: 200,
  expectJson: (j) => j.verified === true && j.demoMode === true && j.uid === "demo-backstage",
});

await check("GET", "/api/verify-identity?p=DEADBEEF&c=CAFE", {
  label: "verify-identity (invalid card) → demo-backstage fallback",
  expectStatus: 200,
  expectJson: (j) => j.verified === true && j.demoMode === true,
});

await check("GET", "/api/verify-identity", {
  label: "verify-identity (no params) → demo-backstage fallback",
  expectStatus: 200,
  expectJson: (j) => j.verified === true && j.demoMode === true,
});

// ── 2FA ───────────────────────────────────────────────────────────────────────
console.log("\n🔐 2FA");

await check("GET", "/2fa", {
  label: "GET /2fa (no params) → HTML page",
  expectStatus: 200,
  expectBody: (b) => b.includes("2FA") || b.includes("Two"),
});

// ── Fake invoice ──────────────────────────────────────────────────────────────
console.log("\n🧾 Fake invoice");

await check("GET", "/api/fake-invoice?amount=1000", {
  label: "fake-invoice (1000 msat) → bolt11",
  expectStatus: 200,
  expectJson: (j) => typeof j.pr === "string" && j.pr.startsWith("lnbc"),
});

await check("GET", "/api/fake-invoice?amount=0", {
  label: "fake-invoice (0 msat) → error",
  expectStatus: 400,
});

// ── Operator pages (auth required) ────────────────────────────────────────────
console.log("\n🔒 Operator pages (auth required)");

await check("GET", "/operator/login", {
  label: "GET /operator/login → login page",
  expectStatus: 200,
  expectBody: (b) => b.includes("PIN") || b.includes("Operator"),
});

await check("GET", "/operator/pos", {
  label: "GET /operator/pos → redirect to login (302)",
  expectStatus: 302,
});

await check("GET", "/operator/topup", {
  label: "GET /operator/topup → redirect to login (302)",
  expectStatus: 302,
});

await check("GET", "/operator/refund", {
  label: "GET /operator/refund → redirect to login (302)",
  expectStatus: 302,
});

await check("GET", "/operator/cards", {
  label: "GET /operator/cards → redirect to login (302)",
  expectStatus: 302,
});

// ── Debug / experimental (auth required) ──────────────────────────────────────
console.log("\n🧪 Debug & experimental (auth required)");

await check("GET", "/debug", {
  label: "GET /debug → redirect to login (302)",
  expectStatus: 302,
});

await check("GET", "/experimental/activate", {
  label: "GET /experimental/activate → redirect to login (302)",
  expectStatus: 302,
});

// ── Redirects ─────────────────────────────────────────────────────────────────
console.log("\n➡️  Redirects");

await check("GET", "/pos", { label: "GET /pos → 302", expectStatus: 302 });
await check("GET", "/activate", { label: "GET /activate → 302", expectStatus: 302 });
await check("GET", "/wipe", { label: "GET /wipe → 302", expectStatus: 302 });
await check("GET", "/bulkwipe", { label: "GET /bulkwipe → 302", expectStatus: 302 });
await check("GET", "/analytics", { label: "GET /analytics → 302", expectStatus: 302 });
await check("GET", "/nfc", { label: "GET /nfc → 302", expectStatus: 302 });

// ── Static assets ─────────────────────────────────────────────────────────────
console.log("\n📦 Static assets");

await check("GET", "/favicon.ico", { label: "GET /favicon.ico → 204", expectStatus: 204 });
await check("GET", "/static/js/nfc.js", { label: "GET /static/js/nfc.js → JS", expectStatus: 200, expectBody: (b) => b.includes("createNfcScanner") });
await check("GET", "/static/js/nfc-gate.js", { label: "GET /static/js/nfc-gate.js → JS", expectStatus: 200, expectBody: (b) => b.includes("_nfcPageHandler") });

// ── Security headers ──────────────────────────────────────────────────────────
console.log("\n🔒 Security headers");

await check("GET", "/identity", {
  label: "Security headers present",
  expectStatus: 200,
  expectHeader: {
    "X-Content-Type-Options": /nosniff/i,
    "X-Frame-Options": /DENY/i,
    "Referrer-Policy": /.+/,
    "Content-Security-Policy": /.+/,
  },
});

// ── Balance check API ─────────────────────────────────────────────────────────
console.log("\n💰 Balance check API");

await check("POST", "/api/balance-check", {
  label: "POST /api/balance-check (no body) → error",
  expectStatus: 400,
});

// ── Card info API ─────────────────────────────────────────────────────────────
console.log("\n📊 Card info API");

await check("GET", "/card/info", {
  label: "GET /card/info (no params) → 400",
  expectStatus: 400,
});

// ── POS menu API ──────────────────────────────────────────────────────────────
console.log("\n🍽️  POS menu API");

await check("GET", "/api/pos/menu", {
  label: "GET /api/pos/menu → auth required (302)",
  expectStatus: 302,
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
