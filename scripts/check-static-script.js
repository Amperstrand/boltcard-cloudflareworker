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

const REGISTRY_FILE = join(import.meta.dirname, "..", "static", "js", "registry.ts");
const SYNC_FILE = join(import.meta.dirname, "..", "scripts", "sync-js-exports.mjs");

const registryContent = readFileSync(REGISTRY_FILE, "utf8");
const syncContent = readFileSync(SYNC_FILE, "utf8");

const registryFiles = new Set(
  [...registryContent.matchAll(/"([a-z0-9-]+\.js)":\s*\{/g)].map((m) => m[1])
);

const syncFiles = new Set(
  [...syncContent.matchAll(/"([a-z0-9-]+\.js)",/g)].map((m) => m[1])
);

const usedFiles = new Set();
function collectStaticScriptRefs(dir, file) {
  const content = readFileSync(join(dir, file), "utf8");
  for (const match of content.matchAll(/staticScript\("([a-z0-9-]+\.js)"\)/g)) {
    usedFiles.add(match[1]);
  }
}
for (const file of readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".ts"))) {
  collectStaticScriptRefs(TEMPLATES_DIR, file);
}
for (const file of readdirSync(HANDLERS_DIR).filter((f) => f.endsWith(".ts"))) {
  collectStaticScriptRefs(HANDLERS_DIR, file);
}

const registryIssues = [];
for (const f of usedFiles) {
  if (!registryFiles.has(f)) registryIssues.push(`  ${f} used via staticScript() but MISSING from registry.ts`);
  if (!syncFiles.has(f)) registryIssues.push(`  ${f} used via staticScript() but MISSING from sync-js-exports.mjs FILE_ORDER`);
}

for (const f of registryFiles) {
  if (!syncFiles.has(f)) registryIssues.push(`  ${f} in registry.ts but MISSING from sync-js-exports.mjs FILE_ORDER`);
}
for (const f of syncFiles) {
  if (!registryFiles.has(f)) registryIssues.push(`  ${f} in sync-js-exports.mjs FILE_ORDER but MISSING from registry.ts`);
}

if (registryIssues.length > 0) {
  console.error(`\nRegistry completeness audit: ${registryIssues.length} issue(s) found`);
  for (const issue of registryIssues) console.error(issue);
  process.exit(1);
}

console.log("Registry completeness audit: all staticScript() refs present in registry and sync. OK.");
process.exit(0);
