import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as policy from "../extension/policy.mjs";

const id = "a".repeat(32), origin = "https://crm.example";
const extensionUrl = `chrome-extension://${id}/`;
const embedded = { id, url: extensionUrl + "app/index.html?embedded=1", frameId: 7, tab: { id: 11, url: policy.WA_ORIGIN + "/" } };
const optionsPage = { id, url: extensionUrl + "options.html", frameId: 0 };
const secret = "synthetic-password-for-this-test-only";
const token = "synthetic_native_session_" + "a".repeat(32);

async function fixture({ originValue = origin, beforeFetch, responseFor } = {}) {
  const local = originValue ? { crmOrigin: originValue } : {}, session = {}, requests = [], broadcasts = [], tabs = [], access = [];
  let listener, loggedIn = false, expired = false;
  const storage = (values, area) => ({
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(update) { Object.assign(values, structuredClone(update)); },
    async remove(key) { delete values[key]; },
    async setAccessLevel(input) { access.push({ area, ...input }); },
  });
  const chrome = {
    runtime: {
      id, getURL: path => extensionUrl + path,
      onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} },
      async sendMessage(message) { broadcasts.push(structuredClone(message)); }, async openOptionsPage() {},
    },
    storage: { local: storage(local, "local"), session: storage(session, "session") },
    permissions: { async contains() { return true; } },
    tabs: {
      async get(tabId) { tabs.push({ operation: "get", tabId }); throw Error("No CRM tabs exist"); },
      async query(query) { tabs.push({ operation: "query", query }); return []; },
      async create(input) { tabs.push({ operation: "create", input }); return { id: 99, ...input }; },
      onUpdated: { addListener() {} }, onRemoved: { addListener() {} },
    },
    scripting: { async executeScript(input) { tabs.push({ operation: "inject", input }); throw Error("Bridge must not run"); } },
    action: { onClicked: { addListener() {} } },
  };
  const fetch = async (url, input) => {
    const request = { url, ...input, headers: { ...input.headers } };
    requests.push(request);
    await beforeFetch?.(request);
    const custom = await responseFor?.(request);
    if (custom) return custom;
    const path = new URL(url).pathname;
    if (path === "/api/auth/status") return Response.json({ authProvider: "password", configured: true });
    if (path === "/api/login") {
      const data = JSON.parse(input.body);
      if (data.email !== "owner@example.test" || data.password !== secret) return Response.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
      assert.equal(data.client, "extension"); loggedIn = true; expired = false;
      return Response.json({ token, email: data.email, csrf: "synthetic-csrf", mode: "server", authProvider: "password", expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    }
    if (!loggedIn || expired || input.headers.Authorization !== "Bearer " + token) return Response.json({ error: "Sesión vencida." }, { status: 401 });
    if (path === "/api/session") return Response.json({ email: "owner@example.test", csrf: "synthetic-csrf", mode: "server", authProvider: "password" });
    if (path === "/api/logout" || path === "/api/password") { loggedIn = false; return Response.json({ ok: true, logoutUrl: "/login" }); }
    if (path === "/api/workspace") return Response.json({ revision: 4, state: { clients: [] } });
    return Response.json({ error: "No encontrado." }, { status: 404 });
  };
  const source = await readFile(new URL("../extension/background.mjs", import.meta.url), "utf8");
  vm.runInNewContext(source.replace(/^import[^\n]+\n/, ""), {
    chrome, fetch, ...policy, URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
  });
  const invoke = (message, sender = embedded) => new Promise(resolve => {
    assert.equal(listener({ channel: "nexo", expectedOrigin: local.crmOrigin || policy.DEFAULT_ORIGIN, ...message }, sender, resolve), true);
  });
  return { invoke, local, session, requests, broadcasts, tabs, access, expire: () => { expired = true; } };
}

test("Native extension login and CRUD work with every CRM tab closed; only background keeps the bearer", async () => {
  const f = await fixture();
  const status = await f.invoke({ type: "crm.authStatus" });
  assert.equal(status.result.authProvider, "password");
  const before = await f.invoke({ type: "crm.verify" });
  assert.equal(before.result.ready, false);
  const loggedIn = await f.invoke({ type: "crm.login", input: { email: "owner@example.test", password: secret } });
  assert.equal(loggedIn.ok, true);
  assert.equal(loggedIn.result.ready, true);
  assert.equal(JSON.stringify(loggedIn).includes(token), false);
  assert.equal(JSON.stringify(loggedIn).includes(secret), false);
  assert.equal((await f.invoke({ type: "crm.verify" })).result.ready, true);
  const read = await f.invoke({ type: "crm.request", path: "/api/workspace", method: "GET" });
  assert.equal(read.result.status, 200);
  const write = await f.invoke({ type: "crm.request", path: "/api/workspace", method: "PUT", body: '{"revision":4}' });
  assert.equal(write.result.status, 200);
  assert.equal(f.tabs.length, 0, "No native auth operation can open, require or inject a CRM tab.");
  assert.equal(f.session["nativeSession:" + origin].token, token);
  assert.equal(JSON.stringify(f.local).includes(token), false);
  assert.equal(JSON.stringify(f.local).includes(secret), false);
  assert.equal(JSON.stringify(f.session).includes(secret), false);
  assert.equal(JSON.stringify(f.broadcasts).includes(token), false);
  assert.equal(JSON.stringify(f.broadcasts).includes(secret), false);
  assert(f.access.some(item => item.area === "session" && item.accessLevel === "TRUSTED_CONTEXTS"));
  for (const request of f.requests) {
    assert.equal(request.credentials, "omit"); assert.equal(request.redirect, "error");
    assert.equal(request.headers["X-Nexo-Client"], "extension");
    assert.equal(new URL(request.url).origin, origin);
    assert.equal(Object.hasOwn(request.headers, "Cookie"), false);
  }
  assert.equal(f.requests.find(item => item.method === "PUT").headers.Authorization, "Bearer " + token);
});

test("Wrong passwords leave no session, and WhatsApp pages cannot call login or read privileged APIs", async () => {
  const f = await fixture();
  const wrong = await f.invoke({ type: "crm.login", input: { email: "owner@example.test", password: "wrong" } });
  assert.equal(wrong.ok, false); assert.match(wrong.error, /incorrectos/);
  assert.deepEqual(f.session, {});
  const count = f.requests.length;
  const content = { id, url: policy.WA_ORIGIN + "/", frameId: 0, tab: embedded.tab };
  for (const type of ["crm.login", "crm.authStatus", "crm.request", "crm.verify"]) {
    assert.equal((await f.invoke({ type, input: { email: "owner@example.test", password: secret }, path: "/api/workspace" }, content)).ok, false);
  }
  assert.equal(f.requests.length, count);
  assert.equal((await f.invoke({ type: "crm.request", path: "/api/login", method: "POST", body: "{}" })).ok, false, "The generic API path cannot obtain raw login tokens.");
});

test("Logout, password changes and expired bearer sessions revoke local access without ending another origin's session", async () => {
  const f = await fixture();
  const login = () => f.invoke({ type: "crm.login", input: { email: "owner@example.test", password: secret } });
  await login();
  f.expire();
  const expired = await f.invoke({ type: "crm.request", path: "/api/workspace" });
  assert.equal(expired.result.status, 401);
  assert.equal(f.session["nativeSession:" + origin], undefined);
  await login();
  const logout = await f.invoke({ type: "crm.request", path: "/api/logout", method: "POST", body: "{}" });
  assert.equal(logout.result.status, 200);
  assert.equal(f.session["nativeSession:" + origin], undefined);
  assert.equal((await f.invoke({ type: "crm.verify" })).result.ready, false);
  await login();
  const changed = await f.invoke({ type: "crm.request", path: "/api/password", method: "POST", body: JSON.stringify({ current: secret, next: "synthetic-next-password" }) });
  assert.equal(changed.result.status, 200);
  assert.equal(f.session["nativeSession:" + origin], undefined);
  assert.equal(f.tabs.length, 0);
});

test("Changing CRM origin drops the previous token and blocks stale views before credentials or data leave", async () => {
  const f = await fixture();
  await f.invoke({ type: "crm.login", input: { email: "owner@example.test", password: secret } });
  const changed = await f.invoke({ type: "configuration.set", origin: "https://other-crm.example" }, optionsPage);
  assert.equal(changed.ok, true);
  assert.equal(f.session["nativeSession:" + origin], undefined);
  const count = f.requests.length;
  assert.equal((await f.invoke({ type: "crm.login", expectedOrigin: origin, input: { email: "owner@example.test", password: secret } })).ok, false);
  assert.equal((await f.invoke({ type: "crm.request", expectedOrigin: origin, path: "/api/workspace" })).ok, false);
  assert.equal(f.requests.length, count);
});

test("A login that finishes after a configuration change cannot save its token or switch the new CRM", async () => {
  let started, release;
  const waiting = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ beforeFetch: async request => { if (new URL(request.url).pathname === "/api/login") { started(); await gate; } } });
  const pending = f.invoke({ type: "crm.login", input: { email: "owner@example.test", password: secret } });
  await waiting;
  await f.invoke({ type: "configuration.set", origin: "https://other-crm.example" }, optionsPage);
  release();
  assert.equal((await pending).ok, false);
  assert.equal(f.session["nativeSession:" + origin], undefined);
  assert.equal(f.local.crmOrigin, "https://other-crm.example");
});

test("An older session's late 401 cannot erase or announce logout for a newly authenticated session", async () => {
  let started, release, logins = 0;
  const waiting = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const secondToken = "synthetic_new_session_" + "b".repeat(36);
  const f = await fixture({ responseFor: async request => {
    const path = new URL(request.url).pathname;
    if (path === "/api/login") return Response.json({ token: ++logins === 1 ? token : secondToken, email: "owner@example.test", csrf: "synthetic-csrf", mode: "server", authProvider: "password", expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    if (path === "/api/workspace") { started(); await gate; return Response.json({ error: "Old session expired" }, { status: 401 }); }
  } });
  const login = () => f.invoke({ type: "crm.login", input: { email: "owner@example.test", password: secret } });
  await login();
  const pending = f.invoke({ type: "crm.request", path: "/api/workspace" });
  await waiting;
  await login();
  release();
  assert.equal((await pending).result.status, 401);
  assert.equal(f.session["nativeSession:" + origin].token, secondToken);
  assert.equal(f.broadcasts.filter(message => message.channel === "nexo.connection" && message.ready === false).length, 0);
});

test("Native requests refuse redirects, oversized replies and expired cached tokens", async () => {
  let scenario = "";
  const f = await fixture({ responseFor: request => {
    if (new URL(request.url).pathname !== "/api/workspace") return;
    if (scenario === "redirect") throw Error("Synthetic redirect refused by fetch redirect:error");
    if (scenario === "large") return new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": "1500001" } });
  } });
  await f.invoke({ type: "crm.login", input: { email: "owner@example.test", password: secret } });
  scenario = "redirect";
  assert.equal((await f.invoke({ type: "crm.request", path: "/api/workspace" })).ok, false);
  scenario = "large";
  assert.match((await f.invoke({ type: "crm.request", path: "/api/workspace" })).error, /tamaño permitido/);
  f.session["nativeSession:" + origin].expiresAt = Math.floor(Date.now() / 1000) - 1;
  const count = f.requests.length;
  assert.equal((await f.invoke({ type: "crm.request", path: "/api/workspace" })).result.status, 401);
  assert.equal(f.requests.length, count, "An expired cached token is not sent to the server.");
});

test("The pre-granted main CRM opens directly without asking for a configuration URL", async () => {
  const f = await fixture({ originValue: "" });
  const configuration = await f.invoke({ type: "configuration.get" });
  assert.equal(configuration.result.origin, policy.DEFAULT_ORIGIN);
  assert.equal(f.local.crmOrigin, policy.DEFAULT_ORIGIN);
  assert.equal(f.tabs.length, 0);
});
