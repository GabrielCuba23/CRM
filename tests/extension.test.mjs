import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, mkdtemp, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { crmOrigin, allowedApi, isExtensionPage, embeddedWhatsAppTab, isWhatsAppSender, draftInput, safeContext, WA_ORIGIN } from "../extension/policy.mjs";

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

test("Only the packaged CRM iframe inside a WhatsApp tab receives embedded privileges", () => {
  const embedded = {
    id, url: `chrome-extension://${id}/app/index.html?embedded=1`,
    frameId: 7, tab: { id: 11, url: "https://web.whatsapp.com/" },
  };
  assert.equal(isExtensionPage(embedded, id), true);
  assert.equal(embeddedWhatsAppTab(embedded, id), 11);
  for (const sender of [
    { ...embedded, url: `chrome-extension://${id}/app/index.html` },
    { ...embedded, url: `chrome-extension://${id}/app/index.html?embedded=0` },
    { ...embedded, url: `chrome-extension://${id}/options.html?embedded=1` },
    { ...embedded, url: `chrome-extension://${id}/bootstrap.mjs?embedded=1` },
    { ...embedded, url: `chrome-extension://${id}/app/other.html?embedded=1` },
    { ...embedded, id: "b".repeat(32) },
    { ...embedded, url: `chrome-extension://${"b".repeat(32)}/app/index.html?embedded=1` },
    { ...embedded, frameId: -1 },
    { ...embedded, frameId: "7" },
    { ...embedded, tab: undefined },
    { ...embedded, tab: { id: "11", url: "https://web.whatsapp.com/" } },
    { ...embedded, tab: { id: 11, url: "https://web.whatsapp.com.evil.example/" } },
    { ...embedded, tab: { id: 11, url: "https://crm.example/" } },
    { ...embedded, tab: { id: 11, url: "about:blank" } },
  ]) {
    assert.equal(isExtensionPage(sender, id), false, JSON.stringify(sender));
    assert.equal(embeddedWhatsAppTab(sender, id), undefined);
  }
  assert.equal(embeddedWhatsAppTab({ id, url: `chrome-extension://${id}/app/index.html`, frameId: 0 }, id), undefined);
  assert.equal(embeddedWhatsAppTab({ id, url: `chrome-extension://${id}/options.html`, frameId: 0 }, id), undefined);
});

async function backgroundFixture() {
  const source = await readFile(join(root, "extension/background.mjs"), "utf8");
  const calls = [];
  const tabs = new Map([
    [11, { id: 11, url: "https://web.whatsapp.com/", status: "complete", active: false }],
    [22, { id: 22, url: "https://web.whatsapp.com/", status: "complete", active: true }],
    [33, { id: 33, url: "https://crm.example/companion", status: "complete", active: false }],
  ]);
  const session = { waTabId: 22, crmTabId: 33 };
  const local = { crmOrigin: "https://crm.example" };
  let messageListener, actionListener;
  const storage = values => ({
    async get(key) { return { [key]: values[key] }; },
    async set(update) { Object.assign(values, update); },
    async remove(key) { delete values[key]; },
  });
  const chrome = {
    runtime: {
      id, getURL: path => `chrome-extension://${id}/${path}`,
      onMessage: { addListener(handler) { messageListener = handler; } },
      onInstalled: { addListener() {} },
      async sendMessage(message) { calls.push({ type: "broadcast", message }); },
      async openOptionsPage() { calls.push({ type: "options" }); },
    },
    storage: { session: storage(session), local: { ...storage(local), async setAccessLevel() {} } },
    permissions: { async contains() { return true; } },
    action: { onClicked: { addListener(handler) { actionListener = handler; } } },
    tabs: {
      async get(tabId) {
        calls.push({ type: "get", tabId });
        if (!tabs.has(tabId)) throw Error("Closed tab");
        return { ...tabs.get(tabId) };
      },
      async query(query) {
        calls.push({ type: "query", query });
        return [...tabs.values()].filter(tab => (!query.active || tab.active) && (!query.url || tab.url.startsWith(query.url.slice(0, -1))));
      },
      async sendMessage(tabId, message, options) {
        calls.push({ type: "send", tabId, message, options });
        if (message.channel === "nexo.whatsapp") {
          const context = { name: `Chat ${tabId}`, phone: tabId === 11 ? "51999999999" : "51888888888", chatId: `wa:peer-${tabId}@lid` };
          return { ok: true, result: message.action === "context" ? context : message.action === "capture" ? [{ ...context, body: `Message ${tabId}` }] : { ...context, prepared: true } };
        }
        return { ok: true };
      },
      async update(tabId, update) { calls.push({ type: "update", tabId, update }); return { ...tabs.get(tabId), ...update }; },
      async create(input) { calls.push({ type: "create", input }); return { id: 44, ...input }; },
    },
    scripting: { async executeScript(input) { calls.push({ type: "inject", input }); } },
  };
  const context = vm.createContext({ chrome, URL, TextEncoder, crmOrigin, allowedApi, isExtensionPage, embeddedWhatsAppTab, isWhatsAppSender, safeContext, draftInput, WA_ORIGIN });
  vm.runInContext(source.replace(/^import[^\n]+\n/, ""), context);
  assert.equal(typeof messageListener, "function");
  const invoke = (message, sender) => new Promise(resolve => {
    assert.equal(messageListener({ channel: "nexo", ...message }, sender, resolve), true);
  });
  return { invoke, calls, tabs, session, action: tab => actionListener(tab) };
}

test("An embedded CRM targets its own WhatsApp tab even when another conversation tab is active", async () => {
  const { invoke, calls, tabs } = await backgroundFixture();
  const sender = { id, url: `chrome-extension://${id}/app/index.html?embedded=1`, frameId: 7, tab: { id: 11, url: "https://web.whatsapp.com/" } };
  const configuration = await invoke({ type: "configuration.get" }, sender);
  assert.equal(configuration.ok, true);
  assert.equal(configuration.result.waTabId, 11);
  const context = await invoke({ type: "wa.context", tabId: 22 }, sender);
  assert.equal(context.ok, true);
  assert.equal(context.result.tabId, 11);
  assert.equal(context.result.chatId, "wa:peer-11@lid");
  const capture = await invoke({ type: "wa.capture", tabId: 22 }, sender);
  assert.equal(capture.ok, true);
  assert.equal(capture.result[0].body, "Message 11");
  const bind = await invoke({ type: "wa.bind", tabId: 22, input: { phone: "51999999999", chatId: "wa:peer-11@lid" } }, sender);
  assert.equal(bind.ok, true);
  const prepare = await invoke({ type: "wa.prepare", tabId: 22, input: { phone: "51999999999", text: "Entrega revisada" } }, sender);
  assert.equal(prepare.ok, true);
  const sends = calls.filter(call => call.type === "send");
  assert.deepEqual(sends.map(call => call.tabId), [11, 11, 11, 11]);
  assert.deepEqual(sends.map(call => call.message.action), ["context", "capture", "bind", "prepare"]);
  assert(sends.every(call => call.options.frameId === 0));
  assert(!calls.some(call => call.type === "query"));

  const sendCount = sends.length;
  tabs.set(11, { id: 11, url: "https://other.example/", status: "complete" });
  const navigated = await invoke({ type: "wa.prepare", input: { phone: "51999999999", text: "No insertar" } }, sender);
  assert.equal(navigated.ok, false);
  assert.match(navigated.error, /pestaña de WhatsApp cambió/);
  assert.equal(calls.filter(call => call.type === "send").length, sendCount);
});

test("The actual background denies CRM APIs to WhatsApp content and embedded configuration changes", async () => {
  const { invoke, calls } = await backgroundFixture();
  const content = { id, url: "https://web.whatsapp.com/", frameId: 0, tab: { id: 11, url: "https://web.whatsapp.com/" } };
  for (const type of ["crm.request", "crm.connect", "configuration.get", "configuration.set", "wa.prepare"]) {
    const denied = await invoke({ type, expectedOrigin: "https://crm.example", path: "/api/workspace", method: "PUT", body: "{}", origin: "https://other-crm.example" }, content);
    assert.equal(denied.ok, false, type);
    assert.match(denied.error, /no permitida/);
  }
  const embedded = { id, url: `chrome-extension://${id}/app/index.html?embedded=1`, frameId: 7, tab: content.tab };
  const change = await invoke({ type: "configuration.set", origin: "https://other-crm.example" }, embedded);
  assert.equal(change.ok, false);
  assert.match(change.error, /configuración de la extensión/);
  assert.equal(calls.length, 0);
});

test("The toolbar opens the dock in its WhatsApp tab without the Chrome side panel", async () => {
  const { action, calls, tabs } = await backgroundFixture();
  action(tabs.get(11));
  await new Promise(setImmediate);
  const sends = calls.filter(call => call.type === "send");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].tabId, 11);
  assert.equal(sends[0].message.channel, "nexo.dock");
  assert.equal(sends[0].message.action, "toggle");
  assert.equal(sends[0].options.frameId, 0);
  assert(calls.some(call => call.type === "update" && call.tabId === 11 && call.update.active));
  assert(!calls.some(call => call.type === "query"));
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
  assert.equal(manifest.version, "1.1.1");
  assert.deepEqual(manifest.host_permissions, ["https://web.whatsapp.com/*"]);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.side_panel, undefined);
  assert(!manifest.permissions.includes("sidePanel"));
  assert(!manifest.permissions.includes("debugger"));
  assert.deepEqual(manifest.content_scripts, [{
    matches: ["https://web.whatsapp.com/*"], js: ["whatsapp.js", "dock.js"],
    run_at: "document_idle", all_frames: false,
  }]);
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ["app/*", "bootstrap.mjs", "companion.css"],
    matches: ["https://web.whatsapp.com/*"],
  }]);
  const dock = await readFile(join(output, "dock.js"), "utf8");
  assert.match(dock, /embedded=1/);
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
