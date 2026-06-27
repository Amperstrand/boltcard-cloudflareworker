#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const REPORT_PATH = join(process.cwd(), "test-results", "report.json");
const OUTPUT_DIR = join(process.cwd(), "test-results", "dashboard");
const OUTPUT_HTML = join(OUTPUT_DIR, "index.html");

function flattenTests(suites, parentTitle = "") {
  const results = [];
  if (!suites) return results;
  for (const suite of suites) {
    const suiteTitle = parentTitle ? `${parentTitle} > ${suite.title}` : suite.title;
    if (suite.specs) {
      for (const spec of suite.specs) {
        if (!spec.tests) continue;
        const allResults = spec.tests.flatMap((t) => t.results || []);
        const best = allResults.sort((a, b) => (a.status === "passed" ? -1 : 1) - (b.status === "passed" ? -1 : 1))[0];
        if (!best) continue;
        results.push({
          suite: suiteTitle, title: spec.title, status: best.status, duration: best.duration || 0,
          screenshots: (best.attachments || []).filter((a) => a.contentType?.startsWith("image/") && a.path).map((a) => a.path),
          videos: (best.attachments || []).filter((a) => a.contentType?.startsWith("video/") && a.path).map((a) => a.path),
          error: best.errors?.[0]?.message?.split("\n")[0],
        });
      }
    }
    if (suite.suites) results.push(...flattenTests(suite.suites, suiteTitle));
  }
  return results;
}

function fmt(ms) { return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`; }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function renderCard(t) {
  const sc = t.status === "passed" ? "pass" : t.status === "failed" ? "fail" : "skip";
  const si = t.status === "passed" ? "✓" : t.status === "failed" ? "✗" : "⊘";
  const shots = t.screenshots.map((p) => `<a href="${relative(OUTPUT_DIR, p)}" target="_blank"><img src="${relative(OUTPUT_DIR, p)}" loading="lazy" alt="${esc(t.title)}" /></a>`).join("");
  const vids = t.videos.map((p) => `<a href="${relative(OUTPUT_DIR, p)}" target="_blank" class="video-link">▶ Video</a>`).join("");
  const err = t.error ? `<div class="test-error">${esc(t.error)}</div>` : "";
  const media = (shots || vids) ? `<div class="test-media">${shots}${vids}</div>` : "";
  return `        <div class="test-card ${sc}" data-title="${esc(t.title.toLowerCase())}" data-suite="${esc(t.suite.toLowerCase())}" data-status="${sc}">\n          <div class="test-header"><span class="status-icon ${sc}">${si}</span><span class="test-title">${esc(t.title)}</span><span class="test-duration">${fmt(t.duration)}</span></div>\n          ${err}\n          ${media}\n        </div>`;
}

function render(report) {
  const tests = flattenTests(report.suites);
  const passed = tests.filter((t) => t.status === "passed").length;
  const failed = tests.filter((t) => t.status === "failed").length;
  const skipped = tests.filter((t) => t.status === "skipped" || t.status === "interrupted").length;
  const total = tests.reduce((s, t) => s + t.duration, 0);
  const groups = new Map();
  for (const t of tests) { if (!groups.has(t.suite)) groups.set(t.suite, []); groups.get(t.suite).push(t); }
  const sections = [...groups.entries()].map(([name, tests]) => `      <section class="suite-section">\n        <h2 class="suite-title">${esc(name)} <span style="color:var(--muted);font-weight:400;">(${tests.length})</span></h2>\n${tests.map(renderCard).join("\n")}\n      </section>`).join("\n");
  const rate = tests.length ? ((passed / tests.length) * 100).toFixed(0) : "0";
  return `<!DOCTYPE html><html lang="en" class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Test Evidence — boltcard</title>
<style>:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#f1f5f9;--muted:#94a3b8;--pass:#10b981;--fail:#ef4444;--skip:#f59e0b;--accent:#8b5cf6}*{margin:0;padding:0;box-sizing:border-box}body{background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;min-height:100vh}header{background:var(--card);border-bottom:1px solid var(--border);padding:1.5rem 2rem;position:sticky;top:0;z-index:10}header h1{font-size:1.5rem}.summary{display:flex;gap:1.5rem;margin-top:1rem;flex-wrap:wrap}.summary-item{display:flex;align-items:center;gap:.4rem;font-size:.9rem}.summary-item .count{font-weight:700;font-size:1.2rem}.pass .count{color:var(--pass)}.fail .count{color:var(--fail)}.skip .count{color:var(--skip)}.rate .count{color:var(--accent)}.filter-bar{margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap}.filter-bar input{flex:1;min-width:200px;padding:.5rem .75rem;background:var(--bg);border:1px solid var(--border);border-radius:.5rem;color:var(--text)}.filter-bar select{padding:.5rem;background:var(--bg);border:1px solid var(--border);border-radius:.5rem;color:var(--text)}main{max-width:1200px;margin:0 auto;padding:2rem}.suite-section{margin-bottom:2rem}.suite-title{font-size:1.1rem;font-weight:600;margin-bottom:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);padding-bottom:.5rem}.test-card{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1rem;margin-bottom:.75rem}.test-card:hover{border-color:var(--accent)}.test-header{display:flex;align-items:center;gap:.5rem}.status-icon{width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:700;font-size:.875rem;flex-shrink:0}.status-icon.pass{background:rgba(16,185,129,.15);color:var(--pass)}.status-icon.fail{background:rgba(239,68,68,.15);color:var(--fail)}.status-icon.skip{background:rgba(245,158,11,.15);color:var(--skip)}.test-title{flex:1;font-size:.9rem}.test-duration{color:var(--muted);font-size:.8rem}.test-error{margin-top:.5rem;padding:.5rem;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:.5rem;font-size:.75rem;color:var(--fail);font-family:monospace;white-space:pre-wrap;word-break:break-all}.test-media{margin-top:.75rem;display:flex;flex-wrap:wrap;gap:.75rem}.test-media img{max-height:200px;border-radius:.5rem;border:1px solid var(--border);cursor:pointer}.video-link{display:inline-flex;align-items:center;gap:.25rem;padding:.4rem .8rem;background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.3);border-radius:.5rem;color:var(--accent);font-size:.8rem;font-weight:600;text-decoration:none}footer{text-align:center;padding:2rem;color:var(--muted);font-size:.8rem;border-top:1px solid var(--border);margin-top:2rem}.hidden{display:none!important}@media(max-width:640px){header{padding:1rem}main{padding:1rem}.test-media img{max-height:150px}}</style></head>
<body><header><h1>🎫 Test Evidence — boltcard-cloudflareworker</h1><div class="summary"><div class="summary-item pass"><span class="count">${passed}</span> passed</div><div class="summary-item fail"><span class="count">${failed}</span> failed</div><div class="summary-item skip"><span class="count">${skipped}</span> skipped</div><div class="summary-item"><span class="count">${tests.length}</span> total</div><div class="summary-item rate"><span class="count">${rate}%</span> pass rate</div><div class="summary-item"><span class="count">${fmt(total)}</span> duration</div></div><div class="filter-bar"><input type="search" id="f" placeholder="Filter tests..." oninput="filter()"><select id="s" onchange="filter()"><option value="all">All</option><option value="pass">Passed</option><option value="fail">Failed</option><option value="skip">Skipped</option></select></div></header><main>${sections}</main><footer>Generated ${new Date().toISOString()}</footer><script>function filter(){var q=document.getElementById("f").value.toLowerCase(),sf=document.getElementById("s").value;document.querySelectorAll(".test-card").forEach(function(c){var t=c.dataset.title||"",su=c.dataset.suite||"",st=c.dataset.status||"";c.classList.toggle("hidden",!( (!q||t.includes(q)||su.includes(q)) &&(sf==="all"||st===sf)))});document.querySelectorAll(".suite-section").forEach(function(s){s.classList.toggle("hidden",!s.querySelectorAll(".test-card:not(.hidden)").length)})}</script></body></html>`;
}

if (!existsSync(REPORT_PATH)) { console.error("No report at", REPORT_PATH, "— run: npm run test:evidence"); process.exit(1); }
const report = JSON.parse(readFileSync(REPORT_PATH, "utf-8"));
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_HTML, render(report));
const tests = flattenTests(report.suites);
console.log(`Dashboard: ${OUTPUT_HTML}`);
console.log(`${tests.filter((t) => t.status === "passed").length} passed, ${tests.filter((t) => t.status === "failed").length} failed, ${tests.length} total`);
