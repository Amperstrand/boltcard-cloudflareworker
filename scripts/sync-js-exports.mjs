#!/usr/bin/env node
// Sync exports.ts from static/js/*.js source files.
// Reads each JS file, computes SHA-256 hash, and rewrites exports.ts.
//
// Usage: node scripts/sync-js-exports.mjs

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join, basename } from "path";

const ROOT = join(import.meta.dirname, "..");
const JS_DIR = join(ROOT, "static", "js");
const EXPORTS_FILE = join(JS_DIR, "exports.ts");

// Order must match registry.ts imports exactly
const FILE_ORDER = [
  "nfc.js",
  "helpers.js",
  "csrf.js",
  "card-dashboard.js",
  "debug.js",
  "login.js",
  "activate.js",
  "analytics.js",
  "card-audit.js",
  "menu-editor.js",
  "wipe.js",
  "bulk-wipe.js",
  "two-factor.js",
  "bolt11-decode.js",
  "pos.js",
  "topup.js",
  "refund.js",
  "identity.js",
];

function jsName(filename) {
  // nfc.js → NFC_JS, card-dashboard.js → CARD_DASHBOARD_JS
  return basename(filename, ".js")
    .toUpperCase()
    .replace(/-/g, "_") + "_JS";
}

function computeHash(content) {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
}

function escapeForTemplateLiteral(content) {
  // Escape backslashes FIRST (so \/ stays as \/), then backticks and ${
  return content
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

// Read all JS files
const entries = [];
for (const filename of FILE_ORDER) {
  const filePath = join(JS_DIR, filename);
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    console.error(`SKIP: ${filename} not found`);
    continue;
  }

  // Strip trailing newline for consistent hashing
  const trimmed = content.replace(/\n$/, "");
  const hash = computeHash(trimmed);
  const constName = jsName(filename);

  entries.push({ filename, constName, content: trimmed, hash });
}

// Generate exports.ts content
const lines = [];
for (const entry of entries) {
  lines.push(`export const ${entry.constName} = \`${escapeForTemplateLiteral(entry.content)}\`;`);
  lines.push(`export const ${entry.constName}_HASH = "${entry.hash}";`);
  lines.push("");
}

writeFileSync(EXPORTS_FILE, lines.join("\n"), "utf8");

// Verify
let mismatches = 0;
for (const entry of entries) {
  const reRead = readFileSync(EXPORTS_FILE, "utf8");
  const expected = `\`${escapeForTemplateLiteral(entry.content)}\``;
  if (!reRead.includes(expected.slice(0, 100))) {
    console.error(`MISMATCH: ${entry.filename}`);
    mismatches++;
  }
}

if (mismatches === 0) {
  console.log(`sync-js-exports: ${entries.length} files synced to exports.ts`);
} else {
  console.error(`sync-js-exports: ${mismatches} mismatches detected!`);
  process.exit(1);
}
