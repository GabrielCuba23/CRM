import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, mkdtemp, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { crmOrigin, allowedApi, isExtensionPage, isWhatsAppSender, draftInput, safeContext } from "../extension/policy.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const id = "a".repeat(32);

test("Extension grants one exact HTTPS CRM origin and exposes only owner APIs", () => {
  assert.equal(crmOrigin("https://crm.example/"), "https://crm.example");
  for (const origin of ["http://crm.example", "https://secret@crm.example", "https://crm.example/path", "https://crm.example/?token=secret", "https://crm.example/#key", "https://web.whatsapp.com", "https://crm.example:8787"])
    assert.throws(() => crmOrigin(origin));
  assert.deepEqual(allowedApi("/api/workspace", "PUT", "{}"), { path: "/api/workspace", method: "PUT", body: "{}" });
  for (const path of ["//evil.example", "https://evil.example/api/workspace", "/api/integration/claim", "/api/workspace?other=1", "/cdn-cgi/access/certs"])
    assert.throws(() => allowedApi(path));
  assert.throws(() => allowedApi("/api/workspace", "DELETE"));
  assert.throws(() => allowedApi("/api/workspace", "GET", "{}"));
  assert.throws(() => allowedApi("/api/workspace", "PUT", "a".repeat(1100001)));
  assert.throws(() => draftInput({ phone: "51999999999", text: "a".repeat(8001) }));
});

test("A WhatsApp content script cannot impersonate the privileged CRM interface", () => {
  assert.equal(isExtensionPage({ id, url: `chrome-extension://${id}/app/index.html` }, id), true);
  assert.equal(isExtensionPage({ id, url: `chrome-extension://${id}/options.html`, tab: { id: 3 } }, id), true);
  for (const sender of [
    { id, url: "https://web.whatsapp.com/", tab: { id: 1 } },
    { id, url: `chrome-extension://${id}/app/index.html`, frameId: 2 },
    { id: "b".repeat(32), url: `chrome-extension://${id}/app/index.html` },
    { id, url: "https://crm.example/" },
  ]) assert.equal(isExtensionPage(sender, id), false);
  assert.equal(isWhatsAppSender({ id, url: "https://web.whatsapp.com/", tab: { id: 4 }, frameId: 0 }, id), true);
  assert.equal(isWhatsAppSender({ id, url: "https://web.whatsapp.com.evil.example/", tab: { id: 4 } }, id), false);
  assert.equal(isWhatsAppSender({ id, url: "https://web.whatsapp.com/", tab: { id: 4 }, frameId: 1 }, id), false);
  assert.equal(safeContext({ name: "x".repeat(500), phone: "<script>" }, 1).name.length, 160);
  assert.equal(safeContext({ phone: "not-a-phone" }, 1).phone, "");
});

async function whatsappFixture({ title = "+51 999 999 999", peer = "opaque-peer@lid", group = false, draft = "", entries = [] } = {}) {
  const source = await readFile(join(root, "extension/whatsapp.js"), "utf8");
  const state = { title, peer, group, draft, entries, insertions: 0, clicks: 0 };
  const titleNode = { getAttribute: () => state.title, get textContent() { return state.title; } };
  const header = {
    get textContent() { return state.title + (state.group ? " · participantes" : ""); },
    querySelector(selector) { return selector.includes("default-group") ? state.group ? {} : null : titleNode; },
    querySelectorAll() { return [titleNode]; },
  };
  const composer = { get innerText() { return state.draft; }, get textContent() { return state.draft; }, focus() {} };
  const entryNode = entry => {
    const classes = { contains: value => value === (entry.direction === "sent" ? "message-out" : "message-in") };
    const body = { innerText: entry.body, textContent: entry.body, closest: () => null };
    const node = {
      getAttribute: name => name === "data-id" ? `${entry.direction === "sent" ? "true" : "false"}_${state.peer}_${entry.id}` : "",
      matches: () => true, classList: classes,
      getClientRects: () => entry.hidden ? [] : [{}],
      getBoundingClientRect: () => ({ top: 10, bottom: 30, left: 0, right: 200 }),
      querySelectorAll: () => [body],
    };
    return node;
  };
  const main = {
    querySelector(selector) { return selector === "header" ? header : selector.includes("contenteditable") ? composer : null; },
    querySelectorAll() { return state.entries.length ? state.entries.map(entryNode) : state.peer ? [{ getAttribute: () => `false_${state.peer}_identity` }] : []; },
  };
  const document = {
    querySelector: () => main,
    execCommand(command, _ui, text) { assert.equal(command, "insertText"); state.draft += text; state.insertions++; return true; },
  };
  const context = vm.createContext({ document, innerHeight: 800, innerWidth: 1200 });
  vm.runInContext(source, context);
  return { state, adapter: context.__nexoWhatsAppAdapter };
}

test("The WhatsApp adapter never guesses a phone from an opaque peer; manual linking follows the exact conversation", async () => {
  const { state, adapter } = await whatsappFixture({ title: "Ana", peer: "123456789@lid" });
  assert.equal(adapter.context().phone, "");
  assert.equal(adapter.context().chatId, "wa:123456789@lid");
  assert.throws(() => adapter.capture(), /teléfono/);
  const linked = adapter.bind({ phone: "51999999999", chatId: "wa:123456789@lid" });
  assert.equal(linked.phone, "51999999999");
  assert.equal(linked.phoneSource, "manual");
  state.peer = "other-contact@lid";
  assert.equal(adapter.context().phone, "");
  assert.throws(() => adapter.bind({ phone: "51999999999", chatId: "wa:123456789@lid" }), /cambió/);
});

test("Draft insertion refuses groups, different recipients and existing drafts; no send action runs", async () => {
  const { state, adapter } = await whatsappFixture();
  assert.throws(() => adapter.prepare({ phone: "51888888888", text: "Acceso privado" }), /no coincide/);
  assert.equal(state.insertions, 0);
  state.draft = "Borrador personal";
  assert.equal(adapter.prepare({ phone: "51999999999", text: "Nuevo mensaje" }).clipboard, true);
  assert.equal(state.draft, "Borrador personal");
  state.draft = "";
  const result = adapter.prepare({ phone: "51999999999", text: "Tu renovación está lista" });
  assert.equal(result.prepared, true);
  assert.equal(result.requiresConfirmation, true);
  assert.equal(state.draft, "Tu renovación está lista");
  assert.equal(state.clicks, 0);
  state.group = true;
  assert.throws(() => adapter.prepare({ phone: "51999999999", text: "No enviar" }), /individual/);
});

test("Capture includes stable message ids and the exact chat/phone; hidden messages are excluded", async () => {
  const { adapter } = await whatsappFixture({ entries: [
    { id: "one", body: "Quiero Netflix", direction: "received" },
    { id: "two", body: "Te comparto los planes", direction: "sent" },
    { id: "three", body: "Invisible", direction: "received", hidden: true },
  ] });
  const rows = adapter.capture();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].body, "Quiero Netflix");
  assert.equal(rows[1].direction, "sent");
  assert.equal(rows[0].chatId, adapter.context().chatId);
  assert.equal(rows[0].phone, "51999999999");
  assert.notEqual(rows[0].id, rows[1].id);
});

test("The CRM bridge rejects page callers and derives CSRF from the authenticated session", async () => {
  const source = await readFile(join(root, "extension/crm-bridge.js"), "utf8");
  let listener; const calls = [];
  const context = vm.createContext({ TextEncoder, TextDecoder, URL, location: { protocol: "https:", origin: "https://crm.example" },
    chrome: { runtime: { id, getURL: path => `chrome-extension://${id}/${path}`, onMessage: { addListener: handler => { listener = handler; } } } },
    fetch: async (path, options) => {
      calls.push({ path, options });
      return Response.json(path === "/api/session" ? { csrf: "session-derived-csrf" } : { revision: 2 });
    },
  });
  context.window = context; context.top = context;
  vm.runInContext(source, context);
  const invoke = (request, sender, expectedOrigin = "https://crm.example") => new Promise(resolve => listener({ channel: "nexo.crm.bridge", request, expectedOrigin }, sender, resolve));
  const denied = await invoke({ path: "/api/workspace", method: "GET" }, { id, tab: { id: 1 }, url: "https://web.whatsapp.com/" });
  assert.equal(denied.ok, false); assert.equal(calls.length, 0);
  const malformed = await invoke({ path: "https://evil.example/", method: "GET" }, { id, url: `chrome-extension://${id}/background.mjs` });
  assert.equal(malformed.ok, false); assert.equal(calls.length, 0);
  const wrongOrigin = await invoke({ path: "/api/workspace", method: "PUT", body: "{}" }, { id, url: `chrome-extension://${id}/background.mjs` }, "https://other-crm.example");
  assert.equal(wrongOrigin.ok, false); assert.equal(calls.length, 0);
  const result = await invoke({ path: "/api/workspace", method: "PUT", body: "{}" }, { id, url: `chrome-extension://${id}/background.mjs` });
  assert.equal(result.ok, true);
  assert.equal(calls[0].path, "/api/session");
  assert.equal(calls[1].options.headers["X-CSRF-Token"], "session-derived-csrf");
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.equal(calls[1].options.redirect, "error");
});

test("The package contains the entire CRM and no server data or remote executable code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nexo-extension-test-"));
  const output = join(directory, "unpacked"), zip = join(directory, "extension.zip");
  await mkdir(output);
  await writeFile(join(output, ".env"), "SYNTHETIC_UNRELATED_VALUE=do-not-package\n");
  const result = spawnSync("python3", ["extension/build.py", "--output-dir", output, "--zip", zip], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ["https://web.whatsapp.com/*"]);
  assert.equal(manifest.externally_connectable, undefined);
  assert(!manifest.permissions.includes("debugger"));
  const html = await readFile(join(output, "app/index.html"), "utf8");
  assert.match(html, /name="crm-backend" content="required"/);
  assert.match(html, /src="\.\.\/bootstrap\.mjs"/);
  for (const view of ["customers", "accounts", "free", "renewals", "finance", "marketing", "settings"])
    assert.match(html, new RegExp(`data-view="${view}"`));
  assert(!(await readdir(join(output, "app"))).includes("sw.js"));
  assert(!html.includes('src="https://'));
  const entries = spawnSync("python3", ["-c", "import zipfile,json,sys; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))", zip], { encoding: "utf8" });
  assert.equal(entries.status, 0);
  assert(!JSON.parse(entries.stdout).some(name => /\.env|sqlite|token|wrangler/.test(name)));
});
