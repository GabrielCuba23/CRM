// Activation links keep their one-time token in the fragment, which never goes
// to HTTP logs. Remove it before fetching configuration or handling the form.
const fragment = new URLSearchParams(location.hash.slice(1));
let setupToken = fragment.get("setup") || "";
if (fragment.has("setup")) history.replaceState(null, "", location.pathname + location.search);
const invalidSetupLink = Boolean(setupToken && !/^[A-Za-z0-9_-]{32,256}$/.test(setupToken));
if (invalidSetupLink) setupToken = "";

const form = document.querySelector("#login-form");
const button = document.querySelector("#login-submit");
const error = document.querySelector("#login-error");
const status = document.querySelector("#login-status");
const activationNote = document.querySelector("#login-activation-note");
let submitting = false;

function displayMode() {
  const setup = Boolean(setupToken);
  document.querySelector("#login-title").textContent = setup ? "Crea tu contraseña" : "Iniciar sesión";
  document.querySelector("#login-description").textContent = setup
    ? "Elige una contraseña para entrar a tu CRM desde la web y desde WhatsApp."
    : "Entra con tu correo y contraseña para gestionar tu negocio.";
  button.textContent = setup ? "Crear contraseña y entrar" : "Iniciar sesión →";
  document.querySelector("#login-confirmation").hidden = !setup;
  form.elements.confirmation.disabled = !setup;
  form.elements.confirmation.required = setup;
  form.elements.password.autocomplete = setup ? "new-password" : "current-password";
  form.elements.password.minLength = setup ? 12 : 0;
}
displayMode();
if (invalidSetupLink) error.textContent = "El enlace de activación no es válido. Solicita un nuevo enlace privado.";

// Older Flask installations expose the same login form without this endpoint.
// A failed status check never prevents the user from trying their credentials.
fetch("/api/auth/status", { credentials: "same-origin", cache: "no-store", redirect: "error" })
  .then(async response => {
    if (!response.ok) return;
    const result = await response.json();
    if (result.authProvider !== "password") return;
    if (result.configured === false) {
      activationNote.hidden = Boolean(setupToken);
    } else if (result.configured === true && setupToken && !submitting) {
      setupToken = "";
      form.elements.password.value = "";
      form.elements.confirmation.value = "";
      displayMode();
      status.textContent = "Tu contraseña ya está creada. Inicia sesión con tu correo y contraseña.";
    }
  })
  .catch(() => {});

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (submitting) return;
  error.textContent = "";
  status.textContent = "";
  const setup = Boolean(setupToken);
  if (setup && form.elements.password.value !== form.elements.confirmation.value) {
    error.textContent = "Las contraseñas no coinciden.";
    form.elements.confirmation.focus();
    return;
  }
  if (setup && form.elements.password.value.length < 12) {
    error.textContent = "Elige una contraseña de al menos 12 caracteres.";
    form.elements.password.focus();
    return;
  }
  submitting = true;
  button.disabled = true;
  form.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(setup ? "/api/setup" : "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
        ...(setup ? { token: setupToken } : {}),
      }),
      credentials: "same-origin",
      redirect: "error",
    });
    let result;
    try { result = await response.json(); }
    catch { throw Error("No se pudo conectar con el servidor. Inténtalo nuevamente."); }
    if (!response.ok) throw Error(result.error || (setup ? "No se pudo crear la contraseña." : "No se pudo iniciar sesión."));
    setupToken = "";
    form.elements.password.value = "";
    form.elements.confirmation.value = "";
    location.replace("/");
  } catch (failure) {
    error.textContent = failure.name === "TypeError"
      ? "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo nuevamente."
      : failure.message || "No se pudo conectar con el servidor.";
  } finally {
    submitting = false;
    button.disabled = false;
    form.removeAttribute("aria-busy");
  }
});
