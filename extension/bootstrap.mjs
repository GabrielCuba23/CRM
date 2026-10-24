async function rpc(type, input = {}) {
  const reply = await chrome.runtime.sendMessage({ channel: "nexo", type, ...input });
  if (!reply?.ok) throw Error(reply?.error || "La extensión no pudo completar la operación.");
  return reply.result;
}
const loginUrl = chrome.runtime.getURL("options.html");
let configuredOrigin = "";
globalThis.NexoCompanion = Object.freeze({
  loginUrl,
  async fetch(path, options = {}) {
    const result = await rpc("crm.request", { expectedOrigin: configuredOrigin, path, method: options.method || "GET", ...(options.body === undefined ? {} : { body: options.body }) });
    return new Response(result.body, { status: result.status, headers: result.headers });
  },
  getContext: () => rpc("wa.context"),
  bindConversation: input => rpc("wa.bind", { input }),
  captureVisibleMessages: () => rpc("wa.capture"),
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
      if (sender.id === chrome.runtime.id && !sender.tab && message?.channel === "nexo.context") handler(message.context);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  },
  async openLogin() { return rpc("crm.connect", { expectedOrigin: configuredOrigin }); },
});
try {
  const { origin } = await rpc("configuration.get");
  if (!origin) { location.replace(loginUrl); }
  else {
    configuredOrigin = origin;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet"; stylesheet.href = "../companion.css";
    document.head.append(stylesheet);
    await import("./app/app.js");
  }
} catch (error) {
  document.body.replaceChildren();
  const main = document.createElement("main"), title = document.createElement("h1"), message = document.createElement("p"), action = document.createElement("a");
  title.textContent = "Conecta Nexo CRM"; message.textContent = error.message;
  action.href = loginUrl; action.target = "_blank"; action.rel = "noopener"; action.textContent = "Abrir configuración e iniciar sesión";
  main.append(title, message, action); document.body.append(main);
}
