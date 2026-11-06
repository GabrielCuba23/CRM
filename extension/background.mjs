import { crmOrigin, allowedApi, isExtensionPage, embeddedWhatsAppTab, isWhatsAppSender, safeContext, draftInput, WA_ORIGIN, DEFAULT_ORIGIN, createEngagementRuntime } from "./policy.mjs";

const EXTENSION_ID = chrome.runtime.id;
const storage = chrome.storage.session;
const CONNECT_FLOW_TTL = 15 * 60 * 1000;
const connectionProbes = new Map();
let creatingClipboardDocument = null;
let clipboardQueue = Promise.resolve();
chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
const authModes = new Map();
let authenticationEpoch = 0;
// Chrome can terminate and recreate an MV3 worker while storage.session and
// the side panel stay alive. Keep the session generation with those runs.
const authenticationReady = storage.get('authenticationEpoch').then(saved => {
  const value = saved.authenticationEpoch;
  authenticationEpoch = Number.isSafeInteger(value) && value >= 0 ? value : 0;
});
let authenticationWrites = Promise.resolve();
function advanceAuthenticationEpoch() {
  const operation = authenticationWrites.then(async () => {
    await authenticationReady;
    authenticationEpoch++;
    await storage.set({authenticationEpoch});
    return authenticationEpoch;
  });
  authenticationWrites = operation.catch(() => {});
  return operation;
}
const engagementRuntime = createEngagementRuntime({
  local: chrome.storage.local, session: storage,
  getOrigin: async () => (await configuration()).origin,
  getSession: nativeSession,
  getTab: async id => { try { return await chrome.tabs.get(id); } catch { return null; } },
  activeTab: activeWhatsApp, epoch: () => authenticationEpoch,
  panelActive: async run => (await chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']})).some(item=>item.contextId===run.panelContextId),
  mediaFiles: campaignMedia,
  request: async (origin, path, method, body) => {
    const response = await nativeRequest(origin, {path, method, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const value = replyData(response);
    if (response.status < 200 || response.status >= 300) throw Error(value.error || 'No se pudo completar la operación del chatbot.');
    return value;
  },
  sendContent: async (tabId, origin, action, input) => {
    await assertOrigin(origin);
    const tab = await chrome.tabs.get(tabId);
    if (tabOrigin(tab) !== WA_ORIGIN) throw Error('La pestaña de WhatsApp cambió.');
    const response = await chrome.tabs.sendMessage(tabId,{channel:'nexo.whatsapp',scope:origin,action,input},{frameId:0});
    if (!response?.ok) throw Error(response?.error || 'Recarga WhatsApp para activar el chatbot.');
    return response.result;
  },
});

function tabOrigin(tab) {
  try { return new URL(tab?.url || "").origin; } catch { return ""; }
}
function nativePanelPage(sender) {
  if (!isExtensionPage(sender, EXTENSION_ID) || (sender.frameId ?? 0) !== 0) return false;
  try { const url = new URL(sender.url); return url.pathname === "/app/index.html" && url.searchParams.get("panel") === "1"; }
  catch { return false; }
}
let nativePanelRegistrations = Promise.resolve();
function panelDocumentBase(value) {
  try {
    const url = new URL(value);
    // A renderer may cache sender.url before history.replaceState gives this
    // panel its unique instance. No other URL component may be normalized away.
    url.searchParams.delete("panelInstance");
    return url.href;
  } catch { return ""; }
}
async function nativePanelWindow(sender, panelContextId, panelWindowId, panelInstance) {
  // Chrome omits frame/document sender fields for non-tab extension views, and
  // SIDE_PANEL contexts can report windowId=-1. Our isolated panel reads its own
  // containing window via windows.getCurrent(), then supplies the live context
  // ID and window. Content scripts and ordinary extension tabs cannot register.
  if (!nativePanelPage(sender) || sender.tab || !chrome.runtime.getContexts)
    throw Error("Abre Nexo desde la barra lateral de Chrome para continuar.");
  const documentId = typeof sender.documentId === "string" && sender.documentId ? sender.documentId : undefined;
  if (panelContextId !== undefined && (typeof panelContextId !== "string" || !panelContextId || panelContextId.length > 200))
    throw Error("No se pudo identificar esta barra lateral. Vuelve a abrir Nexo en Chrome.");
  if (panelInstance !== undefined && (typeof panelInstance !== "string" || !/^[a-f0-9]{32}$/.test(panelInstance)))
    throw Error("No se pudo identificar esta barra lateral. Vuelve a abrir Nexo en Chrome.");
  if (!documentId && (!panelContextId || !panelInstance))
    throw Error("No se pudo identificar esta barra lateral. Reintenta la conexión con WhatsApp desde Nexo.");
  const operation = nativePanelRegistrations.then(async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"],
      ...(documentId ? { documentIds: [documentId] } : {}), ...(panelContextId ? { contextIds: [panelContextId] } : {}) });
    const senderBase = panelDocumentBase(sender.url);
    const matches = contexts.filter(item => {
      if (item.contextType !== "SIDE_PANEL" || !senderBase || panelDocumentBase(item.documentUrl) !== senderBase ||
          documentId && item.documentId !== documentId || panelContextId && item.contextId !== panelContextId) return false;
      if (!panelInstance) return true; // Legacy strong-document identity path.
      const instances = new URL(item.documentUrl).searchParams.getAll("panelInstance");
      return instances.length === 1 && instances[0] === panelInstance;
    });
    if (matches.length !== 1)
      throw Error("No se pudo identificar esta barra lateral. Reintenta la conexión con WhatsApp desde Nexo.");
    const context = matches[0];
    const authoritativeWindow = Number.isInteger(context.windowId) && context.windowId >= 0 ? context.windowId : undefined;
    if (panelWindowId !== undefined && (!Number.isInteger(panelWindowId) || panelWindowId < 0))
      throw Error("La ventana de esta barra lateral no es válida.");
    if (authoritativeWindow !== undefined && panelWindowId !== undefined && authoritativeWindow !== panelWindowId)
      throw Error("La ventana de esta barra lateral cambió. Vuelve a abrir Nexo.");
    const windowId = authoritativeWindow ?? panelWindowId;
    if (!Number.isInteger(windowId) || windowId < 0 || !chrome.windows?.get)
      throw Error("No se pudo conectar esta ventana con WhatsApp. Reintenta desde Nexo.");
    const browserWindow = await chrome.windows.get(windowId);
    if (!browserWindow || browserWindow.id !== windowId)
      throw Error("La ventana de esta barra lateral ya no está disponible.");
    const identity = context.contextId || (documentId && context.documentId);
    if (!identity) throw Error("No se pudo identificar esta barra lateral. Vuelve a abrir Nexo.");
    const key = "nativePanelWindow:" + identity;
    const previous = (await storage.get(key))[key];
    if (previous !== undefined && previous !== windowId)
      throw Error("Esta barra lateral ya está conectada a otra ventana. Vuelve a abrir Nexo.");
    if (previous === undefined) await storage.set({ [key]: windowId });
    return windowId;
  });
  nativePanelRegistrations = operation.catch(() => {});
  return operation;
}
const windowWhatsAppKey = windowId => "panelWhatsApp:" + windowId;
let windowSelectionWrites = Promise.resolve();
const activationSequences = new Map(), rememberedActivationSequences = new Map();
function rememberWindowWhatsApp(tab, activatedSequence) {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab.windowId) || tab.windowId < 0 || tabOrigin(tab) !== WA_ORIGIN) return Promise.resolve();
  const operation = windowSelectionWrites.then(async () => {
    const live = await chrome.tabs.get(tab.id);
    if (tabOrigin(live) !== WA_ORIGIN || live.windowId !== tab.windowId) return;
    if (Number.isInteger(activatedSequence)) {
      // Metadata for two onActivated events may arrive out of order. A later
      // WhatsApp activation always owns the remembered target, even if the
      // user has already moved on to a non-WhatsApp page by the time it resolves.
      if (activatedSequence < (rememberedActivationSequences.get(tab.windowId) || 0)) return;
    } else {
      const active = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      if (live.active !== true || !active.some(item => item.id === live.id)) return;
    }
    await storage.set({ [windowWhatsAppKey(tab.windowId)]: live.id });
    if (Number.isInteger(activatedSequence)) rememberedActivationSequences.set(tab.windowId, activatedSequence);
  });
  windowSelectionWrites = operation.catch(() => {});
  return operation;
}
async function activeWhatsApp(tab) {
  const current = await chrome.tabs.get(tab.id);
  if (tabOrigin(current) !== WA_ORIGIN || current.windowId !== tab.windowId || current.active !== true) return false;
  if (chrome.windows?.get && (await chrome.windows.get(current.windowId)).focused === false) return false;
  return true;
}
function openNativePanel(sender) {
  if ((!isWhatsAppSender(sender, EXTENSION_ID) && !isExtensionPage(sender, EXTENSION_ID)) || !Number.isInteger(sender.tab?.windowId) || sender.tab.windowId < 0)
    throw Error("Abre Nexo con su icono de la barra de Chrome.");
  if (!chrome.sidePanel?.open) throw Error("Actualiza Chrome para mantener Nexo visible al cambiar de pestaña.");
  // Invoke within the original click gesture, before storage/tab/network awaits.
  const opening = chrome.sidePanel.open({ windowId: sender.tab.windowId });
  return opening.then(async () => {
    if (tabOrigin(sender.tab) === WA_ORIGIN) {
      await rememberWindowWhatsApp(sender.tab);
      await chrome.tabs.sendMessage(sender.tab.id, { channel: "nexo.dock", action: "close" }, { frameId: 0 }).catch(() => {});
    }
    return { opened: true, windowId: sender.tab.windowId };
  });
}
if (chrome.sidePanel?.setPanelBehavior)
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
async function notifyConnection(origin, ready, reason) {
  // This lifecycle signal contains no identity, CSRF value, or workspace data.
  await chrome.runtime.sendMessage({ channel: "nexo.connection", origin, ready, ...(reason ? { reason } : {}) }).catch(() => {});
}
async function rememberWhatsAppReturn(tab) {
  if (Number.isInteger(tab?.id) && tabOrigin(tab) === WA_ORIGIN)
    await storage.set({ connectionReturn: { tabId: tab.id, chosenAt: Date.now() } });
}
async function ensureClipboardDocument() {
  if (!chrome.offscreen?.createDocument || !chrome.runtime.getContexts)
    throw Error("Actualiza la extensión para habilitar la copia dentro de WhatsApp.");
  if (creatingClipboardDocument) { await creatingClipboardDocument; return; }
  const url = chrome.runtime.getURL("clipboard.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (contexts.length) return;
  // One hidden, bundled extension document handles clipboard operations. Unlike
  // an iframe inside WhatsApp it is not constrained by that site's focus/policy.
  creatingClipboardDocument = chrome.offscreen.createDocument({
    url: "clipboard.html",
    reasons: ["CLIPBOARD"],
    justification: "Copiar el texto solicitado por el propietario desde Nexo CRM sin cambiar de pestaña.",
  });
  try { await creatingClipboardDocument; } finally { creatingClipboardDocument = null; }
}
function copyText(text) {
  if (typeof text !== "string" || text.length > 100000)
    throw Error("El texto para copiar no es válido o supera el tamaño permitido.");
  const operation = clipboardQueue.then(async () => {
    await ensureClipboardDocument();
    const result = await chrome.runtime.sendMessage({ channel: "nexo.clipboard.offscreen", target: "clipboard-document", type: "write", text });
    if (result?.ok !== true) throw Error("No se pudo copiar. Selecciona el texto y cópialo manualmente.");
    return { copied: true };
  });
  // Serializing avoids competing writes and document-creation/closure races.
  // A failed copy does not poison the queue for the next explicit request.
  clipboardQueue = operation.catch(() => {});
  return operation;
}

async function configuration() {
  let { crmOrigin: value } = await chrome.storage.local.get("crmOrigin");
  // The distributed main CRM has one exact, pre-granted host. Other CRM hosts
  // still require the user's explicit grant in the advanced options.
  if (!value && typeof DEFAULT_ORIGIN === "string" && await chrome.permissions.contains({ origins: [DEFAULT_ORIGIN + "/*"] })) {
    value = DEFAULT_ORIGIN;
    await chrome.storage.local.set({ crmOrigin: value });
  }
  if (!value) throw Error("Conecta tu CRM desde Configuración de la extensión.");
  const origin = crmOrigin(value);
  if (!(await chrome.permissions.contains({ origins: [origin + "/*"] }))) throw Error("Autoriza el acceso al sitio de tu CRM desde Configuración.");
  return { origin };
}

const sessionKey = origin => "nativeSession:" + origin;
let nativeSessionOperations = Promise.resolve();
function withNativeSessions(action) {
  const operation = nativeSessionOperations.then(action);
  nativeSessionOperations = operation.catch(() => {});
  return operation;
}
async function assertOrigin(expectedOrigin) {
  const { origin } = await configuration();
  if (crmOrigin(expectedOrigin) !== origin) throw Error("Cambió el CRM conectado. Recarga el panel antes de continuar.");
  return origin;
}
async function forgetNativeSession(origin, expectedToken) {
  return withNativeSessions(async () => {
    const key = sessionKey(origin), values = await storage.get(key);
    if (expectedToken && values[key]?.token !== expectedToken) return false;
    await storage.remove(key);
    return true;
  });
}
async function nativeSession(origin) {
  return withNativeSessions(async () => {
    const key = sessionKey(origin), values = await storage.get(key), value = values[key];
    if (value?.origin === origin && typeof value.token === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value.token) && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() / 1000)
      return value;
    if (value) await storage.remove(key);
    return null;
  });
}
async function boundedReply(response, limit = 1500000) {
  const declared = Number(response.headers?.get("content-length"));
  if (declared > limit) throw Error("La respuesta del CRM supera el tamaño permitido.");
  const reader = response.body?.getReader();
  if (!reader) {
    if (response.body === null) return "";
    throw Error("No se pudo leer la respuesta del CRM.");
  }
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw Error("La respuesta del CRM supera el tamaño permitido."); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
async function nativeHttp(origin, path, { method = "GET", body, token, limit } = {}) {
  await assertOrigin(origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(origin + path, {
      method, credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { "Accept": "application/json", "Content-Type": "application/json", "X-Nexo-Client": "extension", ...(token ? { "Authorization": "Bearer " + token } : {}) },
      ...(body === undefined ? {} : { body }),
    });
    const text = await boundedReply(response, limit);
    await assertOrigin(origin);
    if (!response.headers.get("content-type")?.includes("application/json")) throw Error("El CRM no respondió con una sesión válida.");
    return { status: response.status, body: text, headers: { "Content-Type": "application/json" } };
  } catch (error) {
    if (error?.message?.startsWith("Cambió el CRM") || error?.message?.includes("tamaño permitido")) throw error;
    throw Error("No se pudo conectar con el CRM. Revisa tu conexión y vuelve a intentarlo.");
  } finally { clearTimeout(timer); }
}
function replyData(reply) {
  try { return JSON.parse(reply.body); } catch { throw Error("El CRM no respondió con datos válidos."); }
}
async function authStatus(origin, fresh = false) {
  await assertOrigin(origin);
  const previous = authModes.get(origin);
  if (!fresh && previous && Date.now() - previous.checkedAt < 30000) return previous.value;
  // Legacy instances may still be protected by Access and cannot answer this
  // public endpoint. Keep that compatibility path separate from native sessions.
  let value;
  if (typeof fetch === "function") {
    try {
      const reply = await nativeHttp(origin, "/api/auth/status", { limit: 4096 });
      const result = replyData(reply);
      if (reply.status === 200 && result.authProvider === "password") value = { authProvider: "password", configured: result.configured === true };
    } catch (error) { if (previous?.value.authProvider === "password") throw error; }
  }
  value ||= { authProvider: typeof DEFAULT_ORIGIN === "string" && origin === DEFAULT_ORIGIN ? "password" : "cloudflare-access", configured: true };
  await assertOrigin(origin);
  authModes.set(origin, { checkedAt: Date.now(), value });
  return value;
}
async function nativeRequest(origin, request) {
  if (request.path === "/api/logout" || request.path === "/api/password") {
    await advanceAuthenticationEpoch(); void engagementRuntime.invalidate().catch(() => {});
  }
  const session = await nativeSession(origin);
  if (!session) return { status: 401, body: JSON.stringify({ error: "Inicia sesión con tu correo y contraseña." }), headers: { "Content-Type": "application/json" } };
  const reply = await nativeHttp(origin, request.path, { ...request, token: session.token });
  if (reply.status === 401 || ((request.path === "/api/logout" || request.path === "/api/password") && reply.status === 200)) {
    if (await forgetNativeSession(origin, session.token)) await notifyConnection(origin, false, "session-ended");
  }
  return reply;
}
async function nativeVerify(origin) {
  const reply = await nativeRequest(origin, { path: "/api/session", method: "GET" });
  const data = replyData(reply);
  const ready = reply.status === 200 && data.mode === "server" && data.authProvider === "password";
  return { origin, ready, authProvider: "password" };
}
async function nativeLogin(origin, input) {
  if (typeof input?.email !== "string" || input.email.length > 254 || typeof input?.password !== "string" || !input.password || input.password.length > 1024)
    throw Error("Introduce tu correo y contraseña.");
  const epoch = await advanceAuthenticationEpoch();
  void engagementRuntime.invalidate().catch(() => {});
  const status = await authStatus(origin, true);
  if (status.authProvider !== "password") throw Error("Este CRM conserva el acceso anterior. Abre su sesión desde las opciones avanzadas.");
  if (!status.configured) throw Error("Crea primero tu contraseña desde el enlace privado de activación.");
  const reply = await nativeHttp(origin, "/api/login", { method: "POST", limit: 8192, body: JSON.stringify({ email: input.email.trim(), password: input.password, client: "extension" }) });
  const data = replyData(reply);
  if (reply.status !== 200) {
    if (reply.status === 401) throw Error("Correo o contraseña incorrectos.");
    if (reply.status === 429) throw Error("Demasiados intentos. Espera unos minutos antes de volver a entrar.");
    throw Error("No se pudo iniciar sesión. Revisa tu correo y contraseña o inténtalo nuevamente.");
  }
  if (epoch !== authenticationEpoch) throw Error("La sesión cambió mientras ingresabas. Inténtalo nuevamente.");
  if (typeof data.token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(data.token) || data.authProvider !== "password" || data.mode !== "server" || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() / 1000 || typeof data.email !== "string")
    throw Error("No se pudo verificar la sesión del CRM.");
  await assertOrigin(origin);
  await withNativeSessions(async () => {
    if (epoch !== authenticationEpoch) throw Error("La sesión cambió mientras ingresabas. Inténtalo nuevamente.");
    await storage.set({ [sessionKey(origin)]: { origin, token: data.token, expiresAt: data.expiresAt, email: data.email } });
  });
  if (epoch !== authenticationEpoch) { await forgetNativeSession(origin, data.token); throw Error("La sesión cambió. Inicia sesión nuevamente."); }
  await assertOrigin(origin);
  await notifyConnection(origin, true);
  return { origin, ready: true, email: data.email, authProvider: "password" };
}
async function crmTab({ create = false, active = false, expectedOrigin } = {}) {
  const { origin } = await configuration();
  if (expectedOrigin && origin !== expectedOrigin) throw Error("Cambió el CRM conectado. Recarga el panel para trabajar con el nuevo CRM.");
  const { crmTabId } = await storage.get("crmTabId");
  let tab;
  if (Number.isInteger(crmTabId)) {
    try { tab = await chrome.tabs.get(crmTabId); } catch { /* The user may have closed the session tab. */ }
    if (tab && tabOrigin(tab) !== origin) {
      const { pendingCrmConnection } = await storage.get("pendingCrmConnection");
      // During Access authentication, Chrome may hide the redirect URL because
      // it is outside our permitted CRM host. Focus only the tab this explicit
      // flow already opened; never inject or fetch on the authentication host.
      const knownLogin = create && active && pendingCrmConnection?.tabId === tab.id && pendingCrmConnection.origin === origin && Date.now() - pendingCrmConnection.startedAt < CONNECT_FLOW_TTL;
      if (!knownLogin) tab = null;
    }
  }
  if (!tab) {
    const matches = await chrome.tabs.query({ url: origin + "/*" });
    tab = matches.find(t => t.url && new URL(t.url).origin === origin);
  }
  if (!tab && create) tab = await chrome.tabs.create({ url: origin + "/", active });
  if (!tab) throw Error("Abre la sesión del CRM desde Configuración y mantén esa pestaña abierta.");
  if (create && active && tabOrigin(tab) === origin && new URL(tab.url).pathname === "/companion")
    tab = await chrome.tabs.update(tab.id, { url: origin + "/", active: true });
  await storage.set({ crmTabId: tab.id });
  if (active) await chrome.tabs.update(tab.id, { active: true });
  return { tab, origin };
}
async function bridge(message, expectedOrigin, pinnedCrmTabId) {
  const binding = Number.isInteger(pinnedCrmTabId)
    ? { tab: await chrome.tabs.get(pinnedCrmTabId), ...(await configuration()) }
    : await crmTab({ expectedOrigin });
  const { tab, origin } = binding;
  if (origin !== expectedOrigin) throw Error("Cambió el CRM conectado. Recarga el panel para trabajar con el nuevo CRM.");
  // Access may currently be asking for the email code on its own origin.
  if (!tab.url || new URL(tab.url).origin !== origin || tab.status === "loading") throw Error("Termina el inicio de sesión del CRM y vuelve a conectar.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["crm-bridge.js"] });
  // Configuration or navigation may change while injection is awaited. Bind
  // every request to the origin whose data this particular UI actually loaded.
  const current = await configuration();
  const destination = await chrome.tabs.get(tab.id);
  if (current.origin !== expectedOrigin || !destination.url || new URL(destination.url).origin !== expectedOrigin)
    throw Error("Cambió el CRM conectado. Recarga el panel antes de guardar.");
  return chrome.tabs.sendMessage(tab.id, { channel: "nexo.crm.bridge", expectedOrigin, ...message }, { frameId: 0 });
}
async function returnToWhatsAppIfRequested(tabId, origin) {
  const { pendingCrmConnection: pending } = await storage.get("pendingCrmConnection");
  if (!pending || pending.tabId !== tabId || pending.origin !== origin) return;
  await storage.remove("pendingCrmConnection");
  if (!Number.isInteger(pending.waTabId) || Date.now() - pending.startedAt >= CONNECT_FLOW_TTL) return;
  // Never steal focus from an unrelated tab while a background login finishes.
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active.some(tab => tab.id === tabId)) return;
  let target;
  try { target = await chrome.tabs.get(pending.waTabId); } catch { return; }
  if (tabOrigin(target) !== WA_ORIGIN) return;
  await openWhatsAppDock(target, "open");
}
async function probeConnection(tabId, origin) {
  const key = origin + ":" + tabId;
  if (connectionProbes.has(key)) return connectionProbes.get(key);
  const probe = (async () => {
    try {
      const reply = await bridge({ type: "request", request: { path: "/api/session", method: "GET" } }, origin, tabId);
      if (!reply?.ok || reply.response?.status !== 200) return { origin, ready: false };
      const session = JSON.parse(reply.response.body);
      if (session?.mode !== "server") return { origin, ready: false };
      // Recheck configuration after the authenticated fetch completes as well.
      if ((await configuration()).origin !== origin || tabOrigin(await chrome.tabs.get(tabId)) !== origin)
        return { origin, ready: false };
      await storage.set({ crmTabId: tabId });
      await notifyConnection(origin, true);
      await returnToWhatsAppIfRequested(tabId, origin).catch(() => {});
      return { origin, ready: true };
    } catch { return { origin, ready: false }; }
  })();
  connectionProbes.set(key, probe);
  try { return await probe; } finally { connectionProbes.delete(key); }
}
async function connectCrm(sender, expectedOrigin) {
  const { origin } = await configuration();
  if (expectedOrigin && expectedOrigin !== origin) throw Error("Cambió el CRM conectado. Revisa la dirección e inténtalo nuevamente.");
  if ((await authStatus(origin)).authProvider === "password") return nativeVerify(origin);
  const pinnedWa = embeddedWhatsAppTab(sender, EXTENSION_ID);
  if (Number.isInteger(pinnedWa)) {
    const tab = await chrome.tabs.get(pinnedWa);
    await rememberWhatsAppReturn(tab);
  }
  const { connectionReturn } = await storage.get("connectionReturn");
  const waTabId = connectionReturn && Date.now() - connectionReturn.chosenAt < CONNECT_FLOW_TTL ? connectionReturn.tabId : undefined;
  const { tab } = await crmTab({ create: true, active: true, expectedOrigin: origin });
  await storage.set({ pendingCrmConnection: { tabId: tab.id, origin, startedAt: Date.now(), ...(Number.isInteger(waTabId) ? { waTabId } : {}) } });
  // A pre-existing authenticated CRM tab may already be complete. A new tab or
  // Access redirect is handled by onUpdated when it returns to this origin.
  const currentTab = await chrome.tabs.get(tab.id);
  const result = currentTab.status === "complete" && tabOrigin(currentTab) === origin
    ? await probeConnection(tab.id, origin) : { origin, ready: false };
  // A cached tab can finish before this flow has stored its return target.
  // Complete that explicit return even if an onUpdated probe won the race.
  if (result.ready) await returnToWhatsAppIfRequested(tab.id, origin).catch(() => {});
  return { tabId: tab.id, ...result };
}
async function whatsappTab(pinnedTabId, windowId) {
  if (Number.isInteger(pinnedTabId)) {
    const tab = await chrome.tabs.get(pinnedTabId);
    if (!tab?.url || new URL(tab.url).origin !== WA_ORIGIN) throw Error("La pestaña de WhatsApp cambió. Recarga WhatsApp Web.");
    return tab;
  }
  if (Number.isInteger(windowId)) {
    let tab = (await chrome.tabs.query({ active: true, windowId })).find(item => tabOrigin(item) === WA_ORIGIN);
    let hadRemembered = false;
    if (!tab) {
      const values = await storage.get(windowWhatsAppKey(windowId));
      hadRemembered = Number.isInteger(values[windowWhatsAppKey(windowId)]);
      if (hadRemembered)
        try { tab = await chrome.tabs.get(values[windowWhatsAppKey(windowId)]); } catch { /* Closed WhatsApp tab. */ }
    }
    if (!hadRemembered && (tabOrigin(tab) !== WA_ORIGIN || tab.windowId !== windowId)) {
      // A unique WhatsApp in this window is unambiguous on first use. Never
      // borrow another Chrome window's recipient or pick among multiple chats.
      const candidates = await chrome.tabs.query({ url: WA_ORIGIN + "/*", windowId });
      tab = candidates.length === 1 ? candidates[0] : null;
    }
    if (tabOrigin(tab) !== WA_ORIGIN || tab.windowId !== windowId)
      throw Error("Abre WhatsApp Web en esta ventana y selecciona una conversación. Puedes seguir usando Clientes y Cuentas aquí.");
    await rememberWindowWhatsApp(tab);
    return tab;
  }
  const active = (await chrome.tabs.query({ active: true, currentWindow: true })).find(tab => tab.url && new URL(tab.url).origin === WA_ORIGIN);
  let tab = active;
  if (!tab) {
    const { waTabId } = await storage.get("waTabId");
    if (Number.isInteger(waTabId)) {
      try { tab = await chrome.tabs.get(waTabId); } catch { /* Closed WhatsApp tab. */ }
    }
  }
  if (!tab?.url || new URL(tab.url).origin !== WA_ORIGIN) throw Error("Abre WhatsApp Web y selecciona una conversación individual.");
  await storage.set({ waTabId: tab.id });
  return tab;
}
// Explicit links contain only an opaque WhatsApp peer, its displayed alias and
// the confirmed CRM telephone. They never contain fichas, messages or credentials.
// Session anchors are deliberately excluded: a display name is not a durable key.
let chatLinkWrites = Promise.resolve();
const validStoredLink = item => item && typeof item.origin === "string" && /^https:\/\//.test(item.origin) && typeof item.chatId === "string" && item.chatId.startsWith("wa:") && item.chatId.length <= 300 && typeof item.name === "string" && item.name.length <= 160 && /^\d{7,15}$/.test(item.phone);
async function readChatLinks() {
  await chatLinkWrites;
  const { chatLinks } = await chrome.storage.local.get("chatLinks");
  return Array.isArray(chatLinks) ? chatLinks.filter(validStoredLink).slice(-200) : [];
}
function changeChatLinks(change) {
  const operation = chatLinkWrites.then(async () => {
    const { chatLinks } = await chrome.storage.local.get("chatLinks");
    const previous = Array.isArray(chatLinks) ? chatLinks.filter(validStoredLink) : [];
    await chrome.storage.local.set({ chatLinks: change(previous).slice(-200) });
  });
  chatLinkWrites = operation.catch(() => {});
  return operation;
}
let whatsappOperations = Promise.resolve();
async function waRequest(action, input, sender, expectedOrigin, explicitTabId, panelContextId, panelWindowId, panelInstance) {
  const { origin } = await configuration();
  if (crmOrigin(expectedOrigin) !== origin) throw Error("Cambió el CRM conectado. Recarga el panel antes de vincular o enviar mensajes.");
  const nativeWindowId = nativePanelPage(sender) ? await nativePanelWindow(sender, panelContextId, panelWindowId, panelInstance) : undefined;
  let tab;
  try { tab = await whatsappTab(explicitTabId ?? embeddedWhatsAppTab(sender, EXTENSION_ID), nativeWindowId); }
  catch (error) {
    if (Number.isInteger(nativeWindowId) && action === "context")
      return { ...safeContext({}, undefined), windowId: nativeWindowId, active: false };
    throw error;
  }
  const guard = Number.isInteger(nativeWindowId) ? async () => {
    const selected = await whatsappTab(undefined, nativeWindowId);
    if (selected.id !== tab.id) throw Error("Cambió la pestaña de WhatsApp. Revisa el contacto antes de continuar.");
    if (action !== "context" && !await activeWhatsApp(tab))
      throw Error("Vuelve a la pestaña de WhatsApp antes de vincular, guardar textos o preparar un mensaje.");
  } : undefined;
  await guard?.();
  // Native DOM/storage operations are short and share persisted peer links.
  // Serialize across tabs so polling cannot resurrect an unlink or interleave
  // an older restore with another tab's changed recipient. No prompt or CRM
  // network request runs inside this queue.
  const operation = whatsappOperations.then(async () => {
    const result = await waRequestOnTab(action, input, origin, tab, guard, Number.isInteger(nativeWindowId) && action !== "context");
    if (Number.isInteger(nativeWindowId) && ["context", "bind", "unbind"].includes(action)) {
      const active = await activeWhatsApp(tab);
      await guard();
      return { ...result, windowId: nativeWindowId, active };
    }
    return result;
  });
  whatsappOperations = operation.catch(() => {});
  return operation;
}
async function waRequestOnTab(action, input, origin, tab, guard, requireVisible = false) {
  const send = async (operation, payload) => {
    await guard?.();
    if ((await configuration()).origin !== origin) throw Error("Cambió el CRM conectado. Recarga el panel.");
    let response;
    try { response = await chrome.tabs.sendMessage(tab.id, { channel: "nexo.whatsapp", scope: origin, action: operation, ...(requireVisible ? { requireVisible: true } : {}), ...payload }, { frameId: 0 }); }
    catch { throw Error("Recarga WhatsApp Web después de instalar la extensión."); }
    if (!response?.ok) throw Error(response?.error || "No se pudo leer la conversación actual.");
    if ((await configuration()).origin !== origin) throw Error("Cambió el CRM conectado. Recarga el panel.");
    await guard?.();
    return response.result;
  };
  const restore = async () => {
    let current = safeContext(await send("context"), tab.id);
    if (!current.chatId.startsWith("wa:") || current.isGroup || current.ambiguous) return current;
    const stored = (await readChatLinks()).find(item => item.origin === origin && item.chatId === current.chatId);
    const forgetManual = () => send("unbind", { input: { chatId: current.chatId, name: current.name } }).then(value => safeContext(value, tab.id));
    // Another WhatsApp tab can forget or change this peer's link. Its persisted
    // mapping is authoritative; an old document's manual cache cannot recreate
    // it or delete a newer mapping by pretending to be a visible phone conflict.
    if (!stored) return current.phoneSource === "manual" ? forgetManual() : current;
    if (stored.name !== current.name || current.phoneSource === "visible" && current.phone !== stored.phone) {
      await changeChatLinks(items => items.filter(item => item.origin !== origin || item.chatId !== stored.chatId));
      return current.phoneSource === "manual" ? forgetManual() : current;
    }
    if (current.phoneSource === "manual" && current.phone !== stored.phone) current = await forgetManual();
    if (!current.phone) current = safeContext(await send("bind", { input: { chatId: current.chatId, name: stored.name, phone: stored.phone } }), tab.id);
    return current;
  };
  if (action === "context") return restore();
  if (action === "bind" || action === "unbind") {
    const result = safeContext(await send(action, input), tab.id);
    if (action === "bind" && result.chatId.startsWith("wa:") && result.chatId === input.input.chatId && result.phone === input.input.phone)
      await changeChatLinks(items => [...items.filter(item => item.origin !== origin || item.chatId !== result.chatId), { origin, chatId: result.chatId, name: result.name, phone: result.phone }]);
    if (action === "unbind") await changeChatLinks(items => items.filter(item => item.origin !== origin || item.chatId !== input.input.chatId));
    return result;
  }
  await restore();
  return send(action, input);
}
async function openWhatsAppDock(candidate, action = "open") {
  let tab = candidate;
  if (!tab?.url || new URL(tab.url).origin !== WA_ORIGIN)
    tab = (await chrome.tabs.query({ url: WA_ORIGIN + "/*", currentWindow: true }))[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: WA_ORIGIN + "/", active: true });
    // The document_idle content scripts open the dock after WhatsApp loads.
    return { tabId: tab.id };
  }
  await chrome.tabs.update(tab.id, { active: true });
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { channel: "nexo.dock", action }, { frameId: 0 });
    if (!result?.ok) throw Error("El panel todavía no está cargado.");
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["whatsapp.js", "dock.js"] });
    await chrome.tabs.sendMessage(tab.id, { channel: "nexo.dock", action: "open" }, { frameId: 0 });
  }
  return { tabId: tab.id };
}
const campaignKey = windowId => "outreachRun:" + windowId;
const delayCampaign = ms => new Promise(resolve => setTimeout(resolve, ms));
let campaignLifecycle = Promise.resolve();
function withCampaignLifecycle(action) {
  const operation = campaignLifecycle.then(action);
  campaignLifecycle = operation.catch(() => {});
  return operation;
}
async function campaignWindow(sender, message, requireSession = true) {
  const origin = await assertOrigin(message.expectedOrigin);
  const epoch = authenticationEpoch;
  const windowId = await nativePanelWindow(sender, message.panelContextId, message.panelWindowId, message.panelInstance);
  if (requireSession && (!(await nativeSession(origin)) || epoch !== authenticationEpoch)) throw Error("Inicia sesión aquí antes de enviar una campaña.");
  return { origin, windowId, authEpoch: epoch };
}
async function campaignRun(sender, message) {
  const context = await campaignWindow(sender, message), key = campaignKey(context.windowId);
  const run = (await storage.get(key))[key];
  if (!run || run.origin !== context.origin || run.runId !== message.input?.runId || run.panelContextId !== message.panelContextId || run.authEpoch !== authenticationEpoch || run.expires < Date.now()) throw Error("La campaña está detenida. Iníciala o reanúdala desde Nexo.");
  return { ...context, run, key };
}
async function campaignMedia(origin, media = []) {
  if (!Array.isArray(media) || media.length > 10 || media.reduce((n, x) => n + (x.size || 0), 0) > 20971520) throw Error("El mensaje supera 10 adjuntos o 20 MB.");
  const files = [];
  async function read(path) {
    const response = await nativeRequest(origin, { path, method: "GET" });
    const value = JSON.parse(response.body);
    if (response.status !== 200) throw Error(value.error || "No se pudo descargar el adjunto.");
    return value;
  }
  for (const item of media) {
    if (!/^[a-f0-9]{32}$/.test(item.id || "")) throw Error("El adjunto no es válido.");
    const base = "/api/outreach/media/" + item.id, info = await read(base + "/metadata"), m = info.media;
    if (!m || m.sha256 !== item.sha256 || m.size !== item.size || m.type !== item.type || m.size > 20971520 || info.chunks > 40) throw Error("El archivo cambió. Revisa los adjuntos de la campaña.");
    const bytes = new Uint8Array(m.size);
    for (let part = 0; part < info.chunks; part++) {
      const chunk = await read(base + "/chunks/" + part);
      const decoded = Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0));
      const offset = part * info.chunkSize;
      if (chunk.part !== part || decoded.length !== Math.min(info.chunkSize, m.size - offset)) throw Error("El adjunto está incompleto.");
      bytes.set(decoded, offset);
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== m.sha256) throw Error("No se pudo verificar el adjunto.");
    let encoded = ""; for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
    files.push({ name: m.name, type: m.type, data: btoa(encoded) });
  }
  return files;
}
async function execute(message, sender) {
  if (message?.type === "panel.open") return openNativePanel(sender);
  await authenticationReady;
  if (isWhatsAppSender(sender, EXTENSION_ID)) {
    if (message.type === 'engagement.tick') return engagementRuntime.tick(sender,message.input);
    if (message.type === 'engagement.permit') return engagementRuntime.permit(sender,message.input);
    if (message.type === 'engagement.documentReady') { await engagementRuntime.resumeDocument(sender); return {accepted:true}; }
    if (message.type === "campaign.permit") {
      const tab = await chrome.tabs.get(sender.tab.id), key = campaignKey(tab.windowId), run = (await storage.get(key))[key];
      const livePanels = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
      const allowed = Boolean(run && run.runId === message.input?.runId && run.phone === message.input?.phone &&
        run.tabId === tab.id && run.expires > Date.now() && run.authEpoch === authenticationEpoch &&
        (await configuration()).origin === run.origin && await activeWhatsApp(tab) &&
        await nativeSession(run.origin) && livePanels.some(panel => panel.contextId === run.panelContextId));
      // A stop, logout or CRM switch may arrive while Chrome/session reads await.
      // Never authorize the stale snapshot that preceded those operations.
      const latest = (await storage.get(key))[key];
      return { allowed: Boolean(allowed && latest?.runId === run.runId && latest?.phone === run.phone &&
        latest?.tabId === tab.id && run.authEpoch === authenticationEpoch && (await configuration()).origin === run.origin) };
    }
    if (message?.type === "configuration.open") { await rememberWhatsAppReturn(sender.tab); await chrome.runtime.openOptionsPage(); return { opened: true }; }
    if (message?.type !== "wa.contextChanged") throw Error("Operación no permitida desde esta página.");
    await storage.set({ waTabId: sender.tab.id });
    const live = await chrome.tabs.get(sender.tab.id);
    if (live.active === true) await rememberWindowWhatsApp(live);
    // Re-read the current native identity in the configured scope instead of
    // forwarding a stale manual binding from another CRM's content-script cache.
    const { origin } = await configuration();
    let current = await waRequest("context", undefined, sender, origin, sender.tab.id);
    if (Number.isInteger(live.windowId)) {
      const saved = await storage.get(windowWhatsAppKey(live.windowId));
      if (saved[windowWhatsAppKey(live.windowId)] === live.id)
        current = { ...current, windowId: live.windowId, active: await activeWhatsApp(live) };
    }
    chrome.runtime.sendMessage({ channel: "nexo.context", origin, context: current }).catch(() => {});
    return { accepted: true };
  }
  if (!isExtensionPage(sender, EXTENSION_ID)) throw Error("Origen de extensión no autorizado.");
  if (message.type?.startsWith('engagement.')) {
    const {origin,windowId} = await campaignWindow(sender,message,message.type !== 'engagement.stop');
    if (message.type === 'engagement.status') return engagementRuntime.status(origin);
    if (message.type === 'engagement.select') return engagementRuntime.select(origin,message.input?.lineId);
    if (message.type === 'engagement.stop') return engagementRuntime.stop(origin);
    if (message.type === 'engagement.start') return withCampaignLifecycle(async () => {
      const prior = (await storage.get(campaignKey(windowId)))[campaignKey(windowId)];
      if (prior && prior.expires > Date.now() && prior.authEpoch === authenticationEpoch) throw Error('Pausa la campaña antes de activar el chatbot.');
      const tab = await whatsappTab(undefined,windowId);
      return engagementRuntime.start({origin,windowId,tabId:tab.id,panelContextId:message.panelContextId,lineId:message.input?.lineId,allowBackground:message.input?.allowBackground === true});
    });
    throw Error('Operación de chatbot no permitida.');
  }
  if (message.type?.startsWith("campaign.")) {
    const input = message.input || {};
    if (message.type === "campaign.start") return withCampaignLifecycle(async () => {
      const { origin, windowId, authEpoch } = await campaignWindow(sender, message);
      if ((await engagementRuntime.status(origin)).running) throw Error('Detén el chatbot antes de iniciar una campaña en este perfil.');
      if (typeof input.campaignId !== "string" || !input.campaignId || input.campaignId.length > 100) throw Error("Selecciona una campaña guardada.");
      const key = campaignKey(windowId), previous = (await storage.get(key))[key];
      if (previous && previous.origin === origin && previous.authEpoch === authEpoch && previous.expires > Date.now()) {
        const contexts = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
        if (contexts.some(context => context.contextId === previous.panelContextId)) {
          if (previous.panelContextId === message.panelContextId && previous.campaignId === input.campaignId) return { runId: previous.runId };
          throw Error("Ya hay una campaña en ejecución. Pausa la anterior.");
        }
      }
      const runId = crypto.randomUUID().replaceAll("-", "");
      await storage.set({ [key]: { runId, campaignId: input.campaignId, origin, windowId, panelContextId: message.panelContextId, authEpoch, expires: Date.now() + 28800000 } });
      return { runId };
    });
    if (message.type === "campaign.stop") return withCampaignLifecycle(async () => {
      // Stopping only revokes a permit; it remains available after session expiry.
      const { origin, windowId } = await campaignWindow(sender, message, false), key = campaignKey(windowId);
      const run = (await storage.get(key))[key];
      if (!run || run.origin !== origin || run.runId !== input.runId || run.panelContextId !== message.panelContextId)
        throw Error("La campaña ya está detenida o pertenece a otra barra lateral.");
      await storage.remove(key);
      if (Number.isInteger(run.tabId)) await chrome.tabs.sendMessage(run.tabId, { channel: "nexo.whatsapp", scope: origin, action: "campaignCancel", input: { runId: run.runId } }, { frameId: 0 }).catch(() => {});
      return { stopped: true };
    });
    const { origin, windowId, run, key } = await campaignRun(sender, message);
    const phone = String(input.phone || "").replace(/[\s()+.-]/g, "");
    if (!/^[1-9]\d{6,14}$/.test(phone)) throw Error("Revisa el teléfono del destinatario.");
    let tab = await whatsappTab(undefined, windowId);
    if (!await activeWhatsApp(tab)) throw Error("Vuelve a WhatsApp para continuar la campaña.");
    if (message.type === "campaign.select") {
      const before = await waRequest("context", undefined, sender, origin, undefined, message.panelContextId, message.panelWindowId, message.panelInstance);
      if (before.phone === phone && (!before.chatId || before.isGroup || before.ambiguous)) throw Error("No se pudo verificar una conversación individual para ese número.");
      if (before.phone !== phone) {
        await waRequest("campaignCheck", undefined, sender, origin, undefined, message.panelContextId, message.panelWindowId, message.panelInstance);
        await chrome.tabs.update(tab.id, { url: WA_ORIGIN + "/send?phone=" + phone });
        const limit = Date.now() + 45000; let revealedIdentity = "", current;
        while (Date.now() < limit) {
          await campaignRun(sender, message);
          if (!await activeWhatsApp(tab)) throw Error("La campaña se pausó porque WhatsApp dejó de estar activo.");
          try {
            current = await waRequest("context", undefined, sender, origin, tab.id, message.panelContextId, message.panelWindowId, message.panelInstance);
            if (current.phone === phone && current.chatId && !current.isGroup && !current.ambiguous) break;
            const identity = current.chatId + "\0" + current.name;
            // Navigation can leave the previous document responding briefly.
            // Its drawer must not consume the target contact's reveal attempt.
            if (current.name && current.chatId && !current.isGroup && !current.ambiguous && !current.phone && identity !== revealedIdentity) {
              await waRequest("campaignReveal", undefined, sender, origin, tab.id, message.panelContextId, message.panelWindowId, message.panelInstance); revealedIdentity = identity;
            }
          } catch { /* WhatsApp is replacing its document. */ }
          await delayCampaign(300);
        }
        if (current?.phone !== phone || current.isGroup || current.ambiguous) throw Error("No se pudo verificar el número en WhatsApp. Revisa el contacto antes de reintentar.");
      }
      return withCampaignLifecycle(async () => {
        const latest = await campaignRun(sender, message);
        await storage.set({ [key]: { ...latest.run, tabId: tab.id, phone } });
        return { selected: true, phone, tabId: tab.id };
      });
    }
    if (!["campaign.send", "campaign.preview"].includes(message.type) || run.phone !== phone || run.tabId !== tab.id) throw Error("Selecciona y verifica el destinatario antes de enviar.");
    const text = typeof input.text === "string" ? input.text : "";
    if (text.length > 8000 || !text.trim() && !input.media?.length) throw Error("Escribe un mensaje o selecciona un archivo.");
    const files = await campaignMedia(origin, input.media || []);
    await campaignRun(sender, message);
    return waRequest("campaignSend", { input: { runId: run.runId, phone, text, files, automatic: message.type === "campaign.send" } }, sender, origin, undefined, message.panelContextId, message.panelWindowId, message.panelInstance);
  }
  switch (message?.type) {
    case "wa.contacts": {
      const input = message.input || {};
      if (!["visible", "archived", "group"].includes(input.source) || input.scan !== undefined && typeof input.scan !== "boolean") throw Error("Selecciona una lista de contactos válida.");
      return waRequest("exportContacts", { input }, sender, message.expectedOrigin, undefined, message.panelContextId, message.panelWindowId, message.panelInstance);
    }
    case "configuration.get": {
      const values = await chrome.storage.local.get("crmOrigin");
      let origin = values.crmOrigin || "";
      if (!origin) try { origin = (await configuration()).origin; } catch { /* Other hosts need a one-time grant in advanced options. */ }
      if (nativePanelPage(sender)) {
        // Authentication and CRM operations do not depend on WhatsApp routing.
        // Missing optional Chrome sender metadata must never hide inline login.
        const result = { origin, ...(origin === DEFAULT_ORIGIN ? { authProvider: "password" } : {}) };
        try {
          result.panelWindowId = await nativePanelWindow(sender, message.panelContextId, message.panelWindowId, message.panelInstance);
          try { result.waTabId = (await whatsappTab(undefined, result.panelWindowId)).id; } catch { /* CRM works without an open WhatsApp. */ }
        } catch (error) { result.panelRoutingError = error?.message || "No se pudo conectar esta ventana con WhatsApp."; }
        return result;
      }
      return { origin, waTabId: embeddedWhatsAppTab(sender, EXTENSION_ID) };
    }
    case "clipboard.copy": return copyText(message.text);
    case "configuration.open": {
      const pinned = embeddedWhatsAppTab(sender, EXTENSION_ID);
      if (Number.isInteger(pinned)) await rememberWhatsAppReturn(await chrome.tabs.get(pinned));
      await chrome.runtime.openOptionsPage(); return { opened: true };
    }
    case "configuration.set": {
      if ((sender.frameId ?? 0) !== 0 || new URL(sender.url).pathname !== "/options.html") throw Error("Abre la configuración de la extensión.");
      const origin = crmOrigin(message.origin);
      if (!(await chrome.permissions.contains({ origins: [origin + "/*"] }))) throw Error("Autoriza primero el dominio del CRM.");
      const previous = await chrome.storage.local.get("crmOrigin");
      await chrome.storage.local.set({ crmOrigin: origin });
      if (previous.crmOrigin !== origin) {
        await advanceAuthenticationEpoch();
        void engagementRuntime.invalidate().catch(() => {});
        if (previous.crmOrigin) await forgetNativeSession(previous.crmOrigin);
        await forgetNativeSession(origin);
        authModes.clear();
        await storage.remove("crmTabId");
        await storage.remove("pendingCrmConnection");
        await notifyConnection(origin, false, "configuration-changed");
      }
      return { origin };
    }
    case "crm.authStatus": {
      const origin = await assertOrigin(message.expectedOrigin);
      return { origin, ...(await authStatus(origin, true)) };
    }
    case "crm.login": {
      const origin = await assertOrigin(message.expectedOrigin);
      return nativeLogin(origin, message.input);
    }
    case "crm.connect": return connectCrm(sender, message.expectedOrigin);
    case "crm.open": {
      const { origin } = await configuration();
      if (crmOrigin(message.expectedOrigin) !== origin) throw Error("Cambió el CRM conectado. Revisa la dirección guardada.");
      // Opening the full CRM is an explicit working action, so completing its
      // authenticated session must not return focus to WhatsApp automatically.
      await storage.remove("pendingCrmConnection");
      const { tab } = await crmTab({ create: true, active: true, expectedOrigin: origin });
      return { opened: true, tabId: tab.id };
    }
    case "crm.verify": {
      const { origin } = await configuration();
      if (crmOrigin(message.expectedOrigin) !== origin) throw Error("Cambió el CRM conectado. Revisa la dirección guardada.");
      try {
        if ((await authStatus(origin)).authProvider === "password") return nativeVerify(origin);
        const { tab } = await crmTab({ expectedOrigin: origin });
        return probeConnection(tab.id, origin);
      } catch { return { origin, ready: false }; }
    }
    case "crm.request": {
      const request = allowedApi(message.path, message.method || "GET", message.body);
      const expectedOrigin = crmOrigin(message.expectedOrigin);
      await assertOrigin(expectedOrigin);
      if ((await authStatus(expectedOrigin)).authProvider === "password") return nativeRequest(expectedOrigin, request);
      const reply = await bridge({ type: "request", request }, expectedOrigin);
      if (!reply?.ok) throw Error(reply?.error || "No se pudo consultar el CRM.");
      if (request.path === "/api/logout" && reply.response?.status === 200) {
        const { tab } = await crmTab({ expectedOrigin });
        await chrome.tabs.update(tab.id, { url: expectedOrigin + "/cdn-cgi/access/logout", active: true });
        reply.response.body = JSON.stringify({ ok: true, logoutUrl: chrome.runtime.getURL("options.html") });
      }
      return reply.response;
    }
    case "wa.open": {
      if (nativePanelPage(sender)) {
        const windowId = await nativePanelWindow(sender, message.panelContextId, message.panelWindowId, message.panelInstance);
        let tab;
        try { tab = await whatsappTab(undefined, windowId); }
        catch {
          // This is an explicit "Abrir WhatsApp" click, so a unique remaining
          // tab can be focused. Passive context reads never make this switch.
          const candidates = await chrome.tabs.query({ url: WA_ORIGIN + "/*", windowId });
          if (candidates.length === 1) tab = candidates[0];
        }
        if (!tab) tab = await chrome.tabs.create({ url: WA_ORIGIN + "/", active: true, windowId });
        else tab = await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows?.update?.(windowId, { focused: true });
        await rememberWindowWhatsApp(tab);
        return { tabId: tab.id, windowId };
      }
      const pinned = embeddedWhatsAppTab(sender, EXTENSION_ID);
      const candidate = Number.isInteger(pinned) ? await chrome.tabs.get(pinned) : undefined;
      const result = await openWhatsAppDock(candidate);
      await rememberWhatsAppReturn(await chrome.tabs.get(result.tabId));
      return result;
    }
    case "wa.context": return waRequest("context", undefined, sender, message.expectedOrigin, undefined, message.panelContextId, message.panelWindowId, message.panelInstance);
    case "wa.capture": return waRequest("capture", undefined, sender, message.expectedOrigin, undefined, message.panelContextId, message.panelWindowId, message.panelInstance);
    case "wa.bind": {
      const phone = String(message.input?.phone || "").replace(/[\s()+.-]/g, "");
      const chatId = message.input?.chatId;
      const name = message.input?.name;
      if (!/^\d{7,15}$/.test(phone) || typeof chatId !== "string" || chatId.length > 300 || typeof name !== "string" || !name || name.length > 160) throw Error("Confirma el teléfono y la conversación a vincular.");
      return waRequest("bind", { input: { phone, chatId, name } }, sender, message.expectedOrigin, undefined, message.panelContextId, message.panelWindowId, message.panelInstance);
    }
    case "wa.unbind": {
      const chatId = message.input?.chatId;
      const name = message.input?.name;
      if (typeof chatId !== "string" || !chatId || chatId.length > 300 || typeof name !== "string" || !name || name.length > 160) throw Error("Revisa la conversación que deseas desvincular.");
      return waRequest("unbind", { input: { chatId, name } }, sender, message.expectedOrigin, undefined, message.panelContextId, message.panelWindowId, message.panelInstance);
    }
    case "wa.prepare": return waRequest("prepare", { input: draftInput(message.input) }, sender, message.expectedOrigin, undefined, message.panelContextId, message.panelWindowId, message.panelInstance);
    default: throw Error("Operación desconocida.");
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore our identity broadcasts; there is no externally-connectable entry point.
  if (message?.channel === "nexo.context") return false;
  if (message?.channel !== "nexo") return false;
  execute(message, sender).then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message || "La operación no pudo completarse." }));
  return true;
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  // Native Chrome panels open from a deliberate toolbar/launcher click. Do not
  // redirect a fresh installation to another setup or licensing page.
  if (reason === "install" && !chrome.sidePanel?.open) chrome.runtime.openOptionsPage();
});
chrome.tabs.onActivated?.addListener(({ tabId, windowId }) => {
  const sequence = (activationSequences.get(windowId) || 0) + 1;
  activationSequences.set(windowId, sequence);
  (async () => {
    const tab = await chrome.tabs.get(tabId);
    if (tabOrigin(tab) === WA_ORIGIN) await rememberWindowWhatsApp(tab, sequence);
    if (activationSequences.get(windowId) !== sequence) return;
    const { origin } = await configuration();
    const selected = await whatsappTab(undefined, windowId);
    const current = await waRequest("context", undefined, {}, origin, selected.id);
    if (activationSequences.get(windowId) !== sequence) return;
    chrome.runtime.sendMessage({ channel: "nexo.context", origin, context: { ...current, windowId, active: await activeWhatsApp(selected) } }).catch(() => {});
  })().catch(() => {});
});
chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  configuration().then(async ({ origin }) => {
    if (tabOrigin(tab) === origin && (await authStatus(origin)).authProvider !== "password") return probeConnection(tabId, origin);
  }).catch(() => {});
});
chrome.tabs.onRemoved?.addListener(tabId => {
  (async () => {
    const { crmTabId } = await storage.get("crmTabId");
    if (crmTabId === tabId) await storage.remove("crmTabId");
    const { pendingCrmConnection } = await storage.get("pendingCrmConnection");
    if (pendingCrmConnection?.tabId === tabId) await storage.remove("pendingCrmConnection");
    const { connectionReturn } = await storage.get("connectionReturn");
    if (connectionReturn?.tabId === tabId) await storage.remove("connectionReturn");
  })().catch(() => {});
});
chrome.action.onClicked.addListener(tab => {
  if (chrome.sidePanel?.open) {
    // setPanelBehavior handles the browser gesture and global panel. Remember
    // WhatsApp only; switching to another site must not focus it again.
    rememberWindowWhatsApp(tab).catch(() => {});
    return;
  }
  openWhatsAppDock(tab, "toggle").catch(() => chrome.runtime.openOptionsPage());
});
