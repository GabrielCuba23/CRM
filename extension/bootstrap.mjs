import { DEFAULT_ORIGIN } from "./policy.mjs";

async function rpc(type, input = {}) {
  // Authentication does not depend on WhatsApp or Chrome's optional sender
  // metadata. Routing hints are used only to associate this native panel.
  let panel = {};
  if (nativePanel) try { panel = await nativePanelIdentity(); } catch {}
  const reply = await chrome.runtime.sendMessage({ channel: "nexo", type, ...input, ...panel });
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
const nativePanel = parameters.get("panel") === "1" && !embedded;
let panelInstance = "", panelIdentityPending;
if (nativePanel) {
  try {
    // Chrome reports -1 as the window of SIDE_PANEL contexts, and can omit
    // documentId from MessageSender. Give this live document a unique URL so
    // getContexts can distinguish two identical panels in different windows.
    panelInstance = crypto.randomUUID().replaceAll("-", "");
    const ownUrl = new URL(location.href);
    ownUrl.searchParams.set("panelInstance", panelInstance);
    history.replaceState(history.state, "", ownUrl.href);
  } catch { panelInstance = ""; }
}
async function nativePanelIdentity() {
  if (!chrome.windows?.getCurrent || !chrome.runtime.getContexts)
    throw Error("No se pudo identificar esta ventana de WhatsApp.");
  if (panelIdentityPending) return panelIdentityPending;
  const pending = (async () => {
    const [ownWindow, contexts] = await Promise.all([
      chrome.windows.getCurrent(),
      chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"], documentUrls: [location.href] }),
    ]);
    if (!Number.isInteger(ownWindow?.id) || ownWindow.id < 0)
      throw Error("No se pudo identificar esta ventana de WhatsApp.");
    const matches = contexts.filter(context => context.contextType === "SIDE_PANEL" &&
      context.documentUrl === location.href && typeof context.contextId === "string" && context.contextId &&
      (context.windowId === -1 || context.windowId === ownWindow.id));
    if (matches.length !== 1) throw Error("No se pudo identificar esta barra de WhatsApp.");
    return { panelContextId: matches[0].contextId, panelWindowId: ownWindow.id, panelInstance };
  })();
  panelIdentityPending = pending;
  try { return await pending; }
  finally { if (panelIdentityPending === pending) panelIdentityPending = null; }
}
const optionsUrl = chrome.runtime.getURL("options.html");
const workspaceUrl = new URL(chrome.runtime.getURL("app/index.html"));
if (embedded) workspaceUrl.searchParams.set("embedded", "1");
if (nativePanel) workspaceUrl.searchParams.set("panel", "1");
const login = new URL(workspaceUrl);
login.searchParams.set("setup", "1");
const loginUrl = login.href;
let configuredOrigin = nativePanel ? DEFAULT_ORIGIN : "", configuredWaTabId, configuredPanelWindowId;
let authenticationProvider = nativePanel ? "password" : "", passwordConfigured = true;
let nativeChatActive = false;
let nativeContextRead = 0, lastNativeContext = null;
let embeddedVisible = !embedded;
let phase = "booting", bootComplete = false, connectionCheckRunning = false;
let connectionCheckPending = false, pendingReadyOrigin = "", connectionTimer;
let recoveryStarted = false, lastConnectionProbe = 0, applicationStarted = false, manualConnectionCheck = false, verifyingOrigin = "";
let nativeSubmitting = false;
const recoveryKey = "nexo.connection-recovery";

document.documentElement.classList.toggle("nexo-embedded", embedded || nativePanel);
document.body.classList.toggle("nexo-embedded", embedded || nativePanel);
document.documentElement.classList.toggle("nexo-native-panel", nativePanel);
document.body.classList.toggle("nexo-native-panel", nativePanel);
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

function nativePanelShell() {
  if (!nativePanel) return null;
  let header = document.querySelector("#nexo-native-panel-header");
  if (header) return header;
  header = document.createElement("header");
  header.id = "nexo-native-panel-header";
  const brand = document.createElement("strong");
  brand.textContent = "Nexo CRM";
  const open = document.createElement("button");
  open.type = "button";
  open.id = "nexo-return-to-whatsapp";
  open.textContent = "Abrir WhatsApp";
  open.addEventListener("click", async () => {
    open.disabled = true;
    try {
      await rpc("wa.open");
      if (configuredOrigin) await readContext();
    } catch (error) {
      nativeChatNotice(error?.message || "Abre WhatsApp para trabajar con la conversación.");
    } finally { if (open.isConnected) open.disabled = false; }
  });
  const notice = document.createElement("p");
  notice.id = "nexo-native-chat-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.hidden = true;
  header.append(brand, open, notice);
  document.body.prepend(header);
  return header;
}
function nativeChatNotice(message) {
  if (!nativePanel) return;
  const notice = nativePanelShell().querySelector("#nexo-native-chat-notice");
  notice.textContent = message || "";
  notice.hidden = !message;
}
function recordNativeContext(context) {
  if (!nativePanel) return context;
  // The configuration can precede Chrome's live-context registration. A later
  // verified background response establishes the window without another login.
  if (!Number.isInteger(configuredPanelWindowId) && Number.isInteger(context?.windowId) && context.windowId >= 0)
    configuredPanelWindowId = context.windowId;
  if (!Number.isInteger(configuredPanelWindowId) || context?.windowId !== configuredPanelWindowId)
    throw Error("Actualiza el panel para volver a conectar esta ventana de WhatsApp.");
  configuredWaTabId = context.tabId;
  nativeChatActive = context.active === true;
  lastNativeContext = context;
  nativePanelShell();
  nativeChatNotice(nativeChatActive ? "" : "Puedes gestionar el CRM aquí. Abre WhatsApp para trabajar con el chat.");
  if (!nativeChatActive) {
    // The CRM remains visible on other sites, but periodic message collection
    // must stop as soon as its WhatsApp conversation leaves the foreground.
    document.dispatchEvent(new CustomEvent("nexo-companion-visibility", { detail: { visible: false } }));
  }
  return context;
}
async function readContext() {
  const origin = configuredOrigin;
  const read = nativePanel ? ++nativeContextRead : 0;
  const context = await rpc("wa.context", { expectedOrigin: origin });
  if (nativePanel && (read !== nativeContextRead || origin !== configuredOrigin)) {
    if (origin === configuredOrigin && lastNativeContext) return lastNativeContext;
    throw Error("La conversación cambió. Espera un momento y vuelve a intentarlo.");
  }
  return recordNativeContext(context);
}

globalThis.NexoCompanion = Object.freeze({
  compact: true,
  loginUrl,
  showLogin: message => setupCard(message || "Inicia sesión aquí para volver a consultar y guardar tus operaciones."),
  isVisible: visible,
  copyText,
  async fetch(path, options = {}) {
    const result = await rpc("crm.request", { expectedOrigin: configuredOrigin, path, method: options.method || "GET", ...(options.body === undefined ? {} : { body: options.body }) });
    // Login and logout stay in a local setup card, including inside the dock.
    // Native authentication stays in this same dock. Legacy instances retain
    // their explicit Access compatibility flow.
    if (path === "/api/logout" && result.status === 200)
      result.body = JSON.stringify({ ok: true, logoutUrl: loginUrl });
    return new Response(result.body, { status: result.status, headers: result.headers });
  },
  getContext: readContext,
  startCampaign: input => rpc("campaign.start", { input, expectedOrigin: configuredOrigin }),
  stopCampaign: input => rpc("campaign.stop", { input, expectedOrigin: configuredOrigin }),
  selectRecipient: input => rpc("campaign.select", { input, expectedOrigin: configuredOrigin }),
  sendCampaign: input => rpc("campaign.send", { input, expectedOrigin: configuredOrigin }),
  prepareMedia: input => rpc("campaign.preview", { input, expectedOrigin: configuredOrigin }),
  exportWhatsAppContacts: input => rpc("wa.contacts", { input, expectedOrigin: configuredOrigin }),
  bindConversation: input => rpc("wa.bind", { input, expectedOrigin: configuredOrigin }),
  unbindConversation: input => rpc("wa.unbind", { input, expectedOrigin: configuredOrigin }),
  captureVisibleMessages: () => {
    if (!visible()) throw Error("Abre el panel de Nexo en WhatsApp para registrar mensajes visibles.");
    if (nativePanel && !nativeChatActive) throw Error("Abre WhatsApp antes de registrar los textos de esta conversación.");
    return rpc("wa.capture", { expectedOrigin: configuredOrigin });
  },
  async prepareMessage(input) {
    const result = await rpc("wa.prepare", { input, expectedOrigin: configuredOrigin });
    if (result.clipboard) await copyText(input.text);
    return result;
  },
  onContext(handler) {
    let nativeNotification = 0, removed = false;
    const listener = (message, sender) => {
      if (sender.id !== chrome.runtime.id || sender.tab || message?.channel !== "nexo.context" || message.origin !== configuredOrigin) return;
      // A dock belongs to its own WhatsApp tab. Other open conversations cannot
      // silently replace its recipient through a background identity broadcast.
      if (embedded && (!Number.isInteger(configuredWaTabId) || message.context?.tabId !== configuredWaTabId)) return;
      if (nativePanel && message.context?.windowId !== configuredPanelWindowId) return;
      if (nativePanel) {
        // Notifications are wakeups, not recipient selections. Re-read the
        // same-window WhatsApp target so another tab's late identity cannot
        // replace the current chat in this persistent document.
        const notification = ++nativeNotification, origin = configuredOrigin;
        readContext().then(context => {
          if (!removed && notification === nativeNotification && origin === configuredOrigin) handler(context);
        }).catch(() => {});
        return;
      }
      handler(recordNativeContext(message.context));
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => { removed = true; nativeNotification++; chrome.runtime.onMessage.removeListener(listener); };
  },
  async openLogin() {
    if (authenticationProvider === "password") { setupCard(); return; }
    return rpc("crm.connect", { expectedOrigin: configuredOrigin });
  },
  async openWebCRM() { return rpc("crm.open", { expectedOrigin: configuredOrigin }); },
});

function setupCard(message) {
  if (authenticationProvider === "password" || (nativePanel && (!configuredOrigin || configuredOrigin === DEFAULT_ORIGIN)))
    return nativeSetupCard(message);
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
  nativePanelShell();
  document.body.hidden = false;
}

function nativeSetupCard(message) {
  const existing = document.querySelector("#nexo-login-form");
  if (phase === "setup" && existing?.dataset.origin === configuredOrigin) {
    if (message && !nativeSubmitting) setupStatus(message);
    return;
  }
  phase = "setup";
  embeddedVisible = false;
  announceVisibility();
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
  document.body.classList.remove("nexo-compact");
  document.body.classList.add("nexo-setup");
  document.title = "Nexo · Iniciar sesión";
  const main = document.createElement("main");
  main.className = "nexo-setup-card";
  const logo = document.createElement("img");
  logo.src = chrome.runtime.getURL("app/app-icon-192.png");
  logo.alt = ""; logo.width = 48; logo.height = 48;
  const label = document.createElement("p");
  label.className = "nexo-setup-label"; label.textContent = "NEXO CRM";
  const title = document.createElement("h1"); title.textContent = "Inicia sesión";
  const description = document.createElement("p");
  description.textContent = message || "Entra con tu correo y contraseña para gestionar tus clientes aquí.";
  const form = document.createElement("form");
  form.id = "nexo-login-form";
  form.method = "post";
  form.dataset.origin = configuredOrigin;
  function inputField(text, name, type, autocomplete, maximum) {
    const wrapper = document.createElement("label");
    wrapper.textContent = text;
    const input = document.createElement("input");
    Object.assign(input, { name, type, autocomplete, maxLength: maximum, required: true });
    wrapper.append(input); form.append(wrapper); return input;
  }
  const email = inputField("Correo", "email", "email", "username", 254);
  const password = inputField("Contraseña", "password", "password", "current-password", 1024);
  const submit = document.createElement("button");
  submit.type = "submit"; submit.id = "nexo-login-submit"; submit.textContent = "Iniciar sesión";
  form.append(submit);
  const status = document.createElement("p");
  status.id = "status"; status.className = "nexo-setup-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  if (!passwordConfigured) status.textContent = "Crea primero tu contraseña desde el enlace privado de activación. Después podrás entrar aquí.";
  const advanced = document.createElement("a");
  advanced.href = optionsUrl; advanced.target = "_blank"; advanced.rel = "noopener noreferrer";
  advanced.textContent = "Usar otro CRM"; advanced.className = "nexo-setup-note";
  const note = document.createElement("p");
  note.className = "nexo-setup-note"; note.textContent = "Usa las mismas credenciales que en la web.";
  main.append(logo, label, title, description, form, status);
  if (!nativePanel || configuredOrigin !== DEFAULT_ORIGIN) main.append(advanced);
  main.append(note);
  document.body.append(main); document.body.hidden = false;
  nativePanelShell();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (nativeSubmitting) return;
    const expectedOrigin = configuredOrigin, submittedEmail = email.value.trim();
    let secret = password.value;
    password.value = "";
    nativeSubmitting = true; submit.disabled = true; email.disabled = true; password.disabled = true;
    status.textContent = "Iniciando sesión…";
    try {
      await rpc("crm.login", { expectedOrigin, input: { email: submittedEmail, password: secret } });
      const fresh = await rpc("configuration.get");
      if (fresh.origin !== expectedOrigin) throw Error("Cambió el CRM. Vuelve a iniciar sesión.");
      recoveryStarted = true;
      location.replace(workspaceUrl.href);
    } catch (error) {
      status.textContent = error.message || "No se pudo iniciar sesión.";
    } finally {
      secret = ""; password.value = ""; nativeSubmitting = false;
      if (submit.isConnected) { submit.disabled = false; email.disabled = false; password.disabled = false; }
    }
  });
  email.focus({ preventScroll: true });
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
  if (!bootComplete || recoveryStarted || connectionCheckRunning || nativeSubmitting) return;
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
        configuredPanelWindowId = fresh.panelWindowId;
      } else {
        showConnectionNotice();
        setupStatus("Cambió el CRM conectado. Recarga el panel antes de iniciar sesión.");
        return;
      }
      if (origin) {
        const auth = await rpc("crm.authStatus", { expectedOrigin: origin });
        authenticationProvider = auth.authProvider || "";
        passwordConfigured = auth.configured !== false;
      }
      setupCard(authenticationProvider === "password" ? undefined : origin ? "Dirección guardada. Completa el ingreso en la pestaña del CRM; este panel se conectará cuando la sesión esté lista." : undefined);
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
      throw Error(authenticationProvider === "password" ? "Introduce tu correo y contraseña para entrar." : session.error || "Completa el inicio de sesión en la pestaña del CRM. Este panel se conectará cuando esté listo.");
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
    setupStatus(error?.message || "No se pudo verificar tu sesión. Vuelve a intentarlo aquí.");
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
  configuredPanelWindowId = configuration.panelWindowId;
  authenticationProvider = configuredOrigin === DEFAULT_ORIGIN ? "password" : "";
  if (configuredOrigin) {
    const auth = await rpc("crm.authStatus", { expectedOrigin: configuredOrigin });
    authenticationProvider = auth.authProvider || "";
    passwordConfigured = auth.configured !== false;
  }
  const nativeReady = authenticationProvider === "password" && (await rpc("crm.verify", { expectedOrigin: configuredOrigin })).ready;
  if (!configuredOrigin || (authenticationProvider === "password" ? !nativeReady : parameters.get("setup") === "1")) {
    setupCard(configuredOrigin
      ? authenticationProvider === "password" ? "Entra con tu correo y contraseña para gestionar tus clientes aquí." : "Inicia sesión en tu CRM para volver a consultar y guardar tus operaciones."
      : undefined);
  } else {
    applicationStarted = true;
    await import("./app/app.js");
    document.body.hidden = false;
    phase = "active";
    nativePanelShell();
    try { sessionStorage.removeItem(recoveryKey); } catch {}
  }
} catch (error) {
  if (nativePanel && configuredOrigin === DEFAULT_ORIGIN) {
    nativeSetupCard();
    setupStatus("No se pudo verificar la sesión. Introduce tu correo y contraseña aquí.");
  } else {
    setupCard(error?.message || "No se pudo conectar con tu CRM. Revisa la configuración y vuelve a intentarlo.");
  }
} finally {
  bootComplete = true;
  if (connectionCheckPending) scheduleConnectionCheck();
}
