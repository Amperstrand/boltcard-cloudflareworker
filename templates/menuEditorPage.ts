import { rawHtml, safe, jsString } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";
import type { MenuData } from "../handlers/menuHandler.js";

export function renderMenuEditorPage({ host, terminalId, menu }: { host: string; terminalId: string; menu: MenuData }): string {
  const items: MenuData["items"] = menu.items || [];
  const itemsJson: string = items.length > 0 ? JSON.stringify(items).replace(/</g, '\\u003c') : "[]";

  return renderTailwindPage({
    title: "Menu Editor",
    metaRobots: "noindex,nofollow",
    csrf: true,
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content: rawHtml`
    <div id="menu-editor-config" class="hidden"
      data-items="${safe(itemsJson)}"
      data-terminal-id="${safe(jsString(terminalId))}"></div>

    <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800">
      <a href="/operator/pos" class="text-sm font-semibold text-emerald-500 tracking-widest hover:text-emerald-400 transition-colors">&larr; POS</a>
      <span class="text-xs text-gray-500 font-mono">${terminalId}</span>
    </div>

    <div class="max-w-lg mx-auto p-4">
      <h1 class="text-xl font-bold text-white mb-6">Menu Editor</h1>

      <div id="items-list" class="space-y-2 mb-4"></div>

      <button id="add-item-btn" type="button" class="w-full bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 rounded-lg py-3 text-gray-400 text-sm font-semibold transition-colors">
        + ADD ITEM
      </button>

      <div class="mt-6 flex gap-3">
        <button id="save-btn" type="button" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl transition-colors">
          SAVE MENU
        </button>
        <button id="clear-btn" type="button" class="bg-red-900/50 hover:bg-red-800/50 text-red-300 font-bold py-3 px-4 rounded-xl transition-colors">
          CLEAR ALL
        </button>
      </div>

      <div id="status" class="hidden mt-4 text-center text-sm"></div>
    </div>

    ${safe('<script src="/static/js/nfc.js"></script>')}
    ${safe('<script src="/static/js/menu-editor.js"></script>')}
  `,
  });
}
