import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { crmOrigin, allowedApi, isExtensionPage, embeddedWhatsAppTab, isWhatsAppSender, safeContext, draftInput, WA_ORIGIN } from "../extension/policy.mjs";

const id = "a".repeat(32);
const extensionUrl = `chrome-extension://${id}/`;
const app = { id, url: extensionUrl + "app/index.html?embedded=1", frameId: 7, tab: { id: 11, url: "https://web.whatsapp.com/" } };

async function backgroundFixture() {
  const source = await readFile(new URL("../extension/background.mjs", import.meta.url), "utf8");
  let listener, documentExists = false, activeWrites = 0, maximumWrites = 0, failNext = false;
  const creates = [], writes = [];
  const storage = { async get() { return {}; }, async set() {}, async remove() {}, async setAccessLevel() {} };
  const chrome = {
    runtime: {
      id, getURL: path => extensionUrl + path,
      onMessage: { addListener: fn => { listener = fn; } },
      onInstalled: { addListener() {} }, async openOptionsPage() {},
      async getContexts(filter) {
        assert.deepEqual([...filter.contextTypes], ["OFFSCREEN_DOCUMENT"]);
        assert.deepEqual([...filter.documentUrls], [extensionUrl + "clipboard.html"]);
        return documentExists ? [{ documentUrl: extensionUrl + "clipboard.html" }] : [];
      },
      async sendMessage(message) {
        if (message.channel !== "nexo.clipboard.offscreen") return;
        writes.push(message);
        activeWrites++; maximumWrites = Math.max(maximumWrites, activeWrites);
        await new Promise(setImmediate);
        activeWrites--;
        const success = !failNext; failNext = false;
        return { ok: success };
      },
    },
    storage: { local: storage, session: storage },
    offscreen: { async createDocument(input) { creates.push(input); await new Promise(setImmediate); documentExists = true; } },
    tabs: {}, action: { onClicked: { addListener() {} } },
  };
  const context = vm.createContext({ chrome, URL, TextEncoder, crmOrigin, allowedApi, isExtensionPage, embeddedWhatsAppTab, isWhatsAppSender, safeContext, draftInput, WA_ORIGIN });
  vm.runInContext(source.replace(/^import[^\n]+\n/, ""), context);
  const invoke = (text, sender = app) => new Promise(resolve => listener({ channel: "nexo", type: "clipboard.copy", text }, sender, resolve));
  return { invoke, creates, writes, maximumWrites: () => maximumWrites, failNext: () => { failNext = true; } };
}

test("Only the trusted packaged CRM may request a bounded clipboard write", async () => {
  const fixture = await backgroundFixture();
  for (const sender of [
    { id, url: "https://web.whatsapp.com/", frameId: 0, tab: app.tab },
    { id: "b".repeat(32), url: app.url, frameId: 7, tab: app.tab },
    { id, url: app.url, frameId: 7, tab: { id: 33, url: "https://unrelated.example/" } },
    { id, url: extensionUrl + "clipboard.html", frameId: 0 },
  ]) assert.equal((await fixture.invoke("Do not copy", sender)).ok, false);
  for (const value of [null, {}, 23, "a".repeat(100001)]) assert.equal((await fixture.invoke(value)).ok, false);
  assert.equal(fixture.creates.length, 0);
  assert.equal(fixture.writes.length, 0);
});

test("Concurrent requests use one hidden document and serialized acknowledged writes", async () => {
  const fixture = await backgroundFixture();
  const texts = ["Hola María 👋\nNetflix · Perfil 1\nValor de prueba", "Segundo mensaje"];
  const results = await Promise.all(texts.map(text => fixture.invoke(text)));
  assert(results.every(result => result.ok === true && result.result.copied === true));
  assert.equal(fixture.creates.length, 1);
  assert.equal(fixture.creates[0].url, "clipboard.html");
  assert.deepEqual([...fixture.creates[0].reasons], ["CLIPBOARD"]);
  assert.equal(fixture.maximumWrites(), 1);
  assert.deepEqual(fixture.writes.map(value => value.text), texts);
  assert(fixture.writes.every(value => value.target === "clipboard-document" && value.type === "write"));
  assert(results.every(result => !JSON.stringify(result).includes(texts[0])));
});

test("A failed offscreen acknowledgement reports failure without poisoning later copies", async () => {
  const fixture = await backgroundFixture();
  fixture.failNext();
  const first = await fixture.invoke("No acknowledgement");
  assert.equal(first.ok, false);
  assert.match(first.error, /No se pudo copiar/);
  const next = await fixture.invoke("A new explicit copy");
  assert.equal(next.ok, true);
  assert.equal(next.result.copied, true);
  assert.equal(fixture.creates.length, 1);
});

async function clipboardDocumentFixture() {
  const source = await readFile(new URL("../extension/clipboard.js", import.meta.url), "utf8");
  let listener, copied = [], clearedSelections = 0, commandSucceeds = true;
  const buffer = { value: "", selected: false, select() { this.selected = true; } };
  const document = {
    querySelector: selector => selector === "#clipboard-buffer" ? buffer : null,
    execCommand(command) { assert.equal(command, "copy"); assert.equal(buffer.selected, true); copied.push(buffer.value); return commandSucceeds; },
    getSelection: () => ({ removeAllRanges() { clearedSelections++; } }),
  };
  const chrome = { runtime: { id, getURL: path => extensionUrl + path, onMessage: { addListener: fn => { listener = fn; } } } };
  vm.runInNewContext(source, { chrome, document });
  const invoke = (text, sender = { id, url: extensionUrl + "background.mjs" }, extra = {}) => {
    let response;
    listener({ channel: "nexo.clipboard.offscreen", target: "clipboard-document", type: "write", text, ...extra }, sender, result => { response = result; });
    return response;
  };
  return { invoke, buffer, copied, clearedSelections: () => clearedSelections, setCommandResult: value => { commandSucceeds = value; } };
}

test("The offscreen receiver rejects websites, content scripts, other UI pages and malformed writes", async () => {
  const fixture = await clipboardDocumentFixture();
  for (const sender of [
    { id, url: "https://web.whatsapp.com/", tab: app.tab },
    { id, url: extensionUrl + "app/index.html?embedded=1" },
    { id, url: extensionUrl + "options.html" },
    { id, url: extensionUrl + "background.mjs", tab: app.tab },
    { id: "b".repeat(32), url: extensionUrl + "background.mjs" },
  ]) assert.equal(fixture.invoke("Do not copy", sender).ok, false);
  for (const value of [undefined, {}, 123, "a".repeat(100001)]) assert.equal(fixture.invoke(value).ok, false);
  assert.equal(fixture.invoke("Do not copy", undefined, { target: "other" }).ok, false);
  assert.equal(fixture.copied.length, 0);
  assert.equal(fixture.buffer.value, "");
});

test("The hidden document preserves literal multiline text and clears it after success or failure", async () => {
  const fixture = await clipboardDocumentFixture();
  const text = "Hola 👋\n<literal>& texto de prueba\nPerfil 2";
  const success = fixture.invoke(text);
  assert.equal(success.ok, true);
  assert.deepEqual(Object.keys(success), ["ok"]);
  assert.equal(fixture.copied[0], text);
  assert.equal(fixture.buffer.value, "");
  assert.equal(fixture.clearedSelections(), 1);
  fixture.setCommandResult(false);
  assert.equal(fixture.invoke("Copy command refused").ok, false);
  assert.equal(fixture.buffer.value, "");
  assert.equal(fixture.clearedSelections(), 2);
});
