const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-companion-browser-"));
  const unpacked = path.join(directory, "extension");
  execFileSync("python3", ["extension/build.py", "--output-dir", unpacked, "--zip", path.join(directory, "extension.zip")], { cwd: root });
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const errors = [], pages = new Map(), listeners = [];
    const extensionId = "a".repeat(32), extensionUrl = `chrome-extension://${extensionId}/`;
    const local = { crmOrigin: "https://crm.test" }, session = {};
    let crm, whatsapp, panel, nextTabId = 1;
    function tab(page) { return { id: pages.get(page), url: page.url(), status: "complete" }; }
    function findPage(tabId) { return [...pages].find(([, id]) => id === tabId)?.[0]; }
    async function deliver(message, sender) {
      for (const listener of listeners) {
        const response = await new Promise(resolve => {
          const keep = listener(message, sender, resolve);
          if (keep !== true) resolve(undefined);
        });
        if (response !== undefined) return response;
      }
      throw Error("No fixture runtime listener accepted the message");
    }
    const storage = values => ({
      async get(key) { return { [key]: values[key] }; },
      async set(update) { Object.assign(values, update); },
      async remove(key) { delete values[key]; },
      async setAccessLevel() {},
    });
    // The real background router runs with Chrome API boundaries mocked. The
    // VM's managed Chromium blocks third-party installation; do not bypass it.
    global.chrome = {
      runtime: {
        id: extensionId, getURL: suffix => extensionUrl + suffix,
        onMessage: { addListener: listener => listeners.push(listener) },
        onInstalled: { addListener() {} }, async openOptionsPage() {},
        async sendMessage(message) {
          if (panel && !panel.isClosed()) await panel.evaluate(({ message, id }) => {
            for (const listener of globalThis.__chromeListeners) listener(message, { id }, () => {});
          }, { message, id: extensionId });
        },
      },
      storage: { local: storage(local), session: storage(session) },
      permissions: { async contains({ origins }) { return origins.every(value => ["https://crm.test/*", "https://crm-b.test/*"].includes(value)); } },
      sidePanel: { async setPanelBehavior() {} },
      tabs: {
        async get(tabId) { const page = findPage(tabId); if (!page) throw Error("tab closed"); return tab(page); },
        async query(query) {
          if (query.active) return whatsapp ? [tab(whatsapp)] : [];
          return [...pages].filter(([page]) => page.url().startsWith(query.url.replace(/\*$/, ""))).map(([page]) => tab(page));
        },
        async create({ url }) { const page = await context.newPage(); pages.set(page, nextTabId++); await page.goto(url); return tab(page); },
        async update(tabId, update) { const page = findPage(tabId); if (update.url) await page.goto(update.url); return tab(page); },
        async sendMessage(tabId, message) {
          return findPage(tabId).evaluate(({ message, id }) => new Promise(resolve => {
            for (const listener of globalThis.__chromeListeners) {
              const keep = listener(message, { id, url: `chrome-extension://${id}/background.mjs` }, resolve);
              if (keep !== undefined && keep !== false) return;
            }
          }), { message, id: extensionId });
        },
      },
      scripting: { async executeScript({ target, files }) {
        for (const name of files) await findPage(target.tabId).evaluate(fs.readFileSync(path.join(unpacked, name), "utf8"));
      } },
    };
    await import(path.join(root, "extension/background.mjs"));
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    await context.exposeBinding("nexoToBackground", async ({ page }, message) => {
      const sender = { id: extensionId, frameId: 0, url: page.url() };
      if (page.url().startsWith("https://extension.test/")) sender.url = extensionUrl + new URL(page.url()).pathname.slice(1);
      else sender.tab = tab(page);
      return deliver(message, sender);
    });
    await context.addInitScript(({ id }) => {
      globalThis.__chromeListeners = [];
      globalThis.chrome = { runtime: {
        id, getURL: suffix => location.origin === "https://extension.test" ? "https://extension.test/" + suffix : `chrome-extension://${id}/` + suffix,
        sendMessage: message => globalThis.nexoToBackground(message),
        onMessage: { addListener: listener => globalThis.__chromeListeners.push(listener), removeListener: listener => { globalThis.__chromeListeners = globalThis.__chromeListeners.filter(item => item !== listener); } },
      } };
    }, { id: extensionId });
    let revision = 0;
    const { emptyState } = await import(path.join(root, "cloud/state.mjs"));
    let state = emptyState();
    state.accounts.push({ id: "netflix", service: "Netflix", email: "test@example.com", provider: "Proveedor de prueba", password: "test-only", expires: "2030-12-31", capacity: 2 });
    await context.route("https://crm.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (["/", "/companion"].includes(url.pathname)) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Sesión CRM</title><p>Conexión privada</p>" });
      let json;
      if (url.pathname === "/api/session") json = { email: "operator@example.com", csrf: "fixture-csrf", mode: "server", authProvider: "cloudflare-access" };
      else if (url.pathname === "/api/workspace" && request.method() === "GET") json = { state, revision };
      else if (url.pathname === "/api/workspace" && request.method() === "PUT") {
        assert.equal(request.headers()["x-csrf-token"], "fixture-csrf");
        const update = request.postDataJSON(); assert.equal(update.revision, revision);
        state = update.state; json = { revision: ++revision };
      } else if (url.pathname === "/api/automation-status") json = { configured: false, reminders: [], worker: null };
      else if (url.pathname === "/api/report-status") json = { configured: false, recipient: "operator@example.com", recent: [] };
      else if (url.pathname.startsWith("/api/message-tasks")) json = { configured: false, tasks: [] };
      else return route.fulfill({ status: 404, json: { error: "not found" } });
      return route.fulfill({ json });
    });
    await context.route("https://extension.test/**", route => {
      const filename = path.resolve(unpacked, "." + new URL(route.request().url()).pathname);
      if (!filename.startsWith(unpacked + path.sep) || !fs.existsSync(filename)) return route.fulfill({ status: 404, body: "Not found" });
      const type = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" }[path.extname(filename)] || "application/octet-stream";
      return route.fulfill({ contentType: type, body: fs.readFileSync(filename) });
    });
    await context.route("https://web.whatsapp.com/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><div id="main"><header><span title="+51 999 999 999">+51 999 999 999</span></header><div data-id="false_fixture-peer@lid_one"><div class="message-in"><div data-pre-plain-text="[10:30, 24/10/2026] Cliente: "><span class="selectable-text">Quiero Netflix</span></div></div></div><footer><div role="textbox" contenteditable="true" style="border:1px solid #ccc;min-height:50px"></div></footer></div></body></html>` }));
    crm = await context.newPage(); pages.set(crm, nextTabId++); await crm.goto("https://crm.test/companion");
    whatsapp = await context.newPage(); pages.set(whatsapp, nextTabId++); await whatsapp.goto("https://web.whatsapp.com/");
    await whatsapp.evaluate(fs.readFileSync(path.join(unpacked, "whatsapp.js"), "utf8"));
    panel = await context.newPage(); pages.set(panel, nextTabId++); await panel.goto("https://extension.test/app/index.html");
    await panel.locator("#companion-workspace").waitFor({ state: "visible", timeout: 20000 });
    const chat = await panel.evaluate(() => globalThis.NexoCompanion.getContext());
    assert.equal(chat.phone, "51999999999"); assert.equal(chat.chatId, "wa:fixture-peer@lid");
    const captured = await panel.evaluate(() => globalThis.NexoCompanion.captureVisibleMessages());
    assert.equal(captured[0].body, "Quiero Netflix"); assert.equal(captured[0].chatId, chat.chatId);
    const attack = await whatsapp.evaluate(() => chrome.runtime.sendMessage({ channel: "nexo", type: "crm.request", path: "/api/workspace" }));
    assert.equal(attack.ok, false);
    await panel.locator('[data-view="customers"]').click();
    await panel.locator("#new-client").click();
    await panel.locator('#client-form [name="name"]').fill("Cliente desde WhatsApp");
    await panel.locator('#client-form [name="phone"]').fill("51999999999");
    await panel.locator('#client-form [name="accountId"]').selectOption("netflix");
    assert.equal(await panel.locator('#client-form [name="profile"]').inputValue(), "Perfil 1");
    await panel.locator('#client-form [name="expires"]').fill("2030-11-24");
    await panel.locator('#client-form [name="price"]').fill("25.00");
    await panel.locator('#client-form button:not([type="button"])').last().click();
    await panel.waitForFunction(() => !document.querySelector("#client-dialog").open);
    assert.equal(state.clients[0].name, "Cliente desde WhatsApp"); assert.equal(state.clients[0].profile, "Perfil 1");
    assert.equal(state.ledger[0].amount, 2500);
    await panel.evaluate(() => globalThis.NexoCompanion.prepareMessage({ phone: "51999999999", text: "Tu perfil Netflix está listo" }));
    assert.equal(await whatsapp.locator('footer [contenteditable="true"]').innerText(), "Tu perfil Netflix está listo");
    if (process.env.EXTENSION_SCREENSHOT) await panel.screenshot({ path: process.env.EXTENSION_SCREENSHOT, fullPage: true });
    const revisionBeforeSwitch = revision;
    const change = await deliver({ channel: "nexo", type: "configuration.set", origin: "https://crm-b.test" }, { id: extensionId, url: extensionUrl + "options.html" });
    assert.equal(change.ok, true);
    const staleWrite = await panel.evaluate(async () => {
      try { await globalThis.NexoCompanion.fetch("/api/workspace", { method: "PUT", body: JSON.stringify({ revision: 1, state: { private: "old CRM" } }) }); return "unexpected"; }
      catch (error) { return error.message; }
    });
    assert.match(staleWrite, /Cambió el CRM/);
    assert.equal(revision, revisionBeforeSwitch);
    assert.equal(await panel.locator("body").evaluate(node => node.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    console.log("Extension browser fixture: full packaged CRM, actual background router, same-origin CSRF bridge, conversation capture, rejected WhatsApp-to-CRM request, profile sale, ledger and draft passed at 390px.");
    console.log("Real MV3 installation remains a manual check: managed Chromium here blocks third-party extensions.");
  } finally { await browser.close(); delete global.chrome; }
})().catch(error => { console.error(error); process.exitCode = 1; });
