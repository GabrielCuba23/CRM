import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tokenHash, nativeConfigured, nativePublicRequest } from "../cloud/native-auth.mjs";
import { emptyState } from "../cloud/state.mjs";

const require = createRequire("/workspace/work/cloud-tools/package.json");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const { build } = require("esbuild");
const root = new URL("..", import.meta.url).pathname;
const email = "owner@example.test", password = "Synthetic owner password 1!";
const pepper = "Synthetic testing pepper only 012345678901234567890123456789";
const compiled = await build({
  stdin: { contents: `import {handleRequest} from './cloud/index.mjs'; export default {fetch(request, env){ return handleRequest(request,{...env, ASSETS:{fetch:async request=>new Response(new URL(request.url).pathname==='/login.html'?'<head></head><main>Public sign in</main>':'Private application asset')}}); }};`, resolveDir: root },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", logLevel: "silent",
});
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
  name: "native-auth-test", modules: true, compatibilityDate: "2026-10-01",
  script: compiled.outputFiles[0].text, d1Databases: { DB: "native-auth-database" },
  bindings: { OWNER_EMAIL: email, AUTH_MODE: "password", AUTH_PASSWORD_PEPPER: pepper },
}] }));
const DB = await mf.getD1Database("DB");
await DB.exec((await readFile(new URL("../cloud/schema.sql", import.meta.url), "utf8")).replace(/\n/g, " "));
test.after(() => mf.dispose());

function request(path, { method = "GET", body, cookie, bearer, csrf, origin = "https://crm.test", extension = false, ip = "192.0.2.1", headers = {} } = {}) {
  return mf.dispatchFetch("https://crm.test" + path, {
    method, redirect: "manual",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(origin === undefined || origin === null ? {} : { Origin: origin }),
      ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...(extension ? { "X-Nexo-Client": "extension" } : {}),
      "CF-Connecting-IP": ip, ...headers,
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function reset({ expires = Math.floor(Date.now() / 1000) + 3600 } = {}) {
  await DB.batch(["auth_owner", "auth_setup", "auth_sessions", "auth_attempts", "workspace"].map(table => DB.prepare("DELETE FROM " + table)));
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  await DB.prepare("INSERT INTO auth_setup(token_hash,email,expires,used_at) VALUES(?,?,?,NULL)").bind(await tokenHash(token), email, expires).run();
  return token;
}
async function setup(token, value = password) {
  return request("/api/setup", { method: "POST", body: { email, password: value, token } });
}
async function login({ extension = false, value = password, ...options } = {}) {
  return request("/api/login", { method: "POST", body: { email, password: value, ...(extension ? { client: "extension" } : {}) }, extension, ...options });
}
async function owner() {
  const token = await reset(), response = await setup(token);
  assert.equal(response.status, 200, await response.clone().text());
  return { cookie: response.headers.get("Set-Cookie").split(";")[0], ...(await response.json()) };
}

test("native mode fails closed without its owner and pepper; public login reveals no private modules", async () => {
  assert.equal(nativeConfigured({ DB, OWNER_EMAIL: email }), false);
  assert.equal(nativeConfigured({ DB, OWNER_EMAIL: email, AUTH_PASSWORD_PEPPER: pepper }), true);
  await reset();
  const status = await request("/api/auth/status");
  assert.deepEqual(await status.json(), { authProvider: "password", configured: false });
  for (const path of ["/", "/index.html", "/companion"]) {
    const response = await request(path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), "https://crm.test/login");
  }
  for (const path of ["/api/session", "/api/workspace", "/app.js", "/companions/workspace.mjs"]) assert.equal((await request(path)).status, 401, path);
  assert.equal((await request("/login")).status, 200);
  assert.equal((await request("/login.js")).status, 200);
  assert.equal((await request("/api/login", { method: "OPTIONS", origin: "https://attacker.test" })).headers.has("Access-Control-Allow-Origin"), false);
});

test("only a live invite for the configured owner can create a password; setup starts a secure web session", async () => {
  const token = await reset();
  const invalidOrigin = await request("/api/setup", { method: "POST", body: { email, password, token }, origin: "https://attacker.test" });
  assert.equal(invalidOrigin.status, 403);
  const wrongOwner = await request("/api/setup", { method: "POST", body: { email: "someone@example.test", password, token } });
  assert.equal(wrongOwner.status, 403);
  assert.equal((await setup("x".repeat(64))).status, 403);
  assert.equal((await setup(token, "short")).status, 400);
  const response = await setup(token);
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("Set-Cookie");
  for (const flag of ["__Host-nexo_session=", "Path=/", "Max-Age=28800", "HttpOnly", "Secure", "SameSite=Strict"]) assert(cookie.includes(flag));
  const session = await response.json();
  assert.equal(session.email, email);
  assert.equal(session.authProvider, "password");
  assert.equal(session.mode, "server");
  assert(!Object.hasOwn(session, "token"));
  assert(!Object.hasOwn(session, "token_hash"));
  const stored = await DB.prepare("SELECT * FROM auth_owner").first();
  assert.match(stored.password_hash, /^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert(!JSON.stringify(stored).includes(password));
  assert(!JSON.stringify(stored).includes(pepper));
  assert.equal((await DB.prepare("SELECT used_at FROM auth_setup").first()).used_at > 0, true);
  assert.equal((await DB.prepare("SELECT count(*) AS count FROM workspace").first()).count, 0, "Setting a password must never change customer data.");
  assert.equal((await setup(token)).status, 409);
  assert.equal((await request("/api/auth/status")).status, 200);
  assert.equal((await request("/login", { cookie: cookie.split(";")[0] })).status, 302);
});

test("expired invites and racing setup attempts cannot overwrite or create multiple owners", async () => {
  let token = await reset({ expires: 1 });
  assert.equal((await setup(token)).status, 403);
  token = await reset();
  const results = await Promise.all([setup(token), setup(token, "Second synthetic password 2!")]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  assert.equal((await DB.prepare("SELECT count(*) AS count FROM auth_owner").first()).count, 1);
  assert.equal((await DB.prepare("SELECT count(*) AS count FROM auth_sessions").first()).count, 1);
});

test("web login validates credentials without Access and all cookie writes require same-origin CSRF", async () => {
  await owner();
  assert.equal((await login({ value: "Wrong synthetic password" })).status, 401);
  assert.equal((await request("/api/login", { method: "POST", body: { email: "someone@example.test", password } })).status, 401);
  assert.equal((await login({ origin: "https://attacker.test" })).status, 403);
  const response = await login();
  assert.equal(response.status, 200);
  const cookie = response.headers.get("Set-Cookie").split(";")[0], session = await response.json();
  assert.deepEqual(await (await request("/api/session", { cookie })).json(), session);
  const data = { revision: 0, state: emptyState() };
  assert.equal((await request("/api/workspace", { method: "PUT", body: data, cookie })).status, 403);
  assert.equal((await request("/api/workspace", { method: "PUT", body: data, cookie, csrf: session.csrf, origin: "https://attacker.test" })).status, 403);
  assert.equal((await request("/api/workspace", { method: "PUT", body: data, cookie, csrf: session.csrf })).status, 200);
  assert.equal((await request("/app.js", { cookie })).status, 200);
  const stored = await DB.prepare("SELECT token_hash FROM auth_sessions WHERE token_hash=?").bind(await tokenHash(cookie.split("=")[1])).first();
  assert(stored && !cookie.includes(stored.token_hash));
});

test("the extension gets a separate revocable bearer without cookies or an open CRM tab", async () => {
  const web = await owner();
  const response = await login({ extension: true, origin: "chrome-extension://" + "a".repeat(32) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.has("Set-Cookie"), false);
  assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
  const session = await response.json();
  assert.match(session.token, /^[a-f0-9]{64}$/);
  assert.equal((await request("/api/session", { bearer: session.token, origin: null })).status, 200);
  assert.equal((await request("/api/workspace", { method: "PUT", body: { revision: 0, state: emptyState() }, bearer: session.token, origin: null })).status, 200);
  const noOrigin = await login({ extension: true, origin: null });
  assert.equal(noOrigin.status, 200, "Privileged extension fetches may omit Origin.");
  assert.equal((await login({ extension: true, origin: "https://attacker.test" })).status, 403);
  assert.equal((await request("/api/login", { method: "POST", body: { email, password, client: "extension" }, origin: null })).status, 403);
  const logout = await request("/api/logout", { method: "POST", bearer: session.token, origin: null });
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.has("Set-Cookie"), false);
  assert.equal((await request("/api/session", { bearer: session.token })).status, 401);
  assert.equal((await request("/api/session", { cookie: web.cookie })).status, 200, "Logging out of the extension does not revoke a different web session.");
});

test("invalid, expired and wrong-kind bearer credentials never fall through to a valid cookie", async () => {
  const web = await owner();
  const session = await (await login({ extension: true, origin: null })).json();
  const webToken = web.cookie.split("=")[1];
  assert.equal((await request("/api/session", { cookie: web.cookie, bearer: "0".repeat(64) })).status, 401);
  assert.equal((await request("/api/session", { bearer: webToken })).status, 401);
  assert.equal((await request("/api/session", { cookie: "__Host-nexo_session=" + session.token })).status, 401);
  await DB.prepare("UPDATE auth_sessions SET expires=1 WHERE token_hash=?").bind(await tokenHash(session.token)).run();
  assert.equal((await request("/api/session", { cookie: web.cookie, bearer: session.token })).status, 401);
  const logout = await request("/api/logout", { method: "POST", cookie: web.cookie, csrf: web.csrf });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal((await request("/api/session", { cookie: web.cookie })).status, 401);
});

test("a password change revokes web and extension sessions and rejects old verified session versions", async () => {
  const web = await owner(), extension = await (await login({ extension: true, origin: null })).json();
  const next = "New independent synthetic password 2!";
  assert.equal((await request("/api/password", { method: "POST", cookie: web.cookie, csrf: web.csrf, body: { current: "Incorrect", next } })).status, 403);
  assert.equal((await request("/api/session", { bearer: extension.token })).status, 200);
  const changed = await request("/api/password", { method: "POST", cookie: web.cookie, csrf: web.csrf, body: { current: password, next } });
  assert.equal(changed.status, 200, await changed.clone().text());
  assert.equal((await request("/api/session", { cookie: web.cookie })).status, 401);
  assert.equal((await request("/api/session", { bearer: extension.token })).status, 401);
  assert.equal((await login()).status, 401);
  assert.equal((await login({ value: next })).status, 200);
  const stale = "f".repeat(64), now = Math.floor(Date.now() / 1000);
  await DB.prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?,?,?)").bind(await tokenHash(stale), email, "stale-csrf", "extension", 1, now + 100, now).run();
  assert.equal((await request("/api/session", { bearer: stale })).status, 401, "Even a concurrent insertion with an old owner version stays revoked.");
});

test("a login that already verified the old password cannot mint a session after a concurrent password change", async () => {
  const web = await owner();
  let enterInsert, releaseInsert;
  const entered = new Promise(resolve => { enterInsert = resolve; });
  const release = new Promise(resolve => { releaseInsert = resolve; });
  const wrap = statement => ({
    bind(...values) { return wrap(statement.bind(...values)); },
    async first(...args) { enterInsert(); await release; return statement.first(...args); },
  });
  const guardedDB = { prepare(sql) {
    const statement = DB.prepare(sql);
    return sql.startsWith("INSERT INTO auth_sessions(") ? wrap(statement) : statement;
  } };
  const pending = nativePublicRequest(new Request("https://crm.test/api/login", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Nexo-Client": "extension", "CF-Connecting-IP": "192.0.2.50" },
    body: JSON.stringify({ email, password, client: "extension" }),
  }), { DB: guardedDB, OWNER_EMAIL: email, AUTH_PASSWORD_PEPPER: pepper });
  await entered;
  const changed = await request("/api/password", { method: "POST", cookie: web.cookie, csrf: web.csrf, body: { current: password, next: "Another synthetic password after race!" } });
  assert.equal(changed.status, 200, await changed.clone().text());
  releaseInsert();
  const response = await pending;
  assert.equal(response.status, 401, await response.clone().text());
  assert.equal(Object.hasOwn(await response.json(), "token"), false);
  assert.equal((await DB.prepare("SELECT count(*) AS count FROM auth_sessions").first()).count, 0);
});

test("login attempt counters are atomic, bound IP rows and reject oversized or non-JSON authentication", async () => {
  await owner();
  const now = Math.floor(Date.now() / 1000), start = Math.floor(now / 900) * 900;
  const bucket = "login:ip:" + await tokenHash("192.0.2.1");
  await DB.prepare("INSERT INTO auth_attempts VALUES(?,?,?)").bind(bucket, start, 9).run();
  const raced = await Promise.all([login({ value: "incorrect" }), login({ value: "incorrect" })]);
  assert.deepEqual(raced.map(response => response.status).sort(), [401, 429]);
  await DB.prepare("UPDATE auth_attempts SET attempts=200 WHERE bucket='login:global'").run();
  assert.equal((await login({ ip: "192.0.2.200", value: "incorrect" })).status, 429);
  assert.equal((await DB.prepare("SELECT count(*) AS count FROM auth_attempts WHERE bucket LIKE 'login:ip:%'").first()).count, 1);
  const oversized = await request("/api/login", { method: "POST", body: { email, password: "x".repeat(9000) } });
  assert.equal(oversized.status, 413);
  const plain = await mf.dispatchFetch("https://crm.test/api/login", { method: "POST", headers: { Origin: "https://crm.test", "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(plain.status, 400);
});
