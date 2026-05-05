// helpers.js — classic script (no import/export)

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text != null ? String(text) : '';
}

function setHtml(id, html) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function showEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function setList(id, items, renderFn) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = items.map(renderFn).join('');
}

function toggleEl(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('hidden');
}
