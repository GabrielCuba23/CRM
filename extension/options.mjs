import { crmOrigin, DEFAULT_ORIGIN } from "./policy.mjs";

const status = document.querySelector("#status");
const loginForm = document.querySelector("#login-form");
const password = loginForm.elements.password;
const originInput = document.querySelector("#origin");
const legacyButton = document.querySelector("#connect");
let busy = false, configuredOrigin = "", provider = "";

async function rpc(type, data = {}) {
  const reply = await chrome.runtime.sendMessage({ channel: "nexo", type, ...data });
  if (!reply?.ok) throw Error(reply?.error || "No se pudo completar la operación.");
  return reply.result;
}
function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}
async function action(callback) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll("button,input")];
  controls.forEach(item => { item.disabled = true; });
  try { await callback(); }
  catch (error) { showStatus(error.message || "No se pudo conectar con tu CRM.", true); }
  finally { busy = false; controls.forEach(item => { item.disabled = false; }); }
}
async function refreshAuthStatus() {
  const current = await rpc("configuration.get");
  configuredOrigin = current.origin || "";
  originInput.value = configuredOrigin || DEFAULT_ORIGIN;
  if (!configuredOrigin) {
    showStatus("Guarda la dirección de tu CRM en Usar otro CRM para continuar.");
    return;
  }
  const expectedOrigin = configuredOrigin;
  const result = await rpc("crm.authStatus", { expectedOrigin });
  if (configuredOrigin !== expectedOrigin) return;
  provider = result.authProvider || "";
  const legacy = provider === "cloudflare-access";
  legacyButton.hidden = !legacy;
  loginForm.hidden = legacy;
  if (legacy) {
    showStatus("Esta instancia utiliza un acceso anterior. Pulsa Acceder a este CRM para abrir su sesión.");
    return;
  }
  if (result.configured === false) {
    showStatus("Primero crea tu contraseña desde el enlace privado de activación. Después podrás iniciar sesión aquí.");
    return;
  }
  const verified = await rpc("crm.verify", { expectedOrigin });
  if (configuredOrigin !== expectedOrigin) return;
  showStatus(verified.ready
    ? "Ya tienes una sesión iniciada. Abre WhatsApp para trabajar con Nexo."
    : "Introduce tu correo y contraseña para entrar.");
}

loginForm.addEventListener("submit", event => {
  event.preventDefault();
  const email = loginForm.elements.email.value.trim();
  let secret = password.value;
  password.value = "";
  action(async () => {
    try {
      if (!configuredOrigin) throw Error("Guarda primero la dirección de tu CRM en Usar otro CRM.");
      const expectedOrigin = configuredOrigin;
      showStatus("Iniciando sesión…");
      await rpc("crm.login", { expectedOrigin, input: { email, password: secret } });
      if (configuredOrigin !== expectedOrigin) throw Error("Cambió el CRM. Vuelve a iniciar sesión en la dirección elegida.");
      showStatus("Sesión iniciada. Abriendo WhatsApp con Nexo…");
      await rpc("wa.open");
      showStatus("Sesión iniciada. Puedes trabajar dentro de WhatsApp Web.");
    } finally { secret = ""; password.value = ""; }
  });
});

document.querySelector("#configuration").addEventListener("submit", event => {
  event.preventDefault();
  let origin;
  try { origin = crmOrigin(originInput.value.trim()); }
  catch (error) { showStatus(error.message, true); return; }
  // Request this exact additional host directly in the user's click gesture.
  const grant = chrome.permissions.request({ origins: [origin + "/*"] });
  action(async () => {
    if (!await grant) throw Error("No se autorizó el sitio del CRM. Puedes intentarlo de nuevo.");
    await rpc("configuration.set", { origin });
    configuredOrigin = origin;
    provider = "";
    password.value = "";
    await refreshAuthStatus();
  });
});

document.querySelector("#workspace").addEventListener("click", () => action(async () => {
  await rpc("wa.open");
}));
legacyButton.addEventListener("click", () => action(async () => {
  if (!configuredOrigin || provider !== "cloudflare-access") return;
  const result = await rpc("crm.connect", { expectedOrigin: configuredOrigin });
  showStatus(result.ready ? "Sesión iniciada. Abre WhatsApp con Nexo." : "Termina el ingreso de esta instancia y vuelve a WhatsApp.");
}));
document.querySelector("#check").addEventListener("click", () => action(refreshAuthStatus));

chrome.runtime.onMessage?.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.channel !== "nexo.connection" || message.origin !== configuredOrigin) return false;
  if (!busy) showStatus(message.ready
    ? "Sesión iniciada. Puedes trabajar dentro de WhatsApp Web."
    : "Vuelve a iniciar sesión con tu correo y contraseña.");
  return false;
});

await action(refreshAuthStatus);
