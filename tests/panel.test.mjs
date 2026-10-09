import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { handlePanel } from "../cloud/panel/index.mjs";
import { provisionOne } from "../cloud/panel/provision.mjs";
import { csrfToken } from "../cloud/auth.mjs";
import customer from "../cloud/panel/build/client.mjs";
const require = createRequire("/tmp/crm-cloud-tools/package.json");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "panel-test",
        modules: true,
        script: 'export default {fetch(){return new Response("ok")}}',
        d1Databases: { DB: "panel", A: "customer-a", B: "customer-b" },
      },
    ],
  }),
);
const DB = await mf.getD1Database("DB");
await DB.exec(
  (
    await readFile(
      new URL("../cloud/panel/schema.sql", import.meta.url),
      "utf8",
    )
  ).replace(/\n/g, " "),
);
const env = {
  DB,
  PUBLIC_URL: "https://panel.example",
  OWNER_EMAIL: "admin@example.com",
  ACCESS_TEAM_DOMAIN: "panel-test.cloudflareaccess.com",
  ACCESS_AUD: "operator-aud",
  WORKERS_SUBDOMAIN: "example",
  ACCOUNT_ID: "a".repeat(32),
  PANEL_WORKER_NAME: "nexo-retail-panel",
  PIN_PROVIDER_ID: "pin",
  RETAIL_PROVISION_TOKEN: "test-only-not-a-real-provider-key",
  ASSETS: {
    fetch: async () =>
      new Response("<html>Panel</html>", {
        headers: { "Content-Type": "text/html" },
      }),
  },
};
const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const jwk = {
  ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
  kid: "panel-key",
  use: "sig",
};
const certificates = async () => Response.json({ keys: [jwk] });
async function token(
  email = env.OWNER_EMAIL,
  aud = env.ACCESS_AUD,
  extra = {},
) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const text =
    encode({ alg: "RS256", kid: "panel-key" }) +
    "." +
    encode({
      iss: "https://" + env.ACCESS_TEAM_DOMAIN,
      aud: [aud],
      email,
      exp: Date.now() / 1000 + 3600,
      iat: Math.floor(Date.now() / 1000),
      ...extra,
    });
  return (
    text +
    "." +
    Buffer.from(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        keys.privateKey,
        new TextEncoder().encode(text),
      ),
    ).toString("base64url")
  );
}
const jwt = await token(),
  csrf = await csrfToken(jwt);
function request(path, method = "GET", data, headers = {}) {
  return new Request(env.PUBLIC_URL + path, {
    method,
    headers: {
      "Cf-Access-Jwt-Assertion": jwt,
      "Content-Type": "application/json",
      Origin: env.PUBLIC_URL,
      "X-CSRF-Token": csrf,
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
const call = (path, method, data, headers) =>
  handlePanel(request(path, method, data, headers), env, {
    fetcher: certificates,
  });
const rows = [],
  uploads = [],
  queries = [],
  apps = [],
  databases = [],
  scripts = [];
let queryIndex = 0;
const tenantDBs = [await mf.getD1Database("A"), await mf.getD1Database("B")];
async function fakeCloud(url, options) {
  const path = new URL(url).pathname.replace(
    "/client/v4/accounts/" + env.ACCOUNT_ID,
    "",
  );
  let result;
  if (options.method === "GET")
    result = path.startsWith("/d1/")
      ? databases
      : path.startsWith("/access/")
        ? apps
        : scripts;
  else if (path === "/d1/database") {
    const input = JSON.parse(options.body);
    result = { uuid: "db-" + databases.length, name: input.name };
    databases.push(result);
  } else if (path.endsWith("/query")) {
    const input = JSON.parse(options.body);
    queries.push(input);
    const db = tenantDBs[Number(path.match(/db-(\d)/)[1])];
    if (input.params)
      await db
        .prepare(input.sql)
        .bind(...input.params)
        .run();
    else await db.exec(input.sql.replace(/\n/g, " "));
    result = [{ success: true }];
  } else if (path === "/access/apps") {
    const input = JSON.parse(options.body);
    result = { ...input, id: "app-" + apps.length, aud: "aud-" + apps.length };
    apps.push(result);
  } else if (options.body instanceof FormData) {
    const metadata = JSON.parse(options.body.get("metadata"));
    uploads.push({ path, metadata });
    result = { id: path.split("/").pop() };
    if (!scripts.some((s) => s.id === result.id)) scripts.push(result);
  } else result = {};
  return Response.json({ success: true, result });
}
test("Panel authenticates owner signature/audience, origin and CSRF, and never exposes registry to customers", async () => {
  assert.equal(
    (
      await handlePanel(new Request(env.PUBLIC_URL + "/api/instances"), env, {
        fetcher: certificates,
      })
    ).status,
    401,
  );
  for (const wrong of [
    await token("other@example.com"),
    await token(env.OWNER_EMAIL, "customer-aud"),
  ])
    assert.equal(
      (
        await call("/api/instances", "GET", undefined, {
          "Cf-Access-Jwt-Assertion": wrong,
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await call(
        "/api/instances",
        "POST",
        {},
        { Origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/instances", "POST", {}, { "X-CSRF-Token": "wrong" }))
      .status,
    403,
  );
  assert.equal((await call("/api/workspace")).status, 404);
  assert.equal(
    (await handlePanel(new Request("https://other.example/"), env)).status,
    404,
  );
  assert.equal(
    (
      await handlePanel(request("/"), {
        ...env,
        ACCESS_AUD: "not-configured-closed",
      })
    ).status,
    503,
  );
  assert.equal((await call("/")).headers.get("Content-Type"), "text/html");
  assert.equal(
    (await call("/api/instances", "POST", {}, undefined)).status,
    400,
  );
  assert.equal(
    (
      await handlePanel(
        request("/api/instances", "POST", {}),
        { ...env, RETAIL_PROVISION_TOKEN: "" },
        { fetcher: certificates },
      )
    ).status,
    503,
  );
});
test("Two queued CRMs publish with independent D1, owner-only Access, locked first upload and no original data/keys", async () => {
  for (const slug of ["alpha", "beta"]) {
    const response = await call("/api/instances", "POST", {
      name: slug,
      slug,
      ownerEmail: slug + "@example.com",
      crmName: slug + " CRM",
      business: slug,
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.queued, true);
    assert.equal(result.instance.url, null);
    rows.push(result.instance);
  }
  assert.equal(
    (
      await call("/api/instances", "POST", {
        name: "dup",
        slug: "alpha",
        ownerEmail: "x@example.com",
      })
    ).status,
    409,
  );
  for (let i = 0; i < 2; i++)
    assert.deepEqual(await provisionOne(env, { fetcher: fakeCloud }), {
      configured: true,
      processed: 1,
    });
  assert.notEqual(databases[0].uuid, databases[1].uuid);
  assert.notEqual(databases[0].name, databases[1].name);
  assert.equal(uploads.length, 4);
  for (let i = 0; i < 2; i++) {
    const binding = uploads[i * 2].metadata.bindings;
    assert.equal(
      binding.find((b) => b.name === "ACCESS_AUD").text,
      "not-configured-closed",
    );
    assert.equal(
      uploads[i * 2 + 1].metadata.bindings.find((b) => b.name === "ACCESS_AUD")
        .text,
      apps[i].aud,
    );
    assert.deepEqual(apps[i].policies[0].include, [
      { email: { email: binding.find((b) => b.name === "OWNER_EMAIL").text } },
    ]);
    assert.equal(
      binding.find((b) => b.name === "CONTROL").service,
      "nexo-retail-panel",
    );
    assert(
      !binding.some((b) =>
        [
          "RETAIL_PROVISION_TOKEN",
          "WHATSAPP_ACCESS_TOKEN",
          "RESEND_API_KEY",
        ].includes(b.name),
      ),
    );
    const state = JSON.parse(queries[i * 2 + 1].params[0]);
    for (const collection of ["clients", "accounts", "ledger"])
      assert.deepEqual(state[collection], []);
  }
  const listing = await (await call("/api/instances")).json();
  assert(
    listing.instances.every(
      (row) =>
        row.stage === "ready" &&
        row.status === "active" &&
        row.url.startsWith("https://crm-r-"),
    ),
  );
  assert(!JSON.stringify(listing).includes("lifecycle_secret"));
  assert(!JSON.stringify(listing).includes(env.RETAIL_PROVISION_TOKEN));
  const dbRows = (
    await DB.prepare("SELECT lifecycle_secret FROM instances").all()
  ).results;
  assert(dbRows.every((row) => row.lifecycle_secret === null));
});
test("Compiled customer Worker isolates actual workspace and rejects operator/other-customer JWT; suspension invalidates previous login", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = certificates;
  try {
    const byId = new Map(
      (await DB.prepare("SELECT * FROM instances").all()).results.map((row) => [
        row.worker_name,
        row,
      ]),
    );
    const rowA = byId.get(databases[0].name),
      rowB = byId.get(databases[1].name);
    function tenantEnv(i, row) {
      const bindings = uploads[i * 2 + 1].metadata.bindings;
      return {
        DB: tenantDBs[i],
        OWNER_EMAIL: row.owner_email,
        ACCESS_AUD: apps[i].aud,
        ACCESS_TEAM_DOMAIN: env.ACCESS_TEAM_DOMAIN,
        INSTANCE_ID: row.id,
        LIFECYCLE_TOKEN: bindings.find((b) => b.name === "LIFECYCLE_TOKEN")
          .text,
        CONTROL: { fetch: (request) => handlePanel(request, env) },
      };
    }
    const a = tenantEnv(0, rowA),
      b = tenantEnv(1, rowB),
      tokenA = await token(a.OWNER_EMAIL, a.ACCESS_AUD),
      tokenB = await token(b.OWNER_EMAIL, b.ACCESS_AUD);
    const req = (
      worker,
      tok,
      path = "/api/workspace",
      method = "GET",
      body,
      csrfValue = "",
    ) =>
      new Request(`https://${worker}.example.workers.dev${path}`, {
        method,
        headers: {
          "Cf-Access-Jwt-Assertion": tok,
          "Content-Type": "application/json",
          Origin: `https://${worker}.example.workers.dev`,
          "X-CSRF-Token": csrfValue,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    const state = await (
      await customer.fetch(req(rowA.worker_name, tokenA), a, {})
    ).json();
    state.state.settings.business = "Private Alpha";
    assert.equal(
      (
        await customer.fetch(
          req(
            rowA.worker_name,
            tokenA,
            "/api/workspace",
            "PUT",
            state,
            await csrfToken(tokenA),
          ),
          a,
          {},
        )
      ).status,
      200,
    );
    const beta = await (
      await customer.fetch(req(rowB.worker_name, tokenB), b, {})
    ).json();
    assert.notEqual(beta.state.settings.business, "Private Alpha");
    assert.equal(
      (await customer.fetch(req(rowB.worker_name, tokenA), b, {})).status,
      401,
    );
    assert.equal(
      (await customer.fetch(req(rowA.worker_name, jwt), a, {})).status,
      401,
    );
    assert.equal(
      (
        await call(`/api/instances/${rowA.id}`, "PATCH", {
          status: "suspended",
        })
      ).status,
      200,
    );
    assert.equal(
      (await customer.fetch(req(rowA.worker_name, tokenA, "/app.js"), a, {}))
        .status,
      403,
    );
    assert.equal(
      (await customer.fetch(req(rowB.worker_name, tokenB), b, {})).status,
      200,
    );
    assert.equal(
      (await call(`/api/instances/${rowA.id}`, "PATCH", { status: "active" }))
        .status,
      200,
    );
    assert.equal(
      (await customer.fetch(req(rowA.worker_name, tokenA), a, {})).status,
      403,
    );
    const after = (
      await DB.prepare("SELECT session_after FROM instances WHERE id=?")
        .bind(rowA.id)
        .first()
    ).session_after;
    const fresh = await token(a.OWNER_EMAIL, a.ACCESS_AUD, { iat: after + 1 });
    assert.equal(
      (await customer.fetch(req(rowA.worker_name, fresh), a, {})).status,
      200,
    );
    const wrong = new Request(`https://control.internal/lifecycle/${rowB.id}`, {
      headers: { Authorization: "Bearer " + a.LIFECYCLE_TOKEN },
    });
    assert.equal((await handlePanel(wrong, env)).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("Ambiguous provider failures retain checkpoints and never retry automatically", async () => {
  const response = await call("/api/instances", "POST", {
    name: "Failed",
    slug: "failure",
    ownerEmail: "failure@example.com",
  });
  assert.equal(response.status, 201);
  let count = 0;
  const failure = async () => {
    count++;
    return new Response("provider error", { status: 503 });
  };
  assert((await provisionOne(env, { fetcher: failure })).failed);
  assert.equal((await provisionOne(env, { fetcher: failure })).processed, 0);
  assert.equal(count, 1);
  const row = await DB.prepare(
    "SELECT stage,status,error FROM instances WHERE slug='failure'",
  ).first();
  assert.equal(row.stage, "failed");
  assert.equal(row.status, "pending");
  assert(!row.error.includes(env.RETAIL_PROVISION_TOKEN));
});
test.after(() => mf.dispose());
