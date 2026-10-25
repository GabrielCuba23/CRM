import { crmOrigin, allowedApi, isExtensionPage, embeddedWhatsAppTab, isWhatsAppSender, safeContext, draftInput, WA_ORIGIN } from "./policy.mjs";

const EXTENSION_ID = chrome.runtime.id;
const storage = chrome.storage.session;
chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

async function configuration() {
  const { crmOrigin: value } = await chrome.storage.local.get("crmOrigin");
  if (!value) throw Error("Conecta tu CRM desde Configuración de la extensión.");
  const origin = crmOrigin(value);
  if (!(await chrome.permissions.contains({ origins: [origin + "/*"] }))) throw Error("Autoriza el acceso al sitio de tu CRM desde Configuración.");
  return { origin };
}
async function crmTab({ create = false, active = false, expectedOrigin } = {}) {
  const { origin } = await configuration();
  if (expectedOrigin && origin !== expectedOrigin) throw Error("Cambió el CRM conectado. Recarga el panel para trabajar con el nuevo CRM.");
  const { crmTabId } = await storage.get("crmTabId");
  let tab;
  if (Number.isInteger(crmTabId)) {
    try { tab = await chrome.tabs.get(crmTabId); } catch { /* The user may have closed the session tab. */ }
    if (tab && new URL(tab.url || "about:blank").origin !== origin) tab = null;
  }
  if (!tab) {
    const matches = await chrome.tabs.query({ url: origin + "/*" });
    tab = matches.find(t => t.url && new URL(t.url).origin === origin);
  }
  if (!tab && create) tab = await chrome.tabs.create({ url: origin + "/companion", active });
  if (!tab) throw Error("Abre la sesión del CRM desde Configuración y mantén esa pestaña abierta.");
  await storage.set({ crmTabId: tab.id });
  if (active) await chrome.tabs.update(tab.id, { active: true });
  return { tab, origin };
}
async function bridge(message, expectedOrigin) {
  const { tab, origin } = await crmTab({ expectedOrigin });
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
async function waRequest(action, input, sender) {
  const tab = await whatsappTab(embeddedWhatsAppTab(sender, EXTENSION_ID));
  let response;
  try { response = await chrome.tabs.sendMessage(tab.id, { channel: "nexo.whatsapp", action, ...input }, { frameId: 0 }); }
  catch { throw Error("Recarga WhatsApp Web después de instalar la extensión."); }
  if (!response?.ok) throw Error(response?.error || "No se pudo leer la conversación actual.");
  if (action === "context") return safeContext(response.result, tab.id);
  if (action === "capture") return response.result;
  return response.result;
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
    if (message?.type === "configuration.open") { await chrome.runtime.openOptionsPage(); return { opened: true }; }
    if (message?.type !== "wa.contextChanged") throw Error("Operación no permitida desde esta página.");
    await storage.set({ waTabId: sender.tab.id });
    // Broadcast only public chat identity; never a response from the CRM.
    chrome.runtime.sendMessage({ channel: "nexo.context", context: safeContext(message.context, sender.tab.id) }).catch(() => {});
    return { accepted: true };
  }
  if (!isExtensionPage(sender, EXTENSION_ID)) throw Error("Origen de extensión no autorizado.");
  switch (message?.type) {
    case "configuration.get": {
      const values = await chrome.storage.local.get("crmOrigin");
      return { origin: values.crmOrigin || "", waTabId: embeddedWhatsAppTab(sender, EXTENSION_ID) };
    }
    case "configuration.open": { await chrome.runtime.openOptionsPage(); return { opened: true }; }
    case "configuration.set": {
      if ((sender.frameId ?? 0) !== 0 || new URL(sender.url).pathname !== "/options.html") throw Error("Abre la configuración de la extensión.");
      const origin = crmOrigin(message.origin);
      if (!(await chrome.permissions.contains({ origins: [origin + "/*"] }))) throw Error("Autoriza primero el dominio del CRM.");
      await chrome.storage.local.set({ crmOrigin: origin });
      await storage.remove("crmTabId");
      return { origin };
    }
    case "crm.connect": {
      const { tab } = await crmTab({ create: true, active: true, expectedOrigin: message.expectedOrigin });
      return { tabId: tab.id };
    }
    case "crm.request": {
      const request = allowedApi(message.path, message.method || "GET", message.body);
      const expectedOrigin = crmOrigin(message.expectedOrigin);
      const reply = await bridge({ type: "request", request }, expectedOrigin);
      if (!reply?.ok) throw Error(reply?.error || "No se pudo consultar el CRM.");
      if (request.path === "/api/logout" && reply.response?.status === 200) {
        const { tab } = await crmTab({ expectedOrigin });
        await chrome.tabs.update(tab.id, { url: expectedOrigin + "/cdn-cgi/access/logout", active: true });
        reply.response.body = JSON.stringify({ ok: true, logoutUrl: chrome.runtime.getURL("options.html") });
      }
      return reply.response;
    }
    case "wa.open": return openWhatsAppDock();
    case "wa.context": return waRequest("context", undefined, sender);
    case "wa.capture": return waRequest("capture", undefined, sender);
    case "wa.bind": {
      const phone = String(message.input?.phone || "").replace(/[\s()+.-]/g, "");
      const chatId = message.input?.chatId;
      if (!/^\d{7,15}$/.test(phone) || typeof chatId !== "string" || chatId.length > 300) throw Error("Confirma el teléfono y la conversación a vincular.");
      return waRequest("bind", { input: { phone, chatId } }, sender);
    }
    case "wa.prepare": return waRequest("prepare", { input: draftInput(message.input) }, sender);
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
chrome.action.onClicked.addListener(tab => { openWhatsAppDock(tab, "toggle").catch(() => chrome.runtime.openOptionsPage()); });
