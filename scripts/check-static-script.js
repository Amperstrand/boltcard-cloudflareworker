#!/usr/bin/env node
// Audit gate: ensure all /static/js/ script tags use staticScript() helper.
// Run via: node scripts/check-static-script.js
//
// Purpose: prevent raw <script src="/static/js/..."> tags that bypass cache busting.
// All static JS must be loaded via staticScript("file.js") from rawTemplate.ts.

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const TEMPLATES_DIR = join(import.meta.dirname, "..", "templates");
const HANDLERS_DIR = join(import.meta.dirname, "..", "handlers");
const ALLOWED_RAW = new Set([
  // pageShell.ts is the shell — it uses deployVersion directly for its own scripts
  "pageShell.ts",
]);

let violations = [];

function checkFile(dir, file) {
  if (ALLOWED_RAW.has(file)) return;
  const content = readFileSync(join(dir, file), "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: /static/js/SOMETHING inside a script src attribute
    // but NOT via staticScript() call
    if (line.includes('"/static/js/') && line.includes("<script") && !line.includes("staticScript(")) {
      violations.push(`  ${file}:${i + 1}: ${line.trim()}`);
    }
  }
}

// Check templates
for (const file of readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".ts"))) {
  checkFile(TEMPLATES_DIR, file);
}

// Check handlers (testErrorHandler.ts has a standalone HTML page)
for (const file of readdirSync(HANDLERS_DIR).filter((f) => f.endsWith(".ts"))) {
  checkFile(HANDLERS_DIR, file);
}

if (violations.length > 0) {
  console.error(`staticScript audit: ${violations.length} violation(s) found\n`);
  for (const v of violations) {
    console.error(v);
  }
  console.error(
    "\nFix: use staticScript(\"file.js\") from utils/rawTemplate.js instead of raw <script> tags."
  );
  process.exit(1);
}

console.log("staticScript audit: all script tags use staticScript(). OK.");
process.exit(0);
