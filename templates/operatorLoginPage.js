import { rawHtml } from "../utils/rawTemplate.js";
import { renderTailwindPage } from "./pageShell.js";

export function renderOperatorLoginPage({ error, returnTo }) {
  const errorHtml = error
    ? rawHtml`<div class="bg-red-900/30 border border-red-500/40 rounded-lg p-4 mb-4">
        <p class="text-red-300 text-sm">${error}</p>
      </div>`
    : "";

  const returnField = returnTo
    ? rawHtml`<input type="hidden" name="return" value="${returnTo}" />`
    : "";

  return renderTailwindPage({
    title: "Operator Login",
    bodyClass: "min-h-screen bg-gray-900 font-sans antialiased flex flex-col items-center justify-center p-4",
    styles: "body { background-color: #111827; color: #f3f4f6; }",
    content: rawHtml`
    <div class="max-w-sm w-full">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-bold text-emerald-500 tracking-tight mb-1">OPERATOR</h1>
        <p class="text-gray-500 text-sm">Enter your PIN to continue</p>
      </div>

      <div class="bg-gray-800 border border-gray-700 rounded-lg p-6">
        ${errorHtml}
        <form method="POST" action="/operator/login" class="space-y-4">
          ${returnField}
          <div>
            <label for="pin" class="block text-xs text-gray-500 uppercase tracking-wider mb-1">PIN</label>
            <input
              type="password"
              id="pin"
              name="pin"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              autofocus
              class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-3 text-gray-200 text-center text-xl tracking-[0.5em] focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded transition-colors">
            LOGIN
          </button>
        </form>
      </div>
    </div>
  `,
  });
}
