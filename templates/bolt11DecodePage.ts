import { rawHtml } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderBolt11DecodePage(): string {
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
        <button data-action="decode" class="bg-amber-600 hover:bg-amber-500 text-white font-bold px-4 py-2 rounded text-sm transition-colors">Decode</button>
        <button data-action="clear" class="bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold px-4 py-2 rounded text-sm transition-colors">Clear</button>
      </div>
      <p id="decode-error" class="text-red-400 text-xs mt-2 hidden"></p>
    </div>

    <div id="decode-result" class="hidden">
      <div id="result-header" class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4"></div>
      <div id="result-tags" class="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden"></div>
    </div>
  </div>

  <script src="/static/js/bolt11-decode.js"></script>
  `,
  });
}
