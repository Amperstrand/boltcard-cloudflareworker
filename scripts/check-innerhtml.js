#!/usr/bin/env node
// Audit gate: fail if innerHTML usage in static/js/*.js exceeds baseline.
// Run via: node scripts/check-innerhtml.js
//
// Purpose: prevent new XSS-unsafe innerHTML assignments from creeping into
// browser JS files. The current count is the baseline; any increase fails CI.

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const STATIC_JS_DIR = join(import.meta.dirname, "..", "static", "js");

// Baseline: maximum allowed innerHTML occurrences per file.
// If you intentionally add a new innerHTML, update this map.
const BASELINE = {
  "bolt11-decode.js": 3,
  "menu-editor.js": 2,
  "card-audit.js": 4,
  "bulk-wipe.js": 3,
  "login.js": 11,
  "card-dashboard.js": 2,
  "debug.js": 19,
  "helpers.js": 2,
  "identity.js": 4,
  "wipe.js": 1,
  "pos.js": 2,
};

const files = readdirSync(STATIC_JS_DIR).filter((f) => f.endsWith(".js"));
let totalCurrent = 0;
let totalBaseline = 0;
let violations = [];

for (const file of files) {
  const content = readFileSync(join(STATIC_JS_DIR, file), "utf8");
  // Count innerHTML occurrences (assignments and reads)
  const count = (content.match(/\.innerHTML/g) || []).length;
  totalCurrent += count;

  const baseline = BASELINE[file] ?? 0;
  totalBaseline += baseline;

  if (count > baseline) {
    violations.push(
      `  ${file}: ${count} innerHTML (baseline: ${baseline}) — NEW innerHTML detected!`
    );
  } else if (count < baseline) {
    violations.push(
      `  ${file}: ${count} innerHTML (baseline: ${baseline}) — baseline should be lowered. Update scripts/check-innerhtml.js`
    );
  }

  // New file with innerHTML not in baseline
  if (!(file in BASELINE) && count > 0) {
    violations.push(
      `  ${file}: ${count} innerHTML — NEW FILE with innerHTML! Add to baseline in scripts/check-innerhtml.js`
    );
  }
}

console.log(`innerHTML audit: ${totalCurrent} total (baseline: ${totalBaseline})`);

if (violations.length > 0) {
  console.error("\nViolations:");
  for (const v of violations) {
    console.error(v);
  }
  console.error(
    "\nFix: either remove the innerHTML (preferred) or update the baseline in scripts/check-innerhtml.js"
  );
  process.exit(1);
}

console.log("OK — no new innerHTML detected.");
process.exit(0);
