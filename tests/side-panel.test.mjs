import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as policy from "../extension/policy.mjs";

const id = "a".repeat(32), origin = "https://crm.example";
const ext = `chrome-extension://${id}/`;
const panelContextId = "native-panel-context", panelDocumentId = "native-panel-document";
const panelInstance = "0123456789abcdef0123456789abcdef";
const panelUrl = ext + "app/index.html?panel=1&panelInstance=" + panelInstance;
// Extension-page MessageSender metadata is optional: real Chrome side panels
// do not consistently include the tab/document fields supplied by old mocks.
const native = { id, url: ext + "app/index.html?panel=1" };

async function fixture() {
  const calls = [], local = { crmOrigin: origin }, session = { "panelWhatsApp:1": 11, "panelWhatsApp:2": 21 };
  const tabs = new Map([
    [11, { id: 11, windowId: 1, active: true, url: policy.WA_ORIGIN + "/", status: "complete" }],
    [12, { id: 12, windowId: 1, active: false, url: "https://unrelated.example/", status: "complete" }],
    [13, { id: 13, windowId: 1, active: false, url: policy.WA_ORIGIN + "/", status: "complete" }],
    [21, { id: 21, windowId: 2, active: true, url: policy.WA_ORIGIN + "/", status: "complete" }],
  ]);
  const peers = new Map([...tabs.values()].filter(tab => tab.url.startsWith(policy.WA_ORIGIN)).map(tab => [tab.id, {
    name: `Contacto ${tab.id}`, phone: tab.id === 11 ? "51999999999" : tab.id === 13 ? "51988888888" : "51977777777", chatId: `wa:peer-${tab.id}@lid`, phoneSource: "visible",
  }]));
  let listener, actionListener, activationListener, removalListener, focusedWindow = 1, beforeAdapterReply, beforeTabGet;
  let contexts = [{ contextType: "SIDE_PANEL", contextId: panelContextId, documentId: panelDocumentId, documentUrl: panelUrl, windowId: -1, tabId: -1 }];
  const area = values => ({
    async get(key) { calls.push({ type: "storage-read", key }); return { [key]: structuredClone(values[key]) }; },
    async set(update) { Object.assign(values, structuredClone(update)); },
    async remove(key) { delete values[key]; },
    async setAccessLevel() {},
  });
  const chrome = {
    runtime: {
      id, getURL: path => ext + path,
      getManifest: () => ({ side_panel: { default_path: "app/index.html?panel=1" } }),
      onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} },
      async openOptionsPage() { calls.push({ type: "open-options" }); },
      async getContexts(filter = {}) { calls.push({ type: "get-contexts", filter }); return contexts.filter(item => (!filter.documentIds || filter.documentIds.includes(item.documentId)) && (!filter.contextIds || filter.contextIds.includes(item.contextId)) && (!filter.contextTypes || filter.contextTypes.includes(item.contextType)) && (!filter.documentUrls || filter.documentUrls.includes(item.documentUrl)) && (!filter.windowIds || filter.windowIds.includes(item.windowId))); },
      async sendMessage(message) { calls.push({ type: "broadcast", message: structuredClone(message) }); },
    },
    sidePanel: {
      async setPanelBehavior(input) { calls.push({ type: "panel-behavior", input }); },
      async setOptions(input) { calls.push({ type: "panel-options", input }); },
      async open(input) { calls.push({ type: "panel-open", input }); },
    },
    storage: { local: area(local), session: area(session) },
    permissions: { async contains() { return true; } },
    action: { onClicked: { addListener(fn) { actionListener = fn; } } },
    windows: {
      async get(windowId) { if (![1, 2].includes(windowId)) throw Error("Closed window"); return { id: windowId, focused: focusedWindow === windowId }; },
      async update(windowId, input) { if (input.focused) focusedWindow = windowId; calls.push({ type: "window-update", windowId, input }); return { id: windowId, focused: focusedWindow === windowId }; },
    },
    tabs: {
      onUpdated: { addListener() {} },
      onActivated: { addListener(fn) { activationListener = fn; } },
      onRemoved: { addListener(fn) { removalListener = fn; } },
      async get(tabId) { calls.push({ type: "tab-get", tabId }); await beforeTabGet?.(tabId); if (!tabs.has(tabId)) throw Error("Closed tab"); return { ...tabs.get(tabId) }; },
      async query(query) { calls.push({ type: "tab-query", query }); return [...tabs.values()].filter(tab => (!query.active || tab.active) && (query.windowId === undefined || tab.windowId === query.windowId) && (!query.currentWindow || tab.windowId === focusedWindow) && (!query.url || tab.url.startsWith(query.url.replace(/\*$/, "")))).map(tab => ({ ...tab })); },
      async update(tabId, update) { const tab = tabs.get(tabId); if (!tab) throw Error("Closed tab"); if (update.active) for (const item of tabs.values()) if (item.windowId === tab.windowId) item.active = item.id === tabId; Object.assign(tab, update); calls.push({ type: "tab-update", tabId, update }); return { ...tab }; },
      async create(input) { const tab = { id: 99, windowId: input.windowId || focusedWindow, status: "loading", ...input }; tabs.set(99, tab); calls.push({ type: "tab-create", input }); return { ...tab }; },
      async sendMessage(tabId, message) {
        calls.push({ type: "adapter", tabId, message: structuredClone(message) });
        if (message.channel === "nexo.dock") return { ok: true };
        const peer = peers.get(tabId); if (!peer) throw Error("No WhatsApp document");
        if (message.action === "bind") {
          if (peer.chatId !== message.input.chatId || peer.name !== message.input.name || peer.phone && peer.phone !== message.input.phone) return { ok: false, error: "La conversación cambió" };
          peer.phone = message.input.phone; peer.phoneSource = "manual";
        }
        if (message.action === "unbind") { peer.phone = ""; peer.phoneSource = ""; }
        if (message.action === "capture") return { ok: true, result: [{ ...peer, body: "Texto sintético visible" }] };
        if (message.action === "prepare") return { ok: true, result: { prepared: true, ...peer } };
        const result = { ok: true, result: { ...peer } };
        await beforeAdapterReply?.({ tabId, message });
        return result;
      },
    },
    scripting: { async executeScript(input) { calls.push({ type: "inject", input }); } },
  };
  const source = await readFile(new URL("../extension/background.mjs", import.meta.url), "utf8");
  vm.runInNewContext(source.replace(/^import[^\n]+\n/, ""), { chrome, ...policy, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, AbortController });
  await new Promise(setImmediate);
  const invoke = (message, sender = native) => new Promise(resolve => {
    assert.equal(listener({ channel: "nexo", expectedOrigin: origin, panelContextId, panelWindowId: 1, panelInstance, ...message }, sender, resolve), true);
  });
  async function activate(tabId) { const tab = tabs.get(tabId); for (const item of tabs.values()) if (item.windowId === tab.windowId) item.active = item.id === tabId; activationListener?.({ tabId, windowId: tab.windowId }); await new Promise(setImmediate); }
  return { invoke, calls, local, session, tabs, peers, chrome, activate, beforeReply: value => { beforeAdapterReply = value; }, beforeGet: value => { beforeTabGet = value; }, focus: value => { focusedWindow = value; }, contexts: value => { contexts = value; }, action: tab => actionListener(tab), remove: async tabId => { const windowId = tabs.get(tabId)?.windowId; tabs.delete(tabId); removalListener?.(tabId, { windowId, isWindowClosing: false }); await new Promise(setImmediate); } };
}

test("The persistent panel configures a global action and opens in the click's window before async storage work", async () => {
  const f = await fixture();
  assert(f.calls.some(item => item.type === "panel-behavior" && item.input.openPanelOnActionClick === true));
  assert(!f.calls.some(item => item.type === "panel-options" && Object.hasOwn(item.input, "tabId")), "The global panel must not be disabled on unrelated websites.");
  f.calls.length = 0;
  const sender = { id, url: policy.WA_ORIGIN + "/", frameId: 0, tab: { ...f.tabs.get(11) } };
  const pending = f.invoke({ type: "panel.open" }, sender);
  assert.equal(f.calls[0]?.type, "panel-open", "Open must run in the original click, before awaited reads lose the gesture.");
  const reply = await pending;
  assert.equal(reply.ok, true);
  assert.equal(f.calls[0].input.windowId, 1);
  assert(!Object.hasOwn(f.calls[0].input, "tabId"), "Opening a tab-specific panel would hide it when tabs change.");
  assert(f.calls.some(item => item.type === "adapter" && item.message.channel === "nexo.dock" && item.message.action === "close"));
  assert(!f.calls.some(item => item.type === "open-options" || item.type === "tab-create"));
});

test("A native panel retains only its window's WhatsApp target when another website is active", async () => {
  const f = await fixture();
  const config = await f.invoke({ type: "configuration.get" });
  assert.equal(config.ok, true); assert.equal(config.result.panelWindowId, 1); assert.equal(config.result.waTabId, 11);
  const first = await f.invoke({ type: "wa.context" });
  assert.equal(first.result.tabId, 11); assert.equal(first.result.windowId, 1); assert.equal(first.result.active, true);
  assert.equal((await f.invoke({ type: "wa.capture" })).ok, true);
  assert(f.calls.some(item => item.type === "adapter" && item.message.action === "capture" && item.message.requireVisible === true), "Native message operations must ask the document to recheck visibility too.");
  await f.activate(12);
  const retained = await f.invoke({ type: "wa.context", tabId: 21, windowId: 2 });
  assert.equal(retained.ok, true);
  assert.equal(retained.result.tabId, 11); assert.equal(retained.result.windowId, 1); assert.equal(retained.result.active, false);
  assert.equal(retained.result.chatId, first.result.chatId);
  const before = f.calls.filter(item => item.type === "adapter").length;
  for (const type of ["wa.capture", "wa.prepare", "wa.bind", "wa.unbind"]) {
    const reply = await f.invoke({ type, input: { phone: "51999999999", chatId: first.result.chatId, name: "Contacto 11", text: "No insertar fuera de WhatsApp" } });
    assert.equal(reply.ok, false, type); assert.match(reply.error, /WhatsApp|conversación|pestaña/i);
  }
  assert.equal(f.calls.filter(item => item.type === "adapter").length, before, "Hidden chats cannot be captured, bound or drafted.");
  await f.activate(13);
  const second = await f.invoke({ type: "wa.context" });
  assert.equal(second.result.tabId, 13); assert.equal(second.result.active, true);
  await f.activate(12);
  assert.equal((await f.invoke({ type: "wa.context" })).result.tabId, 13);
  assert(!f.calls.some(item => item.type === "adapter" && item.tabId === 21), "A different Chrome window cannot lend its conversation to this panel.");
});

test("Native panel identity comes from a verified SIDE_PANEL document, never query parameters or content senders", async () => {
  const f = await fixture();
  for (const sender of [
    { ...native, documentId: "unverified-document" },
    { ...native, tab: { ...f.tabs.get(11) } },
    { ...native, frameId: 7, tab: { ...f.tabs.get(11) } },
    { ...native, id: "b".repeat(32) },
    { id, url: policy.WA_ORIGIN + "/", frameId: 0, tab: { ...f.tabs.get(11) } },
  ]) assert.equal((await f.invoke({ type: "wa.context", windowId: 1 }, sender)).ok, false);
  f.contexts([{ contextType: "TAB", contextId: panelContextId, documentId: panelDocumentId, documentUrl: panelUrl, windowId: 1 }]);
  assert.equal((await f.invoke({ type: "wa.context" })).ok, false);
  f.contexts([{ contextType: "SIDE_PANEL", contextId: panelContextId, documentId: panelDocumentId, documentUrl: panelUrl, windowId: 2 }]);
  const otherWindow = await f.invoke({ type: "wa.context", windowId: 1, panelWindowId: 2 });
  assert.equal(otherWindow.result.windowId, 2); assert.equal(otherWindow.result.tabId, 21);
});

test("Closing or navigating the remembered WhatsApp tab cannot silently retarget another window", async () => {
  const f = await fixture();
  f.tabs.set(14, { id: 14, windowId: 1, active: false, url: policy.WA_ORIGIN + "/", status: "complete" });
  await f.activate(12);
  await f.remove(11);
  const missing = await f.invoke({ type: "wa.context" });
  assert.equal(missing.ok, true); assert.equal(missing.result.chatId, ""); assert.equal(missing.result.active, false);
  assert(!f.calls.some(item => item.type === "adapter" && [13, 21].includes(item.tabId)));
  const open = await f.invoke({ type: "wa.open" });
  assert.equal(open.ok, true);
  const create = f.calls.find(item => item.type === "tab-create");
  assert(create && create.input.windowId === 1, "Explicit return creates WhatsApp in this panel's window when its target is gone.");
  const g = await fixture();
  g.tabs.set(14, { id: 14, windowId: 1, active: false, url: policy.WA_ORIGIN + "/", status: "complete" });
  await g.activate(12);
  const beforeNavigated = g.calls.filter(item => item.type === "adapter").length;
  g.tabs.get(11).url = "https://different.example/";
  const navigated = await g.invoke({ type: "wa.context" });
  assert.equal(navigated.ok, true); assert.equal(navigated.result.chatId, "");
  assert.equal(g.calls.filter(item => item.type === "adapter").length, beforeNavigated);
});

test("A context reply held while the active WhatsApp tab changes cannot be delivered as the current recipient", async () => {
  const f = await fixture();
  let started, release;
  const pending = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  let held = false;
  f.beforeReply(async ({ tabId, message }) => {
    if (!held && tabId === 11 && message.action === "context") { held = true; started(); await gate; }
  });
  const old = f.invoke({ type: "wa.context" });
  await pending;
  await f.activate(13);
  release();
  const result = await old;
  assert.equal(result.ok, false, "The identity of tab A must be rejected after the browser selects tab B.");
  assert.match(result.error, /pestaña|cambió|contacto/i);
  const current = await f.invoke({ type: "wa.context" });
  assert.equal(current.result.tabId, 13); assert.equal(current.result.active, true);
});

test("A slow activation callback cannot overwrite the newer WhatsApp choice after moving to another website", async () => {
  const f = await fixture();
  let started, release;
  const pending = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  let held = false;
  f.beforeGet(async tabId => { if (!held && tabId === 11) { held = true; started(); await gate; } });
  const old = f.activate(11);
  await pending;
  await f.activate(13);
  await f.activate(12);
  release(); await old;
  await new Promise(setImmediate); await new Promise(setImmediate);
  const current = await f.invoke({ type: "wa.context" });
  assert.equal(current.result.tabId, 13, "The old callback must not make tab A the remembered recipient again.");
  assert.equal(current.result.active, false);
  assert.equal(f.session["panelWhatsApp:1"], 13);
});

test("An unfocused window cannot read message bodies or draft, and stale CRM views stay blocked", async () => {
  const f = await fixture();
  f.focus(2);
  const hidden = await f.invoke({ type: "wa.context" });
  assert.equal(hidden.result.active, false);
  const count = f.calls.filter(item => item.type === "adapter").length;
  assert.equal((await f.invoke({ type: "wa.capture" })).ok, false);
  assert.equal((await f.invoke({ type: "wa.prepare", input: { phone: "51999999999", text: "No usar otra ventana" } })).ok, false);
  assert.equal(f.calls.filter(item => item.type === "adapter").length, count);
  f.local.crmOrigin = "https://different-crm.example";
  const stale = await f.invoke({ type: "wa.context", expectedOrigin: origin });
  assert.equal(stale.ok, false); assert.match(stale.error, /CRM|Recarga/);
});



test("Native CRM configuration and inline authentication remain available when sender document metadata is omitted", async () => {
  const f = await fixture();
  for (const sender of [native, { ...native, frameId: 0 }, { ...native, documentId: panelDocumentId }]) {
    const configuration = await f.invoke({ type: "configuration.get" }, sender);
    assert.equal(configuration.ok, true, "Optional Chrome document metadata must not prevent the inline login from loading.");
    assert.equal(configuration.result.origin, origin);
    assert.equal(configuration.result.panelWindowId, 1);
    const context = await f.invoke({ type: "wa.context" }, sender);
    assert.equal(context.ok, true); assert.equal(context.result.windowId, 1); assert.equal(context.result.tabId, 11);
  }
  f.contexts([{ contextType: "SIDE_PANEL", contextId: panelContextId, documentUrl: panelUrl, windowId: 1, tabId: -1 }]);
  assert.equal((await f.invoke({ type: "wa.context" })).result.windowId, 1, "A live browser context ID is sufficient when its optional documentId is absent too.");
});

test("Panel context hints must identify a live exact-URL SIDE_PANEL and cannot guess a window", async () => {
  const f = await fixture();
  const first = { contextType: "SIDE_PANEL", contextId: panelContextId, documentId: panelDocumentId, documentUrl: panelUrl, windowId: 1, tabId: -1 };
  const second = { ...first, contextId: "other-panel-context", documentId: "other-panel-document", windowId: 2 };
  f.contexts([first, second]);
  const missing = await f.invoke({ type: "wa.context", panelContextId: undefined, windowId: 1 });
  assert.equal(missing.ok, false, "Multiple live panels cannot be resolved from a raw requested window or by choosing the first one.");
  for (const hint of ["unknown-context", "", 1, null]) {
    assert.equal((await f.invoke({ type: "wa.context", panelContextId: hint, windowId: 1 })).ok, false);
  }
  const firstWindow = await f.invoke({ type: "wa.context", windowId: 2 });
  assert.equal(firstWindow.result.windowId, 1); assert.equal(firstWindow.result.tabId, 11);
  const secondWindow = await f.invoke({ type: "wa.context", panelContextId: second.contextId, panelWindowId: 2, windowId: 1 });
  assert.equal(secondWindow.result.windowId, 2); assert.equal(secondWindow.result.tabId, 21);
  assert.equal((await f.invoke({ type: "wa.context", panelContextId: second.contextId }, { ...native, documentId: panelDocumentId })).ok, false, "Provided sender document metadata must agree with the selected live context.");
  f.contexts([{ ...first, documentUrl: ext + "options.html" }]);
  assert.equal((await f.invoke({ type: "wa.context" })).ok, false);
  f.contexts([{ ...first, windowId: undefined }]);
  assert.equal((await f.invoke({ type: "wa.context" })).result.windowId, 1, "Optional context window metadata can use the validated browser UI window hint.");
  f.contexts([{ ...first, contextType: "TAB", tabId: 11 }]);
  assert.equal((await f.invoke({ type: "wa.context" })).ok, false);
});

test("Panel routing failure does not block CRM configuration but still blocks WhatsApp operations", async () => {
  const f = await fixture();
  f.contexts([]);
  const configuration = await f.invoke({ type: "configuration.get" });
  assert.equal(configuration.ok, true);
  assert.equal(configuration.result.origin, origin);
  assert.equal(configuration.result.panelWindowId, undefined);
  assert.equal(typeof configuration.result.panelRoutingError, "string");
  for (const type of ["wa.context", "wa.open", "wa.capture", "wa.prepare"]) {
    const response = await f.invoke({ type, input: { phone: "51999999999", text: "Do not cross a missing context" } });
    assert.equal(response.ok, false, type);
  }
  assert(!f.calls.some(item => item.type === "adapter" || item.type === "tab-create" || item.type === "tab-update" || item.type === "open-options"));
});


test("Real Chrome unassociated SIDE_PANEL window metadata uses only a validated browser UI window hint", async () => {
  const f = await fixture();
  const nativeChrome = { contextType: "SIDE_PANEL", contextId: panelContextId, documentUrl: panelUrl, windowId: -1, tabId: -1 };
  f.contexts([nativeChrome]);
  const first = await f.invoke({ type: "wa.context" });
  assert.equal(first.ok, true); assert.equal(first.result.windowId, 1); assert.equal(first.result.tabId, 11);
  for (const panelWindowId of [undefined, -1, "1", 999, null]) {
    assert.equal((await f.invoke({ type: "wa.context", panelWindowId })).ok, false, String(panelWindowId));
  }
  assert.equal((await f.invoke({ type: "wa.context", panelContextId: undefined })).ok, false, "A window hint without a live SIDE_PANEL identity cannot authorize WhatsApp routing.");
  const rebound = await f.invoke({ type: "wa.context", panelWindowId: 2 });
  assert.equal(rebound.ok, false, "A live context already bound to one Chrome window cannot be rebound to another.");
  f.contexts([nativeChrome, { ...nativeChrome, contextId: "actual-second-context" }]);
  const second = await f.invoke({ type: "wa.context", panelContextId: "actual-second-context", panelWindowId: 2 });
  assert.equal(second.ok, true); assert.equal(second.result.windowId, 2); assert.equal(second.result.tabId, 21);
});


test("Unassociated native contexts are selected by their per-document URL nonce rather than array order", async () => {
  const f = await fixture();
  const otherInstance = "abcdef0123456789abcdef0123456789";
  const first = { contextType: "SIDE_PANEL", contextId: panelContextId, documentUrl: panelUrl, windowId: -1, tabId: -1 };
  const other = { ...first, contextId: "other-live-instance", documentUrl: native.url + "&panelInstance=" + otherInstance };
  f.contexts([other, first]);
  const own = await f.invoke({ type: "wa.context" });
  assert.equal(own.ok, true); assert.equal(own.result.windowId, 1); assert.equal(own.result.tabId, 11);
  for (const input of [
    { panelInstance: undefined }, { panelInstance: "" }, { panelInstance: "unknown" },
    { panelInstance: otherInstance }, { panelContextId: other.contextId },
    { panelContextId: "missing-context", panelInstance: otherInstance },
  ]) assert.equal((await f.invoke({ type: "wa.context", ...input })).ok, false, JSON.stringify(input));
  const second = await f.invoke({ type: "wa.context", panelContextId: other.contextId, panelInstance: otherInstance, panelWindowId: 2 });
  assert.equal(second.ok, true); assert.equal(second.result.windowId, 2); assert.equal(second.result.tabId, 21);
});
