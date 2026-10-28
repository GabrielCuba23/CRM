export const DEFAULT_ORIGIN = "https://nexo-crm.acxelcubaaraoz.workers.dev";
export const WA_ORIGIN = "https://web.whatsapp.com";
export const API_METHODS = Object.freeze({
  "/api/session": ["GET"],
  "/api/workspace": ["GET", "PUT"],
  "/api/automation-status": ["GET"],
  "/api/message-tasks": ["GET"],
  "/api/message-tasks/refresh": ["POST"],
  "/api/report-status": ["GET"],
  "/api/logout": ["POST"],
  "/api/password": ["POST"],
});
export function crmOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw Error("Introduce la dirección HTTPS de tu CRM."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname))
    throw Error("Usa solo el origen HTTPS de tu CRM, sin rutas, claves ni parámetros.");
  if (parsed.origin === WA_ORIGIN) throw Error("Introduce el sitio del CRM, no WhatsApp Web.");
  return parsed.origin;
}
export function allowedApi(path, method = "GET", body) {
  if (typeof path !== "string" || !API_METHODS[path]?.includes(method)) throw Error("Operación no permitida por la extensión.");
  if (body !== undefined && (typeof body !== "string" || new TextEncoder().encode(body).length > 1100000)) throw Error("La operación supera el tamaño permitido.");
  if (["GET", "HEAD"].includes(method) && body !== undefined) throw Error("Solicitud no válida.");
  return { path, method, ...(body === undefined ? {} : { body }) };
}
export function isExtensionPage(sender, extensionId) {
  if (sender.id !== extensionId) return false;
  try {
    const url = new URL(sender.url || "");
    if (url.protocol !== "chrome-extension:" || url.hostname !== extensionId || !["/app/index.html", "/options.html"].includes(url.pathname)) return false;
    if ((sender.frameId ?? 0) === 0) return true;
    // Only our own CRM document may run inside a WhatsApp tab. The browser
    // supplies these sender fields; page messages cannot choose a tab/frame.
    return url.pathname === "/app/index.html" && url.searchParams.get("embedded") === "1" &&
      Number.isInteger(sender.frameId) && sender.frameId > 0 &&
      Number.isInteger(sender.tab?.id) && new URL(sender.tab.url).origin === WA_ORIGIN;
  } catch { return false; }
}
export function embeddedWhatsAppTab(sender, extensionId) {
  return isExtensionPage(sender, extensionId) && (sender.frameId ?? 0) > 0 ? sender.tab.id : undefined;
}
export function isWhatsAppSender(sender, extensionId) {
  if (sender.id !== extensionId || !Number.isInteger(sender.tab?.id) || (sender.frameId ?? 0) !== 0) return false;
  try { return new URL(sender.url || sender.tab.url).origin === WA_ORIGIN; } catch { return false; }
}
export function safeContext(value, tabId) {
  return {
    name: typeof value?.name === "string" ? value.name.slice(0, 160) : "",
    phone: /^\d{7,15}$/.test(value?.phone || "") ? value.phone : "",
    chatId: typeof value?.chatId === "string" ? value.chatId.slice(0, 300) : "",
    isGroup: value?.isGroup === true,
    ambiguous: value?.ambiguous === true,
    phoneSource: value?.phoneSource === "manual" ? "manual" : value?.phoneSource === "visible" ? "visible" : "",
    tabId,
  };
}
export function draftInput(value) {
  const phone = String(value?.phone || "").replace(/[\s()+.-]/g, "");
  const text = value?.text;
  if (!/^\d{7,15}$/.test(phone) || typeof text !== "string" || !text.trim() || text.length > 8000) throw Error("Revisa el teléfono y el texto del mensaje.");
  return { phone, text };
}
