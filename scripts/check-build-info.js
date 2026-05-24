#!/usr/bin/env node
// Audit gate: verify BUILD_REVISION in utils/buildInfo.ts matches current git HEAD.
// Run via: node scripts/check-build-info.js
//
// Purpose: prevent stale cache-busting — if BUILD_REVISION doesn't match the
// deployed commit, browsers will serve stale JS assets.

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const BUILD_INFO = join(import.meta.dirname, "..", "utils", "buildInfo.ts");

function getGitRevision() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function getStoredRevision() {
  const content = readFileSync(BUILD_INFO, "utf8");
  const match = content.match(/BUILD_REVISION\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

const gitRev = getGitRevision();
const storedRev = getStoredRevision();

if (!gitRev) {
  console.error("build-info audit: cannot determine git revision (not a git repo?)");
  process.exit(1);
}

if (!storedRev) {
  console.error("build-info audit: cannot find BUILD_REVISION in utils/buildInfo.ts");
  process.exit(1);
}

if (gitRev === storedRev) {
  console.log(`build-info audit: BUILD_REVISION=${storedRev} matches git HEAD. OK.`);
  process.exit(0);
}

console.error(`build-info audit: MISMATCH`);
console.error(`  git HEAD:        ${gitRev}`);
console.error(`  BUILD_REVISION:  ${storedRev}`);
console.error(`\nFix: run \`node scripts/sync-js-exports.mjs\` to update.`);
process.exit(1);
