const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

// This fixture runs the actual packaged app, WhatsApp content script, embedded
// dock and background router. Its contacts/messages are entirely synthetic.
// It does not claim to install an extension or exercise the real WhatsApp site.
const WHATSAPP_FIXTURE = `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><title>WhatsApp Web · prueba integrada</title><style>
*{box-sizing:border-box}html,body{height:auto;margin:0;font-family:Arial,sans-serif;color:#213238;background:#d6dbd7}
body{overflow:hidden}#app{height:100dvh;position:relative;background:#fff}.app-wrapper-web{position:absolute;inset:0;width:100%;height:100%;display:grid;grid-template-columns:64px 280px minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
.rail{background:#f0f2f5;border-right:1px solid #dbe1e4;padding:22px 15px;display:flex;flex-direction:column;gap:28px;align-items:center;color:#657781}
.rail b{background:#00a884;color:white;padding:10px;border-radius:50%;font-size:12px}
.contacts{border-right:1px solid #dbe1e4;background:#fff;min-width:0}.contact-head{padding:20px;font-size:22px;font-weight:bold;display:flex;justify-content:space-between;align-items:center}.fixture-label{color:#008069;font-size:12px;line-height:1.4;font-weight:normal;background:#d9fdd3;border-radius:20px;padding:5px 8px}
.search{margin:0 14px 15px;background:#f0f2f5;border-radius:8px;padding:12px;color:#667781;font-size:13px}.contact{padding:20px 14px;display:flex;gap:12px;border-bottom:1px solid #f0f2f5;align-items:center}.contact.selected{background:#f0f2f5}.avatar{width:44px;height:44px;border-radius:50%;background:#dfe5e7;display:grid;place-items:center;color:#54656f;font-weight:bold;flex-shrink:0}.contact .preview{font-size:12px;color:#667781;margin-top:6px}.contact .name{font-size:14px}.contact .time{font-size:11px;color:#667781;margin-left:auto;align-self:flex-start}
#main{display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;background:#efeae2}#main header{height:74px;background:#f0f2f5;display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid #dbe1e4;flex-shrink:0}#main header .identity{display:flex;flex-direction:column;gap:5px}#main header small{color:#667781;font-size:12px}.history{flex:1;min-height:0;overflow:auto;padding:30px 32px;background-image:radial-gradient(#d8d3cb 1px,transparent 1px);background-size:23px 23px}.day{width:fit-content;margin:0 auto 25px;background:#fff8;padding:8px 14px;border-radius:7px;font-size:12px;color:#54656f}.message-in,.message-out{max-width:80%;padding:12px 14px;margin-bottom:18px;border-radius:9px;box-shadow:0 1px 1px #0002;font-size:14px;line-height:1.5}.message-in{background:#fff;margin-right:auto}.message-out{background:#d9fdd3;margin-left:auto}.message-time{display:block;text-align:right;color:#667781;font-size:10px;margin-top:5px}.privacy{font-size:11px;color:#667781;text-align:center;padding:10px;background:#fff9;border-radius:7px;margin-bottom:30px}
footer{background:#f0f2f5;display:flex;align-items:center;gap:12px;padding:14px 16px;flex-shrink:0}footer [contenteditable]{min-height:46px;max-height:100px;flex:1;border-radius:8px;background:white;padding:13px;outline:none;font-size:14px;overflow:auto}footer button{border:none;background:#00a884;color:white;border-radius:50%;width:42px;height:42px;cursor:pointer}.sent-result{color:#008069;font-size:12px;margin-left:20px}
@media(max-width:850px){.app-wrapper-web{grid-template-columns:52px 180px minmax(0,1fr)}.history{padding:24px 16px}.contacts .contact{padding:16px 10px}.contacts .contact-head{padding:16px 12px;font-size:17px}.fixture-label{display:none}}
</style></head><body><div id="app" style="--fixture-native-marker:keep-me"><div class="app-wrapper-web">
<aside class="rail" aria-label="Herramientas de WhatsApp"><b>WA</b><span>◉</span><span>▣</span><span>☆</span><span>⚙</span></aside>
<aside class="contacts"><div class="contact-head">WhatsApp <span class="fixture-label">Vista de prueba</span></div><div class="search">Buscar una conversación</div>
<div class="contact selected"><span class="avatar">MP</span><div><div class="name">María · cliente de prueba</div><div class="preview">Quiero renovar Netflix</div></div><span class="time">10:32</span></div>
<div class="contact"><span class="avatar">JC</span><div><div class="name">José · ejemplo</div><div class="preview">Gracias por la atención</div></div></div>
<div class="contact"><span class="avatar">LC</span><div><div class="name">Lucía · ejemplo</div><div class="preview">¿Tienes un perfil disponible?</div></div></div></aside>
<section id="main" aria-label="Conversación de prueba"><header><span class="avatar">MP</span><div class="identity"><span title="+51 999 999 999">+51 999 999 999</span><small>María · conversación sintética</small></div></header>
<div class="history"><div class="day">HOY · DATOS DE EJEMPLO</div><div class="privacy">Esta vista usa contactos y mensajes ficticios. No está conectada a WhatsApp.</div>
<div data-id="false_fixture-peer@lid_one"><div class="message-in"><div data-pre-plain-text="[10:30, 25/10/2026] María: "><span class="selectable-text">Hola, quiero renovar mi perfil de Netflix.</span></div><small class="message-time">10:30</small></div></div>
<div data-id="true_fixture-peer@lid_two"><div class="message-out"><div data-pre-plain-text="[10:31, 25/10/2026] Operador: "><span class="selectable-text">Hola, María. Estoy revisando tu servicio.</span></div><small class="message-time">10:31 ✓✓</small></div></div>
<div data-id="false_fixture-peer@lid_three"><div class="message-in"><div data-pre-plain-text="[10:32, 25/10/2026] María: "><span class="selectable-text">Perfecto, ¿puedo mantener el mismo perfil?</span></div><small class="message-time">10:32</small></div></div></div>
<footer><span aria-hidden="true">＋</span><div role="textbox" aria-label="Escribir mensaje de prueba" contenteditable="true"></div><button id="fixture-send" aria-label="Enviar mensaje de prueba">➤</button></footer><output class="sent-result" id="fixture-sent"></output>
</section></div></div><script>document.querySelector('#fixture-send').addEventListener('click',()=>{const editor=document.querySelector('footer [contenteditable]');document.querySelector('#fixture-sent').textContent=editor.textContent;editor.textContent='';});</script></body></html>`;

(async () => {
  const root = path.resolve(__dirname, "..");
  assert.ok(fs.existsSync(path.join(root, "extension/dock.js")), "Construye extension/dock.js antes de ejecutar esta prueba.");
  const scratch = path.join(root, "work");
  fs.mkdirSync(scratch, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(scratch, "nexo-embedded-browser-"));
  const unpacked = path.join(temporary, "extension");
  execFileSync("python3", ["extension/build.py", "--output-dir", unpacked, "--zip", path.join(temporary, "extension.zip")], { cwd: root });
  const manifest = JSON.parse(fs.readFileSync(path.join(unpacked, "manifest.json")));
  assert.ok(manifest.content_scripts.some(entry => entry.matches.includes("https://web.whatsapp.com/*") && entry.js.includes("dock.js")), "El dock debe instalarse en WhatsApp Web.");
  assert.ok(manifest.web_accessible_resources?.some(entry => entry.matches?.includes("https://web.whatsapp.com/*") && entry.resources?.some(resource => ["app/*", "app/index.html", "*"].includes(resource))), "El documento incrustado debe poder cargarse desde WhatsApp Web.");
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 760 } });
  const extensionId = "a".repeat(32);
  const extensionUrl = `chrome-extension://${extensionId}/`;
  const fixtureExtension = "https://extension.test/";
  const pages = new Map(), backgroundListeners = [], errors = [];
  const local = { crmOrigin: "https://crm.test" }, session = {};
  let whatsapp, nextTabId = 1, writes = 0, embeddedMessages = 0, sessionExpired = false, rejectNextWrite = false;
  const tab = page => ({ id: pages.get(page), url: page.url(), status: "complete" });
  const pageFor = tabId => [...pages].find(([, id]) => id === tabId)?.[0];
  const storage = values => ({
    async get(key) { return { [key]: values[key] }; },
    async set(update) { Object.assign(values, update); },
    async remove(key) { delete values[key]; },
    async setAccessLevel() {},
  });
  async function dispatch(message, sender) {
    for (const listener of backgroundListeners) {
      const response = await new Promise(resolve => {
        if (listener(message, sender, resolve) !== true) resolve(undefined);
      });
      if (response !== undefined) return response;
    }
    throw Error("Ningún listener de background aceptó el mensaje de prueba.");
  }
  try {
    global.chrome = {
      runtime: {
        id: extensionId, getURL: suffix => extensionUrl + suffix,
        onMessage: { addListener: listener => backgroundListeners.push(listener) },
        onInstalled: { addListener() {} }, async openOptionsPage() {},
        async sendMessage(message) {
          for (const page of pages.keys()) for (const frame of page.frames()) {
            if (!frame.url().startsWith(fixtureExtension)) continue;
            await frame.evaluate(({ message, id }) => {
              for (const listener of globalThis.__chromeListeners) listener(message, { id }, () => {});
            }, { message, id: extensionId });
          }
        },
      },
      storage: { local: storage(local), session: storage(session) },
      permissions: { async contains({ origins }) { return origins.every(origin => origin === "https://crm.test/*"); } },
      action: { onClicked: { addListener() {} } },
      sidePanel: { async setPanelBehavior() {}, async open() {} },
      tabs: {
        onUpdated: { addListener() {} }, onRemoved: { addListener() {} }, onActivated: { addListener() {} },
        async get(id) { const page = pageFor(id); if (!page) throw Error("Pestaña cerrada."); return tab(page); },
        async query(query) {
          if (query.active) return whatsapp ? [tab(whatsapp)] : [];
          return [...pages].filter(([page]) => !query.url || page.url().startsWith(query.url.replace(/\*$/, ""))).map(([page]) => tab(page));
        },
        async create({ url }) { const page = await context.newPage(); pages.set(page, nextTabId++); await page.goto(url); return tab(page); },
        async update(id, update) { const page = pageFor(id); if (update.url) await page.goto(update.url); return tab(page); },
        async sendMessage(id, message) {
          return pageFor(id).evaluate(({ message, extensionId }) => new Promise(resolve => {
            let accepted = false;
            for (const listener of globalThis.__chromeListeners) {
              const result = listener(message, { id: extensionId, url: chrome.runtime.getURL("background.mjs") }, resolve);
              if (result === true) accepted = true;
            }
            if (!accepted) resolve(undefined);
          }), { message, extensionId });
        },
      },
      scripting: { async executeScript({ target, files }) {
        for (const name of files) await pageFor(target.tabId).evaluate(fs.readFileSync(path.join(unpacked, name), "utf8"));
      } },
    };
    await import(path.join(root, "extension/background.mjs"));
    context.on("page", page => {
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", dialog => dialog.accept());
    });
    await context.exposeBinding("nexoToBackground", async ({ page, frame }, message) => {
      const embedded = frame.url().startsWith(fixtureExtension) && frame !== page.mainFrame();
      const sender = { id: extensionId, frameId: embedded ? 1 : 0, url: frame.url() };
      if (frame.url().startsWith(fixtureExtension)) {
        const parsed = new URL(frame.url());
        sender.url = extensionUrl + parsed.pathname.slice(1) + parsed.search;
        if (embedded) { sender.tab = tab(page); embeddedMessages++; }
      } else sender.tab = tab(page);
      return dispatch(message, sender);
    });
    await context.addInitScript(({ id, fixtureExtension }) => {
      globalThis.__chromeListeners = [];
      globalThis.chrome = { runtime: {
        id, getURL: suffix => location.origin === "https://crm.test" ? `chrome-extension://${id}/` + suffix : fixtureExtension + suffix,
        sendMessage: message => globalThis.nexoToBackground(message),
        onMessage: {
          addListener: listener => globalThis.__chromeListeners.push(listener),
          removeListener: listener => { globalThis.__chromeListeners = globalThis.__chromeListeners.filter(item => item !== listener); },
        },
      } };
    }, { id: extensionId, fixtureExtension });
    const { emptyState } = await import(path.join(root, "cloud/state.mjs"));
    let state = emptyState(), revision = 0;
    state.accounts = [{ id: "netflix-demo", service: "Netflix", email: "cuenta@example.test", provider: "Proveedor de prueba", password: "solo-datos-de-prueba", expires: "2099-12-31", capacity: 3 }];
    state.clients = [{ id: "maria-demo", name: "María · cliente de prueba", phone: "51999999999", email: "cuenta@example.test", whatsappUsername: "", service: "Netflix", profile: "Perfil 1", expires: "2099-12-31", notes: "Ficha sintética para verificar el panel incrustado.", accountId: "netflix-demo", pin: "", price: 2500, reminderConsent: false, marketingConsent: false, archived: false, serviceHistory: [] }];
    await context.route("https://crm.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (["/", "/companion"].includes(url.pathname)) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Sesión CRM de prueba</title><p>Puente autenticado de prueba</p>" });
      let json;
      if (url.pathname === "/api/session") {
        if (sessionExpired) return route.fulfill({ status: 401, json: { error: "Sesión de prueba caducada." } });
        json = { email: "operador@example.test", csrf: "csrf-de-prueba", mode: "server", authProvider: "cloudflare-access" };
      }
      else if (url.pathname === "/api/workspace" && request.method() === "GET") json = { state, revision };
      else if (url.pathname === "/api/workspace" && request.method() === "PUT") {
        assert.equal(request.headers()["x-csrf-token"], "csrf-de-prueba");
        if (rejectNextWrite) {
          rejectNextWrite = false;
          return route.fulfill({ status: 503, json: { error: "Conexión de prueba interrumpida. Vuelve a intentar guardar." } });
        }
        const input = request.postDataJSON();
        if (input.revision !== revision) return route.fulfill({ status: 409, json: { error: "Los datos cambiaron en otra sesión." } });
        state = input.state; writes++; json = { revision: ++revision };
      } else if (url.pathname === "/api/automation-status") json = { configured: false, reminders: [], worker: null };
      else if (url.pathname === "/api/report-status") json = { configured: false, recipient: "operador@example.test", recent: [] };
      else if (url.pathname.startsWith("/api/message-tasks")) json = { configured: false, tasks: [] };
      else return route.fulfill({ status: 404, json: { error: "Ruta de prueba no encontrada." } });
      return route.fulfill({ json });
    });
    await context.route(fixtureExtension + "**", route => {
      const filename = path.resolve(unpacked, "." + new URL(route.request().url()).pathname);
      if (!filename.startsWith(unpacked + path.sep) || !fs.existsSync(filename)) return route.fulfill({ status: 404 });
      const type = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" }[path.extname(filename)] || "application/octet-stream";
      return route.fulfill({ contentType: type, body: fs.readFileSync(filename) });
    });
    await context.route("https://web.whatsapp.com/**", route => route.fulfill({ contentType: "text/html", body: WHATSAPP_FIXTURE }));
    const crm = await context.newPage(); pages.set(crm, nextTabId++); await crm.goto("https://crm.test/companion");
    whatsapp = await context.newPage(); pages.set(whatsapp, nextTabId++); await whatsapp.goto("https://web.whatsapp.com/");
    async function layoutMetrics() {
      return whatsapp.evaluate(() => {
        const rect = selector => {
          const element = document.querySelector(selector);
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight },
          root: rect("#app"), wrapper: rect(".app-wrapper-web"), chat: rect("#main"),
          history: rect(".history"), footer: rect("footer"), editor: rect('footer [contenteditable="true"]'),
          rootInlineStyle: document.querySelector("#app").getAttribute("style"),
          rootAnchored: document.querySelector("#app").classList.contains("nexo-dock-anchor"),
          rootPosition: getComputedStyle(document.querySelector("#app")).position,
          rootHeight: getComputedStyle(document.querySelector("#app")).height,
          documentInlineStyle: document.documentElement.getAttribute("style"),
        };
      });
    }
    const nativeLayout = await layoutMetrics();
    await whatsapp.evaluate(fs.readFileSync(path.join(unpacked, "whatsapp.js"), "utf8"));
    await whatsapp.evaluate(fs.readFileSync(path.join(unpacked, "dock.js"), "utf8"));
    const dockLayout = await layoutMetrics();
    console.log("Embedded layout metrics:", JSON.stringify({ native: nativeLayout, opened: dockLayout }));
    assert.ok(dockLayout.root.height >= nativeLayout.root.height - 2, "Abrir el CRM debe conservar el alto nativo de WhatsApp aunque html/body tengan height:auto.");
    assert.ok(dockLayout.history.height >= 300, "El historial debe conservar un área visible sustancial.");
    assert.ok(Math.abs(dockLayout.footer.bottom - dockLayout.viewport.height) <= 30, "El compositor debe permanecer cerca del borde inferior de la ventana.");
    const host = whatsapp.locator("#nexo-whatsapp-dock");
    await host.waitFor({ state: "visible" });
    assert.equal(await host.getAttribute("data-state"), "open");
    assert.equal(await host.getAttribute("data-layout"), "push");
    const frameElement = host.locator("iframe#nexo-crm-frame");
    await frameElement.waitFor({ state: "visible" });
    assert.equal(new URL(await frameElement.getAttribute("src")).searchParams.get("embedded"), "1");
    await whatsapp.waitForFunction(() => document.querySelector("#nexo-whatsapp-dock")?.shadowRoot?.querySelector("iframe")?.contentWindow !== null);
    const embedded = await frameElement.contentFrame();
    const appFrame = await (await frameElement.elementHandle()).contentFrame();
    try {
      await embedded.locator("#companion-workspace").waitFor({ state: "visible", timeout: 20000 });
    } catch (error) {
      console.error("Embedded fixture diagnostic:", {
        errors,
        frames: whatsapp.frames().map(frame => frame.url()),
        body: await embedded.locator("body").innerText(),
      });
      throw error;
    }
    assert.ok(embeddedMessages > 0, "El CRM debe comunicarse desde un frame incrustado real.");
    assert.equal(whatsapp.url(), "https://web.whatsapp.com/");
    assert.equal(pages.size, 2, "No se debe abrir otra pestaña para el CRM operativo.");
    assert.equal(await embedded.locator("#companion-client").inputValue(), "maria-demo");
    const editor = whatsapp.locator('footer [contenteditable="true"]');
    const chatBox = await whatsapp.locator("#main").boundingBox();
    const wrapperBox = await whatsapp.locator(".app-wrapper-web").boundingBox();
    const dockBox = await frameElement.boundingBox();
    assert.ok(chatBox.width >= 300, "La conversación debe conservar un ancho utilizable.");
    assert.ok(chatBox.x + chatBox.width <= dockBox.x + 2, "El modo push no debe cubrir la conversación.");
    assert.ok(wrapperBox.x + wrapperBox.width <= dockBox.x + 2, "El contenedor absoluto de WhatsApp también debe seguir el ancho reducido.");
    assert.ok(dockBox.width >= 320 && dockBox.width <= 720, "El dock debe caber en un escritorio normal.");
    await embedded.locator("#companion-auto-capture").check();
    await embedded.locator("#companion-status").filter({ hasText: "mensajes guardados" }).waitFor();
    assert.equal(state.growth.interactions.length, 3);
    assert.equal(await embedded.locator("#companion-auto-capture").isChecked(), true);
    await editor.fill("Borrador de prueba que debe conservarse");
    await host.getByRole("button", { name: "Cerrar Nexo CRM", exact: true }).click();
    assert.equal(await host.getAttribute("data-state"), "closed");
    await frameElement.waitFor({ state: "hidden" });
    await appFrame.waitForFunction(() => !document.querySelector("#companion-auto-capture").checked);
    assert.equal(await editor.innerText(), "Borrador de prueba que debe conservarse");
    await host.getByRole("button", { name: "Abrir Nexo CRM", exact: true }).click();
    assert.equal(await host.getAttribute("data-state"), "open");
    await embedded.locator("#companion-workspace").waitFor({ state: "visible" });
    assert.equal(await embedded.locator("#companion-auto-capture").isChecked(), false, "Reabrir no debe reactivar el registro automático sin consentimiento.");
    assert.equal(await editor.innerText(), "Borrador de prueba que debe conservarse");
    const variants = [
      ["relative", "--fixture-native-marker:keep-me;position:relative;height:100dvh"],
      ["static", "--fixture-native-marker:keep-me;position:static;height:100dvh"],
      ["absolute", "--fixture-native-marker:keep-me;position:absolute;inset:0;height:auto"],
      ["fixed", "--fixture-native-marker:keep-me;position:fixed;inset:0;height:auto"],
    ];
    for (const [position, inlineStyle] of variants) {
      await host.getByRole("button", { name: "Cerrar Nexo CRM", exact: true }).click();
      await whatsapp.locator("#app").evaluate((root, value) => root.setAttribute("style", value), inlineStyle);
      const native = await layoutMetrics();
      assert.equal(native.rootPosition, position);
      assert.ok(native.history.height >= 300, `La fixture ${position} debe ser utilizable antes de abrir el CRM.`);
      await host.getByRole("button", { name: "Abrir Nexo CRM", exact: true }).click();
      const opened = await layoutMetrics();
      assert.ok(Math.abs(opened.root.height - native.root.height) <= 2, `El CRM debe conservar el alto del root ${position}.`);
      assert.ok(opened.history.height >= 300, `El historial no debe colapsar con root ${position}.`);
      assert.ok(Math.abs(opened.footer.bottom - opened.viewport.height) <= 30, `El compositor debe quedar abajo con root ${position}.`);
      assert.equal(opened.rootPosition, position === "static" ? "relative" : position, `El CRM debe conservar la posición nativa ${position}; solo static necesita anclaje.`);
      const frameBounds = await frameElement.boundingBox();
      assert.ok(opened.wrapper.right <= frameBounds.x + 2, `El contenedor de WhatsApp no debe cubrir el CRM con root ${position}.`);
      await host.getByRole("button", { name: "Cerrar Nexo CRM", exact: true }).click();
      const restored = await layoutMetrics();
      assert.equal(restored.rootInlineStyle, native.rootInlineStyle, "Cerrar debe conservar todos los estilos inline originales del root.");
      assert.equal(restored.rootPosition, position);
      assert.equal(restored.rootAnchored, false, "Cerrar debe retirar solo la clase de anclaje de la extensión.");
      assert.ok(Math.abs(restored.root.width - native.root.width) <= 2);
      assert.ok(Math.abs(restored.root.height - native.root.height) <= 2);
      assert.equal(await whatsapp.evaluate(() => document.documentElement.style.getPropertyValue("--nexo-dock-width")), "");
      console.log("Native WhatsApp layout restored:", JSON.stringify({ position, rootHeight: opened.root.height, historyHeight: opened.history.height, footerBottom: opened.footer.bottom }));
      await host.getByRole("button", { name: "Abrir Nexo CRM", exact: true }).click();
    }
    await host.getByRole("button", { name: "Cerrar Nexo CRM", exact: true }).click();
    await whatsapp.locator("#app").evaluate((root, style) => root.setAttribute("style", style), nativeLayout.rootInlineStyle);
    await host.getByRole("button", { name: "Abrir Nexo CRM", exact: true }).click();
    const moduleSelector = embedded.locator("#nexo-module-select");
    const expectedModules = ["home", "customers", "accounts", "free", "renewals", "finance", "messages", "combos", "security", "automation", "integrations", "settings", "marketing", "social"];
    assert.deepEqual(await moduleSelector.locator("option").evaluateAll(options => options.map(option => option.value)), expectedModules);
    for (const module of expectedModules) {
      await moduleSelector.selectOption(module);
      await embedded.locator(`#${module}`).waitFor({ state: "visible" });
      assert.equal(await moduleSelector.inputValue(), module);
    }
    const writesBeforeEdit = writes;
    await moduleSelector.selectOption("customers");
    await embedded.locator("#customers").waitFor({ state: "visible" });
    await appFrame.waitForFunction(() => document.scrollingElement.scrollTop === 0);
    assert.equal(await embedded.locator("#nexo-chat-tools").evaluate(node => node.open), false);
    assert.ok(await embedded.locator("#customers").evaluate(node => node.getBoundingClientRect().top < innerHeight * 0.65), "La sección Clientes debe estar visible sin que las herramientas del chat ocupen toda la altura.");
    await embedded.locator("#clients tr").first().getByRole("button", { name: "Editar", exact: true }).click();
    await embedded.locator('#client-form [name="notes"]').fill("Nota guardada desde WhatsApp Web sin cambiar de página.");
    await embedded.locator('#client-form button[type="submit"]').click();
    await embedded.locator("#client-dialog").waitFor({ state: "hidden" });
    assert.equal(state.clients[0].notes, "Nota guardada desde WhatsApp Web sin cambiar de página.");
    assert.equal(writes, writesBeforeEdit + 1);
    await embedded.locator("#nexo-chat-tools > summary").click();
    await embedded.locator("#companion-capture").click();
    await embedded.locator("#companion-status").filter({ hasText: /mensajes guardados|ya están registrados/ }).waitFor();
    assert.equal(state.growth.interactions.length, 3);
    await editor.fill("Mensaje manual de prueba");
    await whatsapp.getByRole("button", { name: "Enviar mensaje de prueba", exact: true }).click();
    assert.equal(await whatsapp.locator("#fixture-sent").innerText(), "Mensaje manual de prueba");
    assert.equal(whatsapp.url(), "https://web.whatsapp.com/");
    const untrusted = await whatsapp.evaluate(() => chrome.runtime.sendMessage({ channel: "nexo", type: "crm.request", expectedOrigin: "https://crm.test", path: "/api/workspace", method: "GET" }));
    assert.equal(untrusted.ok, false, "La página WhatsApp no debe tener acceso a los datos privados del CRM.");
    await whatsapp.setViewportSize({ width: 980, height: 900 });
    await whatsapp.waitForFunction(() => document.querySelector("#nexo-whatsapp-dock").dataset.layout === "overlay");
    const narrow = await layoutMetrics();
    assert.ok(narrow.history.height >= 300);
    assert.ok(Math.abs(narrow.footer.bottom - narrow.viewport.height) <= 40);
    await host.getByRole("button", { name: "Cerrar Nexo CRM", exact: true }).click();
    const narrowClosed = await layoutMetrics();
    assert.equal(narrowClosed.root.width, narrowClosed.viewport.width);
    assert.equal(narrowClosed.rootInlineStyle, nativeLayout.rootInlineStyle);
    assert.equal(narrowClosed.rootAnchored, false);
    await editor.fill("El chat también funciona al cerrar el dock en una ventana pequeña.");
    assert.equal(await editor.innerText(), "El chat también funciona al cerrar el dock en una ventana pequeña.");
    await whatsapp.setViewportSize({ width: 1440, height: 760 });
    await host.getByRole("button", { name: "Abrir Nexo CRM", exact: true }).click();
    await whatsapp.waitForFunction(() => document.querySelector("#nexo-whatsapp-dock").dataset.layout === "push");
    await editor.fill("");
    // A freshly deployed CRM has no demo customers or inventory. The extension
    // must explain that state and still permit contact creation in a new chat
    // whose visible phone is known but whose history has no loaded peer IDs.
    const originalHistory = await whatsapp.locator(".history").innerHTML();
    await whatsapp.locator(".history").evaluate(node => node.querySelectorAll("[data-id]").forEach(message => message.remove()));
    state = emptyState(); revision = 0;
    await Promise.all([
      appFrame.waitForNavigation({ waitUntil: "domcontentloaded" }),
      embedded.locator("#companion-reload").click(),
    ]);
    await moduleSelector.waitFor({ state: "visible" });
    if (!(await embedded.locator("#nexo-chat-tools").evaluate(node => node.open)))
      await embedded.locator("#nexo-chat-tools > summary").click();
    await embedded.locator("#companion-status").filter({ hasText: /No hay ficha/ }).waitFor();
    assert.equal(await embedded.locator("#companion-new-client").isEnabled(), true);
    for (const id of ["companion-open-client", "companion-renew", "companion-compose", "companion-capture", "companion-auto-capture"])
      assert.equal(await embedded.locator("#" + id).isDisabled(), true, `${id} debe explicar la falta de ficha sin ofrecer una acción inválida.`);
    assert.ok(await embedded.locator("#companion-selection-help").isVisible());
    const emptyChat = await appFrame.evaluate(() => globalThis.NexoCompanion.getContext());
    assert.equal(emptyChat.chatId, "phone:51999999999");
    assert.equal(emptyChat.phone, "51999999999");
    await embedded.locator("#companion-new-client").click();
    const clientForm = embedded.locator("#client-form");
    assert.equal(await clientForm.locator('[name="phone"]').inputValue(), "51999999999");
    assert.equal(await clientForm.locator('[name="accountId"] option').count(), 1);
    await clientForm.locator('[name="name"]').fill("María · nuevo cliente de prueba");
    rejectNextWrite = true;
    await clientForm.getByRole("button", { name: "Guardar cliente", exact: true }).click();
    await embedded.locator("#client-error").filter({ hasText: "Conexión de prueba interrumpida" }).waitFor();
    assert.equal(await embedded.locator("#client-dialog").evaluate(dialog => dialog.open), true);
    assert.equal(state.clients.length, 0, "Un guardado fallido no puede crear una ficha remota.");
    assert.equal(state.ledger.length, 0, "Un guardado fallido no puede crear cobros.");
    await clientForm.getByRole("button", { name: "Guardar cliente", exact: true }).click();
    await embedded.locator("#client-dialog").waitFor({ state: "hidden" });
    assert.equal(state.clients.length, 1);
    assert.equal(state.clients[0].accountId, "");
    assert.equal(state.accounts.length, 0);
    assert.equal(state.ledger.length, 0);
    const newClientId = state.clients[0].id;
    await embedded.locator("#companion-capture").click();
    await embedded.locator("#companion-status").filter({ hasText: /ya están registrados|no contienen mensajes nuevos/ }).waitFor();
    assert.equal(state.growth.interactions.length, 0);
    await embedded.locator("#new-account").click();
    const accountForm = embedded.locator("#account-form");
    await accountForm.locator('[name="service"]').fill("Netflix");
    await accountForm.locator('[name="email"]').fill("cuenta-nueva@example.test");
    await accountForm.locator('[name="password"]').fill("acceso-de-prueba");
    await accountForm.locator('[name="provider"]').fill("Proveedor de prueba");
    await accountForm.locator('[name="expires"]').fill("2099-12-31");
    await accountForm.locator('[name="capacity"]').fill("2");
    await accountForm.getByRole("button", { name: "Guardar cuenta", exact: true }).click();
    await embedded.locator("#account-dialog").waitFor({ state: "hidden" });
    assert.equal(state.accounts.length, 1);
    assert.equal(state.ledger.length, 0, "Crear inventario no registra ingresos ficticios.");
    await moduleSelector.selectOption("customers");
    await embedded.locator("#clients tr").first().getByRole("button", { name: "Editar", exact: true }).click();
    await clientForm.locator('[name="accountId"]').selectOption(state.accounts[0].id);
    assert.equal(await clientForm.locator('[name="profile"]').inputValue(), "Perfil 1");
    await clientForm.locator('[name="expires"]').fill("2099-11-24");
    await clientForm.locator('[name="price"]').fill("25.00");
    await clientForm.getByRole("button", { name: "Guardar cliente", exact: true }).click();
    await embedded.locator("#client-dialog").waitFor({ state: "hidden" });
    assert.equal(state.clients.length, 1);
    assert.equal(state.clients[0].profile, "Perfil 1");
    assert.equal(state.clients[0].accountId, state.accounts[0].id);
    await moduleSelector.selectOption("finance");
    await embedded.locator("#new-income").click();
    const incomeForm = embedded.locator("#income-form");
    await incomeForm.locator('[name="clientId"]').selectOption(newClientId);
    await incomeForm.locator('[name="amount"]').fill("25.00");
    await incomeForm.locator('[name="service"]').fill("Netflix");
    await incomeForm.locator('[name="description"]').fill("Venta Netflix · cliente de prueba");
    await incomeForm.getByRole("button", { name: "Guardar ingreso", exact: true }).click();
    await embedded.locator("#income-dialog").waitFor({ state: "hidden" });
    assert.equal(state.ledger.length, 1);
    assert.equal(state.ledger[0].amount, 2500);
    assert.equal(state.ledger[0].clientId, newClientId);
    await embedded.locator("#nexo-chat-tools > summary").click();
    assert.equal(await embedded.locator("#companion-client").inputValue(), newClientId);
    await embedded.locator("#companion-renew").click();
    await embedded.locator("#renew-form").getByRole("button", { name: "Confirmar renovación", exact: true }).click();
    await embedded.locator("#renew-dialog").waitFor({ state: "hidden" });
    assert.equal(state.ledger.length, 2);
    assert.equal(state.ledger[1].kind, "renewal");
    assert.notEqual(state.clients[0].expires, "2099-11-24");
    await embedded.locator("#companion-compose").click();
    await embedded.locator("#message-template").selectOption("password");
    await embedded.locator("#open-whatsapp").click();
    await appFrame.waitForFunction(() => document.querySelector("#message-error").textContent.trim().length > 0);
    const preparedStatus = await embedded.locator("#message-error").innerText();
    assert.match(preparedStatus, /Borrador preparado/, `La preparación del borrador debe funcionar: ${preparedStatus}`);
    assert.match(await editor.innerText(), /cuenta-nueva@example\.test/);
    assert.match(await editor.innerText(), /acceso-de-prueba/);
    const preparedHtml = await editor.innerHTML();
    await embedded.locator("#open-whatsapp").click();
    await embedded.locator("#message-error").filter({ hasText: "Borrador preparado" }).waitFor();
    assert.equal(await editor.innerHTML(), preparedHtml, "Preparar otra vez el mismo mensaje multilínea debe conservar el borrador.");
    await embedded.locator("#message-dialog .close").first().click();
    await editor.fill("");
    assert.equal(whatsapp.url(), "https://web.whatsapp.com/");
    assert.equal(pages.size, 2, "Toda la operación de prueba debe continuar dentro del mismo WhatsApp Web.");
    await whatsapp.locator(".history").evaluate((node, html) => { node.innerHTML = html; }, originalHistory);
    await embedded.locator("#companion-context-refresh").click();
    await moduleSelector.selectOption("home");
    await moduleSelector.selectOption("customers");
    await appFrame.waitForFunction(() => document.scrollingElement.scrollTop === 0);
    assert.equal(await embedded.locator("#nexo-chat-tools").evaluate(node => node.open), false);
    const screenshot = process.env.EMBEDDED_EXTENSION_SCREENSHOT || "/workspace/work/deliverables/whatsapp-integrado-v1.1.1-preview.png";
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await whatsapp.screenshot({ path: screenshot, fullPage: true });
    sessionExpired = true;
    await embedded.locator("#nexo-chat-tools > summary").click();
    await embedded.locator("#companion-reload").click();
    await embedded.locator("body.nexo-setup").waitFor({ state: "visible" });
    await embedded.getByRole("heading", { name: "Conecta tu sesión", exact: true }).waitFor();
    const configuration = embedded.getByRole("link", { name: "Configurar CRM", exact: true });
    assert.equal(await configuration.getAttribute("target"), "_blank");
    assert.match(await configuration.getAttribute("href"), /\/options\.html$/);
    assert.equal(new URL(appFrame.url()).pathname, "/app/index.html");
    assert.equal(new URL(appFrame.url()).searchParams.get("embedded"), "1");
    assert.equal(whatsapp.url(), "https://web.whatsapp.com/");
    assert.equal(pages.size, 2, "La sesión caducada debe mostrar una tarjeta dentro del dock sin abrir opciones automáticamente.");
    await editor.fill("Puedo seguir atendiendo mientras vuelvo a iniciar sesión en el CRM.");
    assert.equal(await editor.innerText(), "Puedo seguir atendiendo mientras vuelvo a iniciar sesión en el CRM.");
    assert.deepEqual(errors, []);
    console.log("Embedded extension fixture: same WhatsApp document, actual packaged CRM in shadow iframe, background/CSRF bridge, live customer edit, visible-text capture, capture stopped on collapse/reopen, manual chat and expired-session inline setup passed.");
    console.log("Synthetic preview:", screenshot);
    console.log("A real installed Chrome extension and WhatsApp account remain a separate manual verification.");
  } finally {
    await browser.close();
    delete global.chrome;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
