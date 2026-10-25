async function rpc(type, input = {}) {
  const reply = await chrome.runtime.sendMessage({ channel: "nexo", type, ...input });
  if (!reply?.ok) throw Error(reply?.error || "La extensión no pudo completar la operación.");
  return reply.result;
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
  loginUrl,
  showLogin: message => setupCard(message || "Inicia sesión en tu CRM para volver a consultar y guardar tus operaciones."),
  isVisible: visible,
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
    if (result.clipboard) {
      try { await navigator.clipboard.writeText(input.text); }
      catch { throw Error("Copia el texto desde el CRM y pégalo en WhatsApp después de revisar el destinatario."); }
    }
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
});

function setupCard(message) {
  embeddedVisible = false;
  announceVisibility();
  // Stop the previous CRM view's observers and automatic-capture timers before
  // replacing it; the retry link creates a fresh document and session.
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
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
        await globalThis.NexoCompanion.openLogin();
        status.textContent = "Completa el ingreso en la pestaña del CRM y vuelve a este panel.";
      } catch (error) {
        status.textContent = error.message || "Abre Configurar CRM para revisar la conexión.";
      } finally { connect.disabled = false; }
    });
    const retry = document.createElement("a");
    retry.className = "button secondary";
    retry.href = workspaceUrl.href;
    retry.textContent = "Ya inicié sesión: volver al CRM";
    actions.append(connect, retry);
  }
  const note = document.createElement("p");
  note.className = "nexo-setup-note";
  note.textContent = "La configuración se abre en otra pestaña. Tus conversaciones permanecen en WhatsApp y tus operaciones se guardan en tu CRM.";
  main.append(logo, label, title, description, actions, status, note);
  document.body.append(main);
  document.body.hidden = false;
}

try {
  const configuration = await rpc("configuration.get");
  configuredOrigin = configuration.origin || "";
  configuredWaTabId = configuration.waTabId;
  if (!configuredOrigin || parameters.get("setup") === "1") {
    setupCard(configuredOrigin
      ? "Inicia sesión en tu CRM para volver a consultar y guardar tus operaciones."
      : undefined);
  } else {
    await import("./app/app.js");
    document.body.hidden = false;
  }
} catch (error) {
  setupCard(error?.message || "No se pudo conectar con tu CRM. Revisa la configuración y vuelve a intentarlo.");
}
