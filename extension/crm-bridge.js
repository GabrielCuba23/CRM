(() => {
  if (globalThis.__nexoCrmBridge) return;
  globalThis.__nexoCrmBridge = true;
  const api = {
    "/api/session": ["GET"], "/api/workspace": ["GET", "PUT"],
    "/api/automation-status": ["GET"], "/api/message-tasks": ["GET"],
    "/api/message-tasks/refresh": ["POST"], "/api/report-status": ["GET"],
    "/api/logout": ["POST"],
  };
  const limit = 1500000;
  async function request(input) {
    if (!input || !api[input.path]?.includes(input.method) || (input.body !== undefined && (typeof input.body !== "string" || new TextEncoder().encode(input.body).length > 1100000)))
      throw Error("Solicitud de CRM no permitida.");
    const headers = { "Content-Type": "application/json" };
    if (!["GET", "HEAD"].includes(input.method)) {
      const session = await fetch("/api/session", { credentials: "same-origin", cache: "no-store", redirect: "error" });
      if (!session.ok || !session.headers.get("Content-Type")?.includes("application/json")) throw Error("Vuelve a iniciar sesión en el CRM.");
      const user = await session.json();
      if (typeof user.csrf !== "string" || user.csrf.length > 200) throw Error("Sesión del CRM no válida.");
      headers["X-CSRF-Token"] = user.csrf;
    }
    let response;
    try { response = await fetch(input.path, { method: input.method, body: input.body, headers, credentials: "same-origin", cache: "no-store", redirect: "error" }); }
    catch { throw Error("Inicia sesión en la pestaña del CRM y vuelve a intentarlo."); }
    if (!response.headers.get("Content-Type")?.includes("application/json")) throw Error("El CRM no devolvió una respuesta privada válida. Comprueba el inicio de sesión.");
    const reader = response.body.getReader();
    const parts = []; let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > limit) { await reader.cancel(); throw Error("La respuesta del CRM supera el tamaño admitido."); }
      parts.push(part.value);
    }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const part of parts) { data.set(part, offset); offset += part.length; }
    return { status: response.status, body: new TextDecoder().decode(data), headers: { "Content-Type": "application/json; charset=utf-8" } };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.channel !== "nexo.crm.bridge") return false;
    if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && !sender.url.startsWith(chrome.runtime.getURL("")))) {
      sendResponse({ ok: false, error: "Origen de extensión no autorizado." }); return false;
    }
    if (location.protocol !== "https:" || location.origin !== message.expectedOrigin || window !== window.top) {
      sendResponse({ ok: false, error: "La sesión requiere un sitio HTTPS y su ventana principal." }); return false;
    }
    request(message.request).then(response => sendResponse({ ok: true, response }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
