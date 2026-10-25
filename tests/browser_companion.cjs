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
      window.__companionVisible = true;
      window.NexoCompanion = {
        loginUrl: "https://companion.test/login.html",
        isVisible: () => window.__companionVisible,
        getContext: async () => structuredClone(window.__chat),
        bindConversation: async ({ phone, chatId }) => {
          if (chatId !== window.__chat.chatId) throw Error("Chat cambiado");
          window.__chat.phone = phone;
          return structuredClone(window.__chat);
        },
        captureVisibleMessages: async () => {
          const messages = structuredClone(window.__captureRows || [{ id: "visible-one", body: "Hola, quiero Netflix", direction: "received", phone: window.__chat.phone, chatId: window.__chat.chatId }]);
          if (window.__holdCapture) {
            window.__capturePending = true;
            await new Promise(resolve => { window.__releaseCapture = resolve; });
            window.__capturePending = false;
            window.__holdCapture = false;
          }
          return messages;
        },
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
    const beforeInterruptedCapture = await page.evaluate(() => {
      window.__holdCapture = true;
      window.__captureRows = [{ id: "visible-after-collapse", body: "Este mensaje no debe guardarse tras cerrar el panel", direction: "received", phone: window.__chat.phone, chatId: window.__chat.chatId }];
      return window.__remoteRevision;
    });
    await page.locator("#companion-capture").click();
    await page.waitForFunction(() => window.__capturePending === true);
    await page.evaluate(() => {
      window.__companionVisible = false;
      document.dispatchEvent(new CustomEvent("nexo-companion-visibility", { detail: { visible: false } }));
      // Reopening before the pending transport returns must not revive the
      // capture that belonged to the previous visible session.
      window.__companionVisible = true;
      document.dispatchEvent(new CustomEvent("nexo-companion-visibility", { detail: { visible: true } }));
      window.__releaseCapture();
    });
    await page.waitForFunction(() => document.querySelector("#companion-status").textContent.includes("La captura se detuvo al ocultar el panel"));
    assert.equal(await page.evaluate(() => window.NexoCompanion.isVisible()), true);
    assert.equal(await page.evaluate(() => window.__remoteRevision), beforeInterruptedCapture);
    assert.equal(await page.evaluate(() => window.__remoteState.growth.interactions.length), 1);
    assert.equal(await page.locator("#companion-auto-capture").isChecked(), false);
    await page.evaluate(() => { delete window.__captureRows; });
    await page.locator("#companion-renew").click();
    await page.locator('#renew-form').getByRole("button", { name: "Confirmar renovación", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#renew-dialog").open);
    assert.equal(await page.evaluate(() => window.__remoteState.ledger.length), 2);
    const ledgerBeforePendingPrice = await page.evaluate(() => window.__remoteState.ledger.length);
    await page.locator("#companion-new-client").click();
    await page.locator("#client-account").selectOption("netflix-test");
    await page.locator('#client-form [name="expires"]').fill("2099-10-24");
    assert.equal(await page.locator('#client-form [name="price"]').inputValue(), "", "Una ficha sin precio indicado debe conservar el campo vacío.");
    assert.equal(await page.locator('#client-form [name="paid"]').isChecked(), true);
    await page.locator('#client-form button[type="submit"]').click();
    await page.waitForFunction(() => window.__remoteState.clients.length === 2);
    const pendingPriceClient = await page.evaluate((knownId) => window.__remoteState.clients.find((client) => client.id !== knownId), created.id);
    assert.equal(pendingPriceClient.price, 0);
    assert.equal(pendingPriceClient.pricePending, true, "Un precio desconocido necesita un indicador distinto de un cero conocido.");
    assert.equal(await page.evaluate(() => window.__remoteState.ledger.length), ledgerBeforePendingPrice, "Guardar un precio vacío no debe registrar un cobro aunque la casilla de venta esté marcada.");

    // Exercise the actual edit/renewal/income forms rather than only the state
    // serializer: an unrelated edit must not turn an unknown price into S/0.00.
    await page.evaluate(() => document.querySelector('nav [data-view="customers"]').click());
    const pendingRow = () => page.locator("#clients tr").nth(1);
    await pendingRow().getByRole("button", { name: "Editar", exact: true }).click();
    assert.equal(await page.locator('#client-form [name="price"]').inputValue(), "");
    await page.locator('#client-form [name="notes"]').fill("Precio por confirmar con el propietario");
    await page.locator('#client-form button[type="submit"]').click();
    await page.waitForFunction((id) => window.__remoteState.clients.find((client) => client.id === id)?.notes === "Precio por confirmar con el propietario" && !document.querySelector("#client-dialog").open, pendingPriceClient.id);
    assert.equal(await page.evaluate((id) => window.__remoteState.clients.find((client) => client.id === id).pricePending, pendingPriceClient.id), true);
    await pendingRow().getByRole("button", { name: "Editar", exact: true }).click();
    assert.equal(await page.locator('#client-form [name="price"]').inputValue(), "", "Reabrir después de guardar debe mantener el precio vacío.");
    await page.locator("#client-dialog .close").first().click();
    await pendingRow().getByRole("button", { name: "Renovar", exact: true }).click();
    assert.equal(await page.locator('#renew-form [name="amount"]').inputValue(), "", "La renovación de un precio pendiente no debe proponer un cobro de cero.");
    await page.locator('#renew-form').getByRole("button", { name: "Confirmar renovación", exact: true }).click();
    assert.equal(await page.locator("#renew-dialog").evaluate((dialog) => dialog.open), true);
    assert.equal(await page.evaluate((id) => window.__remoteState.clients.find((client) => client.id === id).expires, pendingPriceClient.id), pendingPriceClient.expires);
    assert.equal(await page.evaluate(() => window.__remoteState.ledger.length), ledgerBeforePendingPrice);
    await page.locator('#renew-form [name="paid"]').uncheck();
    await page.locator('#renew-form').getByRole("button", { name: "Confirmar renovación", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#renew-dialog").open);
    assert.notEqual(await page.evaluate((id) => window.__remoteState.clients.find((client) => client.id === id).expires, pendingPriceClient.id), pendingPriceClient.expires);
    assert.equal(await page.evaluate(() => window.__remoteState.ledger.length), ledgerBeforePendingPrice, "Renovar sin registrar cobro permite dejar el importe vacío y no inventa pagos.");
    assert.equal(await page.evaluate((id) => window.__remoteState.clients.find((client) => client.id === id).pricePending, pendingPriceClient.id), true);
    await page.evaluate(() => document.querySelector('nav [data-view="finance"]').click());
    await page.locator("#new-income").click();
    await page.locator("#income-client").selectOption(pendingPriceClient.id);
    assert.equal(await page.locator('#income-form [name="amount"]').inputValue(), "", "El ingreso de un cliente sin precio exige que el propietario indique el importe real.");
    await page.locator('#income-form button[type="submit"]').click();
    assert.equal(await page.locator("#income-dialog").evaluate((dialog) => dialog.open), true);
    assert.equal(await page.evaluate(() => window.__remoteState.ledger.length), ledgerBeforePendingPrice);
    await page.locator("#income-dialog .close").first().click();

    // An explicitly supplied zero is a known value, not a missing price. It is
    // displayed as 0.00 on reopen, while still creating no implicit cash entry.
    await page.evaluate(() => document.querySelector('nav [data-view="customers"]').click());
    await pendingRow().getByRole("button", { name: "Editar", exact: true }).click();
    await page.locator('#client-form [name="price"]').fill("0");
    await page.locator('#client-form button[type="submit"]').click();
    await page.waitForFunction((id) => !document.querySelector("#client-dialog").open && window.__remoteState.clients.find((client) => client.id === id)?.pricePending !== true, pendingPriceClient.id);
    assert.equal(await page.evaluate((id) => window.__remoteState.clients.find((client) => client.id === id).price, pendingPriceClient.id), 0);
    await pendingRow().getByRole("button", { name: "Editar", exact: true }).click();
    assert.equal(await page.locator('#client-form [name="price"]').inputValue(), "0.00", "Un precio cero indicado expresamente debe distinguirse del campo pendiente vacío.");
    await page.locator("#client-dialog .close").first().click();
    await page.evaluate(() => document.querySelector('nav [data-view="finance"]').click());
    await page.locator("#new-income").click();
    await page.locator("#income-client").selectOption(pendingPriceClient.id);
    assert.equal(await page.locator('#income-form [name="amount"]').inputValue(), "0.00");
    await page.locator('#income-form button[type="submit"]').click();
    assert.equal(await page.locator("#income-dialog").evaluate((dialog) => dialog.open), true);
    assert.equal(await page.evaluate(() => window.__remoteState.ledger.length), ledgerBeforePendingPrice, "Consultar o editar un cero conocido tampoco crea un cobro automático.");
    await page.locator("#income-dialog .close").first().click();
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
    console.log("Companion browser: full CRM sale/profile/payment, delivery draft, visible conversation dedupe, in-flight capture cancellation after close/reopen, renewal, blank-price preservation, explicit-zero distinction, no implicit cash payment and recipient mismatch verified at 390px.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
