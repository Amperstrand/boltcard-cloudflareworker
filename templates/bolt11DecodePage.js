import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderBolt11DecodePage() {
  return renderTailwindPage({
    title: "BOLT11 Decoder",
    bodyClass: "min-h-screen p-4 md:p-8 font-sans antialiased",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content: rawHtml`
  <div class="max-w-3xl mx-auto">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-amber-500 tracking-tight mb-2">BOLT11 DECODER</h1>
      <p class="text-gray-400 text-sm">Paste a BOLT11 invoice to decode all fields</p>
    </div>

    <div class="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6">
      <textarea id="invoice-input" rows="4" placeholder="lnbc20u1p..." class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono text-gray-300 focus:border-amber-500 focus:outline-none resize-y"></textarea>
      <div class="flex gap-2 mt-3">
        <button onclick="decode()" class="bg-amber-600 hover:bg-amber-500 text-white font-bold px-4 py-2 rounded text-sm transition-colors">Decode</button>
        <button onclick="clearAll()" class="bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold px-4 py-2 rounded text-sm transition-colors">Clear</button>
      </div>
      <p id="decode-error" class="text-red-400 text-xs mt-2 hidden"></p>
    </div>

    <div id="decode-result" class="hidden">
      <div id="result-header" class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4"></div>
      <div id="result-tags" class="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden"></div>
    </div>
  </div>

  <script>
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  async function decode() {
    const input = document.getElementById('invoice-input').value.trim();
    const errEl = document.getElementById('decode-error');
    const resultEl = document.getElementById('decode-result');
    errEl.classList.add('hidden');
    resultEl.classList.add('hidden');

    if (!input) {
      errEl.textContent = 'Please paste a BOLT11 invoice';
      errEl.classList.remove('hidden');
      return;
    }

    try {
      const resp = await fetch('/api/decode?invoice=' + encodeURIComponent(input));
      const data = await resp.json();

      if (!data.ok) {
        errEl.textContent = esc(data.error || 'Decode failed');
        errEl.classList.remove('hidden');
        return;
      }

      renderResult(data);
    } catch (e) {
      errEl.textContent = 'Request failed: ' + esc(e.message);
      errEl.classList.remove('hidden');
    }
  }

  function renderResult(d) {
    document.getElementById('decode-result').classList.remove('hidden');

    const sigBadge = d.signatureValid
      ? '<span class="inline-block px-2 py-0.5 text-xs font-bold rounded bg-emerald-900 text-emerald-300">VALID</span>'
      : '<span class="inline-block px-2 py-0.5 text-xs font-bold rounded bg-red-900 text-red-300">INVALID</span>';

    const expiryBadge = d.isExpired
      ? '<span class="inline-block px-2 py-0.5 text-xs font-bold rounded bg-red-900 text-red-300">EXPIRED</span>'
      : '<span class="inline-block px-2 py-0.5 text-xs font-bold rounded bg-emerald-900 text-emerald-300">ACTIVE</span>';

    document.getElementById('result-header').innerHTML = [
      card('Network', esc(d.network)),
      card('Amount', esc(d.amountDisplay || 'any')),
      card('Timestamp', esc(d.timestampISO || '')),
      card('Expiry', esc(d.expiry + 's') + ' ' + expiryBadge),
      card('Expires At', esc(d.expiresAt || '')),
      card('Signature', sigBadge),
    ].join('');

    let tagRows = '';
    const tags = d.rawTags || [];
    for (const t of tags) {
      let val = '';
      if (Array.isArray(t.value)) {
        val = t.value.map(v => '<span class="inline-block bg-gray-700 rounded px-1.5 py-0.5 text-xs mr-1 mb-1">' + esc(v) + '</span>').join('');
      } else {
        val = '<span class="font-mono text-xs break-all">' + esc(String(t.value)) + '</span>';
        if (String(t.value).length === 64) {
          val += ' <button onclick="copyText(\'' + esc(String(t.value)) + '\')" class="ml-1 text-amber-400 hover:text-amber-300 text-xs">copy</button>';
        }
      }
      if (t.rawHex) {
        val += ' <span class="text-gray-500 text-xs">(' + esc(t.rawHex) + ')</span>';
      }
      tagRows += '<tr class="border-b border-gray-700/50"><td class="px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap">' + esc(t.name) + ' <span class="text-gray-600">[' + t.code + ']</span></td><td class="px-4 py-2 text-sm text-gray-300">' + val + '</td></tr>';
    }

    if (d.payee) {
      tagRows += '<tr class="border-b border-gray-700/50"><td class="px-4 py-2 text-xs text-gray-500 font-mono whitespace-nowrap">payee (recovered)</td><td class="px-4 py-2 text-sm font-mono text-purple-300 break-all">' + esc(d.payee) + ' <button onclick="copyText(\'' + esc(d.payee) + '\')" class="ml-1 text-amber-400 hover:text-amber-300 text-xs">copy</button></td></tr>';
    }

    document.getElementById('result-tags').innerHTML = '<table class="w-full">' + tagRows + '</table>';
  }

  function card(label, value) {
    return '<div class="bg-gray-800 border border-gray-700 rounded-lg p-3"><p class="text-xs text-gray-500 uppercase tracking-wider mb-1">' + label + '</p><p class="text-sm font-mono text-gray-200">' + value + '</p></div>';
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function clearAll() {
    document.getElementById('invoice-input').value = '';
    document.getElementById('decode-error').classList.add('hidden');
    document.getElementById('decode-result').classList.add('hidden');
  }

  const textarea = document.getElementById('invoice-input');
  textarea.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') decode();
  });
  </script>
  `,
  });
}
