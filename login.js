const form = document.querySelector("#login-form");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  const error = document.querySelector("#login-error");
  button.disabled = true;
  error.textContent = "";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
      credentials: "same-origin",
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "No se pudo iniciar sesión.");
    form.elements.password.value = "";
    location.replace("/");
  } catch (failure) {
    error.textContent =
      failure.message || "No se pudo conectar con el servidor.";
  } finally {
    button.disabled = false;
  }
});
