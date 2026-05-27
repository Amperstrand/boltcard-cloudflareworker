import { chromium } from 'playwright';

const BASE = 'https://boltcardpoc.psbt.me';
const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS: ' + name);
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message });
    console.log('FAIL: ' + name + ': ' + e.message);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await test('Card dashboard loads', async () => {
  const resp = await page.goto(BASE + '/card', { waitUntil: 'networkidle' });
  if (!resp.ok()) throw new Error('Status ' + resp.status());
  await page.screenshot({ path: '/tmp/pwa-card-dashboard.png' });
});

await test('Manifest link in head', async () => {
  const manifest = await page.evaluate(() => {
    const link = document.querySelector('link[rel="manifest"]');
    return link ? link.getAttribute('href') : null;
  });
  if (manifest !== '/static/manifest.webmanifest') throw new Error('Got: ' + manifest);
});

await test('Theme-color meta tag', async () => {
  const color = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    return meta ? meta.getAttribute('content') : null;
  });
  if (color !== '#10b981') throw new Error('Got: ' + color);
});

await test('Install banner present (hidden)', async () => {
  const banner = await page.$('#install-banner');
  if (!banner) throw new Error('install-banner not found');
  const cls = await banner.getAttribute('class');
  if (!cls.includes('hidden')) throw new Error('Banner should be hidden initially');
});

await test('Offline banner present (hidden)', async () => {
  const banner = await page.$('#offline-banner');
  if (!banner) throw new Error('offline-banner not found');
});

await test('Saved card banner present (hidden)', async () => {
  const banner = await page.$('#saved-card');
  if (!banner) throw new Error('saved-card not found');
});

await test('Stale data banner present (hidden)', async () => {
  const banner = await page.$('#stale-banner');
  if (!banner) throw new Error('stale-banner not found');
});

await test('Balance element has large text', async () => {
  const balance = await page.$('#card-balance');
  if (!balance) throw new Error('card-balance element not found');
  const cls = await balance.getAttribute('class');
  if (!cls.includes('text-lg')) throw new Error('Expected text-lg, got: ' + cls);
});

await test('Scan section visible on initial load', async () => {
  const scan = await page.$('#scan-section');
  if (!scan) throw new Error('scan-section not found');
  const visible = await scan.isVisible();
  if (!visible) throw new Error('scan-section should be visible');
});

await test('sw-register.js script loaded', async () => {
  const hasScript = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[src]');
    return Array.from(scripts).some(function(s) { return s.getAttribute('src').indexOf('sw-register.js') !== -1; });
  });
  if (!hasScript) throw new Error('sw-register.js script not found');
});

await test('GET /static/manifest.webmanifest', async () => {
  const resp = await page.request.get(BASE + '/static/manifest.webmanifest');
  if (resp.status() !== 200) throw new Error('Status ' + resp.status());
  const ct = resp.headers()['content-type'];
  if (ct.indexOf('manifest+json') === -1) throw new Error('Wrong content-type: ' + ct);
  const json = await resp.json();
  if (json.short_name !== 'Bolt Card') throw new Error('Wrong short_name: ' + json.short_name);
  if (json.display !== 'standalone') throw new Error('Wrong display: ' + json.display);
  if (json.start_url !== '/card') throw new Error('Wrong start_url: ' + json.start_url);
});

await test('GET /sw.js', async () => {
  const resp = await page.request.get(BASE + '/sw.js');
  if (resp.status() !== 200) throw new Error('Status ' + resp.status());
  const ct = resp.headers()['content-type'];
  if (ct.indexOf('javascript') === -1) throw new Error('Wrong content-type: ' + ct);
  const swa = resp.headers()['service-worker-allowed'];
  if (swa !== '/') throw new Error('Wrong Service-Worker-Allowed: ' + swa);
  const text = await resp.text();
  if (text.indexOf('install') === -1 || text.indexOf('fetch') === -1) throw new Error('SW missing install/fetch handlers');
});

await test('GET /static/icons/bolt.svg', async () => {
  const resp = await page.request.get(BASE + '/static/icons/bolt.svg');
  if (resp.status() !== 200) throw new Error('Status ' + resp.status());
  const ct = resp.headers()['content-type'];
  if (ct.indexOf('svg') === -1) throw new Error('Wrong content-type: ' + ct);
  const svg = await resp.text();
  if (svg.indexOf('<svg') === -1) throw new Error('Not valid SVG');
});

await test('GET /card/info returns 400 for missing params', async () => {
  const resp = await page.request.get(BASE + '/card/info');
  if (resp.status() !== 400) throw new Error('Expected 400, got ' + resp.status());
});

await test('Login page has manifest link', async () => {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  const manifest = await page.evaluate(() => {
    const link = document.querySelector('link[rel="manifest"]');
    return link ? link.getAttribute('href') : null;
  });
  if (manifest !== '/static/manifest.webmanifest') throw new Error('Got: ' + manifest);
  await page.screenshot({ path: '/tmp/pwa-login-page.png' });
});

await test('NFC scan status present', async () => {
  await page.goto(BASE + '/card', { waitUntil: 'networkidle' });
  const status = await page.$('#scan-status');
  if (!status) throw new Error('scan-status not found');
  const text = await status.textContent();
  if (text.indexOf('card') === -1) throw new Error('Unexpected scan status: ' + text);
});

await test('URL input and load button present', async () => {
  const input = await page.$('#url-input');
  if (!input) throw new Error('url-input not found');
  const btn = await page.$('#btn-load-url');
  if (!btn) throw new Error('btn-load-url not found');
});

// Take final screenshot
await page.goto(BASE + '/card', { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/pwa-final.png', fullPage: true });

console.log('');
console.log('Results: ' + results.filter(function(r) { return r.status === 'PASS'; }).length + ' passed, ' + results.filter(function(r) { return r.status === 'FAIL'; }).length + ' failed');
if (results.some(function(r) { return r.status === 'FAIL'; })) {
  console.log('Failed:');
  results.filter(function(r) { return r.status === 'FAIL'; }).forEach(function(r) { console.log('  FAIL: ' + r.name + ': ' + r.error); });
}

await browser.close();
process.exit(results.some(function(r) { return r.status === 'FAIL'; }) ? 1 : 0);
