// Playwright page.evaluate/addInitScript callbacks execute in the browser;
// `window` there is an opaque page-context handle (call sites cast/assert
// against it). Declared locally instead of adding the DOM lib, which would
// wrongly re-type worker modules imported through the test helper graph.
declare var window: any;
