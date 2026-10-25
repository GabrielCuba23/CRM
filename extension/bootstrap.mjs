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


function installEmbeddedNavigation() {
  if (!embedded) return;
  const sidebar = document.querySelector(".crm-sidebar");
  const sourceNavigation = sidebar?.querySelector("nav");
  const workspace = document.querySelector("#companion-workspace");
  if (!sourceNavigation || !workspace || document.querySelector("#nexo-module-select")) return;
  const links = [...sourceNavigation.querySelectorAll("a[data-view]")];
  const modules = new Map();
  for (const link of links) {
    const id = link.dataset.view;
    if (!id || modules.has(id)) continue;
    const label = link.cloneNode(true);
    label.querySelectorAll("svg, span").forEach(node => node.remove());
    modules.set(id, { link, label: label.textContent.replace(/\s+/g, " ").trim() });
  }
  const navigation = document.createElement("label");
  navigation.className = "nexo-module-nav";
  const caption = document.createElement("span");
  caption.textContent = "Ir a";
  const selector = document.createElement("select");
  selector.id = "nexo-module-select";
  selector.setAttribute("aria-label", "Ir a una sección del CRM");
  for (const [id, item] of modules) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = item.label;
    selector.append(option);
  }
  navigation.append(caption, selector);
  sidebar.append(navigation);

  // Move the existing section instead of rebuilding it: forms, selected client,
  // conversation linkage and all original handlers remain on the same nodes.
  const tools = document.createElement("details");
  tools.id = "nexo-chat-tools";
  tools.className = "nexo-chat-tools";
  const summary = document.createElement("summary");
  summary.title = "Mostrar u ocultar las herramientas del chat actual";
  const summaryTitle = document.createElement("strong");
  summaryTitle.textContent = "Chat actual";
  const identity = document.createElement("span");
  identity.className = "nexo-chat-identity";
  summary.append(summaryTitle, identity);
  workspace.before(tools);
  tools.append(summary, workspace);
  const sourceIdentity = workspace.querySelector(":scope > p");
  const refreshIdentity = () => {
    identity.textContent = (sourceIdentity?.textContent || "").replace(/^Chat abierto:\s*/, "");
  };
  refreshIdentity();
  const observer = new MutationObserver(refreshIdentity);
  if (sourceIdentity) observer.observe(sourceIdentity, { subtree: true, childList: true, characterData: true });

  let previousView = "", requestedScroll = false;
  const sync = () => {
    const current = links.find(link => link.getAttribute("aria-current") === "page")?.dataset.view || "home";
    selector.value = modules.has(current) ? current : "home";
    if (current !== previousView) {
      tools.open = current === "home";
      previousView = current;
    }
    if (requestedScroll) {
      requestedScroll = false;
      requestAnimationFrame(() => {
        if (document.scrollingElement) {
          document.scrollingElement.scrollTop = 0;
          document.scrollingElement.scrollLeft = 0;
        }
      });
    }
  };
  selector.addEventListener("change", () => {
    const item = modules.get(selector.value);
    if (!item) return;
    requestedScroll = true;
    location.hash = item.link.hash;
  });
  window.addEventListener("hashchange", sync);
  window.addEventListener("pagehide", () => {
    observer.disconnect();
    window.removeEventListener("hashchange", sync);
  }, { once: true });
  sync();
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
    installEmbeddedNavigation();
    document.body.hidden = false;
  }
} catch (error) {
  setupCard(error?.message || "No se pudo conectar con tu CRM. Revisa la configuración y vuelve a intentarlo.");
}
