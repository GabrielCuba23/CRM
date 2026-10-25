import { crmOrigin, DEFAULT_ORIGIN } from "./policy.mjs";
const status = document.querySelector("#status");
let busy = false;
async function rpc(type, data = {}) {
  const reply = await chrome.runtime.sendMessage({ channel: "nexo", type, ...data });
  if (!reply?.ok) throw Error(reply?.error || "No se pudo completar la operación.");
  return reply.result;
}
async function action(callback) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll("button")];
  buttons.forEach(button => { button.disabled = true; });
  try { await callback(); } catch (error) { status.textContent = error.message; }
  finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
}
const current = await rpc("configuration.get");
document.querySelector("#origin").value = current.origin || DEFAULT_ORIGIN;
status.textContent = current.origin
  ? "Dirección guardada: " + current.origin + ". Abre WhatsApp con Nexo para conectar tu sesión."
  : "La dirección mostrada es una sugerencia; todavía no está guardada. Pulsa Conectar CRM o Abrir WhatsApp para guardarla y entrar.";

async function saveInputConfiguration() {
  const origin = crmOrigin(document.querySelector("#origin").value.trim());
  // This is deliberately the first await in a direct user-click handler.
  // Chrome must ask the user for this exact host before any background work.
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (!granted) throw Error("No se autorizó el sitio del CRM. Puedes intentarlo nuevamente.");
  const saved = await rpc("configuration.get");
  if (saved.origin !== origin) await rpc("configuration.set", { origin });
  return origin;
}
async function connectWorkspace() {
  const origin = await saveInputConfiguration();
  status.textContent = "Dirección guardada. Abriendo WhatsApp y conectando tu sesión…";
  // Remember the explicitly selected WhatsApp tab before opening authentication,
  // so a successful login can return to that same conversation automatically.
  await rpc("wa.open");
  const verified = await rpc("crm.verify", { expectedOrigin: origin });
  if (verified.ready) {
    status.textContent = "Conexión lista. Nexo ya está disponible dentro de WhatsApp Web.";
    return;
  }
  const connection = await rpc("crm.connect", { expectedOrigin: origin });
  status.textContent = connection.ready
    ? "Conexión lista. Nexo ya está disponible dentro de WhatsApp Web."
    : "Completa el ingreso con tu correo y código si Cloudflare lo solicita. Al terminar, Nexo se conectará en WhatsApp automáticamente.";
}
document.querySelector("#configuration").addEventListener("submit", event => {
  event.preventDefault();
  action(connectWorkspace);
});
document.querySelector("#connect").addEventListener("click", () => action(connectWorkspace));
document.querySelector("#check").addEventListener("click", () => action(async () => {
  const origin = await saveInputConfiguration();
  const result = await rpc("crm.verify", { expectedOrigin: origin });
  status.textContent = result.ready
    ? "Conexión lista. Nexo ya está disponible dentro de WhatsApp Web."
    : "Tu sesión todavía no está conectada. Pulsa Abrir WhatsApp con Nexo para completar el ingreso.";
}));
document.querySelector("#workspace").addEventListener("click", () => action(connectWorkspace));
chrome.runtime.onMessage?.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.channel !== "nexo.connection") return false;
  rpc("configuration.get").then(({ origin }) => {
    if (!origin || origin !== message.origin) return;
    status.textContent = message.ready === true
      ? "Conexión lista. Nexo ya está disponible dentro de WhatsApp Web."
      : "Dirección guardada: " + origin + ". Conecta tu sesión para empezar a trabajar.";
  }).catch(() => {});
  return false;
});
