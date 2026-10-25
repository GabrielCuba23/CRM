import { crmOrigin, DEFAULT_ORIGIN } from "./policy.mjs";
const status = document.querySelector("#status");
async function rpc(type, data = {}) {
  const reply = await chrome.runtime.sendMessage({ channel: "nexo", type, ...data });
  if (!reply?.ok) throw Error(reply?.error || "No se pudo completar la operación.");
  return reply.result;
}
async function action(callback) {
  try { await callback(); } catch (error) { status.textContent = error.message; }
}
const current = await rpc("configuration.get");
document.querySelector("#origin").value = current.origin || DEFAULT_ORIGIN;
document.querySelector("#configuration").addEventListener("submit", event => {
  event.preventDefault();
  action(async () => {
    const origin = crmOrigin(document.querySelector("#origin").value.trim());
    const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
    if (!granted) throw Error("No se autorizó el sitio del CRM. Puedes intentarlo nuevamente.");
    await rpc("configuration.set", { origin });
    await rpc("crm.connect");
    status.textContent = "Termina el inicio de sesión en la pestaña del CRM. Después vuelve aquí y comprueba la conexión.";
  });
});
document.querySelector("#connect").addEventListener("click", () => action(async () => { await rpc("crm.connect"); status.textContent = "Inicia sesión y mantén abierta la pestaña de conexión."; }));
document.querySelector("#check").addEventListener("click", () => action(async () => {
  const { origin } = await rpc("configuration.get");
  const result = await rpc("crm.request", { expectedOrigin: origin, path: "/api/session", method: "GET" });
  const session = JSON.parse(result.body);
  if (result.status !== 200 || session.mode !== "server") throw Error(session.error || "Termina el inicio de sesión del CRM.");
  status.textContent = "Conexión privada verificada para " + session.email + ". Ya puedes abrir el panel junto a WhatsApp Web.";
}));
document.querySelector("#workspace").addEventListener("click", () => action(async () => { await rpc("wa.open"); status.textContent = "Nexo se abre dentro de WhatsApp Web. El botón Nexo permite mostrarlo u ocultarlo."; }));
