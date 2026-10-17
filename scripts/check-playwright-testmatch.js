#!/usr/bin/env node
// Audit gate: verify every tests/e2e/*.spec.ts is listed in testMatch (and vice versa).
// Run via: node scripts/check-playwright-testmatch.js
//
// Purpose: playwright.config.ts testMatch is an ALLOWLIST — a spec file that is
// not listed silently never runs. This checks both directions:
//   - spec file on disk but missing from testMatch  (silently skipped test)
//   - testMatch entry with no matching file on disk (stale entry)

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const E2E_DIR = join(import.meta.dirname, "..", "tests", "e2e");
const CONFIG_FILE = join(import.meta.dirname, "..", "playwright.config.ts");

const diskSpecs = readdirSync(E2E_DIR)
  .filter((f) => f.endsWith(".spec.ts"))
  .sort();

const configContent = readFileSync(CONFIG_FILE, "utf8");
const arrayMatch = configContent.match(/testMatch\s*:\s*\[([^\]]*)\]/);
if (!arrayMatch) {
  console.error("testMatch audit: cannot find testMatch array in playwright.config.ts");
  process.exit(1);
}
const listedSpecs = [...arrayMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const unlisted = diskSpecs.filter((f) => !listedSpecs.includes(f));
const orphaned = listedSpecs.filter((f) => !diskSpecs.includes(f));

if (unlisted.length > 0 || orphaned.length > 0) {
  console.error("testMatch audit: MISMATCH between tests/e2e/ and playwright.config.ts testMatch\n");
  if (unlisted.length > 0) {
    console.error("Spec files on disk but NOT in testMatch (they would silently never run):");
    for (const f of unlisted) console.error(`  tests/e2e/${f}`);
  }
  if (orphaned.length > 0) {
    console.error("testMatch entries with NO matching file on disk:");
    for (const f of orphaned) console.error(`  ${f}`);
  }
  console.error(
    "\nFix: add new specs to testMatch in playwright.config.ts (it is an allowlist); remove stale entries."
  );
  process.exit(1);
}

console.log(`testMatch audit: ${diskSpecs.length} spec files, ${listedSpecs.length} testMatch entries, fully consistent. OK.`);
process.exit(0);
