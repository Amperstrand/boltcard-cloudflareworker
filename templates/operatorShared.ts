import { rawHtml } from "../utils/rawTemplate.js";

export function resultBoxHelpers(boxClass: string, iconSize?: string): string {
  var iconCls = (iconSize || 'text-2xl') + ' leading-none';
  return rawHtml`
    var resultBox = document.getElementById('result-box');
    var resultIcon = document.getElementById('result-icon');
    var resultTitle = document.getElementById('result-title');
    var resultMessage = document.getElementById('result-message');

    function showResult(kind, title, message) {
      resultBox.classList.remove('hidden');
      resultTitle.textContent = title;
      resultMessage.textContent = message;
      if (kind === 'success') {
        resultBox.className = '${boxClass} border-emerald-500/40 bg-emerald-900/20';
        resultIcon.textContent = '\\u2713';
        resultIcon.className = '${iconCls} text-emerald-400';
        resultTitle.className = 'font-bold text-sm text-emerald-300';
        resultMessage.className = 'text-xs mt-0.5 text-emerald-100/90';
      } else {
        resultBox.className = '${boxClass} border-red-500/40 bg-red-900/20';
        resultIcon.textContent = '\\u2717';
        resultIcon.className = '${iconCls} text-red-400';
        resultTitle.className = 'font-bold text-sm text-red-300';
        resultMessage.className = 'text-xs mt-0.5 text-red-100/90';
      }
    }

    function clearResult() {
      resultBox.className = 'hidden ${boxClass}';
    }
  `;
}

export const OPERATOR_LOGOUT_HANDLER: string = rawHtml`
  function operatorLogout() {
    fetch('/operator/logout', { method: 'POST' }).then(function() { window.location.href = '/operator/login'; });
  }
`;

export const NORMALIZE_AMOUNT_INTEGER: string = rawHtml`
  function normalizeAmount(val) {
    if (!val || val === '.') return '0';
    var s = String(val).replace(/[^0-9]/g, '');
    if (s === '') s = '0';
    s = s.replace(/^0+(\\d)/, '$1');
    return s;
  }
`;

export const FORMAT_DISPLAY_INTEGER: string = rawHtml`
  function formatDisplay(val) {
    var n = normalizeAmount(val);
    return n.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  }
`;
