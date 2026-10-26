async function rpc(type, input = {}) {
  const reply = await chrome.runtime.sendMessage({ channel: "nexo", type, ...input });
  if (!reply?.ok) throw Error(reply?.error || "La extensión no pudo completar la operación.");
  return reply.result;
}


async function copyText(text) {
  if (typeof text !== "string" || !text.trim()) throw Error("Escribe un mensaje antes de copiarlo.");
  try {
    const result = await rpc("clipboard.copy", { text });
    if (result?.copied !== true) throw Error("El portapapeles no confirmó la copia.");
    return result;
  } catch {
    throw Error("No se pudo copiar automáticamente. Selecciona el texto del mensaje y cópialo manualmente antes de pegarlo en WhatsApp.");
  }
}

const parameters = new URLSearchParams(location.search);
const embedded = parameters.get("embedded") === "1";
const optionsUrl = chrome.runtime.getURL("options.html");
const workspaceUrl = new URL(chrome.runtime.getURL("app/index.html"));
if (embedded) workspaceUrl.searchParams.set("embedded", "1");
const login = new URL(workspaceUrl);
login.searchParams.set("setup", "1");
const loginUrl = login.href;
let configuredOrigin = "", configuredWaTabId;
let embeddedVisible = !embedded;
let phase = "booting", bootComplete = false, connectionCheckRunning = false;
let connectionCheckPending = false, pendingReadyOrigin = "", connectionTimer;
let recoveryStarted = false, lastConnectionProbe = 0, applicationStarted = false, manualConnectionCheck = false, verifyingOrigin = "";
const recoveryKey = "nexo.connection-recovery";

document.documentElement.classList.toggle("nexo-embedded", embedded);
document.body.classList.toggle("nexo-embedded", embedded);
document.body.hidden = true;
const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./companion.css", import.meta.url).href;
document.head.append(stylesheet);

function visible() {
  return !document.hidden && (!embedded || embeddedVisible);
}
function announceVisibility() {
  document.dispatchEvent(new CustomEvent("nexo-companion-visibility", {
    detail: { visible: visible() },
  }));
}
if (embedded && "IntersectionObserver" in globalThis) {
  const observer = new IntersectionObserver((entries) => {
    const entry = entries.find(item => item.target === document.documentElement);
    if (entry) {
      embeddedVisible = entry.isIntersecting;
      announceVisibility();
    }
  });
  observer.observe(document.documentElement);
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
}
document.addEventListener("visibilitychange", announceVisibility);

globalThis.NexoCompanion = Object.freeze({
  compact: true,
  loginUrl,
  showLogin: message => setupCard(message || "Inicia sesión en tu CRM para volver a consultar y guardar tus operaciones."),
  isVisible: visible,
  copyText,
  async fetch(path, options = {}) {
    const result = await rpc("crm.request", { expectedOrigin: configuredOrigin, path, method: options.method || "GET", ...(options.body === undefined ? {} : { body: options.body }) });
    // Login and logout stay in a local setup card, including inside the dock.
    // Authentication itself always opens in the CRM's separate trusted tab.
    if (path === "/api/logout" && result.status === 200)
      result.body = JSON.stringify({ ok: true, logoutUrl: loginUrl });
    return new Response(result.body, { status: result.status, headers: result.headers });
  },
  getContext: () => rpc("wa.context"),
  bindConversation: input => rpc("wa.bind", { input }),
  captureVisibleMessages: () => {
    if (!visible()) throw Error("Abre el panel de Nexo en WhatsApp para registrar mensajes visibles.");
    return rpc("wa.capture");
  },
  async prepareMessage(input) {
    const result = await rpc("wa.prepare", { input });
    if (result.clipboard) await copyText(input.text);
    return result;
  },
  onContext(handler) {
    const listener = (message, sender) => {
      if (sender.id !== chrome.runtime.id || sender.tab || message?.channel !== "nexo.context") return;
      // A dock belongs to its own WhatsApp tab. Other open conversations cannot
      // silently replace its recipient through a background identity broadcast.
      if (embedded && (!Number.isInteger(configuredWaTabId) || message.context?.tabId !== configuredWaTabId)) return;
      handler(message.context);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  },
  async openLogin() { return rpc("crm.connect", { expectedOrigin: configuredOrigin }); },
  async openWebCRM() { return rpc("crm.open", { expectedOrigin: configuredOrigin }); },
});

function setupCard(message) {
  phase = "setup";
  embeddedVisible = false;
  announceVisibility();
  // Stop the previous CRM view's observers and automatic-capture timers before
  // replacing it; the retry link creates a fresh document and session.
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
  document.body.classList.remove("nexo-compact");
  document.body.classList.add("nexo-setup");
  document.title = "Nexo · Conecta tu CRM";
  const main = document.createElement("main");
  main.className = "nexo-setup-card";
  const logo = document.createElement("img");
  logo.src = chrome.runtime.getURL("app/app-icon-192.png");
  logo.alt = "";
  logo.width = 48;
  logo.height = 48;
  const label = document.createElement("p");
  label.className = "nexo-setup-label";
  label.textContent = "NEXO CRM";
  const title = document.createElement("h1");
  title.textContent = configuredOrigin ? "Conecta tu sesión" : "Tu CRM dentro de WhatsApp";
  const description = document.createElement("p");
  description.textContent = message || "Configura tu CRM e inicia sesión. Después podrás gestionar clientes, cuentas, ventas y renovaciones sin salir de WhatsApp Web.";
  const actions = document.createElement("div");
  actions.className = "nexo-setup-actions";
  const configure = document.createElement("a");
  configure.className = "button";
  configure.href = optionsUrl;
  configure.target = "_blank";
  configure.rel = "noopener noreferrer";
  configure.textContent = "Configurar CRM";
  actions.append(configure);
  const status = document.createElement("p");
  status.id = "status";
  status.className = "nexo-setup-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  if (configuredOrigin) {
    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "secondary";
    connect.textContent = "Abrir sesión del CRM";
    connect.addEventListener("click", async () => {
      connect.disabled = true;
      try {
        const fresh = await rpc("configuration.get");
        if (!fresh.origin) throw Error("Guarda primero la dirección de tu CRM en Configurar CRM.");
        await rpc("crm.connect", { expectedOrigin: fresh.origin });
        status.textContent = "Completa el ingreso en la pestaña del CRM y vuelve a este panel.";
      } catch (error) {
        status.textContent = error.message || "Abre Configurar CRM para revisar la conexión.";
      } finally { connect.disabled = false; }
    });
    actions.append(connect);
  }
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "secondary";
  retry.textContent = "Ya inicié sesión: conectar aquí";
  retry.addEventListener("click", () => scheduleConnectionCheck("", true));
  actions.append(retry);
  const note = document.createElement("p");
  note.className = "nexo-setup-note";
  note.textContent = "La configuración se abre en otra pestaña. Tus conversaciones permanecen en WhatsApp y tus operaciones se guardan en tu CRM.";
  main.append(logo, label, title, description, actions, status, note);
  document.body.append(main);
  document.body.hidden = false;
}


function trustedBackground(sender) {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (!sender.url) return true;
  try {
    const url = new URL(sender.url);
    return url.protocol === "chrome-extension:" && url.hostname === chrome.runtime.id && url.pathname === "/background.mjs";
  } catch { return false; }
}
function showConnectionNotice() {
  if (document.querySelector("#nexo-connection-notice")) return;
  const notice = document.createElement("div");
  notice.id = "nexo-connection-notice";
  notice.className = "nexo-connection-notice";
  notice.setAttribute("role", "alert");
  const message = document.createElement("p");
  message.textContent = "Se cambió la conexión del CRM. Esta vista conserva sus datos anteriores; revisa los formularios abiertos antes de conectar la nueva dirección.";
  const reconnect = document.createElement("a");
  reconnect.className = "button secondary";
  reconnect.href = workspaceUrl.href;
  reconnect.textContent = "Recargar y conectar el CRM";
  notice.append(message, reconnect);
  (document.querySelector("#companion-workspace") || document.querySelector(".crm-sidebar") || document.querySelector("main") || document.body).prepend(notice);
}
function setupStatus(message) {
  if (phase !== "setup") return;
  const status = document.querySelector("#status");
  if (status) status.textContent = message;
}
function rememberRecovery(origin, force = false) {
  try {
    const previous = JSON.parse(sessionStorage.getItem(recoveryKey) || "null");
    if (!force && previous?.origin === origin && Date.now() - previous.at < 15000) return false;
    // This contains only an origin and a retry timestamp, never CRM data.
    sessionStorage.setItem(recoveryKey, JSON.stringify({ origin, at: Date.now() }));
  } catch { /* Disabled session storage must not prevent the connection. */ }
  return true;
}
async function refreshConnection() {
  if (!bootComplete || recoveryStarted || connectionCheckRunning) return;
  connectionCheckRunning = true;
  connectionCheckPending = false;
  const readyOrigin = pendingReadyOrigin;
  const manualCheck = manualConnectionCheck;
  pendingReadyOrigin = "";
  manualConnectionCheck = false;
  lastConnectionProbe = Date.now();
  try {
    // Always read the current configuration rather than trusting an event's
    // payload or rebinding a document that already holds another CRM's state.
    const fresh = await rpc("configuration.get");
    const origin = fresh.origin || "";
    if (phase === "active") {
      if (origin !== configuredOrigin) showConnectionNotice();
      else document.querySelector("#nexo-connection-notice")?.remove();
      return;
    }
    if (phase !== "setup") return;
    if (origin !== configuredOrigin) {
      // Once application code has run, its pending callbacks must keep the old
      // origin pin even after an expired-session card replaced the visible UI.
      if (!applicationStarted) {
        configuredOrigin = origin;
        configuredWaTabId = fresh.waTabId;
      }
      setupCard(origin ? "Dirección guardada. Completa el ingreso en la pestaña del CRM; este panel se conectará cuando la sesión esté lista." : undefined);
    }
    if (!origin) {
      setupStatus("Guarda la dirección de tu CRM en Configurar CRM. No necesitas volver a introducirla aquí.");
      return;
    }
    if (readyOrigin && readyOrigin !== origin) return;
    setupStatus("Comprobando tu sesión del CRM…");
    verifyingOrigin = origin;
    const response = await rpc("crm.request", { expectedOrigin: origin, path: "/api/session", method: "GET" });
    const session = JSON.parse(response.body);
    if (response.status !== 200 || session.mode !== "server")
      throw Error(session.error || "Completa el inicio de sesión en la pestaña del CRM. Este panel se conectará cuando esté listo.");
    const current = await rpc("configuration.get");
    if (current.origin !== origin) {
      connectionCheckPending = true;
      return;
    }
    if (phase !== "setup" || recoveryStarted) return;
    if (!rememberRecovery(origin, manualCheck)) {
      setupStatus("La sesión ya está lista. Si el panel sigue sin abrirse, recarga WhatsApp Web para volver a conectar.");
      return;
    }
    recoveryStarted = true;
    setupStatus("Sesión verificada. Abriendo tu CRM aquí…");
    // A fresh document loads the current CRM state and avoids cached imports or
    // a stale revision from an earlier session. Setup contains no unsaved forms.
    location.replace(workspaceUrl.href);
  } catch (error) {
    setupStatus(error?.message || "Completa el ingreso en tu CRM y vuelve a este panel.");
  } finally {
    verifyingOrigin = "";
    connectionCheckRunning = false;
    if (connectionCheckPending && !recoveryStarted) scheduleConnectionCheck();
  }
}
function scheduleConnectionCheck(readyOrigin = "", immediate = false) {
  if (recoveryStarted) return;
  if (readyOrigin) pendingReadyOrigin = readyOrigin;
  if (immediate) manualConnectionCheck = true;
  connectionCheckPending = true;
  if (!bootComplete || connectionCheckRunning || connectionTimer) return;
  const delay = immediate ? 0 : Math.max(75, 1000 - (Date.now() - lastConnectionProbe));
  connectionTimer = setTimeout(() => {
    connectionTimer = undefined;
    void refreshConnection();
  }, delay);
}
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.channel !== "nexo.connection" || !trustedBackground(sender)) return false;
  // The background can acknowledge this very GET /api/session with ready:true.
  // Its response is already being checked; do not turn that ack into a polling
  // loop when a runtime error keeps the verified session on the setup card.
  if (connectionCheckRunning && message.ready === true && message.origin === verifyingOrigin) return false;
  scheduleConnectionCheck(message.ready === true && typeof message.origin === "string" ? message.origin : "");
  return false;
});
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && Object.hasOwn(changes, "crmOrigin")) scheduleConnectionCheck();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && phase === "setup") scheduleConnectionCheck();
});



try {
  const configuration = await rpc("configuration.get");
  configuredOrigin = configuration.origin || "";
  configuredWaTabId = configuration.waTabId;
  if (!configuredOrigin || parameters.get("setup") === "1") {
    setupCard(configuredOrigin
      ? "Inicia sesión en tu CRM para volver a consultar y guardar tus operaciones."
      : undefined);
  } else {
    applicationStarted = true;
    await import("./app/app.js");
    document.body.hidden = false;
    phase = "active";
    try { sessionStorage.removeItem(recoveryKey); } catch {}
  }
} catch (error) {
  setupCard(error?.message || "No se pudo conectar con tu CRM. Revisa la configuración y vuelve a intentarlo.");
} finally {
  bootComplete = true;
  if (connectionCheckPending) scheduleConnectionCheck();
}
