import { crmOrigin, allowedApi, isExtensionPage, embeddedWhatsAppTab, isWhatsAppSender, safeContext, draftInput, WA_ORIGIN, DEFAULT_ORIGIN } from "./policy.mjs";

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

function tabOrigin(tab) {
  try { return new URL(tab?.url || "").origin; } catch { return ""; }
}
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
  if (request.path === "/api/logout" || request.path === "/api/password") authenticationEpoch++;
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
  const epoch = ++authenticationEpoch;
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
async function whatsappTab(pinnedTabId) {
  if (Number.isInteger(pinnedTabId)) {
    const tab = await chrome.tabs.get(pinnedTabId);
    if (!tab?.url || new URL(tab.url).origin !== WA_ORIGIN) throw Error("La pestaña de WhatsApp cambió. Recarga WhatsApp Web.");
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
async function waRequest(action, input, sender, expectedOrigin, explicitTabId) {
  const { origin } = await configuration();
  if (crmOrigin(expectedOrigin) !== origin) throw Error("Cambió el CRM conectado. Recarga el panel antes de vincular o enviar mensajes.");
  const tab = await whatsappTab(explicitTabId ?? embeddedWhatsAppTab(sender, EXTENSION_ID));
  // Native DOM/storage operations are short and share persisted peer links.
  // Serialize across tabs so polling cannot resurrect an unlink or interleave
  // an older restore with another tab's changed recipient. No prompt or CRM
  // network request runs inside this queue.
  const operation = whatsappOperations.then(() => waRequestOnTab(action, input, origin, tab));
  whatsappOperations = operation.catch(() => {});
  return operation;
}
async function waRequestOnTab(action, input, origin, tab) {
  const send = async (operation, payload) => {
    if ((await configuration()).origin !== origin) throw Error("Cambió el CRM conectado. Recarga el panel.");
    let response;
    try { response = await chrome.tabs.sendMessage(tab.id, { channel: "nexo.whatsapp", scope: origin, action: operation, ...payload }, { frameId: 0 }); }
    catch { throw Error("Recarga WhatsApp Web después de instalar la extensión."); }
    if (!response?.ok) throw Error(response?.error || "No se pudo leer la conversación actual.");
    if ((await configuration()).origin !== origin) throw Error("Cambió el CRM conectado. Recarga el panel.");
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
async function execute(message, sender) {
  if (isWhatsAppSender(sender, EXTENSION_ID)) {
    if (message?.type === "configuration.open") { await rememberWhatsAppReturn(sender.tab); await chrome.runtime.openOptionsPage(); return { opened: true }; }
    if (message?.type !== "wa.contextChanged") throw Error("Operación no permitida desde esta página.");
    await storage.set({ waTabId: sender.tab.id });
    // Re-read the current native identity in the configured scope instead of
    // forwarding a stale manual binding from another CRM's content-script cache.
    const { origin } = await configuration();
    const current = await waRequest("context", undefined, sender, origin, sender.tab.id);
    chrome.runtime.sendMessage({ channel: "nexo.context", origin, context: current }).catch(() => {});
    return { accepted: true };
  }
  if (!isExtensionPage(sender, EXTENSION_ID)) throw Error("Origen de extensión no autorizado.");
  switch (message?.type) {
    case "configuration.get": {
      const values = await chrome.storage.local.get("crmOrigin");
      let origin = values.crmOrigin || "";
      if (!origin) try { origin = (await configuration()).origin; } catch { /* Other hosts need a one-time grant in advanced options. */ }
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
        authenticationEpoch++;
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
      const pinned = embeddedWhatsAppTab(sender, EXTENSION_ID);
      const candidate = Number.isInteger(pinned) ? await chrome.tabs.get(pinned) : undefined;
      const result = await openWhatsAppDock(candidate);
      await rememberWhatsAppReturn(await chrome.tabs.get(result.tabId));
      return result;
    }
    case "wa.context": return waRequest("context", undefined, sender, message.expectedOrigin);
    case "wa.capture": return waRequest("capture", undefined, sender, message.expectedOrigin);
    case "wa.bind": {
      const phone = String(message.input?.phone || "").replace(/[\s()+.-]/g, "");
      const chatId = message.input?.chatId;
      const name = message.input?.name;
      if (!/^\d{7,15}$/.test(phone) || typeof chatId !== "string" || chatId.length > 300 || typeof name !== "string" || !name || name.length > 160) throw Error("Confirma el teléfono y la conversación a vincular.");
      return waRequest("bind", { input: { phone, chatId, name } }, sender, message.expectedOrigin);
    }
    case "wa.unbind": {
      const chatId = message.input?.chatId;
      const name = message.input?.name;
      if (typeof chatId !== "string" || !chatId || chatId.length > 300 || typeof name !== "string" || !name || name.length > 160) throw Error("Revisa la conversación que deseas desvincular.");
      return waRequest("unbind", { input: { chatId, name } }, sender, message.expectedOrigin);
    }
    case "wa.prepare": return waRequest("prepare", { input: draftInput(message.input) }, sender, message.expectedOrigin);
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
  if (reason === "install") chrome.runtime.openOptionsPage();
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
chrome.action.onClicked.addListener(tab => { openWhatsAppDock(tab, "toggle").catch(() => chrome.runtime.openOptionsPage()); });
