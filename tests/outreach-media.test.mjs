import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tokenHash } from "../cloud/native-auth.mjs";
import { createMediaClient } from "../outreach-media-client.mjs";

const require = createRequire("/workspace/work/cloud-tools/package.json");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const { build } = require("esbuild");
const root = new URL("..", import.meta.url).pathname;
const email = "media-owner@example.test", password = "Synthetic media password 1!";
const origin = "https://media-crm.test", pepper = "Synthetic media testing pepper 012345678901234567890123456789";
const source = await build({
  stdin: { contents: `import {handleRequest} from './cloud/index.mjs'; export default {fetch(request,env){return handleRequest(request,{...env,ASSETS:{fetch:async()=>new Response('Private asset')}});}};`, resolveDir: root },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", logLevel: "silent",
});
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
  name: "outreach-media-test", modules: true, compatibilityDate: "2026-10-01", script: source.outputFiles[0].text,
  d1Databases: { DB: "outreach-media-test-database" },
  bindings: { OWNER_EMAIL: email, AUTH_MODE: "password", AUTH_PASSWORD_PEPPER: pepper },
}] }));
const DB = await mf.getD1Database("DB");
await DB.exec((await readFile(new URL("../cloud/schema.sql", import.meta.url), "utf8")).replace(/\n/g, " "));
test.after(() => mf.dispose());
let ownerCookie, ownerCsrf, bearer;
const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13);
const digest = async bytes => Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
async function request(path, { method = "GET", value, auth = true, csrf = true, extension = false, rawBody, headers = {} } = {}) {
  return mf.dispatchFetch(origin + path, {
    method, headers: {
      ...(extension ? { Authorization: "Bearer " + bearer, "X-Nexo-Client": "extension" } : { Origin: origin, ...(auth ? { Cookie: ownerCookie } : {}), ...(csrf ? { "X-CSRF-Token": ownerCsrf } : {}) }),
      ...((value !== undefined || rawBody !== undefined) ? { "Content-Type": "application/json" } : {}),
      "CF-Connecting-IP": "192.0.2.50", ...headers,
    }, body: rawBody === undefined ? value === undefined ? undefined : JSON.stringify(value) : rawBody,
  });
}
async function data(response, expected = 200) {
  const value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  return value;
}
async function init(bytes = png, extras = {}) {
  return data(await request("/api/outreach/media", { method: "POST", value: { name: "Foto de prueba.png", type: "image/png", size: bytes.length, sha256: await digest(bytes), ...extras } }), 201);
}
async function put(id, part, bytes, expected = 200) {
  return data(await request(`/api/outreach/media/${id}/chunks/${part}`, { method: "PUT", value: { data: Buffer.from(bytes).toString("base64") } }), expected);
}
async function complete(id, expected = 200) { return data(await request(`/api/outreach/media/${id}/complete`, { method: "POST", value: {} }), expected); }
test.before(async () => {
  const invite = "a".repeat(64);
  await DB.prepare("INSERT INTO auth_setup(token_hash,email,expires) VALUES(?,?,?)").bind(await tokenHash(invite), email, Math.floor(Date.now() / 1000) + 3600).run();
  const setup = await mf.dispatchFetch(origin + "/api/setup", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email, password, token: invite }) });
  const session = await data(setup);
  ownerCookie = setup.headers.get("Set-Cookie").split(";")[0]; ownerCsrf = session.csrf;
  const login = await mf.dispatchFetch(origin + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Nexo-Client": "extension" }, body: JSON.stringify({ email, password, client: "extension" }) });
  bearer = (await data(login)).token;
});
test.beforeEach(async () => {
  await DB.batch([
    DB.prepare("DELETE FROM outreach_media_chunks"), DB.prepare("DELETE FROM outreach_media"), DB.prepare("DELETE FROM workspace"),
  ]);
});

test("media is owner-private and web writes require same-origin CSRF while native bearer works", async () => {
  const id = "a".repeat(32);
  for (const path of ["/api/outreach/media", `/api/outreach/media/${id}`, `/api/outreach/media/${id}/metadata`, `/api/outreach/media/${id}/chunks/0`])
    assert.equal((await request(path, { auth: false, csrf: false })).status, 401);
  assert.equal((await request("/api/outreach/media", { method: "POST", csrf: false, value: {} })).status, 403);
  assert.equal((await request("/api/outreach/media", { method: "POST", value: {}, headers: { Origin: "https://other.test" } })).status, 403);
  const native = await data(await request("/api/outreach/media", { extension: true }));
  assert.equal(native.usedBytes, 0);
  assert.equal(native.limits.chunkBytes, 524288);
  assert.equal((await request("/api/outreach/media/../../api/workspace")).headers.has("Access-Control-Allow-Origin"), false);
});

test("resumable chunks roundtrip photos in exact order and ready files cannot be overwritten", async () => {
  const bytes = new Uint8Array(524288 * 2 + 27); bytes.set(png); bytes[bytes.length - 1] = 77;
  const started = await init(bytes), id = started.media.id;
  assert.match(id, /^[a-f0-9]{32}$/); assert.equal(started.chunks, 3);
  assert.equal((await request(`/api/outreach/media/${id}/metadata`)).status, 404);
  await put(id, 2, bytes.subarray(1048576));
  await put(id, 0, bytes.subarray(0, 524288));
  await put(id, 0, bytes.subarray(0, 524288));
  await complete(id, 409);
  await put(id, 1, bytes.subarray(524288, 1048576));
  const saved = await complete(id);
  assert.equal(saved.status, "ready"); assert.equal(saved.media.sha256, await digest(bytes));
  assert.deepEqual((await complete(id)).media, saved.media, "Completing a ready upload is idempotent.");
  const list = await data(await request("/api/outreach/media"));
  assert.equal(list.media.length, 1); assert.equal(list.uploads.length, 0); assert.equal(list.usedBytes, bytes.length);
  const meta = await data(await request(`/api/outreach/media/${id}/metadata`)); assert.equal(meta.chunks, 3);
  const part = await data(await request(`/api/outreach/media/${id}/chunks/2`));
  assert.deepEqual(Buffer.from(part.data, "base64"), Buffer.from(bytes.subarray(1048576)));
  await put(id, 0, bytes.subarray(0, 524288), 409);
  const binary = await request(`/api/outreach/media/${id}`);
  assert.equal(binary.headers.get("Content-Type"), "image/png");
  assert.equal(binary.headers.get("Cache-Control"), "no-store");
  assert.match(binary.headers.get("Content-Disposition"), /^attachment;/);
  assert.equal(binary.headers.has("Access-Control-Allow-Origin"), false);
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from(bytes));
});

test("bad chunks, hashes and MIME signatures never become usable attachments", async () => {
  const { media } = await init();
  await put(media.id, 0, png.subarray(0, 8), 400);
  const malformed = await request(`/api/outreach/media/${media.id}/chunks/0`, { method: "PUT", value: { data: "!".repeat(16) } });
  assert.equal(malformed.status, 400);
  assert.equal((await request(`/api/outreach/media/${media.id}/chunks/01`, { method: "PUT", value: { data: "" } })).status, 400);
  const corrupt = png.slice(); corrupt[corrupt.length - 1]++;
  await put(media.id, 0, corrupt); await complete(media.id, 400);
  assert.equal((await request(`/api/outreach/media/${media.id}`)).status, 404);
  await put(media.id, 0, png); await complete(media.id);
  const renamed = await init(png, { name: "Wrong MP4.mp4", type: "video/mp4" });
  await put(renamed.media.id, 0, png); await complete(renamed.media.id, 400);
  assert.equal((await data(await request("/api/outreach/media"))).media.length, 1);
});

test("metadata and request bounds reject unsupported and oversized uploads", async () => {
  const valid = { name: "x.png", type: "image/png", size: png.length, sha256: await digest(png) };
  for (const change of [{ name: "../x.png" }, { name: "x\r\n.png" }, { type: "image/svg+xml" }, { size: 0 }, { size: 20971521 }, { sha256: "not-a-hash" }]) {
    const response = await request("/api/outreach/media", { method: "POST", value: { ...valid, ...change } });
    assert([400, 413].includes(response.status), JSON.stringify(change));
  }
  assert.equal((await request("/api/outreach/media", { method: "POST", rawBody: JSON.stringify({ ...valid, padding: "x".repeat(10000) }) })).status, 413);
  assert.equal((await data(await request("/api/outreach/media"))).usedBytes, 0);
});

test("file quota reservations are atomic and explicit deletion frees space", async () => {
  const hash = await digest(png), size = 20971520;
  await DB.batch(Array.from({ length: 9 }, (_, index) => DB.prepare("INSERT INTO outreach_media(id,name,type,size,sha256,state,created) VALUES(?,?,?,?,?,'uploading',0)").bind(String(index).padStart(32, "0"), "Reserved.png", "image/png", size, hash)));
  const value = { name: "Racing upload.png", type: "image/png", size, sha256: hash };
  const responses = await Promise.all([request("/api/outreach/media", { method: "POST", value }), request("/api/outreach/media", { method: "POST", value })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const state = await data(await request("/api/outreach/media")); assert.equal(state.usedBytes, 209715200);
  assert.equal(state.uploads.length, 10);
  const removed = state.uploads[0].id;
  await data(await request(`/api/outreach/media/${removed}`, { method: "DELETE" }));
  assert.equal((await request("/api/outreach/media", { method: "POST", value })).status, 201);
});

test("maximum-size video validates with streamed native hashing instead of buffering all D1 rows", async () => {
  const bytes = new Uint8Array(20971520); bytes.set([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  bytes[bytes.length - 1] = 17;
  const started = await init(bytes, { name: "Synthetic large video.mp4", type: "video/mp4" });
  assert.equal(started.chunks, 40);
  for (let part = 0; part < 40; part++) await put(started.media.id, part, bytes.subarray(part * 524288, (part + 1) * 524288));
  const saved = await complete(started.media.id);
  assert.equal(saved.media.size, bytes.length); assert.equal(saved.media.sha256, await digest(bytes));
});

test("referenced campaign media is protected from deletion and validation leases can be recovered", async () => {
  const started = await init(); await put(started.media.id, 0, png);
  await DB.prepare("UPDATE outreach_media SET state='validating',lease='old',validation_started=1 WHERE id=?").bind(started.media.id).run();
  await complete(started.media.id);
  await DB.prepare("INSERT INTO workspace(id,revision,body) VALUES(1,1,?)").bind(JSON.stringify({ growth: { outreach: { campaigns: [{ media: [started.media] }] } } })).run();
  assert.equal((await request(`/api/outreach/media/${started.media.id}`, { method: "DELETE" })).status, 409);
  assert.equal((await request(`/api/outreach/media/${started.media.id}/metadata`)).status, 200);
  await DB.prepare("DELETE FROM workspace").run();
  await data(await request(`/api/outreach/media/${started.media.id}`, { method: "DELETE" }));
  assert.equal((await request(`/api/outreach/media/${started.media.id}/metadata`)).status, 404);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM outreach_media_chunks").first()).count, 0);
});

test("shared media client uploads, previews/downloads, and cancels without putting bytes in workspace", async () => {
  const progress = [], client = createMediaClient((path, options = {}) => request(path, { method: options.method, rawBody: options.body }));
  const file = new File([png], "Client.png", { type: "image/png" });
  const saved = await client.uploadMedia(file, { onProgress: value => progress.push(value) });
  assert.deepEqual(progress, [0, 95, 100]);
  assert.equal((await client.listMedia()).media.length, 1);
  const copy = await client.downloadMedia(saved.id);
  assert.equal(copy.name, file.name); assert.equal(copy.type, file.type);
  assert.deepEqual(Buffer.from(await copy.arrayBuffer()), Buffer.from(png));
  const controller = new AbortController();
  await assert.rejects(client.uploadMedia(file, { signal: controller.signal, onProgress: value => { if (value === 95) controller.abort(); } }), /cancelada/i);
  const remaining = await client.listMedia();
  assert.equal(remaining.media.length, 1); assert.equal(remaining.uploads.length, 0);
  await client.deleteMedia(saved.id);
  assert.equal((await client.listMedia()).media.length, 0);
});
