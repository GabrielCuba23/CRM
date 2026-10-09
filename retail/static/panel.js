"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  let csrf = "",
    instances = [],
    logoDataUrl = "";
  const statuses = {
    pending: "Pendiente",
    active: "Activo",
    suspended: "Suspendido",
  };
  function message(text, error = false) {
    $("#notice").textContent = text;
    $("#notice").classList.toggle("error", error);
    $("#notice").hidden = false;
  }
  function clearInvitation() {
    $("#invitation-link").value = "";
    $("#invitation-description").textContent = "";
    $("#invitation-section").hidden = true;
  }
  function showLogin() {
    csrf = "";
    instances = [];
    logoDataUrl = "";
    $("#instances").replaceChildren();
    $("#dashboard").hidden = true;
    $("#session-controls").hidden = true;
    $("#login-section").hidden = false;
    $("#operator-email").textContent = "";
    $("#create-form").reset();
    $("#password-form").reset();
    clearInvitation();
  }
  async function api(path, method = "GET", body) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (response.status === 401) showLogin();
    if (!response.ok)
      throw new Error(result.error || "No se pudo completar la operación.");
    return result;
  }
  function cell(text) {
    const td = document.createElement("td");
    td.textContent = text;
    return td;
  }
  function action(label, onClick, className = "secondary") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await onClick();
      } catch (error) {
        message(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }
  function showInvitation(result) {
    const url = new URL(result.activationUrl);
    if (url.protocol !== "https:")
      throw new Error("El enlace de activación requiere HTTPS.");
    $("#invitation-link").value = url.href;
    $("#invitation-description").textContent =
      `Comparte este enlace con ${result.instance.ownerEmail} para activar ${result.instance.name}. Caduca en 48 horas.`;
    $("#invitation-section").hidden = false;
    $("#invitation-section").scrollIntoView({ block: "center" });
  }
  function render() {
    $("#count-total").textContent = instances.length;
    for (const status of Object.keys(statuses))
      $("#count-" + status).textContent = instances.filter(
        (item) => item.status === status,
      ).length;
    const term = $("#search").value.trim().toLowerCase();
    const filtered = instances.filter((item) =>
      [item.name, item.ownerEmail, item.url, statuses[item.status]]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
    $("#instances").replaceChildren();
    $("#empty-list").hidden = filtered.length > 0;
    $("#empty-list").textContent = instances.length
      ? "No hay instancias que coincidan con la búsqueda."
      : "Aún no tienes instancias. Crea tu primer CRM.";
    for (const item of filtered) {
      const row = document.createElement("tr");
      row.append(cell(item.name), cell(item.ownerEmail));
      const urlCell = cell("");
      const url = new URL(item.url);
      if (url.protocol === "https:") {
        const link = document.createElement("a");
        link.href = url.href;
        link.textContent = url.host;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        urlCell.append(link);
      }
      row.append(urlCell);
      const statusCell = cell("");
      const badge = document.createElement("span");
      badge.className = "status " + item.status;
      badge.textContent = statuses[item.status] || item.status;
      statusCell.append(badge);
      row.append(statusCell);
      const actions = document.createElement("div");
      actions.className = "actions";
      if (item.status === "pending")
        actions.append(
          action("Renovar invitación", async () =>
            showInvitation(
              await api(`/api/instances/${item.id}/invitation`, "POST", {}),
            ),
          ),
        );
      else
        actions.append(
          action(
            item.status === "active" ? "Suspender" : "Reactivar",
            async () => {
              await api(`/api/instances/${item.id}`, "PATCH", {
                status: item.status === "active" ? "suspended" : "active",
              });
              await refresh();
              message(
                item.status === "active"
                  ? "Instancia suspendida. Sus datos se conservan."
                  : "Instancia reactivada.",
              );
            },
            item.status === "active" ? "danger" : "secondary",
          ),
        );
      const td = cell("");
      td.append(actions);
      row.append(td);
      $("#instances").append(row);
    }
  }
  async function refresh() {
    instances = (await api("/api/instances")).instances;
    render();
  }
  async function loadSession() {
    const session = await api("/api/session");
    csrf = session.csrf;
    $("#operator-email").textContent = session.email;
    $("#domain-hint").textContent =
      `Dirección: tu-subdominio.${session.baseDomain}`;
    $("#login-section").hidden = true;
    $("#dashboard").hidden = false;
    $("#session-controls").hidden = false;
    await refresh();
  }
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      button = form.querySelector("button");
    button.disabled = true;
    try {
      await api("/api/login", "POST", Object.fromEntries(new FormData(form)));
      form.reset();
      await loadSession();
      $("#notice").hidden = true;
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  $("#logout").addEventListener("click", async () => {
    try {
      await api("/api/logout", "POST", {});
      showLogin();
      message("Sesión cerrada.");
    } catch (error) {
      message(error.message, true);
    }
  });
  $("#search").addEventListener("input", render);
  $("#show-create").addEventListener("click", () => {
    $("#create-section").hidden = false;
    clearInvitation();
    $("#create-section").scrollIntoView({ block: "start" });
    $("#create-form input").focus();
  });
  $("#cancel-create").addEventListener("click", () => {
    $("#create-section").hidden = true;
    $("#create-form").reset();
    logoDataUrl = "";
  });
  $("#close-invitation").addEventListener("click", clearInvitation);
  $("#copy-invitation").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#invitation-link").value);
      message(
        "Enlace copiado. Compártelo de forma privada con el propietario.",
      );
    } catch {
      $("#invitation-link").select();
      message("Selecciona y copia el enlace de activación.");
    }
  });
  $("#logo-file").addEventListener("change", async (event) => {
    logoDataUrl = "";
    const file = event.target.files[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 100000
    ) {
      event.target.value = "";
      message("Selecciona PNG, JPG o WebP de hasta 100 KB.", true);
      return;
    }
    try {
      logoDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } catch {
      event.target.value = "";
      message("No se pudo leer el logo.", true);
    }
  });
  $("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      button = form.querySelector("button[type=submit]");
    button.disabled = true;
    clearInvitation();
    try {
      const result = await api("/api/instances", "POST", {
        ...Object.fromEntries(new FormData(form)),
        logoDataUrl,
      });
      form.reset();
      logoDataUrl = "";
      $("#create-section").hidden = true;
      await refresh();
      showInvitation(result);
      message("Instancia creada con una base de datos vacía e independiente.");
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  $("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      button = form.querySelector("button");
    button.disabled = true;
    try {
      await api(
        "/api/password",
        "POST",
        Object.fromEntries(new FormData(form)),
      );
      showLogin();
      message("Contraseña actualizada. Inicia sesión nuevamente.");
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  loadSession().catch((error) => {
    showLogin();
    if (error.message !== "Inicia sesión en el panel.")
      message(error.message, true);
  });
})();
