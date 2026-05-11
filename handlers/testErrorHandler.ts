import type { IRequest } from "itty-router";
import type { Env } from "../types/core.js";
import { getDeployRevision, getJsFingerprint } from "../utils/deployInfo.js";
import { rawHtml, safe } from "../utils/rawTemplate.js";

export function handleTestErrorPage(request: IRequest, _env: Env): Response {
  const url = new URL(request.url);
  const origin = url.origin;
  const revision = getDeployRevision();
  const jsFingerprint = getJsFingerprint();
  const html = renderTailwindTestErrorPage(origin, revision, jsFingerprint);
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function renderTailwindTestErrorPage(origin: string, revision: string, jsFingerprint: string): string {
  const content = rawHtml`
<div class="min-h-screen bg-gray-950 text-gray-100 p-6 max-w-2xl mx-auto">
  <h1 class="text-2xl font-bold text-amber-400 mb-2">Error Reporting Smoke Test</h1>
  <p class="text-gray-400 text-sm mb-4">Each button triggers a different client-side error. Check <code class="text-cyan-400">wrangler tail</code> and the log below to verify the pipeline.</p>
  <div class="text-xs text-gray-500 mb-4 space-y-1">
    <p>Deploy: <span class="font-mono text-gray-400">${revision}</span></p>
    <p>JS: <span class="font-mono text-gray-400">${jsFingerprint}</span></p>
  </div>
  <div class="flex flex-col gap-4">
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <h3 class="text-sm font-bold mb-1">1. reportClientError() direct call</h3>
      <p class="text-xs text-gray-500 mb-3">Calls reportClientError() directly. Should appear in wrangler tail as <code>client-error</code> with source "smoke-test".</p>
      <button class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold" onclick="runTest1()">Fire reportClientError</button>
    </div>
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <h3 class="text-sm font-bold mb-1">2. Unhandled exception</h3>
      <p class="text-xs text-gray-500 mb-3">Throws an uncaught Error. Should be caught by <code class="text-cyan-400">window.onerror</code> and forwarded to /api/client-error.</p>
      <button class="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-semibold" onclick="runTest2()">Fire unhandled Error</button>
    </div>
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <h3 class="text-sm font-bold mb-1">3. Unhandled promise rejection</h3>
      <p class="text-xs text-gray-500 mb-3">Rejects a Promise without .catch(). Should be caught by <code class="text-cyan-400">unhandledrejection</code> handler.</p>
      <button class="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold" onclick="runTest3()">Fire unhandled rejection</button>
    </div>
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <h3 class="text-sm font-bold mb-1">4. Run all tests</h3>
      <p class="text-xs text-gray-500 mb-3">Fires all 3 error types sequentially (500ms apart) and verifies each got a 204 response.</p>
      <button class="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold" onclick="runAll()">Run all</button>
    </div>
  </div>
  <div id="log" class="mt-6 bg-gray-900 rounded-xl p-4 font-mono text-xs whitespace-pre-wrap max-h-72 overflow-y-auto border border-gray-800 min-h-[3em]"></div>
</div>`;
  return rawHtml`<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="deploy-revision" content="${revision}" />
  <meta name="js-fingerprint" content="${jsFingerprint}" />
  <title>Error Reporting Smoke Test</title>
  <script src="/static/js/client-error.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
${safe(content)}
<script>
var logEl = document.getElementById('log');
function log(msg, cls) {
  var d = document.createElement('div');
  d.className = cls || '';
  d.textContent = new Date().toISOString().substring(11, 19) + ' ' + msg;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function runTest1() {
  log('TEST 1: Firing reportClientError("smoke-test", ...) ...');
  window.reportClientError(new Error('Intentional smoke test error #1 - reportClientError direct'), 'smoke-test');
  fetch('${safe(origin)}/api/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Intentional smoke test error #1 - verify direct', source: 'smoke-test-verify', deploy: document.querySelector('meta[name="deploy-revision"]').content, js: document.querySelector('meta[name="js-fingerprint"]').content, url: location.pathname, ts: Date.now() })
  }).then(function(r) {
    if (r && r.status === 204) log('TEST 1: /api/client-error responded 204 OK', 'text-emerald-400');
    else log('TEST 1: /api/client-error responded ' + (r ? r.status : 'no response'), 'text-red-400');
  }).catch(function(e) { log('TEST 1: fetch failed: ' + e.message, 'text-red-400'); });
}

function runTest2() {
  log('TEST 2: Throwing unhandled Error ...');
  setTimeout(function() { throw new Error('Intentional smoke test error #2 - unhandled exception'); }, 50);
  setTimeout(function() { log('TEST 2: Error thrown. Check wrangler tail for "onerror" source.'); }, 500);
}

function runTest3() {
  log('TEST 3: Firing unhandled promise rejection ...');
  Promise.reject(new Error('Intentional smoke test error #3 - unhandled rejection'));
  setTimeout(function() { log('TEST 3: Rejection fired. Check wrangler tail for "unhandledrejection" source.'); }, 500);
}

function runAll() {
  logEl.replaceChildren();
  log('=== Running all smoke tests ===');
  runTest1();
  setTimeout(runTest2, 1000);
  setTimeout(runTest3, 2000);
  setTimeout(function() {
    log('=== All tests fired. Verify 3 client-error entries in wrangler tail ===');
    log('Expected: source=smoke-test, source=onerror:..., source=unhandledrejection');
  }, 3500);
}
</script>
</body>
</html>`;
}
