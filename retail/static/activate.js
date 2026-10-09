"use strict";
(() => {
  const form = document.querySelector("#activate-form");
  const notice = document.querySelector("#notice");
  let token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  history.replaceState(null, "", location.pathname);
  function message(text, error = false) {
    notice.textContent = text;
    notice.classList.toggle("error", error);
    notice.hidden = false;
  }
  if (!token) {
    form.hidden = true;
    message(
      "Abre el enlace privado de activación que te compartió el administrador.",
      true,
    );
    document.querySelector("#login-link").hidden = false;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    if (values.get("password") !== values.get("confirmation")) {
      message("Las contraseñas deben coincidir.", true);
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const response = await fetch("/api/activate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          email: values.get("email"),
          password: values.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "No se pudo activar el CRM.");
      token = "";
      form.reset();
      form.hidden = true;
      document.querySelector("#login-link").hidden = false;
      message("Tu acceso está activado. Ya puedes iniciar sesión.");
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
})();
