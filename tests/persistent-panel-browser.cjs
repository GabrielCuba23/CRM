// Reuse the real Worker/D1 and packaged extension harness, with native Chrome
// panel/window boundaries simulated explicitly instead of an embedded iframe.
process.env.PERSISTENT_PANEL_ONLY = '1';
require('./password-browser.cjs');
