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
  const temporary = fs.mkdtempSync(path.join(scratch, "nexo-compact-browser-"));
  const unpacked = path.join(temporary, "extension");
  execFileSync("python3", ["extension/build.py", "--output-dir", unpacked, "--zip", path.join(temporary, "extension.zip")], { cwd: root });
  const manifest = JSON.parse(fs.readFileSync(path.join(unpacked, "manifest.json")));
  assert.ok(manifest.content_scripts.some(entry => entry.matches.includes("https://web.whatsapp.com/*") && entry.js.includes("dock.js")), "El dock debe instalarse en WhatsApp Web.");
  assert.ok(manifest.web_accessible_resources?.some(entry => entry.matches?.includes("https://web.whatsapp.com/*") && entry.resources?.some(resource => ["app/*", "app/index.html", "*"].includes(resource))), "El documento incrustado debe poder cargarse desde WhatsApp Web.");
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 760 } });
  context.setDefaultTimeout(7000);
  const extensionId = "a".repeat(32);
  const extensionUrl = `chrome-extension://${extensionId}/`;
  const fixtureExtension = "https://extension.test/";
  const pages = new Map(), backgroundListeners = [], tabUpdatedListeners = [], errors = [];
  const local = { crmOrigin: "https://crm.test" }, session = {};
  let whatsapp, nextTabId = 1, writes = 0, writeAttempts = 0, embeddedMessages = 0, sessionExpired = false, rejectNextWrite = false;
  const submittedWorkspaces = [];
  let clipboardDocumentReady = false;
  let holdCapture = false, capturePending = false, releaseCapture;
  let workspaceReads = 0, holdWorkspaceRead = false, workspaceReadPending = false, releaseWorkspaceRead;
  let initialWorkspaceFailures = process.env.INITIAL_LOAD_FAILURE_ONLY === '1' ? 1 : 0;
  const clipboardWrites = [];
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
        async getContexts() { return clipboardDocumentReady ? [{ documentUrl: extensionUrl + "clipboard.html" }] : []; },
        async sendMessage(message) {
          if (message.channel === "nexo.clipboard.offscreen") {
            assert.equal(clipboardDocumentReady, true);
            clipboardWrites.push(message.text);
            return { ok: true };
          }
          for (const page of pages.keys()) for (const frame of page.frames()) {
            if (!frame.url().startsWith(fixtureExtension)) continue;
            await frame.evaluate(({ message, id }) => {
              for (const listener of globalThis.__chromeListeners) listener(message, { id }, () => {});
            }, { message, id: extensionId });
          }
        },
      },
      storage: { local: storage(local), session: storage(session) },
      offscreen: { async createDocument(input) {
        assert.equal(input.url, "clipboard.html");
        assert.deepEqual(input.reasons, ["CLIPBOARD"]);
        clipboardDocumentReady = true;
      } },
      permissions: { async contains({ origins }) { return origins.every(origin => origin === "https://crm.test/*"); } },
      action: { onClicked: { addListener() {} } },
      sidePanel: { async setPanelBehavior() {}, async open() {} },
      tabs: {
        onUpdated: { addListener: listener => tabUpdatedListeners.push(listener) }, onRemoved: { addListener() {} }, onActivated: { addListener() {} },
        async get(id) { const page = pageFor(id); if (!page) throw Error("Pestaña cerrada."); return tab(page); },
        async query(query) {
          if (query.active) return whatsapp ? [tab(whatsapp)] : [];
          return [...pages].filter(([page]) => !query.url || page.url().startsWith(query.url.replace(/\*$/, ""))).map(([page]) => tab(page));
        },
        async create({ url }) { const page = await context.newPage(); pages.set(page, nextTabId++); await page.goto(url); return tab(page); },
        async update(id, update) { const page = pageFor(id); if (update.url) await page.goto(update.url); return tab(page); },
        async sendMessage(id, message) {
          const result = await pageFor(id).evaluate(({ message, extensionId }) => new Promise(resolve => {
            let accepted = false;
            for (const listener of globalThis.__chromeListeners) {
              const result = listener(message, { id: extensionId, url: chrome.runtime.getURL("background.mjs") }, resolve);
              if (result === true) accepted = true;
            }
            if (!accepted) resolve(undefined);
          }), { message, extensionId });
          if (message.channel === "nexo.whatsapp" && message.action === "capture" && holdCapture) {
            capturePending = true;
            await new Promise(resolve => { releaseCapture = resolve; });
            holdCapture = false;
            capturePending = false;
          }
          return result;
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
      const nativeSetInterval = window.setInterval.bind(window);
      window.setInterval = (callback, delay, ...args) => {
        if (delay === 20000) window.__nexoWorkspacePoll = callback;
        return nativeSetInterval(callback, delay, ...args);
      };
      // Reproduce the site's clipboard policy/focus failure. The packaged UI
      // must use its extension-owned clipboard route rather than this API.
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async () => { throw new DOMException("Clipboard blocked in the embedded page", "NotAllowedError"); },
      } });
      globalThis.chrome = { permissions: { request: async ({ origins }) => origins.every(origin => origin === "https://crm.test/*") }, runtime: {
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
    state.clients[0].expires = "2030-12-31";
    state.clients.push(
      { ...state.clients[0], id: "maria-disney", service: "Disney+", profile: "Infantil", email: "disney@example.test", accountId: "", expires: "2031-12-01", price: 0, pricePending: true },
      { ...state.clients[0], id: "jose-demo", name: "José · ejemplo", phone: "51988888888", service: "Max", profile: "Perfil 1", email: "jose@example.test", accountId: "", expires: "2031-12-01", price: 1800 },
    );
    if (process.env.RENEWAL_ISOLATION_ONLY === '1') {
      Object.assign(state.clients[0], { name: 'Ernesto · cliente sintético', service: 'MAX', profile: 'Ernesto', accountId: '', email: 'max@example.test', notes: 'Solo el perfil MAX principal.', expires: '2030-12-31', price: 0, pricePending: true });
      Object.assign(state.clients[1], { name: 'Ernesto · cliente sintético', service: 'PARAMOUNT', profile: 'Ernesto', accountId: '', email: 'paramount@example.test', notes: 'Solo el perfil PARAMOUNT.', expires: '2030-12-20', price: 0, pricePending: true,
        serviceHistory: [{ id: 'paramount-previous', service: 'PARAMOUNT anterior', accountId: '', profile: 'Perfil anterior', expires: '2026-09-01', price: 500, endedAt: '2026-09-01T12:00:00.000Z' }] });
      state.clients.push({ ...state.clients[0], id: 'ernesto-second-max', service: 'MAX', profile: 'Ernesto segundo perfil', email: 'max-second@example.test', notes: 'Otra ficha independiente de la misma plataforma.', expires: '2031-09-15', price: 1250, pricePending: false, serviceHistory: [] });
      state.ledger = [{ id: 'paramount-previous-payment', kind: 'sale', date: '2026-10-01', description: 'Pago anterior sintético', clientId: 'maria-disney', service: 'PARAMOUNT', amount: 500 }];
    }
    if (process.env.NATIVE_CONTACT_ONLY === '1' || process.env.MANUAL_LINK_ONLY === '1') {
      const { emptyGrowth } = await import(path.join(root, 'growth.mjs'));
      state.clients[0].serviceHistory = [{ id: 'history-native', service: 'Max anterior', accountId: '', profile: 'Perfil anterior', expires: '2026-09-01', price: 1000, endedAt: '2026-09-01T12:00:00.000Z' }];
      state.ledger = [{ id: 'payment-native', kind: 'sale', date: '2026-10-01', description: 'Pago histórico de ejemplo', clientId: 'maria-demo', service: 'Netflix', amount: 2500 }];
      state.growth = emptyGrowth();
      state.growth.interactions.push({ id: 'conversation-native', name: 'Conversación histórica de ejemplo', clientId: 'maria-demo', network: 'WhatsApp', kind: 'received_manual', body: 'Registro histórico de prueba conservado', agent: 'Propietario', outcome: 'open', occurredAt: '2026-10-01T12:00:00.000Z' });
    }
    await context.route("https://crm.test/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (["/", "/companion"].includes(url.pathname)) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Sesión CRM de prueba</title><p>Puente autenticado de prueba</p>" });
      if (sessionExpired && url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, json: { error: "Sesión de prueba caducada." } });
      let json;
      if (url.pathname === "/api/session") {
        if (sessionExpired) return route.fulfill({ status: 401, json: { error: "Sesión de prueba caducada." } });
        json = { email: "operador@example.test", csrf: "csrf-de-prueba", mode: "server", authProvider: "cloudflare-access" };
      }
      else if (url.pathname === "/api/workspace" && request.method() === "GET") {
        workspaceReads++;
        if (initialWorkspaceFailures > 0) {
          initialWorkspaceFailures--;
          return route.fulfill({ status: 503, json: { error: 'No se pudo leer la base de datos de prueba. Intenta actualizar.' } });
        }
        json = structuredClone({ state, revision });
        if (holdWorkspaceRead) {
          workspaceReadPending = true;
          await new Promise(resolve => { releaseWorkspaceRead = resolve; });
          holdWorkspaceRead = false;
          workspaceReadPending = false;
        }
      }
      else if (url.pathname === "/api/workspace" && request.method() === "PUT") {
        assert.equal(request.headers()["x-csrf-token"], "csrf-de-prueba");
        writeAttempts++;
        const input = request.postDataJSON();
        if (process.env.RENEWAL_ISOLATION_ONLY === '1') submittedWorkspaces.push(structuredClone(input));
        if (rejectNextWrite) {
          rejectNextWrite = false;
          return route.fulfill({ status: 503, json: { error: "Conexión de prueba interrumpida. Vuelve a intentar guardar." } });
        }
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
    const crm = await context.newPage(); pages.set(crm, nextTabId++); await crm.goto("https://crm.test/");
    whatsapp = await context.newPage(); pages.set(whatsapp, nextTabId++); await whatsapp.goto("https://web.whatsapp.com/");
    async function installPlainNativePane(name, { outsideNativeApp = false, insideMain = false } = {}) {
      await whatsapp.evaluate(({ name, outsideNativeApp, insideMain }) => {
        document.querySelector('#fixture-plain-contact-pane')?.remove();
        const pane = document.createElement('div');
        pane.id = 'fixture-plain-contact-pane';
        pane.style.cssText = 'position:absolute;right:0;top:0;width:300px;height:100%;z-index:4;background:#fff;padding:0;overflow:auto';
        const header = document.createElement('header');
        header.style.cssText = 'padding:20px 16px;height:66px;background:#f0f2f5';
        const heading = document.createElement('span'); heading.textContent = 'Info. del contacto';
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.style.cssText = 'border:0;background:none;font-size:24px;margin-right:12px';
        close.addEventListener('click', () => pane.remove());
        header.append(close, heading);
        const profile = document.createElement('div'); profile.style.cssText = 'padding:24px 16px;text-align:center';
        const avatar = document.createElement('div'); avatar.style.cssText = 'margin:0 auto 20px;background:#e0e6e9;border-radius:50%;height:90px;width:90px';
        const identity = document.createElement('h2'); identity.textContent = name; identity.style.fontSize = '24px';
        const phone = document.createElement('span'); phone.id = 'fixture-plain-phone'; phone.style.cssText = 'display:block;font-size:19px;color:#667781';
        const national = document.createElement('span'); national.textContent = '999 999 999'; phone.append(document.createTextNode('+51 '), national);
        profile.append(avatar, identity, phone);
        const actions = document.createElement('div'); actions.style.cssText = 'display:flex;justify-content:space-around;padding:15px';
        for (const label of ['Llamar', 'Video', 'Buscar']) { const item = document.createElement('span'); item.textContent = label; actions.append(item); }
        const note = document.createElement('p'); note.textContent = 'Añade notas sobre tu cliente'; note.style.padding = '16px';
        pane.append(header, profile, actions, note);
        (outsideNativeApp ? document.body : insideMain ? document.querySelector('#main') : document.querySelector('#main').parentElement).append(pane);
      }, { name, outsideNativeApp, insideMain });
    }
    if (process.env.NATIVE_CONTACT_ONLY === '1') {
      await whatsapp.evaluate(() => {
        const title = document.querySelector('#main header span[title]');
        title.title = 'Contacto guardado · ejemplo'; title.textContent = title.title;
        document.querySelectorAll('#main .history [data-id]').forEach(node => node.removeAttribute('data-id'));
      });
      await installPlainNativePane('Contacto guardado · ejemplo');
    }
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
    async function until(predicate, message) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error(message);
    }
    async function submit(formId, dialogId) {
      await embedded.locator(`${formId} button[type="submit"]`).click();
      await until(() => appFrame.evaluate(id => !document.querySelector(id)?.open, dialogId), `El formulario ${formId} no confirmó el guardado.`);
    }
    async function setProfile(value) {
      const profile = embedded.locator('#compact-client-profile-select');
      assert.equal(await embedded.locator('#compact-client-form [name="profile"]').isVisible(), false, 'Una cuenta elegida debe mostrar solo su selector de perfiles libres.');
      if (await profile.evaluate(node => node.tagName === "SELECT")) await profile.selectOption(value);
      else await profile.fill(value);
    }
    async function switchChat({ name, phone = "", peer }) {
      await whatsapp.evaluate(({ name, phone, peer }) => {
        const title = document.querySelector('#main header [title]');
        title.title = phone || name;
        title.textContent = phone || name;
        document.querySelector('#main header small').textContent = name;
        for (const [index, item] of [...document.querySelectorAll('#main .history > [data-id]')].entries()) item.dataset.id = `false_${peer}_${index}`;
      }, { name, phone, peer });
      await until(async () => {
        const ctx = await appFrame.evaluate(() => globalThis.NexoCompanion.getContext());
        return ctx.name === (phone || name) && ctx.chatId === `wa:${peer}`;
      }, "El adaptador no reconoció el cambio de conversación.");
      const expectedPhone = phone.replace(/\D/g, '');
      const expectedName = state.clients.find(item => expectedPhone && item.phone === expectedPhone)?.name || phone || name;
      await until(async () => (await embedded.locator('#compact-chat-name').innerText()).includes(expectedName), "La ficha compacta no cambió junto con la conversación.");
    }
    const service = id => embedded.locator(`.compact-service[data-client-id="${id}"]`);
    const serviceAction = (id, action) => service(id).locator(`[data-action="${action}"]`);
    async function clickServiceAction(id, action) {
      const target = serviceAction(id, action);
      if (!(await target.isVisible())) await service(id).locator('.compact-service-more > summary').click();
      await target.click();
    }
    async function fillClientNotes(value) {
      const notes = embedded.locator('#compact-client-form [name="notes"]');
      if (!(await notes.isVisible())) await embedded.locator('#compact-client-form summary').filter({ hasText: 'Correo, PIN y notas' }).click();
      await notes.fill(value);
    }
    assert.equal(await embedded.locator('body').evaluate(node => node.classList.contains('nexo-compact')), true);
    for (const id of ["chat", "clients", "accounts"]) await embedded.locator(`#compact-tab-${id}`).waitFor({ state: "visible" });
    assert.equal(await embedded.locator('[id^="compact-tab-"]:visible').count(), 3);
    assert.equal(await embedded.locator('#nexo-module-select:visible').count(), 0, "El menú de catorce módulos no debe aparecer en la extensión compacta.");
    assert.equal(await embedded.locator('#summary:visible, .mode-banner:visible, .hero:visible, .crm-sidebar:visible').count(), 0, "La extensión no debe mostrar el tablero, los avisos y la navegación de la web completa.");
    if (process.env.INITIAL_LOAD_FAILURE_ONLY === '1') {
      await embedded.locator('#compact-load-error').waitFor({ state: 'visible' });
      assert.match(await embedded.locator('#compact-load-error').innerText(), /No se pudieron cargar/);
      assert.equal(state.clients.length, 3);
      assert.equal(state.accounts.length, 1);
      assert.equal(state.ledger.length, 0);
      assert.equal(writes, 0);
      const originalFrameUrl = appFrame.url();
      for (const tabName of ['chat', 'clients', 'accounts']) {
        await embedded.locator('#compact-tab-' + tabName).click();
        await embedded.locator('#compact-load-error').waitFor({ state: 'visible' });
        assert.equal(await embedded.locator('#compact-new-client:visible, #compact-add-service:visible, #compact-new-account:visible, .compact-service:visible, #compact-client-list:visible, #compact-account-list:visible').count(), 0, 'Un fallo de lectura no puede presentarse como un CRM vacío con botones para crear datos.');
        assert.doesNotMatch(await embedded.locator('#compact-content').innerText(), /Cliente nuevo|Sin cuentas registradas|Sin coincidencias/);
      }
      await embedded.locator('#compact-tab-chat').click();
      await embedded.locator('#compact-refresh').click();
      await service('maria-demo').waitFor({ state: 'visible' });
      await service('maria-disney').waitFor({ state: 'visible' });
      assert.equal(await embedded.locator('#compact-load-error').count(), 0);
      assert.equal(await embedded.locator('body.nexo-setup').count(), 0);
      assert.equal(appFrame.url(), originalFrameUrl, 'Actualizar debe recuperar los datos en el mismo panel sin recargar la configuración.');
      assert.equal(pages.size, 2);
      assert.equal(workspaceReads, 2, 'La recuperación de la misma revisión debe hacer una nueva lectura real.');
      assert.equal(writes, 0, 'Reintentar una lectura no puede sobrescribir la base de datos.');
      assert.equal(state.clients.length, 3);
      assert.equal(state.accounts.length, 1);
      assert.deepEqual(errors, []);
      console.log('Compact initial-load failure: 503 is visible across all tabs without false empty lists or create actions; Actualizar reads the same revision and restores both services in the same frame without writes or setup.');
      return;
    }
    await service("maria-demo").waitFor({ state: "visible" });
    await service("maria-disney").waitFor({ state: "visible" });
    assert.equal(await service("jose-demo").count(), 0, "El chat actual solo debe mostrar las fichas de ese teléfono.");
    assert.match(await embedded.locator('#compact-chat-phone').innerText(), /51.*999/);

    if (process.env.RENEWAL_ISOLATION_ONLY === '1') {
      const maxId = 'maria-demo', paramountId = 'maria-disney', otherMaxId = 'ernesto-second-max';
      const renewDialog = embedded.locator('#compact-renew-dialog');
      const renewForm = embedded.locator('#compact-renew-form');
      const getClient = id => state.clients.find(item => item.id === id);
      const displayDate = value => value.split('-').reverse().join('/');
      const beforeAll = structuredClone(state);
      async function beginRenew(id, expires, { amount = '', paid = false } = {}) {
        const before = structuredClone(getClient(id));
        await clickServiceAction(id, 'renew');
        await renewDialog.waitFor({ state: 'visible' });
        assert.match(await renewDialog.locator('h2').innerText(), new RegExp(before.service));
        assert.match(await renewDialog.innerText(), /Ernesto/);
        assert.equal(await renewDialog.getByText(before.profile, { exact: true }).count(), 1, 'El formulario debe identificar el perfil concreto antes de confirmar.');
        assert.equal(await renewDialog.getByText(displayDate(before.expires), { exact: true }).count(), 1, 'El vencimiento anterior identifica qué fecha cambiará.');
        assert.equal(await renewForm.locator('button[type="submit"]').innerText(), 'Renovar ' + before.service);
        assert.match(await renewDialog.innerText(), /Solo se renovará este servicio/);
        await renewForm.locator('[name="expires"]').fill(expires);
        await renewForm.locator('[name="amount"]').fill(amount);
        await renewForm.locator('[name="paid"]').setChecked(paid);
      }
      async function assertSingleRenew(id, expires, operation, { paid = false, amount = 0 } = {}) {
        const before = structuredClone(state), savedWrites = writes;
        await operation();
        await until(() => writes === savedWrites + 1, 'La renovación debe confirmar exactamente una escritura del servicio seleccionado.');
        await until(() => appFrame.evaluate(() => !document.querySelector('#compact-renew-dialog')?.open), 'La renovación confirmada debe cerrar su propio formulario.');
        const expectedClients = before.clients.map(client => client.id === id ? { ...client, expires } : client);
        assert.deepEqual(state.clients, expectedClients, 'Renovar un servicio debe conservar byte por byte los otros productos, incluso los del mismo teléfono y perfil.');
        assert.equal(await embedded.locator('#companion-status').innerText(), `${getClient(id).service} renovado hasta el ${displayDate(expires)}.`, 'La confirmación identifica la plataforma y la fecha guardadas.');
        for (const key of Object.keys(before).filter(key => !['clients', 'ledger'].includes(key))) assert.deepEqual(state[key], before[key], 'La renovación no debe alterar el módulo ' + key);
        assert.deepEqual(state.ledger.slice(0, before.ledger.length), before.ledger, 'Los cobros anteriores deben conservarse exactamente.');
        const newPayments = state.ledger.slice(before.ledger.length);
        assert.equal(newPayments.length, paid ? 1 : 0);
        if (paid) assert.deepEqual({ clientId: newPayments[0].clientId, service: newPayments[0].service, amount: newPayments[0].amount, kind: newPayments[0].kind }, { clientId: id, service: getClient(id).service, amount, kind: 'renewal' });
        assert.equal(new Set(state.clients.map(client => client.id)).size, state.clients.length);
        assert.equal(state.clients.length, beforeAll.clients.length);
      }
      // Opening, editing and cancelling another product must neither queue a
      // renewal nor leave its old handler attached to the next product's form.
      await beginRenew(paramountId, '2031-02-20', { amount: '5.00', paid: true });
      await renewDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await until(() => appFrame.evaluate(() => document.querySelectorAll('#compact-renew-dialog').length === 0), 'Cancelar debe retirar el formulario anterior.');
      assert.deepEqual(state, beforeAll);
      assert.equal(writeAttempts, 0);
      await beginRenew(maxId, '2031-01-30');
      await assertSingleRenew(maxId, '2031-01-30', () => submit('#compact-renew-form', '#compact-renew-dialog'));
      assert.equal(getClient(paramountId).expires, '2030-12-20');
      assert.equal(getClient(otherMaxId).expires, '2031-09-15');

      await beginRenew(paramountId, '2031-02-20', { amount: '5.00', paid: true });
      await assertSingleRenew(paramountId, '2031-02-20', () => submit('#compact-renew-form', '#compact-renew-dialog'), { paid: true, amount: 500 });

      // Exercise the actual context broadcast and automatic workspace poll while
      // a MAX renewal is open. Its fixed product identity must not change.
      await beginRenew(maxId, '2031-03-01', { amount: '11.00', paid: true });
      await until(() => appFrame.evaluate(() => typeof window.__nexoWorkspacePoll === 'function'), 'La prueba necesita el sondeo real del CRM.');
      await appFrame.evaluate(async () => { window.__nexoWorkspacePoll(); await globalThis.NexoCompanion.getContext(); });
      const beforeFailure = structuredClone(state), beforeFailureWrites = writes;
      rejectNextWrite = true;
      await renewForm.locator('button[type="submit"]').click();
      await until(async () => /interrumpida|no se guard/i.test(await embedded.locator('#compact-renew-error').innerText()), 'El fallo de conexión debe quedar en el mismo formulario de MAX.');
      assert.equal(writes, beforeFailureWrites);
      assert.deepEqual(state, beforeFailure);
      assert.equal(await renewForm.locator('[name="expires"]').inputValue(), '2031-03-01');
      assert.match(await renewDialog.locator('h2').innerText(), /MAX/);
      await assertSingleRenew(maxId, '2031-03-01', () => submit('#compact-renew-form', '#compact-renew-dialog'), { paid: true, amount: 1100 });

      // An external edit of PARAMOUNT while MAX is being renewed must survive
      // the failed stale write and the later refresh/retry.
      await beginRenew(maxId, '2031-04-01');
      state = structuredClone(state);
      state.clients.find(client => client.id === paramountId).notes = 'Cambio externo de PARAMOUNT que MAX debe conservar.';
      revision++;
      const externalWorkspace = structuredClone(state), beforeConflictWrites = writes;
      await renewForm.locator('button[type="submit"]').click();
      await until(async () => /cambiaron en otra sesión/i.test(await embedded.locator('#compact-renew-error').innerText()), 'Una revisión antigua no puede sobrescribir PARAMOUNT.');
      assert.equal(writes, beforeConflictWrites);
      assert.deepEqual(state, externalWorkspace);
      await renewDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await embedded.locator('#compact-refresh').click();
      await beginRenew(maxId, '2031-04-01');
      await assertSingleRenew(maxId, '2031-04-01', () => submit('#compact-renew-form', '#compact-renew-dialog'));
      assert.equal(getClient(paramountId).expires, '2031-02-20');
      assert.equal(getClient(paramountId).notes, 'Cambio externo de PARAMOUNT que MAX debe conservar.');
      assert.equal(getClient(otherMaxId).expires, '2031-09-15');
      assert.equal(writes, 4);
      assert.equal(writeAttempts, 6, 'Cuatro renovaciones confirmadas más un fallo 503 y un rechazo 409, sin envíos ocultos.');
      assert.equal(submittedWorkspaces.length, writeAttempts);
      assert.deepEqual(errors, []);
      console.log('Renewal isolation: cancelled/reopened PARAMOUNT, repeated MAX renewals, same-customer same-profile and second-MAX records, paid/unpaid ledger entries, context/poll while dialog open, 503 retry and 409 external-edit preservation all passed with exact non-target state equality.');
      console.log('This exercises synthetic records through the packaged UI/background/CRM bridge, not the owner\'s browser or production database.');
      return;
    }

    if (process.env.MANUAL_LINK_ONLY === '1') {
      // Regression for the reported contact whose ficha exists in Clientes but
      // whose open native chat exposes neither a readable phone nor peer ID.
      // Linking selects existing services; it must never write another ficha.
      const beforeWorkspace = structuredClone(state);
      const beforeWrites = writes;
      let activeEmbedded = embedded, activeFrame = appFrame;
      const linkedService = id => activeEmbedded.locator(`.compact-service[data-client-id="${id}"]`);
      const manualContext = () => activeFrame.evaluate(() => globalThis.NexoCompanion.getContext());
      async function manualChat({ name, peer = '', selected = 0 }) {
        await whatsapp.evaluate(({ name, peer, selected }) => {
          const list = document.querySelector('.contacts'); list.id = 'pane-side';
          const rows = [...list.querySelectorAll('.contact')];
          for (const [index, row] of rows.entries()) {
            row.setAttribute('aria-selected', String(index === selected));
            row.classList.toggle('selected', index === selected);
          }
          const title = document.querySelector('#main header span[title]');
          title.title = name; title.textContent = name;
          for (const [index, item] of [...document.querySelectorAll('#main .history > div')].filter(node => node.querySelector('.message-in,.message-out')).entries()) {
            if (peer) item.dataset.id = `false_${peer}_${index}`;
            else item.removeAttribute('data-id');
          }
        }, { name, peer, selected });
        await until(async () => {
          const value = await manualContext();
          return value.name === name && !value.ambiguous && (peer ? value.chatId === `wa:${peer}` : value.chatId.startsWith('session:'));
        }, 'El chat individual debe tener un ancla temporal para confirmar el vínculo aunque WhatsApp oculte su teléfono.');
        // Let the actual context broadcast/poll reach the embedded UI before
        // clicking a control rendered for the preceding conversation.
        await activeFrame.waitForTimeout(1400);
      }
      async function openSearch(query) {
        await activeEmbedded.locator('#compact-open-link').click();
        await activeEmbedded.locator('#compact-link-search').fill(query);
      }
      async function chooseMaria(query = 'María') {
        await openSearch(query);
        assert.equal(await activeEmbedded.locator('#compact-link-results button[data-client-id="maria-demo"]').count(), 1, 'La búsqueda reúne las fichas del mismo teléfono en un solo contacto.');
        assert.equal(await activeEmbedded.locator('#compact-link-results button[data-client-id="maria-disney"]').count(), 0);
        if (query.startsWith('+51')) {
          fs.mkdirSync('/workspace/work/deliverables', { recursive: true });
          await whatsapp.screenshot({ path: '/workspace/work/deliverables/manual-link-search-example.png', fullPage: true });
        }
        await activeEmbedded.locator('#compact-link-results button[data-client-id="maria-demo"]').click();
        await linkedService('maria-demo').waitFor({ state: 'visible' });
        await linkedService('maria-disney').waitFor({ state: 'visible' });
        if (query.startsWith('+51')) await whatsapp.screenshot({ path: '/workspace/work/deliverables/manual-link-connected-example.png', fullPage: true });
      }
      async function unlink() {
        await activeEmbedded.getByText('Chat vinculado', { exact: true }).click();
        await activeEmbedded.locator('#compact-unbind').click();
        await until(async () => !(await manualContext()).phone && await linkedService('maria-demo').count() === 0, 'Desvincular debe retirar la ficha del chat sin borrarla del CRM.');
      }
      const alias = 'Anto · contacto sintético';
      await manualChat({ name: alias });
      await until(async () => await linkedService('maria-demo').count() === 0, 'No se debe adivinar un cliente por su alias.');
      const originalSession = (await manualContext()).chatId;
      assert.equal((await manualContext()).phone, '');
      await chooseMaria('+51 999 999 999');
      assert.equal((await manualContext()).phone, '51999999999');
      assert.equal((await manualContext()).phoneSource, 'manual');
      assert.match(await activeEmbedded.locator('#compact-chat-name').innerText(), /María/);
      await activeEmbedded.getByText('Información e historial', { exact: true }).click();
      await activeEmbedded.getByText('Max anterior', { exact: true }).waitFor({ state: 'visible' });
      await activeEmbedded.locator('#compact-content').getByText('01/10/2026', { exact: true }).waitFor({ state: 'visible' });
      await activeEmbedded.getByText('Conversación guardada', { exact: true }).click();
      await activeEmbedded.locator('.compact-conversation-entry').filter({ hasText: 'Registro histórico de prueba conservado' }).waitFor({ state: 'visible' });
      assert.deepEqual(state, beforeWorkspace, 'Un vínculo no crea fichas ni modifica pagos, servicios o conversaciones.');
      assert.equal(writes, beforeWrites);

      // A different native selected row with the identical alias is another
      // chat. A previous explicit session confirmation cannot follow its name.
      await manualChat({ name: alias, selected: 1 });
      await until(async () => !(await manualContext()).phone && await linkedService('maria-demo').count() === 0, 'Otro chat con el mismo alias no puede heredar el vínculo temporal.');
      assert.notEqual((await manualContext()).chatId, originalSession);
      const stale = await activeFrame.evaluate(async chatId => {
        try { await globalThis.NexoCompanion.bindConversation({ chatId, name: 'Anto · contacto sintético', phone: '51999999999' }); return 'unexpected'; }
        catch (error) { return error.message; }
      }, originalSession);
      assert.match(stale, /cambió|segura|revisa/i, 'Una selección guardada antes de navegar debe rechazarse.');
      assert.equal((await manualContext()).phone, '');
      await chooseMaria('María');
      await unlink();
      assert.deepEqual(state, beforeWorkspace);
      assert.equal(writes, beforeWrites);

      // A proven opaque peer can be recognized after page reload. Persistence
      // is exact-peer plus configured CRM, never an alias-only association.
      await manualChat({ name: alias, peer: 'persistent-manual@lid' });
      await chooseMaria('999999999');
      assert.equal((await manualContext()).phoneSource, 'manual');
      await whatsapp.reload();
      await whatsapp.evaluate(({ name }) => {
        const title = document.querySelector('#main header span[title]'); title.title = name; title.textContent = name;
        for (const [index, item] of [...document.querySelectorAll('#main .history > [data-id]')].entries()) item.dataset.id = `false_persistent-manual@lid_${index}`;
      }, { name: alias });
      await whatsapp.evaluate(fs.readFileSync(path.join(unpacked, 'whatsapp.js'), 'utf8'));
      await whatsapp.evaluate(fs.readFileSync(path.join(unpacked, 'dock.js'), 'utf8'));
      const reloadedElement = whatsapp.locator('#nexo-whatsapp-dock').locator('iframe#nexo-crm-frame');
      await reloadedElement.waitFor({ state: 'visible' });
      activeEmbedded = await reloadedElement.contentFrame();
      activeFrame = await (await reloadedElement.elementHandle()).contentFrame();
      await activeEmbedded.locator('#companion-workspace').waitFor({ state: 'visible', timeout: 20000 });
      await linkedService('maria-demo').waitFor({ state: 'visible' });
      await linkedService('maria-disney').waitFor({ state: 'visible' });
      assert.equal((await manualContext()).phoneSource, 'manual');
      await unlink();
      await manualChat({ name: 'Otro chat de ejemplo', peer: 'other-manual@lid', selected: 1 });
      await manualChat({ name: alias, peer: 'persistent-manual@lid', selected: 0 });
      assert.equal((await manualContext()).phone, '', 'Un vínculo eliminado no puede restaurarse al volver a su peer.');
      assert.equal(await linkedService('maria-demo').count(), 0);
      assert.deepEqual(state, beforeWorkspace);
      assert.equal(writes, beforeWrites);
      assert.equal(pages.size, 2, 'Todo el vínculo se realiza dentro de WhatsApp, sin pestañas de trabajo adicionales.');
      assert.deepEqual(errors, []);
      console.log('Manual existing-contact link: unrecognized native chat, name/spaced-phone search, grouped services and prior history restored without CRM writes, same-alias navigation/stale selection rejected, exact-peer reload restored, unlink leaves CRM intact.');
      console.log('This exercises the packaged extension in a synthetic native-chat fixture, not the owner\'s Chrome session.');
      return;
    }

    if (process.env.NATIVE_CONTACT_ONLY === '1') {
      // The reported real pane exposes ordinary text, not the data-testid,
      // aria-label or tel-link contracts used by the older idealized fixture.
      // This approximates the screenshot's structure; it is not a real WA DOM.
      const plainName = 'Contacto guardado · ejemplo';
      const nativeContext = () => appFrame.evaluate(() => globalThis.NexoCompanion.getContext());
      async function nativeChat(peer = '') {
        await whatsapp.evaluate(({ name, peer }) => {
          const title = document.querySelector('#main header span[title]');
          title.title = name; title.textContent = name;
          for (const [index, item] of [...document.querySelectorAll('#main .history > div')].filter(node => node.querySelector('.message-in,.message-out')).entries()) {
            if (peer) item.dataset.id = `false_${peer}_${index}`;
            else item.removeAttribute('data-id');
          }
        }, { name: plainName, peer });
        await until(async () => (await nativeContext()).name === plainName, 'El encabezado de ejemplo debe reflejar el chat guardado.');
      }
      const plainPane = (name = plainName, outsideNativeApp = false, insideMain = false) => installPlainNativePane(name, { outsideNativeApp, insideMain });
      assert.equal((await nativeContext()).phone, '51999999999', 'Un panel nativo ya abierto al cargar la extensión debe identificar tras confirmar un encabezado estable.');
      await service('maria-demo').waitFor({ state: 'visible' });
      await whatsapp.locator('#fixture-plain-contact-pane').evaluate(node => node.remove());
      await nativeChat();
      await until(async () => !(await nativeContext()).phone && await service('maria-demo').count() === 0, 'Un alias no puede seleccionar por sí solo una ficha.');
      await whatsapp.locator('.history .message-in .selectable-text').first().evaluate((node, name) => {
        node.replaceChildren();
        const fakeHeading = document.createElement('header'); fakeHeading.textContent = 'Info. del contacto';
        const fakeIdentity = document.createElement('h2'); fakeIdentity.textContent = name;
        const fakePhone = document.createElement('span'); fakePhone.textContent = '+51 999 999 999';
        node.append(fakeHeading, fakeIdentity, fakePhone);
      }, plainName);
      assert.equal((await nativeContext()).phone, '', 'Un número dentro de un mensaje no identifica al destinatario.');
      await whatsapp.locator('.history .message-in .selectable-text').first().evaluate(node => { node.textContent = 'Hola, necesito revisar mi servicio registrado.'; });
      await plainPane('Otro contacto');
      await nativeContext();
      assert.equal((await nativeContext()).phone, '', 'El panel de otro nombre no puede seleccionar al cliente.');
      await plainPane();
      assert.equal(await whatsapp.locator('#fixture-plain-contact-pane [data-testid], #fixture-plain-contact-pane [role], #fixture-plain-contact-pane [aria-label], #fixture-plain-contact-pane a[href^="tel:"]').count(), 0);
      await service('maria-demo').waitFor({ state: 'visible' });
      await service('maria-disney').waitFor({ state: 'visible' });
      assert.equal((await nativeContext()).phone, '51999999999');
      assert.match(await embedded.locator('#compact-chat-name').innerText(), /María/);
      await embedded.getByText('Información e historial', { exact: true }).click();
      await embedded.getByText('Max anterior', { exact: true }).waitFor({ state: 'visible' });
      await embedded.locator('#compact-content').getByText('01/10/2026', { exact: true }).waitFor({ state: 'visible' });
      await embedded.getByText('Conversación guardada', { exact: true }).click();
      await embedded.locator('.compact-conversation-entry').filter({ hasText: 'Registro histórico de prueba conservado' }).waitFor({ state: 'visible' });
      const screenshot = process.env.NATIVE_CONTACT_SCREENSHOT || '/workspace/work/deliverables/native-contact-panel-example.png';
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await appFrame.evaluate(() => { document.scrollingElement.scrollTop = 0; });
      await whatsapp.screenshot({ path: screenshot, fullPage: true });
      await whatsapp.locator('#fixture-plain-phone').evaluate(node => { node.hidden = true; });
      await until(async () => !(await nativeContext()).phone, 'Un número oculto no puede autorizar una ficha sin peer.');
      await whatsapp.locator('#fixture-plain-phone').evaluate(node => { node.hidden = false; });
      await service('maria-demo').waitFor({ state: 'visible' });
      await whatsapp.locator('#fixture-plain-phone').evaluate(node => {
        const second = document.createElement('span'); second.id = 'fixture-plain-second-phone'; second.style.display = 'block'; second.textContent = '+51 988 888 888'; node.after(second);
      });
      await until(async () => !(await nativeContext()).phone && await service('maria-demo').count() === 0, 'Dos números visibles en la identidad requieren aclaración.');
      await whatsapp.locator('#fixture-plain-second-phone').evaluate(node => node.remove());
      await service('maria-demo').waitFor({ state: 'visible' });
      await whatsapp.locator('#fixture-plain-contact-pane').evaluate(node => node.remove());
      await until(async () => !(await nativeContext()).phone, 'Sin peer, retirar el panel visible debe retirar el teléfono observado.');
      await plainPane(plainName, false, true);
      await whatsapp.locator('#fixture-plain-contact-pane h2').evaluate(node => {
        const wrapper = document.createElement('div'), nested = document.createElement('div'), text = document.createElement('span');
        text.textContent = node.textContent; text.style.cssText = 'display:block;font-size:24px;margin:18px 0';
        nested.append(text); wrapper.append(nested); node.replaceWith(wrapper);
      });
      await service('maria-demo').waitFor({ state: 'visible' });
      assert.equal((await nativeContext()).phone, '51999999999', 'Un panel nativo dentro del contenedor exterior del chat admite nombres de texto anidados sin atributos de prueba.');
      await whatsapp.locator('#fixture-plain-contact-pane').evaluate(node => node.remove());
      await until(async () => !(await nativeContext()).phone, 'El panel anidado sin peer tampoco puede dejar una identidad basada solo en el nombre.');
      await nativeChat('native-same-name-a@lid');
      await plainPane();
      await service('maria-demo').waitFor({ state: 'visible' });
      await whatsapp.locator('#fixture-plain-contact-pane > header button').click();
      assert.equal((await nativeContext()).phone, '51999999999', 'Una identidad verificada por peer debe conservar su ficha al cerrar información.');
      await appFrame.waitForTimeout(1300);
      await service('maria-demo').waitFor({ state: 'visible' });
      await plainPane();
      await service('maria-demo').waitFor({ state: 'visible' });
      await whatsapp.locator('footer [contenteditable="true"]').fill('Borrador previo que debe conservarse');
      await nativeChat('native-same-name-b@lid');
      await until(async () => !(await nativeContext()).phone && await service('maria-demo').count() === 0, 'Otro peer con el mismo nombre no puede heredar el panel previo.');
      const prepare = await appFrame.evaluate(async () => {
        try { await globalThis.NexoCompanion.prepareMessage({ phone: '51999999999', text: 'No se debe preparar para otro chat' }); return 'unexpected'; }
        catch (error) { return error.message; }
      });
      assert.match(prepare, /teléfono|vincula|identificar/i);
      assert.equal(await whatsapp.locator('footer [contenteditable="true"]').innerText(), 'Borrador previo que debe conservarse');
      await whatsapp.locator('#fixture-plain-contact-pane').evaluate(node => node.remove());
      await plainPane(plainName, true);
      await nativeContext();
      assert.equal((await nativeContext()).phone, '', 'Un panel de texto externo a la app nativa no puede aportar identidad.');
      assert.equal(writes, 0);
      assert.equal(state.clients.length, 3);
      assert.equal(state.ledger.length, 1);
      assert.equal(state.growth.interactions.length, 1);
      assert.deepEqual(errors, []);
      console.log('Plain native-contact pane: no semantic test attributes, verified registered services/payment/service/conversation history, hidden/multiple/wrong phones rejected, stable-peer close retained and same-name stale peer/draft denied.');
      console.log('This is a screenshot-shaped DOM fixture, not the owner\'s real WhatsApp DOM or Chrome session.');
      return;
    }

    if (process.env.COMPACT_SYNC_RACE_ONLY === '1') {
      await embedded.getByText('Conversación guardada', { exact: true }).click();
      await until(() => appFrame.evaluate(() => typeof window.__nexoWorkspacePoll === 'function'), 'No se registró la sincronización automática.');
      const poll = () => appFrame.evaluate(async () => { window.__nexoWorkspacePoll(); await new Promise(resolve => setTimeout(resolve, 100)); });
      const externalInteraction = id => ({ id, name: 'Conversación desde otra sesión del CRM', clientId: 'jose-demo', network: 'WhatsApp', kind: 'received_manual', body: 'Este registro externo debe conservarse.', agent: 'Propietario', outcome: 'open', occurredAt: '2026-10-26T06:00:00.000Z' });
      holdCapture = true;
      await embedded.locator('#compact-capture').click();
      await until(() => capturePending, 'La captura de prueba no quedó en curso.');
      const readsBeforeBusyPoll = workspaceReads;
      await poll();
      assert.equal(workspaceReads, readsBeforeBusyPoll, 'La sincronización automática no debe leer ni adoptar revisiones durante una captura en curso.');
      state = structuredClone(state);
      state.growth ||= (await import(path.join(root, 'growth.mjs'))).emptyGrowth();
      state.growth.interactions.push(externalInteraction('external-while-capturing'));
      revision++;
      await poll();
      assert.equal(workspaceReads, readsBeforeBusyPoll);
      releaseCapture();
      await until(async () => /cambiaron en otra sesión/i.test(await embedded.locator('#companion-status').innerText()), 'La captura con revisión anterior debe fallar sin borrar la conversación externa.');
      assert.equal(writes, 0);
      assert.deepEqual(state.growth.interactions.map(item => item.id), ['external-while-capturing']);

      await embedded.locator('#compact-refresh').click();
      await until(async () => /Datos actualizados/.test(await embedded.locator('#companion-status').innerText()), 'Actualizar manualmente debe funcionar después de finalizar la captura.');
      await embedded.locator('#compact-capture').click();
      await until(() => writes === 1, 'La captura debe poder reintentarse con la revisión actual.');
      await until(async () => /mensajes guardados/i.test(await embedded.locator('#companion-status').innerText()), 'El reintento debe completar su operación antes de probar otra lectura.');
      assert.equal(state.growth.interactions.length, 4);
      assert.ok(state.growth.interactions.some(item => item.id === 'external-while-capturing'));

      // A read started while idle can finish after capture begins. Its result
      // must also be discarded, otherwise a stale growth input could inherit
      // the newer revision and erase another session's confirmed interaction.
      state = structuredClone(state);
      state.growth.interactions.push(externalInteraction('external-during-held-read'));
      revision++;
      holdWorkspaceRead = true;
      await poll();
      await until(() => workspaceReadPending, 'La lectura de sincronización no quedó pendiente.');
      await whatsapp.locator('.history').evaluate(node => {
        const message = document.createElement('div'); message.dataset.id = 'false_fixture-peer@lid_after-read';
        message.innerHTML = '<div class="message-in"><div data-pre-plain-text="[10:34, 26/10/2026] María: "><span class="selectable-text">Nuevo texto visible después de comenzar la sincronización.</span></div></div>';
        node.append(message);
      });
      holdCapture = true;
      await embedded.locator('#compact-capture').click();
      await until(() => capturePending, 'La segunda captura no quedó pendiente.');
      releaseWorkspaceRead();
      await until(() => !workspaceReadPending, 'La lectura de sincronización no concluyó.');
      await appFrame.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
      releaseCapture();
      await until(async () => /cambiaron en otra sesión/i.test(await embedded.locator('#companion-status').innerText()), 'Una lectura automática que terminó durante la captura no debe actualizar su revisión.');
      assert.equal(writes, 1);
      assert.equal(state.growth.interactions.length, 5);
      assert.ok(state.growth.interactions.some(item => item.id === 'external-during-held-read'));
      assert.equal(state.growth.interactions.some(item => item.body.includes('Nuevo texto visible después')), false);
      assert.deepEqual(errors, []);
      console.log('Compact sync/capture race: automatic reads skip busy capture, in-flight reads do not adopt revisions after capture starts, stale captures get 409, external interactions retained, manual refresh and retry work.');
      return;
    }

    // Direct service actions must persist to the same CRM backend, with no
    // phantom cash when an operator renews without recording a payment.
    await clickServiceAction("maria-demo", "renew");
    await embedded.locator('#compact-renew-form [name="expires"]').fill("2031-11-25");
    await embedded.locator('#compact-renew-form [name="amount"]').fill("");
    await embedded.locator('#compact-renew-form [name="paid"]').uncheck();
    await submit("#compact-renew-form", "#compact-renew-dialog");
    assert.equal(state.clients.find(item => item.id === "maria-demo").expires, "2031-11-25");
    assert.equal(state.ledger.length, 0);
    await clickServiceAction("maria-demo", "renew");
    await embedded.locator('#compact-renew-form [name="expires"]').fill("2031-12-25");
    await embedded.locator('#compact-renew-form [name="amount"]').fill("25.00");
    await embedded.locator('#compact-renew-form [name="paid"]').check();
    await submit("#compact-renew-form", "#compact-renew-dialog");
    assert.equal(state.ledger.length, 1);
    assert.equal(state.ledger[0].amount, 2500);

    await clickServiceAction("maria-demo", "edit");
    await fillClientNotes("Actualizada sin salir de WhatsApp");
    await submit("#compact-client-form", "#compact-client-dialog");
    assert.equal(state.clients.find(item => item.id === "maria-demo").notes, "Actualizada sin salir de WhatsApp");
    assert.equal(state.ledger.length, 1, "Editar una ficha no debe duplicar el cobro de la renovación.");

    rejectNextWrite = true;
    await clickServiceAction("maria-demo", "edit");
    await fillClientNotes("Este cambio requiere confirmar el guardado");
    await embedded.locator('#compact-client-form button[type="submit"]').click();
    await until(async () => /interrumpida|no se pudieron|no se guard/i.test(await embedded.locator('#compact-client-dialog').innerText()), "Un fallo de guardado debe explicar el problema en la ficha abierta.");
    assert.equal(await embedded.locator('#compact-client-dialog').evaluate(node => node.open), true);
    assert.equal(state.clients.find(item => item.id === "maria-demo").notes, "Actualizada sin salir de WhatsApp", "Una operación fallida no puede modificar los datos guardados.");
    assert.equal(await embedded.locator('#compact-client-form [name="notes"]').inputValue(), "Este cambio requiere confirmar el guardado");
    await submit("#compact-client-form", "#compact-client-dialog");
    assert.equal(state.clients.find(item => item.id === "maria-demo").notes, "Este cambio requiere confirmar el guardado");

    // Simulate a confirmed edit from the full CRM while an extension form is
    // open. A stale extension save must fail without erasing the web change.
    await clickServiceAction('maria-demo', 'edit');
    await fillClientNotes('Borrador local con revisión anterior');
    state = structuredClone(state);
    state.clients.find(item => item.id === 'jose-demo').notes = 'Actualizado desde la web del CRM';
    revision++;
    await embedded.locator('#compact-client-form button[type="submit"]').click();
    await until(async () => /cambiaron en otra sesión/i.test(await embedded.locator('#compact-client-error').innerText()), 'El CRM debe rechazar la revisión antigua de la extensión.');
    assert.equal(state.clients.find(item => item.id === 'jose-demo').notes, 'Actualizado desde la web del CRM');
    assert.equal(state.clients.find(item => item.id === 'maria-demo').notes, 'Este cambio requiere confirmar el guardado');
    assert.equal(await embedded.locator('#compact-client-form [name="notes"]').inputValue(), 'Borrador local con revisión anterior');
    await embedded.locator('#compact-client-dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await embedded.locator('#compact-refresh').click();
    await until(async () => /Datos actualizados/.test(await embedded.locator('#companion-status').innerText()), 'Actualizar debe leer la revisión actual del CRM.');
    await clickServiceAction('maria-demo', 'edit');
    await fillClientNotes('Cambio confirmado tras actualizar desde la web');
    await submit('#compact-client-form', '#compact-client-dialog');
    assert.equal(state.clients.find(item => item.id === 'jose-demo').notes, 'Actualizado desde la web del CRM');
    assert.equal(state.clients.find(item => item.id === 'maria-demo').notes, 'Cambio confirmado tras actualizar desde la web');
    assert.equal(state.ledger.length, 1);

    await embedded.locator('#compact-add-service').click();
    assert.equal((await embedded.locator('#compact-client-form [name="phone"]').inputValue()).replace(/\D/g, ""), "51999999999");
    assert.match(await embedded.locator('#compact-client-form [name="name"]').inputValue(), /María/);
    await embedded.locator('#compact-client-form [name="accountId"]').selectOption("netflix-demo");
    await setProfile("Perfil 2");
    await embedded.locator('#compact-client-form [name="expires"]').fill("2031-12-25");
    await embedded.locator('#compact-client-form [name="price"]').fill("");
    await embedded.locator('#compact-client-form [name="paid"]').uncheck();
    await submit("#compact-client-form", "#compact-client-dialog");
    const extra = state.clients.find(item => !["maria-demo", "maria-disney", "jose-demo"].includes(item.id));
    assert.ok(extra, "Añadir servicio debe crear una ficha nueva conservando las existentes.");
    assert.equal(extra.accountId, "netflix-demo");
    assert.equal(extra.profile, "Perfil 2");
    assert.equal(extra.pricePending, true);
    assert.equal(state.ledger.length, 1);
    await clickServiceAction(extra.id, "delete");
    await until(() => !state.clients.some(item => item.id === extra.id), "Eliminar servicio no se reflejó en el CRM.");
    assert.equal(state.clients.length, 3);

    // Clientes is a searchable person list with services inside the ficha.
    await embedded.locator('#compact-tab-clients').click();
    await embedded.locator('#compact-client-search').fill("María");
    assert.equal(await embedded.locator('#compact-client-list button[data-group-key]').count(), 1);
    await embedded.locator('#compact-client-list button[data-group-key]').click();
    await service("maria-demo").waitFor({ state: "visible" });
    await service("maria-disney").waitFor({ state: "visible" });
    await embedded.locator('#compact-edit-contact').click();
    await embedded.locator('#compact-contact-form [name="name"]').fill('María · cliente actualizada');
    await submit('#compact-contact-form', '#compact-contact-dialog');
    assert.equal(state.clients.find(item => item.id === 'maria-demo').name, 'María · cliente actualizada');
    assert.equal(state.clients.find(item => item.id === 'maria-disney').name, 'María · cliente actualizada');
    assert.equal(state.clients.find(item => item.id === 'jose-demo').name, 'José · ejemplo');
    assert.equal(state.ledger.length, 1);

    // Profiles belong to their account. Capacity edits must use real capacity;
    // creating an account must not prefill a guessed number of profiles.
    await embedded.locator('#compact-tab-accounts').click();
    await embedded.locator('#compact-account-list button[data-account-id="netflix-demo"]').click();
    await embedded.locator('#compact-account-detail').waitFor({ state: "visible" });
    assert.equal(await embedded.locator('.compact-profile[data-profile="Perfil 1"]').getAttribute('data-status'), "occupied");
    assert.equal(await embedded.locator('.compact-profile[data-profile="Perfil 2"]').getAttribute('data-status'), "free");
    await embedded.locator('#compact-add-profile').click();
    await until(() => state.accounts.find(item => item.id === "netflix-demo").capacity === 4, "Crear un nuevo perfil no aumentó la capacidad guardada.");
    assert.equal(await embedded.locator('.compact-profile[data-profile="Perfil 4"]').getAttribute('data-status'), "free");
    assert.equal(await embedded.locator('#compact-delete-account').isDisabled(), true, "Una cuenta con perfiles asignados no se puede eliminar.");
    await embedded.getByRole("button", { name: "← Cuentas", exact: true }).click();
    await embedded.locator('#compact-new-account').click();
    assert.equal(await embedded.locator('#compact-account-form [name="capacity"]').inputValue(), "");
    for (const [name, value] of Object.entries({ service: "Max", email: "nueva@example.test", expires: "2031-12-31", capacity: "2" })) await embedded.locator(`#compact-account-form [name="${name}"]`).fill(value);
    await submit("#compact-account-form", "#compact-account-dialog");
    const newAccount = state.accounts.find(item => item.id !== "netflix-demo");
    assert.ok(newAccount);
    assert.equal(newAccount.capacity, 2);
    assert.equal(state.ledger.length, 1);
    await embedded.locator('#compact-account-list button[data-account-id="' + newAccount.id + '"]').click();
    await embedded.locator('#compact-delete-account').click();
    await until(() => state.accounts.length === 1, "No se eliminó la cuenta libre.");

    await embedded.locator('#compact-tab-chat').click();
    await clickServiceAction("maria-demo", "compose");
    const reply = "Hola, María 👋\n\nTu perfil está renovado.\nVence: 25/12/2031";
    await embedded.locator('#compact-message-text').fill(reply);
    await embedded.locator('#compact-copy-message').click();
    await until(() => clipboardWrites.includes(reply), "Copiar debe utilizar el documento de portapapeles de la extensión.");
    assert.equal(await whatsapp.locator('footer [contenteditable="true"]').innerText(), "");
    await embedded.locator('#compact-prepare-message').click();
    await until(async () => (await whatsapp.locator('footer [contenteditable="true"]').innerText()).includes("Tu perfil está renovado"), "Preparar no dejó el borrador en WhatsApp.");
    assert.equal(await whatsapp.locator('#fixture-sent').innerText(), "", "La extensión nunca pulsa Enviar.");
    const previousDraft = await whatsapp.locator('footer [contenteditable="true"]').innerText();
    await embedded.locator('#compact-message-text').fill("Otro mensaje que no debe reemplazar el borrador existente");
    await embedded.locator('#compact-prepare-message').click();
    await until(() => clipboardWrites.includes("Otro mensaje que no debe reemplazar el borrador existente"), "Un borrador previo debe conservarse y el mensaje nuevo copiarse.");
    assert.equal(await whatsapp.locator('footer [contenteditable="true"]').innerText(), previousDraft);

    await embedded.getByText("Conversación guardada", { exact: true }).click();
    await embedded.locator('#compact-capture').click();
    await until(() => state.growth.interactions.length === 3, "Guardar conversación debe registrar solo los textos visibles vinculados.");
    assert.ok(state.growth.interactions.every(item => item.clientId === "maria-demo"));

    // An already-started capture must not commit after the panel is hidden,
    // even when the operator reopens it before the transport returns.
    const writesBeforeInterruptedCapture = writes;
    await whatsapp.locator('.history').evaluate(node => {
      const message = document.createElement('div');
      message.dataset.id = 'false_fixture-peer@lid_interrupted';
      message.innerHTML = '<div class="message-in"><div data-pre-plain-text="[10:33, 25/10/2026] María: "><span class="selectable-text">Este texto no se guarda tras ocultar el panel.</span></div></div>';
      node.append(message);
    });
    holdCapture = true;
    await embedded.locator('#compact-capture').click();
    await until(() => capturePending, "La captura de prueba no quedó pendiente.");
    await host.getByRole('button', { name: 'Cerrar Nexo CRM', exact: true }).click();
    await until(() => appFrame.evaluate(() => !globalThis.NexoCompanion.isVisible()), "Cerrar el dock debe informar que el CRM dejó de estar visible.");
    await host.getByRole('button', { name: 'Abrir Nexo CRM', exact: true }).click();
    await until(() => appFrame.evaluate(() => globalThis.NexoCompanion.isVisible()), "Reabrir el dock debe restaurar la visibilidad.");
    releaseCapture();
    await until(async () => /captura se detuvo/i.test(await embedded.locator('#companion-status').innerText()), "La captura previa debe cancelarse al cerrar y reabrir.");
    assert.equal(state.growth.interactions.length, 3);
    assert.equal(writes, writesBeforeInterruptedCapture);
    assert.equal(await embedded.locator('#compact-auto-capture').isChecked(), false);
    await whatsapp.locator('[data-id="false_fixture-peer@lid_interrupted"]').evaluate(node => node.remove());

    // Reproduce the screenshots: named chats can hide their phone. A switch
    // must clear the previous customer's number/card until explicitly linked.
    await switchChat({ name: "Valeria · ejemplo", peer: "valeria-fixture@lid" });
    await until(async () => (await service("maria-demo").count()) === 0, "Se conservó la ficha de María en otro chat.");
    assert.doesNotMatch(await embedded.locator('#compact-chat-phone').innerText(), /51999999999/);
    await embedded.locator('#compact-open-link').click();
    await embedded.locator('#compact-link-search').fill("María");
    assert.equal(await service("maria-demo").count(), 0, "Buscar un cliente sin confirmar no debe seleccionar su ficha.");
    await switchChat({ name: "Nicol · ejemplo", peer: "nicol-fixture@lid" });
    await embedded.locator('#compact-open-link').click();
    assert.equal(await embedded.locator('#compact-link-search').inputValue(), "", "La búsqueda sin vincular debe borrarse al cambiar de chat.");
    assert.equal(await service("maria-demo").count(), 0);
    await embedded.locator('#compact-link-search').fill("José");
    await embedded.locator('#compact-link-results button[data-client-id="jose-demo"]').click();
    await service("jose-demo").waitFor({ state: "visible" });
    assert.equal((await appFrame.evaluate(() => globalThis.NexoCompanion.getContext())).phone, "51988888888");
    await switchChat({ name: "+51 999 999 999", phone: "+51 999 999 999", peer: "fixture-peer@lid" });
    await service("maria-demo").waitFor({ state: "visible" });
    assert.equal(await service("jose-demo").count(), 0);
    const mismatch = await appFrame.evaluate(async () => {
      try { await globalThis.NexoCompanion.prepareMessage({ phone: "51988888888", text: "No debe llegar al otro cliente" }); return "unexpected"; }
      catch (error) { return error.message; }
    });
    assert.match(mismatch, /coincide|destinatario|chat/i);
    assert.equal(await whatsapp.locator('footer [contenteditable="true"]').innerText(), previousDraft);

    // A saved contact may hide the number in its chat header. Only the visible
    // native contact drawer for that exact heading can supply a unique phone.
    const historyBeforeDrawer = await whatsapp.locator('.history').innerHTML();
    await whatsapp.evaluate(() => {
      const title = document.querySelector('#main header span[title]');
      title.title = 'Contacto guardado'; title.textContent = 'Contacto guardado';
      document.querySelectorAll('#main .history [data-id]').forEach(node => node.remove());
      const drawer = document.createElement('section');
      drawer.id = 'fixture-contact-drawer';
      drawer.dataset.testid = 'contact-info-drawer';
      drawer.style.cssText = 'position:fixed;left:600px;top:90px;width:280px;height:180px;background:#fff;z-index:4;padding:20px';
      drawer.innerHTML = '<h2 data-testid="contact-info-name" title="Otro contacto">Otro contacto</h2><p data-testid="contact-info-phone">+51 988 888 888</p>';
      document.body.append(drawer);
    });
    await until(async () => !(await appFrame.evaluate(() => globalThis.NexoCompanion.getContext())).phone, 'Sin teléfono visible ni mensajes cargados, el contacto no debe vincularse por nombre.');
    assert.equal(await service('jose-demo').count(), 0);
    await whatsapp.locator('#fixture-contact-drawer').evaluate(node => {
      const replacement = node.cloneNode(true);
      const name = replacement.querySelector('[data-testid="contact-info-name"]');
      name.title = 'Contacto guardado'; name.textContent = 'Contacto guardado';
      node.replaceWith(replacement);
    });
    await service('jose-demo').waitFor({ state: 'visible' });
    assert.equal((await appFrame.evaluate(() => globalThis.NexoCompanion.getContext())).phoneSource, 'visible');
    await whatsapp.locator('[data-testid="contact-info-phone"]').evaluate(node => { node.hidden = true; });
    await until(async () => (await service('jose-demo').count()) === 0, 'Un teléfono oculto en el drawer no puede vincular el chat.');
    await whatsapp.locator('[data-testid="contact-info-phone"]').evaluate(node => { node.hidden = false; });
    await service('jose-demo').waitFor({ state: 'visible' });
    await whatsapp.locator('#fixture-contact-drawer').evaluate(node => {
      const other = document.createElement('p'); other.dataset.testid = 'contact-info-phone'; other.id = 'fixture-second-phone'; other.textContent = '+51 977 777 777'; node.append(other);
    });
    await until(async () => (await service('jose-demo').count()) === 0, 'Dos teléfonos distintos en la ficha visible requieren aclarar la identidad.');
    assert.equal((await appFrame.evaluate(() => globalThis.NexoCompanion.getContext())).ambiguous, true);
    await whatsapp.locator('#fixture-second-phone').evaluate(node => node.remove());
    await service('jose-demo').waitFor({ state: 'visible' });
    await whatsapp.locator('#fixture-contact-drawer').evaluate(node => node.remove());
    await until(async () => (await service('jose-demo').count()) === 0, 'Cerrar el drawer debe retirar el teléfono que ya no está visible.');
    await whatsapp.locator('.history').evaluate((node, html) => { node.innerHTML = html; }, historyBeforeDrawer);

    // Two different native peers can share an identical display name. A drawer
    // left open for peer A must not lend its number to peer B during navigation.
    await switchChat({ name: 'Nombre repetido', peer: 'same-name-a@lid' });
    await whatsapp.evaluate(() => {
      const drawer = document.createElement('section');
      drawer.id = 'fixture-contact-drawer'; drawer.dataset.testid = 'contact-info-drawer';
      drawer.style.cssText = 'position:fixed;left:600px;top:90px;width:280px;height:180px;background:#fff;z-index:4;padding:20px';
      drawer.innerHTML = '<h2 data-testid="contact-info-name" title="Nombre repetido">Nombre repetido</h2><p data-testid="contact-info-phone">+51 988 888 888</p>';
      document.body.append(drawer);
    });
    await service('jose-demo').waitFor({ state: 'visible' });
    await switchChat({ name: 'Nombre repetido', peer: 'same-name-b@lid' });
    await until(async () => (await service('jose-demo').count()) === 0, 'Cambiar a otro peer con el mismo nombre debe descartar el drawer previo.');
    assert.equal((await appFrame.evaluate(() => globalThis.NexoCompanion.getContext())).phone, '');
    const staleDrawerPrepare = await appFrame.evaluate(async () => {
      try { await globalThis.NexoCompanion.prepareMessage({ phone: '51988888888', text: 'No debe enviarse por un drawer de otro peer' }); return 'unexpected'; }
      catch (error) { return error.message; }
    });
    assert.match(staleDrawerPrepare, /teléfono|vincula|identificar/i);
    assert.equal(await whatsapp.locator('footer [contenteditable="true"]').innerText(), previousDraft);
    await whatsapp.locator('#fixture-contact-drawer').evaluate(node => node.remove());
    await switchChat({ name: '+51 999 999 999', phone: '+51 999 999 999', peer: 'fixture-peer@lid' });
    await service('maria-demo').waitFor({ state: 'visible' });

    // Recheck the original native-layout regression for every positioning mode.
    // A compact CRM must never collapse the WhatsApp history or move its editor.
    const editor = whatsapp.locator('footer [contenteditable="true"]');
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
      await host.getByRole("button", { name: "Abrir Nexo CRM", exact: true }).click();
      const opened = await layoutMetrics();
      assert.ok(Math.abs(opened.root.height - native.root.height) <= 2, `El CRM debe conservar el alto nativo ${position}.`);
      assert.ok(opened.history.height >= 300, `El historial no puede colapsar con root ${position}.`);
      assert.ok(Math.abs(opened.footer.bottom - opened.viewport.height) <= 30);
      assert.equal(opened.rootPosition, position === "static" ? "relative" : position);
      const bounds = await frameElement.boundingBox();
      assert.ok(opened.wrapper.right <= bounds.x + 2);
      await host.getByRole("button", { name: "Cerrar Nexo CRM", exact: true }).click();
      const restored = await layoutMetrics();
      assert.equal(restored.rootInlineStyle, native.rootInlineStyle);
      assert.equal(restored.rootPosition, position);
      assert.equal(restored.rootAnchored, false);
      assert.ok(Math.abs(restored.root.width - native.root.width) <= 2);
      assert.ok(Math.abs(restored.root.height - native.root.height) <= 2);
      await host.getByRole("button", { name: "Abrir Nexo CRM", exact: true }).click();
    }
    await host.getByRole("button", { name: "Cerrar Nexo CRM", exact: true }).click();
    await whatsapp.locator("#app").evaluate((root, value) => root.setAttribute("style", value), nativeLayout.rootInlineStyle);
    await host.getByRole("button", { name: "Abrir Nexo CRM", exact: true }).click();
    await whatsapp.setViewportSize({ width: 980, height: 900 });
    await whatsapp.waitForFunction(() => document.querySelector("#nexo-whatsapp-dock").dataset.layout === "overlay");
    const narrow = await layoutMetrics();
    assert.ok(narrow.history.height >= 300);
    assert.ok(Math.abs(narrow.footer.bottom - narrow.viewport.height) <= 40);
    await host.getByRole("button", { name: "Cerrar Nexo CRM", exact: true }).click();
    const narrowClosed = await layoutMetrics();
    assert.equal(narrowClosed.root.width, narrowClosed.viewport.width);
    assert.equal(narrowClosed.rootInlineStyle, nativeLayout.rootInlineStyle);
    await whatsapp.setViewportSize({ width: 1440, height: 760 });
    await host.getByRole("button", { name: "Abrir Nexo CRM", exact: true }).click();
    await whatsapp.waitForFunction(() => document.querySelector("#nexo-whatsapp-dock").dataset.layout === "push");

    const screenshot = process.env.COMPACT_EXTENSION_SCREENSHOT || "/workspace/work/deliverables/compact-ui-review.png";
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await whatsapp.screenshot({ path: screenshot, fullPage: true });

    sessionExpired = true;
    await embedded.locator('#compact-refresh').click();
    await embedded.locator('body.nexo-setup').waitFor({ state: 'visible' });
    await embedded.getByRole('heading', { name: 'Conecta tu sesión', exact: true }).waitFor();
    assert.equal(new URL(appFrame.url()).pathname, '/app/index.html');
    assert.equal(new URL(appFrame.url()).searchParams.get('embedded'), '1');
    assert.equal(whatsapp.url(), 'https://web.whatsapp.com/');
    assert.equal(pages.size, 2, 'Una sesión caducada debe mostrar la recuperación dentro del dock sin abrir otra pestaña.');
    await editor.fill('Puedo continuar atendiendo mientras vuelvo a iniciar sesión en el CRM.');
    sessionExpired = false;
    for (const listener of tabUpdatedListeners) listener(pages.get(crm), { status: 'complete' }, tab(crm));
    await embedded.locator('#compact-tab-chat').waitFor({ state: 'visible', timeout: 20000 });
    await service('maria-demo').waitFor({ state: 'visible' });
    assert.equal(await embedded.locator('body.nexo-setup').count(), 0);

    // A prefilled options field on a fresh install must actually save the CRM
    // origin and revive the existing dock, without a verification-only tab.
    delete local.crmOrigin;
    delete session.crmTabId;
    await appFrame.goto(fixtureExtension + 'app/index.html?embedded=1');
    await embedded.getByRole('heading', { name: 'Tu CRM dentro de WhatsApp', exact: true }).waitFor();
    const options = await context.newPage(); pages.set(options, nextTabId++);
    await options.goto(fixtureExtension + 'options.html');
    await options.locator('#origin').fill('https://crm.test');
    await options.locator('#workspace').click();
    await embedded.locator('#compact-tab-chat').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(local.crmOrigin, 'https://crm.test');
    assert.equal(await embedded.locator('body.nexo-setup').count(), 0);
    assert.equal(pages.size, 3);
    assert.equal(await editor.innerText(), 'Puedo continuar atendiendo mientras vuelvo a iniciar sesión en el CRM.');
    await service('maria-demo').waitFor({ state: 'visible' });
    await embedded.locator('#compact-edit-contact').click();
    await embedded.locator('#compact-contact-form summary').click();
    await embedded.locator('#compact-delete-contact').click();
    await until(() => !state.clients.some(item => ['maria-demo', 'maria-disney'].includes(item.id)), 'Eliminar cliente debe eliminar todas sus fichas, no solo un servicio.');
    assert.equal(state.clients.length, 1);
    assert.equal(state.clients[0].id, 'jose-demo');
    assert.equal(state.ledger.length, 1, 'Eliminar el contacto conserva su historial financiero.');
    assert.equal(state.growth.interactions.length, 3, 'Eliminar el contacto conserva las conversaciones ya registradas.');
    assert.ok(writes >= 9, "Las acciones compactas deben haberse confirmado en el backend compartido.");
    assert.equal(await embedded.locator('body').evaluate(node => node.scrollWidth <= innerWidth + 1), true, "El panel debe caber sin desplazamiento horizontal.");
    assert.deepEqual(errors, []);
    console.log("Compact packaged extension: three tabs, automatic verified-phone ficha, multi-service renewal/edit/add/delete, shared backend/CAS, accounts with nested profiles, opt-in capture, private clipboard, drafts and stale-chat rejection passed.");
    console.log("Real MV3 installation and real WhatsApp still require the owner's Chrome; this test preserves the managed-browser install policy.");
    console.log('Synthetic compact UI preview:', screenshot);
  } finally { await browser.close(); delete global.chrome; fs.rmSync(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
