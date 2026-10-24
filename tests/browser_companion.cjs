const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const { emptyState } = await import("../cloud/state.mjs");
  const state = emptyState();
  state.accounts = [{ id: "netflix-test", service: "Netflix", email: "fixture@example.com", password: "fixture-access-only", provider: "", expires: "2099-12-31", capacity: 2 }];
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.addInitScript((initial) => {
      window.__remoteState = initial;
      window.__remoteRevision = 0;
      window.__chat = { name: "Ana", phone: "51912345678", chatId: "chat-ana", isGroup: false, tabId: 7 };
      window.NexoCompanion = {
        loginUrl: "https://companion.test/login.html",
        getContext: async () => structuredClone(window.__chat),
        bindConversation: async ({ phone, chatId }) => {
          if (chatId !== window.__chat.chatId) throw Error("Chat cambiado");
          window.__chat.phone = phone;
          return structuredClone(window.__chat);
        },
        captureVisibleMessages: async () => [{ id: "visible-one", body: "Hola, quiero Netflix", direction: "received", phone: window.__chat.phone, chatId: window.__chat.chatId }],
        prepareMessage: async (value) => {
          if (value.phone !== window.__chat.phone) throw Error("El destinatario cambió");
          if (window.__prepareClipboard) return { prepared: false, clipboard: true, reason: "existing-draft" };
          window.__prepared = value;
          return { prepared: true };
        },
        fetch: async (route, options = {}) => {
          if (route === "/api/session") return Response.json({ mode: "server", authProvider: "cloudflare-access", email: "fixture@example.com", csrf: "fixture-csrf" });
          if (route === "/api/workspace") {
            if (options.method === "PUT") {
              const input = JSON.parse(options.body);
              if (input.revision !== window.__remoteRevision) return Response.json({ error: "Datos cambiaron" }, { status: 409 });
              window.__remoteState = input.state;
              window.__remoteRevision++;
              return Response.json({ revision: window.__remoteRevision });
            }
            return Response.json({ state: window.__remoteState, revision: window.__remoteRevision });
          }
          if (route === "/api/automation-status") return Response.json({ configured: false, reminders: [], worker: null });
          if (route === "/api/report-status") return Response.json({ configured: false, recent: [] });
          if (route === "/api/message-tasks") return Response.json({ tasks: [], configured: false });
          return Response.json({ error: "Ruta no esperada" }, { status: 404 });
        },
      };
    }, state);
    const root = path.resolve(__dirname, "..");
    await page.route("https://companion.test/**", (route) => {
      const url = new URL(route.request().url());
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
      let body = fs.readFileSync(file);
      if (relative === "index.html") body = Buffer.from(body.toString().replace("<head>", '<head><meta name="crm-backend" content="required">'));
      const ext = path.extname(relative);
      const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
      return route.fulfill({ body, contentType: types[ext] || "application/octet-stream" });
    });
    await page.goto("https://companion.test/");
    await page.locator("#companion-workspace").waitFor();
    await page.locator("#companion-new-client").click();
    assert.equal(await page.locator('#client-form [name="name"]').inputValue(), "Ana");
    assert.equal(await page.locator('#client-form [name="phone"]').inputValue(), "51912345678");
    await page.locator("#client-account").selectOption("netflix-test");
    await page.locator('#client-form [name="expires"]').fill("2099-10-24");
    await page.locator('#client-form [name="price"]').fill("20.00");
    await page.locator('#client-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector("#client-dialog").open);
    const created = await page.evaluate(() => window.__remoteState.clients[0]);
    assert.equal(created.accountId, "netflix-test");
    assert.equal(created.profile, "Perfil 1");
    assert.equal(await page.evaluate(() => window.__remoteState.ledger.length), 1);
    await page.locator("#companion-compose").click();
    await page.locator("#message-template").selectOption("password");
    await page.locator("#open-whatsapp").click();
    await page.waitForFunction(() => !!window.__prepared);
    const draft = await page.evaluate(() => window.__prepared);
    assert.equal(draft.phone, "51912345678");
    assert.match(draft.text, /fixture-access-only/);
    await page.evaluate(() => { window.__prepareClipboard = true; });
    await page.locator("#open-whatsapp").click();
    assert.match(await page.locator("#message-error").innerText(), /Texto copiado.*Pégalo manualmente/);
    await page.evaluate(() => { window.__prepareClipboard = false; });
    await page.locator("#message-dialog .close").first().click();
    await page.locator("#companion-capture").click();
    await page.waitForFunction(() => window.__remoteState.growth.interactions.length === 1);
    await page.locator("#companion-capture").click();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__remoteState.growth.interactions.length), 1);
    await page.locator("#companion-renew").click();
    await page.locator('#renew-form').getByRole("button", { name: "Confirmar renovación", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#renew-dialog").open);
    assert.equal(await page.evaluate(() => window.__remoteState.ledger.length), 2);
    await page.locator("#companion-new-client").click();
    await page.locator("#client-account").selectOption("netflix-test");
    await page.locator('#client-form [name="expires"]').fill("2099-10-24");
    await page.locator('#client-form button[type="submit"]').click();
    await page.waitForFunction(() => window.__remoteState.clients.length === 2);
    await page.locator("#companion-client").selectOption(created.id);
    await page.locator("#companion-auto-capture").check();
    await page.waitForTimeout(100);
    await page.evaluate(() => document.querySelector('nav [data-view="customers"]').click());
    await page.locator("#clients tr").first().getByRole("button", { name: "Eliminar", exact: true }).click();
    await page.waitForFunction((oldId) => window.__remoteState.clients.length === 1 && document.querySelector("#companion-client").value !== oldId, created.id);
    assert.equal(await page.locator("#companion-auto-capture").isChecked(), false);
    assert.notEqual(await page.locator("#companion-client").inputValue(), created.id);
    await page.locator("#companion-compose").click();
    await page.evaluate(() => { window.__chat.phone = "51987654321"; });
    await page.locator("#open-whatsapp").click();
    assert.match(await page.locator("#message-error").innerText(), /destinatario cambió/);
    await page.locator("#message-dialog .close").first().click();
    await page.evaluate(() => {
      window.__chat = { name: "Bob", phone: "51987654321", chatId: "chat-bob", isGroup: false, tabId: 7 };
      document.querySelector("#companion-new-client").click();
    });
    await page.waitForFunction(() => document.querySelector("#companion-status").textContent.includes("conversación cambió"));
    assert.equal(await page.locator("#client-dialog").evaluate((dialog) => dialog.open), false);
    assert.deepEqual(errors, []);
    console.log("Companion browser: full CRM sale/profile/payment, delivery draft, visible conversation dedupe, renewal and recipient mismatch verified at 390px.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
