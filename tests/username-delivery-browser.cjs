// Run the actual packaged extension against entirely synthetic CRM and
// WhatsApp fixtures; no live account, contact, credential or message is used.
process.env.USERNAME_DELIVERY_ONLY = '1';
require('./compact-extension-browser.cjs');
