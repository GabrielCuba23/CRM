import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { authenticate, csrfToken } from "../cloud/auth.mjs";
import { handleRequest, processDue, sendMeta } from "../cloud/index.mjs";
import { emptyState } from "../cloud/state.mjs";
const require = createRequire("/tmp/crm-cloud-tools/package.json");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const env = {
  OWNER_EMAIL: "owner@example.com",
  ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
  ACCESS_AUD: "test-aud",
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
  kid: "test-key",
  use: "sig",
};
const encode = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function token(overrides = {}) {
  const text =
    encode({ alg: "RS256", kid: "test-key" }) +
    "." +
    encode({
      iss: "https://" + env.ACCESS_TEAM_DOMAIN,
      aud: [env.ACCESS_AUD],
      email: env.OWNER_EMAIL,
      exp: Date.now() / 1000 + 3600,
      ...overrides,
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
  csrf = await csrfToken(jwt),
  fetcher = async () => Response.json({ keys: [jwk] });
function request(path, method = "GET", body, headers = {}) {
  return new Request("https://crm.example" + path, {
    method,
    headers: {
      "Cf-Access-Jwt-Assertion": jwt,
      "Content-Type": "application/json",
      Origin: "https://crm.example",
      "X-CSRF-Token": csrf,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "test",
        modules: true,
        script: 'export default {fetch(){return new Response("ok")}}',
        d1Databases: { DB: "nexo-test" },
      },
    ],
  }),
);
const DB = await mf.getD1Database("DB");
await DB.exec(
  (
    await readFile(new URL("../cloud/schema.sql", import.meta.url), "utf8")
  ).replace(/\n/g, " "),
);
env.DB = DB;
env.ASSETS = {
  fetch: async () => new Response("<head></head><main>CRM</main>"),
};
async function save(state, revision = 0) {
  return handleRequest(
    request("/api/workspace", "PUT", { state, revision }),
    env,
    { fetcher },
  );
}
test("Access validates signatures, owner, audience, issuer and expiry", async () => {
  assert.equal(
    (await authenticate(request("/"), env, { fetcher })).email,
    env.OWNER_EMAIL,
  );
  for (const claims of [
    { email: "other@example.com" },
    { aud: ["wrong"] },
    { iss: "https://wrong.cloudflareaccess.com" },
    { exp: 1 },
  ]) {
    await assert.rejects(
      authenticate(
        request("/", "GET", undefined, {
          "Cf-Access-Jwt-Assertion": await token(claims),
        }),
        env,
        { fetcher },
      ),
    );
  }
  const parts = jwt.split(".");
  parts[1] = encode({
    iss: "https://" + env.ACCESS_TEAM_DOMAIN,
    aud: [env.ACCESS_AUD],
    email: env.OWNER_EMAIL,
    exp: Date.now() / 1000 + 3600,
    name: "forged",
  });
  await assert.rejects(
    authenticate(
      request("/", "GET", undefined, {
        "Cf-Access-Jwt-Assertion": parts.join("."),
      }),
      env,
      { fetcher },
    ),
  );
  assert.equal(
    (await handleRequest(new Request("https://crm.example/"), env, { fetcher }))
      .status,
    401,
  );
  assert.equal(
    (await handleRequest(request("/"), { ...env, ACCESS_AUD: "" }, { fetcher }))
      .status,
    503,
  );
});
test("Private workspace persists in D1, rejects stale updates and CSRF, strips unknown secrets", async () => {
  const state = emptyState();
  state.settings.secret = "not-stored";
  assert.equal((await save(state)).status, 200);
  assert.equal((await save(state)).status, 409);
  assert.equal(
    (
      await handleRequest(
        request(
          "/api/workspace",
          "PUT",
          { state, revision: 1 },
          { Origin: "https://attacker.example" },
        ),
        env,
        { fetcher },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleRequest(
        request(
          "/api/workspace",
          "PUT",
          { state, revision: 1 },
          { "X-CSRF-Token": "wrong" },
        ),
        env,
        { fetcher },
      )
    ).status,
    403,
  );
  const data = await (
    await handleRequest(request("/api/workspace"), env, { fetcher })
  ).json();
  assert.equal(data.revision, 1);
  assert.equal(data.state.settings.secret, undefined);
  const html = await (
    await handleRequest(request("/"), env, { fetcher })
  ).text();
  assert(html.includes("crm-backend"));
  assert.equal(
    (await handleRequest(request("/cloud/schema.sql"), env, { fetcher }))
      .status,
    404,
  );
  assert.equal(
    (
      await (
        await handleRequest(request("/api/session"), env, { fetcher })
      ).json()
    ).authProvider,
    "cloudflare-access",
  );
});
test("Cron sends only consenting clients at three days, caps batches and deduplicates concurrent jobs", async () => {
  const state = emptyState();
  state.automation = {
    enabled: true,
    templateName: "renewal",
    language: "es",
    parameters: ["nombre", "servicio", "vence"],
    hour: 9,
  };
  state.clients = Array.from({ length: 12 }, (_, i) => ({
    email: "",
    profile: "",
    notes: "",
    accountId: "",
    pin: "",
    price: 0,
    id: "c" + i,
    name: "Cliente " + i,
    phone: "987654321",
    service: "Max",
    expires: "2026-10-09",
    reminderConsent: true,
  }));
  state.clients.push({
    ...state.clients[0],
    id: "no-consent",
    reminderConsent: false,
  });
  assert.equal((await save(state, 1)).status, 200);
  const automated = {
    ...env,
    WHATSAPP_ACCESS_TOKEN: "mock-test-token",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  };
  let calls = 0;
  const sender = async (message) => {
    calls++;
    assert.equal(message.to, "51987654321");
    return { state: "accepted", provider_id: "mock-" + calls };
  };
  assert.equal(
    await processDue(automated, {
      now: new Date("2026-10-06T13:00:00Z"),
      sender,
    }),
    0,
  );
  await Promise.all([
    processDue(automated, { now: new Date("2026-10-06T14:00:00Z"), sender }),
    processDue(automated, { now: new Date("2026-10-06T14:00:00Z"), sender }),
  ]);
  assert.equal(calls, 10);
  await processDue(automated, {
    now: new Date("2026-10-06T15:00:00Z"),
    sender,
  });
  assert.equal(calls, 12);
  await processDue(automated, {
    now: new Date("2026-10-06T16:00:00Z"),
    sender,
  });
  assert.equal(calls, 12);
  assert.equal(
    (await DB.prepare("SELECT count(*) n FROM reminders").first()).n,
    12,
  );
});
test("Meta rate limits can retry; ambiguous outcomes never automatically duplicate", async () => {
  assert.equal(
    (
      await sendMeta(
        {},
        { WHATSAPP_PHONE_NUMBER_ID: "123" },
        async () => new Response("", { status: 429 }),
      )
    ).state,
    "rate_limited",
  );
  assert.equal(
    (
      await sendMeta({}, { WHATSAPP_PHONE_NUMBER_ID: "123" }, async () => {
        throw Error("timeout");
      })
    ).state,
    "uncertain",
  );
  const state = emptyState();
  state.automation = {
    enabled: true,
    templateName: "renewal",
    language: "es",
    parameters: [],
    hour: 9,
  };
  state.clients = [
    {
      email: "",
      service: "Max",
      profile: "",
      notes: "",
      accountId: "",
      pin: "",
      price: 0,
      id: "ambiguous",
      name: "Cliente",
      phone: "987654321",
      expires: "2026-10-09",
      reminderConsent: true,
    },
  ];
  assert.equal((await save(state, 2)).status, 200);
  const automated = {
    ...env,
    WHATSAPP_ACCESS_TOKEN: "mock",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  };
  let calls = 0;
  const sender = async () => {
    calls++;
    throw Error("unknown");
  };
  await processDue(automated, {
    now: new Date("2026-10-06T14:00:00Z"),
    sender,
  });
  await processDue(automated, {
    now: new Date("2026-10-06T15:00:00Z"),
    sender,
  });
  assert.equal(calls, 1);
  assert.equal(
    (
      await DB.prepare(
        "SELECT state FROM reminders WHERE client_id='ambiguous'",
      ).first()
    ).state,
    "uncertain",
  );
});
test.after(async () => mf.dispose());
