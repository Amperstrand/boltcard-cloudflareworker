// csrf.js — classic script (no import/export)

function getCsrfToken() {
  var match = document.cookie.match(/(?:^|;\s*)op_csrf=([^;]*)/);
  return match ? match[1] : '';
}
var _origFetch = window.fetch;
window.fetch = function(input, init) {
  init = init || {};
  init.headers = init.headers || {};
  if (typeof init.headers.set === 'function') {
    if (!init.headers.has('X-CSRF-Token')) init.headers.set('X-CSRF-Token', getCsrfToken());
  } else {
    if (!init.headers['X-CSRF-Token']) init.headers['X-CSRF-Token'] = getCsrfToken();
  }
  return _origFetch.call(this, input, init);
};
