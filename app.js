import { supplierOverview } from "./supplier-overview.mjs";
import {
  emptyPromotions,
  validatePromotions,
  promotionPrice,
} from "./promotions.mjs";
import { conversationEntries, manualMessage } from "./messaging.mjs";
import {
  defaultReports,
  validateReports,
  reportSheets,
  workbook,
} from "./reports.mjs";
import { isFormer, archiveContact } from "./lifecycle.mjs";
import { emptyProcurement, accountMargin } from "./procurement.mjs";
import { initializeProcurement } from "./procurement-ui.mjs";
import { emptyGrowth } from "./growth.mjs";
import { initializeGrowth } from "./growth-ui.mjs";
import {
  prepareClientImport,
  parseCSV,
  readExcelRows,
  exportClientCSV,
  exportClientExcel,
  clientColumns,
} from "./bulk.mjs";
import { buildRuleTasks, deliveryLabels } from "./automation.mjs";
import {
  fields,
  defaultTemplates,
  normalizePhone,
  formatDate,
  subscriptionStatus,
  fillTemplate,
  whatsappUrl,
  todayLima,
  validDate,
  money,
  cents,
  availableProfiles,
  validateWorkspace,
  createId,
} from "./crm.mjs";
const $ = (selector) => document.querySelector(selector);
const storageKey = "crm.clients.v1";
const templateKey = "crm.templates.v1";
const workspaceKey = "crm.workspace.v2";
let rules = [],
  taskReceipts = [],
  currentTask = null,
  ruleEditId = null,
  ruleRenderSequence = 0,
  authProvider = "",
  externalTaskStates = new Map(),
  externalCompleted = new Set();
let supplierOverviewPage = 1;
let promotions = emptyPromotions();
let inboxClientId = "";
let reports = { ...defaultReports };
let procurement = emptyProcurement();
let growth = emptyGrowth();
let clients = [],
  templates = [],
  accounts = [],
  combos = [],
  ledger = [],
  settings = { business: "Nexo Streaming", payments: "", dark: false },
  available = true,
  recipient = null,
  automation = {
    enabled: false,
    templateName: "",
    language: "es",
    parameters: ["nombre", "servicio", "vence"],
    hour: 9,
  };
let secureMode = false,
  csrf = "",
  serverRevision = 0,
  saveInFlight = false;
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
  });
  if (response.status === 401) {
    location.replace("/login");
    throw Error("Tu sesión caducó. Inicia sesión nuevamente.");
  }
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error || "No se pudo completar la operación.");
  return result;
}
const backendRequired =
  document.querySelector('meta[name="crm-backend"]')?.content === "required";
if (backendRequired) {
  try {
    const session = await api("/api/session");
    secureMode = session.mode === "server";
    csrf = session.csrf;
    authProvider = session.authProvider || "python";
    if (!secureMode) throw Error("Backend no disponible.");
  } catch {
    location.replace("/login");
    throw Error("No se pudo verificar la sesión privada.");
  }
}
const labels = {
  active: "Vigente",
  soon: "Por vencer",
  expired: "Vencido",
  none: "Sin fecha",
};
function notify(text) {
  $("#status").textContent = text;
}
function snapshot(overrides = {}) {
  return {
    version: 2,
    clients,
    templates,
    accounts,
    combos,
    promotions,
    ledger,
    settings,
    automation,
    rules,
    taskReceipts,
    growth,
    procurement,
    reports,
    ...overrides,
  };
}
async function persistState(overrides = {}) {
  if (!available) {
    notify(
      "El almacenamiento no está disponible. No se guardaron los cambios.",
    );
    return false;
  }
  if (saveInFlight) {
    notify("Hay un cambio en curso. Espera antes de guardar otro.");
    return false;
  }
  try {
    const state = validateWorkspace(snapshot(overrides));
    saveInFlight = true;
    if (secureMode) {
      const result = await api("/api/workspace", {
        method: "PUT",
        body: JSON.stringify({ state, revision: serverRevision }),
      });
      serverRevision = result.revision;
    } else localStorage.setItem(workspaceKey, JSON.stringify(state));
    return true;
  } catch (error) {
    notify(`No se pudieron guardar los cambios: ${error.message}`);
    return false;
  } finally {
    saveInFlight = false;
  }
}
function persist(key, value) {
  return persistState(
    key === storageKey ? { clients: value } : { templates: value },
  );
}
try {
  let saved;
  if (secureMode) {
    const result = await api("/api/workspace");
    serverRevision = result.revision;
    saved = JSON.stringify(result.state);
  } else saved = localStorage.getItem(workspaceKey);
  if (saved) {
    const state = validateWorkspace(JSON.parse(saved));
    ({ clients, templates, accounts, combos, ledger, settings } = state);
    promotions = state.promotions || emptyPromotions();
    reports = state.reports || { ...defaultReports };
    automation = state.automation || automation;
    rules = state.rules || [];
    taskReceipts = state.taskReceipts || [];
    procurement = state.procurement || emptyProcurement();
    growth = state.growth || emptyGrowth();
  } else {
    const legacy = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (
      !Array.isArray(legacy) ||
      !legacy.every(
        (c) =>
          c &&
          ["id", "name", "email", "phone"].every(
            (k) => typeof c[k] === "string",
          ),
      )
    )
      throw Error("Clientes anteriores no válidos.");
    clients = legacy.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      service: c.service || "",
      profile: c.profile || "",
      expires: c.expires || "",
      notes: c.notes || "",
      accountId: "",
      pin: "",
      price: 0,
    }));
    templates = JSON.parse(
      localStorage.getItem(templateKey) || JSON.stringify(defaultTemplates),
    );
    validateWorkspace(snapshot());
  }
} catch (error) {
  available = false;
  clients = [];
  accounts = [];
  combos = [];
  ledger = [];
  templates = structuredClone(defaultTemplates);
  notify(
    `No se pudieron cargar los datos. No se sobrescribirán. ${error.message}`,
  );
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action, className = "secondary") {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function render() {
  renderInbox();
  renderPromotions();
  renderSupplierOverview();
  $("#total").textContent = clients.length;
  const states = clients.map((c) =>
    c.archived ? "none" : subscriptionStatus(c.expires),
  );
  $("#active").textContent = states.filter(
    (s) => s === "active" || s === "soon",
  ).length;
  $("#soon").textContent = states.filter((s) => s === "soon").length;
  $("#expired").textContent = states.filter((s) => s === "expired").length;
  const query = $("#search").value.trim().toLocaleLowerCase();
  const matches = clients.filter(
    (c) =>
      [
        c.name,
        c.email,
        c.phone,
        c.whatsappUsername || "",
        c.service,
        c.profile,
      ].some((v) => v.toLocaleLowerCase().includes(query)) &&
      ($("#account-filter").value === "all" ||
        c.accountId === $("#account-filter").value) &&
      ($("#filter").value === "all" ||
        ($("#filter").value === "former"
          ? isFormer(c, todayLima())
          : $("#filter").value === "archived"
            ? !!c.archived
            : $("#filter").value === "current"
              ? !isFormer(c, todayLima())
              : !c.archived &&
                subscriptionStatus(c.expires) === $("#filter").value)),
  );
  $("#clients").replaceChildren();
  $("#empty").hidden = matches.length > 0;
  if (!matches.length)
    $("#empty").textContent = clients.length
      ? "Aún no hay clientes que coincidan con tu búsqueda."
      : "Añade tu primer cliente para preparar un mensaje de WhatsApp.";
  for (const c of matches) {
    const row = element("tr");
    const identity = element("td");
    identity.append(
      element("strong", c.name),
      element("small", c.email || "Sin correo"),
      element("small", c.phone || c.whatsappUsername || "Sin contacto"),
    );
    const service = element("td");
    service.append(
      element("strong", c.service || "Sin servicio"),
      element("small", c.profile || "Sin perfil"),
    );
    const expiry = element("td");
    const state = subscriptionStatus(c.expires);
    expiry.append(
      element(
        "span",
        c.archived ? "Archivado" : labels[state],
        `pill ${state}`,
      ),
      element("small", formatDate(c.expires)),
    );
    const actions = element("td", undefined, "row-actions");
    actions.append(
      button("Ficha 360", () => growthUI.showContact(c)),
      button(c.archived ? "Reactivar / nueva venta" : "Renovar", async () => {
        if (c.archived) {
          editClient({ ...c, accountId: "", profile: "", expires: "" });
          $("#client-form").dataset.reactivate = "1";
          $("#client-form").elements.paid.disabled = false;
          $("#client-form").elements.paid.checked = true;
        } else openRenew(c);
      }),
      button("Archivar", async () => {
        if (c.archived) return;
        if (
          !confirm(
            `¿Archivar a ${c.name}? Se libera su perfil y se conserva su historial.`,
          )
        )
          return;
        const next = clients.map((x) =>
          x.id === c.id ? archiveContact(x, new Date().toISOString()) : x,
        );
        const nextLedger = ledger.map((m) =>
          !m.clientId &&
          m.service === c.service &&
          [`Venta · ${c.name}`, `Renovación · ${c.name}`].includes(
            m.description,
          )
            ? { ...m, clientId: c.id }
            : m,
        );
        if (await persistState({ clients: next, ledger: nextLedger })) {
          clients = next;
          ledger = nextLedger;
          refreshAccountOptions();
          render();
          notify(
            "Cliente archivado. Su historial sigue disponible en Ficha 360.",
          );
        }
      }),
      button("WhatsApp →", async () => openMessage(c), "whatsapp"),
      button("Editar", async () => editClient(c)),
      button(
        "Eliminar",
        async () => {
          if (
            confirm(
              `¿Eliminar definitivamente la ficha de ${c.name}? Para conservar su historial y liberar el perfil, usa Archivar. Los movimientos financieros se conservan.`,
            )
          ) {
            const next = clients.filter((x) => x.id !== c.id);
            if (await persist(storageKey, next)) {
              clients = next;
              render();
              notify("Cliente eliminado.");
            }
          }
        },
        "text-button",
      ),
    );
    row.append(identity, service, expiry, actions);
    $("#clients").append(row);
  }
  renderModules();
  renderRules();
}
function editClient(c = {}) {
  delete $("#client-form").dataset.reactivate;
  refreshAccountOptions(c.accountId || "");
  $("#client-form").reset();
  $("#client-error").textContent = "";
  for (const key of [
    "id",
    "name",
    "phone",
    "whatsappUsername",
    "email",
    "service",
    "profile",
    "expires",
    "notes",
    "accountId",
    "pin",
    "price",
  ])
    $("#client-form").elements.namedItem(key).value =
      key === "price" ? ((c.price || 0) / 100).toFixed(2) : c[key] || "";
  $("#client-title").textContent = c.id ? "Editar cliente" : "Nuevo cliente";
  $("#client-form").elements.marketingConsent.checked = !!c.marketingConsent;
  $("#client-form").elements.reminderConsent.checked = !!c.reminderConsent;
  $("#client-form").elements.paid.disabled = !!c.id;
  $("#client-form").elements.paid.checked = !c.id;
  showAssignedPassword();
  $("#client-dialog").showModal();
}
$("#new-client").addEventListener("click", async () => editClient());
$("#client-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    data.name = data.name.trim();
    if (!data.name) throw Error("Introduce el nombre del cliente.");
    data.phone = data.phone.trim() ? normalizePhone(data.phone) : "";
    data.whatsappUsername = (data.whatsappUsername || "").trim();
    data.price = cents(data.price || "0");
    data.reminderConsent = data.reminderConsent === "on";
    if (data.expires && !validDate(data.expires))
      throw Error("Introduce un vencimiento válido.");
    if (data.accountId) {
      const a = accounts.find((a) => a.id === data.accountId);
      if (!a) throw Error("Cuenta no disponible.");
      if (
        subscriptionStatus(a.expires) === "expired" &&
        !clients.some((c) => c.id === data.id && c.accountId === a.id)
      )
        throw Error("Renueva la cuenta madre antes de asignar un perfil.");
      const other = clients.filter((c) => c.id !== data.id);
      if (!availableProfiles(a, other).includes(data.profile))
        throw Error(
          "Ese perfil no está disponible. Usa el siguiente perfil libre de la cuenta.",
        );
      data.email = a.email;
      data.service = a.service;
    }
    const previous = clients.find((c) => c.id === data.id);
    const reactivating =
      !!previous?.archived && $("#client-form").dataset.reactivate === "1";
    if (reactivating && !data.expires)
      throw Error("Indica el vencimiento del nuevo servicio.");
    data.archived = !!previous?.archived && !reactivating;
    data.marketingConsent = data.marketingConsent === "on";
    data.serviceHistory = previous?.serviceHistory || [];
    if (data.archived && data.accountId)
      throw Error(
        "Usa Reactivar / nueva venta para asignar una cuenta a este cliente.",
      );
    const isNew = !data.id || reactivating;
    const paid = data.paid === "on";
    delete data.paid;
    data.id ||= createId();
    const next = clients.some((c) => c.id === data.id)
      ? clients.map((c) => (c.id === data.id ? data : c))
      : [...clients, data];
    const nextLedger =
      isNew && paid && data.price > 0
        ? [
            ...ledger,
            {
              id: createId(),
              kind: "sale",
              date: todayLima(),
              description: `${reactivating ? "Reventa" : "Venta"} · ${data.name}`,
              clientId: data.id,
              service: data.service,
              amount: data.price,
            },
          ]
        : ledger;
    if (await persistState({ clients: next, ledger: nextLedger })) {
      clients = next;
      ledger = nextLedger;
      render();
      $("#client-dialog").close();
      notify(
        isNew
          ? paid && data.price > 0
            ? `Venta guardada y cobro registrado: ${money(data.price)}.`
            : "Cliente guardado sin cobro registrado. Puedes registrar su ingreso desde Finanzas → Ingreso / venta."
          : "Cliente actualizado. No se duplicó su venta.",
      );
    }
  } catch (error) {
    $("#client-error").textContent = error.message;
  }
});
$("#search").addEventListener("input", render);
$("#filter").addEventListener("change", render);
$("#account-filter").addEventListener("change", render);
for (const close of document.querySelectorAll(".close"))
  close.addEventListener("click", async () => close.closest("dialog").close());
function templateOptions(select, selected) {
  select.replaceChildren(
    ...templates.map((t) => {
      const option = element("option", `${t.context || "General"} · ${t.name}`);
      option.value = t.id;
      return option;
    }),
  );
  if (select.id === "message-template") {
    const option = element("option", "Mensaje libre · sin plantilla");
    option.value = "__custom";
    select.append(option);
  }
  if (templates.some((t) => t.id === selected)) select.value = selected;
}
let selectedTemplateId = "";
function loadTemplate() {
  const t = templates.find((t) => t.id === $("#template-select").value);
  $("#template-name").value = t.name;
  $("#template-body").value = t.body;
  $("#template-context").value = t.context || "General";
  selectedTemplateId = t.id;
  previewTemplate();
}
function refreshTemplates(selected) {
  templateOptions($("#template-select"), selected);
  templateOptions($("#message-template"));
  loadTemplate();
  renderTemplateLibrary();
  renderRules();
}
$("#template-select").addEventListener("change", () =>
  switchTemplate($("#template-select").value),
);
$("#template-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#template-name").value.trim(),
    body = $("#template-body").value.trim();
  if (!name || !body) {
    notify("Completa el nombre y el texto de la plantilla.");
    return;
  }
  const id = $("#template-select").value;
  const context = $("#template-context").value.trim() || "General";
  const next = templates.map((t) =>
    t.id === id ? { id, name, body, context } : t,
  );
  if (await persist(templateKey, next)) {
    templates = next;
    refreshTemplates(id);
    notify("Plantilla guardada.");
  }
});
$("#add-template").addEventListener("click", async () => {
  const id = createId();
  const next = [
    ...templates,
    {
      id,
      name: "Nueva plantilla",
      body: "Hola {nombre} 👋",
      context: "General",
    },
  ];
  if (await persist(templateKey, next)) {
    templates = next;
    refreshTemplates(id);
    $("#template-name").focus();
  }
});
$("#delete-template").addEventListener("click", async () => {
  if (templates.length === 1) {
    notify("Conserva al menos una plantilla.");
    return;
  }
  if (!confirm("¿Eliminar esta plantilla?")) return;
  const next = templates.filter((t) => t.id !== $("#template-select").value);
  if (await persist(templateKey, next)) {
    templates = next;
    refreshTemplates();
    notify("Plantilla eliminada.");
  }
});
for (const key of fields)
  $("#variables").append(
    button(
      `{${key}}`,
      async () => {
        const input = $("#template-body");
        input.setRangeText(
          `{${key}}`,
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        input.focus();
        previewTemplate();
      },
      "variable",
    ),
  );
function updateLink() {
  try {
    $("#open-whatsapp").href = whatsappUrl(
      recipient.phone,
      $("#message-text").value,
    );
    $("#open-whatsapp").removeAttribute("aria-disabled");
    $("#message-error").textContent = "";
  } catch (error) {
    $("#open-whatsapp").removeAttribute("href");
    $("#open-whatsapp").setAttribute("aria-disabled", "true");
    $("#message-error").textContent = error.message;
  }
}
let messageTemplateId = "";
function compose() {
  messageTemplateId = $("#message-template").value;
  if (messageTemplateId === "__custom") {
    updateLink();
    return;
  }
  const t = templates.find((t) => t.id === $("#message-template").value);
  $("#message-text").value = fillTemplate(
    t.body,
    recipient,
    $("#message-password").value,
    settings,
  );
  updateLink();
}
function openMessage(c) {
  currentTask = null;
  $("#confirm-task").hidden = true;
  $("#confirm-manual-message").hidden = false;
  $("#confirm-manual-message").disabled = false;
  recipient = c;
  $("#message-template-editor").hidden = true;
  $("#message-password").value =
    accounts.find((a) => a.id === c.accountId)?.password || "";
  $("#recipient").textContent =
    `Para ${c.name} · ${c.phone || c.whatsappUsername || "Sin número: puedes copiar el mensaje"}`;
  templateOptions($("#message-template"));
  compose();
  $("#message-dialog").showModal();
}
$("#message-template").addEventListener("change", async () => {
  if (confirm("¿Reemplazar el mensaje con la plantilla seleccionada?")) {
    if ($("#message-template").value === "__custom")
      $("#message-text").value = "";
    compose();
  } else $("#message-template").value = messageTemplateId;
});
$("#message-password").addEventListener("input", compose);
$("#message-text").addEventListener("input", updateLink);
$("#open-whatsapp").addEventListener("click", async (event) => {
  updateLink();
  if (!$("#open-whatsapp").hasAttribute("href")) event.preventDefault();
});
$("#copy-message").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#message-text").value);
    $("#message-error").textContent = "Mensaje copiado.";
  } catch {
    $("#message-error").textContent =
      "No se pudo copiar. Selecciona el texto y cópialo manualmente.";
  }
});
$("#message-dialog").addEventListener("close", async () => {
  $("#message-password").value = "";
  $("#message-text").value = "";
  $("#open-whatsapp").removeAttribute("href");
  recipient = null;
  currentTask = null;
  $("#confirm-task").hidden = true;
});
initializeModules();
initializeSecurity();
refreshTemplates();
render();
function refreshAccountOptions(selected = "") {
  const current = $("#account-filter").value;
  for (const [selector, first] of [
    ["#client-account", "Sin cuenta madre"],
    ["#account-filter", "Todas las cuentas"],
  ]) {
    const select = $(selector);
    const option = element("option", first);
    option.value = selector === "#account-filter" ? "all" : "";
    select.replaceChildren(
      option,
      ...accounts.map((a) => {
        const option = element("option", `${a.service} · ${a.email}`);
        option.value = a.id;
        return option;
      }),
    );
    select.value =
      selector === "#account-filter" && accounts.some((a) => a.id === current)
        ? current
        : selector === "#client-account"
          ? selected
          : "all";
  }
}
function chooseAccount() {
  const form = $("#client-form");
  const account = accounts.find((a) => a.id === form.elements.accountId.value);
  showAssignedPassword();
  if (!account) return;
  const free = availableProfiles(
    account,
    clients.filter((c) => c.id !== form.elements.id.value),
  );
  form.elements.email.value = account.email;
  form.elements.service.value = account.service;
  form.elements.profile.value = free[0] || "";
  $("#client-error").textContent = free.length
    ? ""
    : "Esta cuenta no tiene perfiles libres.";
}
function useAccount(account) {
  editClient({ accountId: account.id });
  chooseAccount();
}
function editAccount(a = {}) {
  $("#account-form").reset();
  for (const key of [
    "id",
    "service",
    "email",
    "provider",
    "password",
    "expires",
    "capacity",
  ])
    $("#account-form").elements.namedItem(key).value =
      a[key] || (key === "capacity" ? 5 : "");
  procurementUI.accountOptions(a);
  $("#account-form").elements.cost.value =
    a.costCents === undefined ? "" : (a.costCents / 100).toFixed(2);
  $("#account-form").elements.costIntervalMonths.value =
    a.costIntervalMonths ?? 1;
  procurementUI.costPreview();
  $("#account-password").type = "password";
  $("#toggle-account-password").textContent = "Mostrar contraseña";
  $("#account-error").textContent = "";
  $("#account-dialog").showModal();
}
function accountCard(a, onlyFree = false) {
  const card = element("article", undefined, "account-card");
  const state = subscriptionStatus(a.expires);
  const free = availableProfiles(a, clients);
  const heading = element("div", undefined, "section-head");
  heading.append(
    element("strong", a.service),
    element("span", labels[state], `pill ${state}`),
  );
  card.append(
    heading,
    element("h3", a.email),
    element(
      "p",
      `${a.capacity - free.length}/${a.capacity} ocupados · ${free.length} libres`,
      "muted",
    ),
    element(
      "p",
      `Vence: ${formatDate(a.expires)}${a.provider ? ` · ${a.provider}` : ""}`,
      "muted",
    ),
  );
  const actions = element("div", undefined, "actions");
  const use = button("Asignar perfil →", async () => useAccount(a));
  use.disabled = !free.length || state === "expired";
  actions.append(use);
  if (!onlyFree)
    actions.append(
      button("Editar", async () => editAccount(a)),
      button("Clientes", async () => {
        $("#account-filter").value = a.id;
        location.hash = "customers";
        render();
      }),
      button(
        "Eliminar",
        async () => {
          if (clients.some((c) => c.accountId === a.id)) {
            notify(
              "Libera o elimina los clientes vinculados antes de eliminar la cuenta.",
            );
            return;
          }
          if (confirm(`¿Eliminar la cuenta ${a.email}?`)) {
            const next = accounts.filter((x) => x.id !== a.id);
            if (await persistState({ accounts: next })) {
              accounts = next;
              refreshAccountOptions();
              render();
            }
          }
        },
        "text-button",
      ),
    );
  card.append(actions);
  return card;
}
function renewalCard(c) {
  const row = element("article", undefined, "renewal-row");
  const details = element("div");
  details.append(
    element("strong", c.name),
    element("small", `${c.service || "Sin servicio"} · ${c.phone}`),
  );
  const date = element("div");
  date.append(
    element(
      "span",
      labels[subscriptionStatus(c.expires)],
      `pill ${subscriptionStatus(c.expires)}`,
    ),
    element("small", formatDate(c.expires)),
  );
  const actions = element("div", undefined, "actions");
  actions.append(
    button(
      "WhatsApp",
      async () => {
        openMessage(c);
        $("#message-template").value = templates.some((t) => t.id === "renew")
          ? "renew"
          : templates[0].id;
        compose();
      },
      "whatsapp",
    ),
    button("Renovar", async () => openRenew(c)),
    button(
      "Liberar perfil",
      async () => {
        if (!c.accountId) {
          notify("Este cliente no tiene una cuenta madre asignada.");
          return;
        }
        if (
          confirm(
            `¿Liberar el perfil de ${c.name}? El cliente conservará su registro.`,
          )
        ) {
          const next = clients.map((x) =>
            x.id === c.id ? { ...x, accountId: "", profile: "" } : x,
          );
          if (await persistState({ clients: next })) {
            clients = next;
            render();
          }
        }
      },
      "text-button",
    ),
  );
  row.append(details, date, actions);
  return row;
}
function openRenew(c) {
  const form = $("#renew-form");
  form.reset();
  form.elements.id.value = c.id;
  form.elements.amount.value = ((c.price || 0) / 100).toFixed(2);
  const base = c.expires && c.expires > todayLima() ? c.expires : todayLima();
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 30);
  form.elements.expires.value = date.toISOString().slice(0, 10);
  $("#renew-name").textContent = `${c.name} · ${c.service || "Sin servicio"}`;
  $("#renew-error").textContent = "";
  $("#renew-dialog").showModal();
}
function renderModules() {
  renderSupplierOverview();
  $("#nav-clients").textContent = clients.length;
  $("#nav-accounts").textContent = accounts.length;
  $("#nav-free").textContent = accounts
    .filter((a) => subscriptionStatus(a.expires) !== "expired")
    .reduce((sum, a) => sum + availableProfiles(a, clients).length, 0);
  const due = clients
    .filter(
      (c) =>
        !c.archived &&
        ["expired", "soon"].includes(subscriptionStatus(c.expires)),
    )
    .sort((a, b) => a.expires.localeCompare(b.expires));
  $("#nav-renewals").textContent = due.length;
  const query = $("#account-search").value.trim().toLocaleLowerCase();
  const accountMatches = accounts.filter((a) =>
    [a.service, a.email, a.provider].some((v) =>
      v.toLocaleLowerCase().includes(query),
    ),
  );
  $("#account-cards").replaceChildren(
    ...accountMatches.map((a) => accountCard(a)),
  );
  if (!accountMatches.length)
    $("#account-cards").append(
      element(
        "p",
        accounts.length
          ? "No hay cuentas que coincidan."
          : "Añade una cuenta madre para gestionar su inventario.",
        "empty",
      ),
    );
  const freeAccounts = accounts.filter(
    (a) =>
      subscriptionStatus(a.expires) !== "expired" &&
      availableProfiles(a, clients).length,
  );
  $("#free-cards").replaceChildren(
    ...freeAccounts.map((a) => accountCard(a, true)),
  );
  if (!freeAccounts.length)
    $("#free-cards").append(
      element("p", "No hay perfiles libres en cuentas vigentes.", "empty"),
    );
  $("#quick-platforms").replaceChildren(
    ...freeAccounts.map((a) => {
      const card = button(
        `${a.service} · ${availableProfiles(a, clients).length} perfiles libres`,
        async () => useAccount(a),
        "platform-card",
      );
      return card;
    }),
  );
  if (!freeAccounts.length)
    $("#quick-platforms").append(
      element(
        "p",
        "Registra una cuenta madre para comenzar con una venta rápida.",
        "empty",
      ),
    );
  const renewQuery = $("#renewal-search").value.trim().toLocaleLowerCase();
  const renewalMatches = due.filter((c) =>
    [c.name, c.service, c.phone].some((v) =>
      v.toLocaleLowerCase().includes(renewQuery),
    ),
  );
  $("#renewal-list").replaceChildren(...renewalMatches.map(renewalCard));
  if (!renewalMatches.length)
    $("#renewal-list").append(
      element("p", "No hay renovaciones pendientes que coincidan.", "empty"),
    );
  $("#attention").replaceChildren(...due.slice(0, 5).map(renewalCard));
  if (!due.length)
    $("#attention").append(
      element("p", "Todo al día. No tienes suscripciones por vencer.", "empty"),
    );
  $("#combo-cards").replaceChildren(
    ...combos.map((c) => {
      const card = element("article", undefined, "account-card");
      card.append(
        element("h3", c.name),
        element("p", c.services, "muted"),
        element("strong", money(c.price)),
      );
      const actions = element("div", undefined, "actions");
      actions.append(
        button("Preparar oferta", async () => {
          if (!clients.length) {
            notify("Añade un cliente antes de preparar una oferta.");
            return;
          }
          // Choose the recipient explicitly; never assume the first client is the intended recipient.
          const select = $("#combo-recipient");
          select.replaceChildren(
            ...clients.map((client) => {
              const o = element("option", `${client.name} · ${client.phone}`);
              o.value = client.id;
              return o;
            }),
          );
          $("#offer-form").dataset.comboId = c.id;
          $("#offer-name").textContent = c.name;
          $("#offer-dialog").showModal();
        }),
        button(
          "Eliminar",
          async () => {
            if (confirm(`¿Eliminar ${c.name}?`)) {
              const next = combos.filter((x) => x.id !== c.id);
              if (await persistState({ combos: next })) {
                combos = next;
                render();
              }
            }
          },
          "text-button",
        ),
      );
      card.append(actions);
      return card;
    }),
  );
  if (!combos.length)
    $("#combo-cards").append(
      element("p", "Crea tu primer combo de plataformas.", "empty"),
    );
  renderFinance();
  renderTemplateLibrary();
}
function renderFinance() {
  const period = $("#finance-month").value;
  const movements = ledger.filter((m) => m.date.slice(0, 7) === period);
  const income = movements
      .filter((m) => m.kind !== "expense")
      .reduce((s, m) => s + m.amount, 0),
    expenses = movements
      .filter((m) => m.kind === "expense")
      .reduce((s, m) => s + m.amount, 0);
  $("#income").textContent = money(income);
  $("#expenses").textContent = money(expenses);
  $("#profit").textContent = money(income - expenses);
  $("#renewal-count").textContent = movements.filter(
    (m) => m.kind === "renewal",
  ).length;
  $("#movements").replaceChildren(
    ...movements
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((m) => {
        const row = element("tr");
        for (const text of [
          formatDate(m.date),
          m.description,
          { sale: "Venta", renewal: "Renovación", expense: "Gasto" }[m.kind],
          `${m.kind === "expense" ? "−" : ""}${money(m.amount)}`,
        ])
          row.append(element("td", text));
        if (m.supplierId) {
          const supplier = procurement.suppliers.find(
            (s) => s.id === m.supplierId,
          );
          row.children[1].append(
            element(
              "small",
              `${supplier?.name || "Proveedor histórico"} · ${m.category === "operating" ? "Gasto operativo" : "Compra de producto"}${m.reference ? " · Ref. " + m.reference : ""}`,
            ),
          );
        }
        const action = element("td");
        action.append(
          button(
            "Eliminar",
            async () => {
              if (
                confirm(
                  "¿Eliminar este movimiento? No cambia el vencimiento del cliente.",
                )
              ) {
                const next = ledger.filter((x) => x.id !== m.id);
                if (await persistState({ ledger: next })) {
                  ledger = next;
                  renderFinance();
                }
              }
            },
            "text-button",
          ),
        );
        row.append(action);
        return row;
      }),
  );
  $("#finance-empty").hidden = movements.length > 0;
  document.dispatchEvent(new Event("finance-updated"));
  const platforms = new Map();
  for (const m of movements.filter((m) => m.kind !== "expense"))
    platforms.set(
      m.service || "Otros",
      (platforms.get(m.service || "Otros") || 0) + m.amount,
    );
  $("#platform-income").replaceChildren(
    ...[...platforms]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => {
        const row = element("p", undefined, "section-head");
        row.append(element("span", name), element("strong", money(amount)));
        return row;
      }),
  );
  if (!platforms.size)
    $("#platform-income").append(
      element("p", "Sin ingresos en este periodo.", "empty"),
    );
  $("#finance-chart").replaceChildren();
  if (!period) return;
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = new Date(`${period}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 5 + i);
    const key = date.toISOString().slice(0, 7);
    const entries = ledger.filter((m) => m.date.slice(0, 7) === key);
    return {
      date,
      income: entries
        .filter((m) => m.kind !== "expense")
        .reduce((s, m) => s + m.amount, 0),
      expense: entries
        .filter((m) => m.kind === "expense")
        .reduce((s, m) => s + m.amount, 0),
    };
  });
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  for (const month of months) {
    const column = element("div", undefined, "chart-column");
    const bars = element("div", undefined, "bars");
    for (const [key, cls] of [
      ["income", "income-bar"],
      ["expense", "expense-bar"],
    ]) {
      const bar = element("div", undefined, cls);
      bar.style.height = `${(month[key] / max) * 120}px`;
      bar.title = money(month[key]);
      bars.append(bar);
    }
    column.append(
      bars,
      element(
        "small",
        month.date.toLocaleDateString("es-PE", {
          month: "short",
          timeZone: "UTC",
        }),
      ),
      element("small", money(month.income)),
    );
    column.setAttribute(
      "aria-label",
      `${month.date.toISOString().slice(0, 7)}: ingresos ${money(month.income)}, gastos ${money(month.expense)}`,
    );
    $("#finance-chart").append(column);
  }
}
function setView() {
  const requested = location.hash.slice(1) || "home";
  const id =
    requested === "templates"
      ? "automation"
      : requested === "finance-suppliers"
        ? "finance"
        : requested;
  if (requested === "finance-suppliers") $("#supplier-section").open = true;
  if (requested === "templates") $("#predefined-messages").open = true;
  const view = document.getElementById(id);
  const selected = view?.classList.contains("view") ? id : "home";
  for (const node of document.querySelectorAll(".view"))
    node.hidden = node.id !== selected;
  $("#summary").hidden = selected !== "home";
  for (const link of document.querySelectorAll("[data-view]")) {
    link.classList.toggle("selected", link.dataset.view === selected);
    if (link.dataset.view === selected)
      link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
function initializeModules() {
  $("#today").textContent = new Date().toLocaleDateString("es-PE", {
    timeZone: "America/Lima",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  $("#finance-month").value = todayLima().slice(0, 7);
  $("#business-name").value = settings.business;
  $("#payment-methods").value = settings.payments;
  document.documentElement.classList.toggle("dark", settings.dark);
  refreshAccountOptions();
  setView();
  window.addEventListener("hashchange", setView);
  $("#quick-sale").addEventListener("click", async () => editClient());
  $("#new-account").addEventListener("click", async () => editAccount());
  $("#client-account").addEventListener("change", chooseAccount);
  $("#account-search").addEventListener("input", renderModules);
  $("#renewal-search").addEventListener("input", renderModules);
  $("#finance-month").addEventListener("change", renderFinance);
  $("#account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const a = Object.fromEntries(new FormData(event.target));
      a.id ||= createId();
      a.service = a.service.trim();
      a.capacity = Number(a.capacity);
      a.costIntervalMonths = Number(a.costIntervalMonths);
      if (a.cost.trim() !== "") a.costCents = cents(a.cost);
      delete a.cost;
      const supplier = procurement.suppliers.find((s) => s.id === a.supplierId);
      if (supplier) a.provider = supplier.name;
      if (!a.service || !validDate(a.expires))
        throw Error("Completa la plataforma y un vencimiento válido.");
      const next = accounts.some((x) => x.id === a.id)
        ? accounts.map((x) => (x.id === a.id ? a : x))
        : [...accounts, a];
      const nextClients = clients.map((c) =>
        c.accountId === a.id ? { ...c, email: a.email, service: a.service } : c,
      );
      if (await persistState({ accounts: next, clients: nextClients })) {
        accounts = next;
        clients = nextClients;
        refreshAccountOptions();
        render();
        $("#account-dialog").close();
        notify("Cuenta guardada.");
      } else $("#account-error").textContent = $("#status").textContent;
    } catch (error) {
      $("#account-error").textContent = error.message;
    }
  });
  $("#renew-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target));
      const c = clients.find((c) => c.id === data.id);
      if (!c) throw Error("Cliente no encontrado.");
      if (
        !validDate(data.expires) ||
        data.expires <= todayLima() ||
        (c.expires && data.expires <= c.expires)
      )
        throw Error(
          "El nuevo vencimiento debe ser posterior al actual y a hoy.",
        );
      const amount = cents(data.amount);
      const next = clients.map((x) =>
        x.id === c.id ? { ...x, expires: data.expires } : x,
      );
      const nextLedger =
        data.paid === "on"
          ? [
              ...ledger,
              {
                id: createId(),
                date: todayLima(),
                kind: "renewal",
                description: `Renovación · ${c.name}`,
                clientId: c.id,
                service: c.service,
                amount,
              },
            ]
          : ledger;
      if (await persistState({ clients: next, ledger: nextLedger })) {
        clients = next;
        ledger = nextLedger;
        render();
        $("#renew-dialog").close();
        notify("Renovación guardada.");
      }
    } catch (error) {
      $("#renew-error").textContent = error.message;
    }
  });
  $("#new-expense").addEventListener("click", async () => {
    $("#expense-form").reset();
    $("#expense-form").elements.date.value = todayLima();
    $("#expense-dialog").showModal();
  });
  $("#expense-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target));
      const amount = cents(data.amount);
      if (!amount || !data.description.trim() || !validDate(data.date))
        throw Error("Completa los datos del gasto.");
      const next = [
        ...ledger,
        {
          id: createId(),
          kind: "expense",
          date: data.date,
          description: data.description.trim(),
          service: "",
          amount,
        },
      ];
      if (await persistState({ ledger: next })) {
        ledger = next;
        renderFinance();
        $("#expense-dialog").close();
        notify("Gasto registrado.");
      }
    } catch (error) {
      notify(error.message);
    }
  });
  $("#combo-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target));
      data.name = data.name.trim();
      data.services = data.services.trim();
      data.price = cents(data.price);
      data.id = createId();
      const next = [...combos, data];
      if (await persistState({ combos: next })) {
        combos = next;
        event.target.reset();
        renderModules();
        notify("Combo guardado.");
      }
    } catch (error) {
      notify(error.message);
    }
  });
  $("#offer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const c = clients.find((c) => c.id === $("#combo-recipient").value),
      combo = combos.find((c) => c.id === event.target.dataset.comboId);
    if (!c || !combo) return;
    $("#offer-dialog").close();
    openMessage(c);
    $("#message-text").value =
      `Hola ${c.name} 👋\n\n*${combo.name}*\n${combo.services}\n\n*Precio: ${money(combo.price)}*\n${settings.payments}\n\n¿Te gustaría adquirirlo?`;
    updateLink();
  });
  $("#copy-numbers").addEventListener("click", async () => {
    const query = $("#renewal-search").value.trim().toLocaleLowerCase();
    const selected = clients.filter(
      (c) =>
        ["expired", "soon"].includes(subscriptionStatus(c.expires)) &&
        [c.name, c.service, c.phone].some((v) =>
          v.toLocaleLowerCase().includes(query),
        ),
    );
    try {
      const phones = [
        ...new Set(
          selected.filter((c) => c.phone).map((c) => normalizePhone(c.phone)),
        ),
      ];
      if (!phones.length) {
        notify("No hay números en esta selección.");
        return;
      }
      await navigator.clipboard.writeText(phones.join("\n"));
      notify(`${phones.length} números copiados.`);
    } catch {
      notify(
        "No se pudieron copiar los números. Revisa los teléfonos y el permiso del portapapeles.",
      );
    }
  });
  $("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = {
      ...settings,
      business: $("#business-name").value.trim(),
      payments: $("#payment-methods").value.trim(),
      crmName: $("#crm-name").value.trim() || "Nexo CRM",
      logoDataUrl: pendingLogo,
    };
    if (await persistState({ settings: next })) {
      settings = next;
      applyBrand();
      notify("Configuración guardada.");
    }
  });
  $("#theme-toggle").addEventListener("click", async () => {
    const next = { ...settings, dark: !settings.dark };
    if (await persistState({ settings: next })) {
      settings = next;
      document.documentElement.classList.toggle("dark", settings.dark);
    }
  });
  $("#export-data").addEventListener("click", async () => {
    if (!available) {
      $("#backup-status").textContent =
        "No se exportará un respaldo vacío: no se pudieron leer los datos originales.";
      return;
    }
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      a = element("a");
    a.href = url;
    a.download = `nexo-respaldo-${todayLima()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("#backup-status").textContent = "Respaldo descargado.";
  });
  $("#import-data").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 10000000)
        throw Error("El respaldo supera el límite de 10 MB.");
      const state = validateWorkspace(JSON.parse(await file.text()));
      if (
        !confirm(
          `¿Restaurar ${state.clients.length} clientes y ${state.accounts.length} cuentas? Reemplazará los datos actuales. Descarga un respaldo antes de continuar.`,
        )
      )
        return;
      state.reports ||= { ...defaultReports };
      state.procurement ||= emptyProcurement();
      state.growth ||= emptyGrowth();
      if (!(await persistState(state)))
        throw Error("No se pudo guardar el respaldo.");
      ({ clients, templates, accounts, combos, ledger, settings } = state);
      promotions = state.promotions || emptyPromotions();
      reports = state.reports || { ...defaultReports };
      automation = state.automation || automation;
      rules = state.rules || [];
      taskReceipts = state.taskReceipts || [];
      reportWeekly.checked = reports.clientsWeekly;
      reportFinance.checked = reports.financeTwiceMonthly;
      reportHour.value = reports.hour;
      procurement = state.procurement || emptyProcurement();
      growth = state.growth || emptyGrowth();
      available = true;
      pendingLogo = settings.logoDataUrl || "";
      applyBrand();
      refreshAccountOptions();
      refreshTemplates();
      render();
      $("#business-name").value = settings.business;
      $("#payment-methods").value = settings.payments;
      document.documentElement.classList.toggle("dark", settings.dark);
      fillAutomationForm();
      $("#backup-status").textContent = "Respaldo restaurado.";
      notify("Respaldo restaurado.");
    } catch (error) {
      $("#backup-status").textContent =
        `No se restauraron los datos: ${error.message}`;
    } finally {
      event.target.value = "";
    }
  });
}

function switchTemplate(id) {
  const previous = templates.find((t) => t.id === selectedTemplateId);
  const dirty =
    previous &&
    (previous.name !== $("#template-name").value ||
      previous.body !== $("#template-body").value ||
      (previous.context || "General") !== $("#template-context").value);
  if (
    dirty &&
    !confirm("¿Descartar los cambios sin guardar de este mensaje?")
  ) {
    $("#template-select").value = selectedTemplateId;
    return;
  }
  $("#template-select").value = id;
  loadTemplate();
  renderTemplateLibrary();
}
function renderTemplateLibrary() {
  const current = $("#context-filter").value;
  const contexts = [
    ...new Set(templates.map((t) => t.context || "General")),
  ].sort();
  const all = element("option", "Todos los contextos");
  all.value = "all";
  $("#context-filter").replaceChildren(
    all,
    ...contexts.map((c) => {
      const o = element("option", c);
      o.value = c;
      return o;
    }),
  );
  $("#context-filter").value = contexts.includes(current) ? current : "all";
  const query = $("#template-search").value.trim().toLocaleLowerCase();
  const matches = templates
    .filter(
      (t) =>
        (t.context || "General") === $("#context-filter").value ||
        $("#context-filter").value === "all",
    )
    .filter((t) =>
      [t.name, t.body, t.context || "General"].some((v) =>
        v.toLocaleLowerCase().includes(query),
      ),
    );
  $("#template-library").replaceChildren(
    ...matches.map((t) => {
      const card = button("", () => switchTemplate(t.id), "template-card");
      card.classList.toggle("chosen", t.id === selectedTemplateId);
      card.append(
        element("span", t.context || "General", "pill none"),
        element("strong", t.name),
        element("small", t.body.slice(0, 120)),
      );
      return card;
    }),
  );
  if (!matches.length)
    $("#template-library").append(
      element(
        "p",
        "No hay mensajes en esta selección. Crea uno con «Nueva plantilla».",
        "muted",
      ),
    );
  const selected = $("#preview-client").value;
  const example = element("option", "Datos de ejemplo");
  example.value = "";
  $("#preview-client").replaceChildren(
    example,
    ...clients.map((c) => {
      const o = element("option", c.name);
      o.value = c.id;
      return o;
    }),
  );
  $("#preview-client").value = clients.some((c) => c.id === selected)
    ? selected
    : "";
  previewTemplate();
}
function previewTemplate() {
  const client = clients.find((c) => c.id === $("#preview-client").value) || {
    name: "Tu cliente",
    phone: "51987654321",
    email: "cliente@example.com",
    service: "Tu plataforma",
    profile: "Perfil 1",
    expires: todayLima(),
    pin: "1234",
  };
  $("#template-preview").textContent = fillTemplate(
    $("#template-body").value,
    client,
    "••••••",
    settings,
  );
}
$("#template-search").addEventListener("input", renderTemplateLibrary);
$("#context-filter").addEventListener("change", renderTemplateLibrary);
$("#preview-client").addEventListener("change", previewTemplate);
$("#template-body").addEventListener("input", previewTemplate);
$("#duplicate-template").addEventListener("click", async () => {
  const id = createId();
  const next = [
    ...templates,
    {
      id,
      name: `${$("#template-name").value.trim() || "Mensaje"} (copia)`,
      context: $("#template-context").value.trim() || "General",
      body: $("#template-body").value.trim() || "Hola {nombre}",
    },
  ];
  if (await persist(templateKey, next)) {
    templates = next;
    refreshTemplates(id);
    notify("Mensaje duplicado. Puedes editarlo libremente.");
  }
});
function fillAutomationForm() {
  $("#automation-enabled").checked = automation.enabled;
  $("#automation-name").value = automation.templateName;
  $("#automation-language").value = automation.language;
  $("#automation-hour").value = automation.hour;
  $("#automation-parameters").value = automation.parameters.join(", ");
}
async function refreshAutomationStatus() {
  if (!secureMode) return;
  try {
    const result = await api("/api/automation-status");
    const recent =
      result.worker &&
      Date.now() / 1000 - result.worker.checked <
        (result.intervalSeconds || 180) + 120;
    $("#automation-badge").textContent = !automation.enabled
      ? "Desactivado"
      : !result.configured
        ? "Falta conectar API"
        : !recent
          ? "Trabajador sin conexión"
          : "Activo";
    $("#automation-badge").className =
      `pill ${automation.enabled && result.configured && recent ? "active" : "none"}`;
    $("#automation-availability").textContent = result.configured
      ? "Las credenciales de WhatsApp están configuradas en el servidor. El envío usa la plantilla aprobada indicada abajo."
      : "Faltan WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID en la configuración privada del servidor. No hay envíos reales habilitados.";
    $("#worker-status").textContent = result.worker
      ? `Última revisión: ${new Date(result.worker.checked * 1000).toLocaleString("es-PE", { timeZone: "America/Lima" })} · ${recent ? "Servicio conectado" : "No hay revisiones recientes"}`
      : "El proceso de recordatorios todavía no se ha iniciado.";
    const descriptions = {
      processing: "Resultado pendiente de revisión",
      accepted: "Aceptado por Meta",
      rejected: "Rechazado",
      uncertain: "Resultado incierto: revisar en Meta",
      rate_limited: "Límite de Meta: se reintentará",
    };
    $("#reminder-history").replaceChildren(
      ...result.reminders.map((r) => {
        const tr = element("tr");
        const c = clients.find((c) => c.id === r.client_id);
        for (const text of [
          c?.name || "Cliente eliminado",
          formatDate(r.expires),
          descriptions[r.state] || r.state,
          r.error || "—",
        ])
          tr.append(element("td", text));
        return tr;
      }),
    );
    if (!result.reminders.length) {
      const row = element("tr"),
        cell = element("td", "Todavía no hay recordatorios procesados.");
      cell.colSpan = 4;
      row.append(cell);
      $("#reminder-history").append(row);
    }
  } catch (error) {
    $("#worker-status").textContent = error.message;
  }
}
async function initializeSecurity() {
  $("#logout").hidden = !secureMode;
  $("#server-security").hidden = !secureMode;
  $("#local-migration").hidden = !secureMode;
  $("#deployment-mode").textContent = secureMode
    ? "Modo privado · Datos en el servidor · Acceso exclusivo del administrador"
    : "Modo local de GitHub Pages · Para login y recordatorios automáticos necesitas desplegar el servidor incluido en el proyecto.";
  $("#security-description").textContent = secureMode
    ? "Tu página y la API requieren una sesión válida. No hay registro público de usuarios."
    : "Este sitio estático no ofrece protección por contraseña. La pantalla de login real está implementada en el backend y se activa al desplegarlo en un servidor con HTTPS.";
  if (secureMode) {
    $("#storage-description").textContent =
      "Los datos se guardan en la base de datos privada del servidor y se consultan tras iniciar sesión.";
    $("#backup-description").textContent =
      "Los registros y plantillas se guardan en el servidor.";
    $("#storage-footer").textContent =
      "Nexo CRM · Sesión privada · Datos en el servidor.";
    const session = await api("/api/session");
    $("#owner-identity").textContent = `Administrador: ${session.email}`;
    if (session.authProvider === "cloudflare-access") {
      $("#password-form").hidden = true;
      $("#security-description").textContent =
        "Acceso exclusivo de tu correo mediante Cloudflare Access. El inicio de sesión se verifica antes de consultar tus datos.";
      $("#server-auth-description").textContent =
        "Cloudflare gestiona el inicio de sesión de la única cuenta autorizada. El CRM no almacena contraseñas de acceso al gestor.";
    }
  }
  fillAutomationForm();
  if (!secureMode) {
    for (const input of $("#automation-form").elements) input.disabled = true;
    $("#refresh-automation").disabled = true;
    $("#automation-availability").textContent =
      "El envío automático necesita un servidor activo y la API oficial de WhatsApp. GitHub Pages permite mensajes manuales mediante wa.me.";
    $("#worker-status").textContent =
      "No hay trabajador de recordatorios en el modo local.";
  } else await refreshAutomationStatus();
}
$("#automation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!secureMode) return;
  const next = {
    enabled: $("#automation-enabled").checked,
    templateName: $("#automation-name").value.trim(),
    language: $("#automation-language").value.trim(),
    hour: Number($("#automation-hour").value),
    parameters: $("#automation-parameters")
      .value.split(",")
      .map((v) => v.trim().replace(/^\{|\}$/g, ""))
      .filter(Boolean),
  };
  if (await persistState({ automation: next })) {
    automation = next;
    notify(
      "Regla de recordatorio guardada. Se revisa tres días antes del vencimiento de cada cliente con autorización.",
    );
    await refreshAutomationStatus();
  }
});
$("#refresh-automation").addEventListener("click", refreshAutomationStatus);
$("#logout").addEventListener("click", async () => {
  try {
    const result = await api("/api/logout", { method: "POST", body: "{}" });
    location.replace(result.logoutUrl || "/login");
  } catch (error) {
    notify(error.message);
  }
});
$("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/password", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
    });
    event.target.reset();
    location.replace("/login");
  } catch (error) {
    $("#password-status").textContent = error.message;
  }
});

function ruleFormData() {
  const form = $("#rule-form"),
    value = (name) => form.elements.namedItem(name).value;
  return {
    id: ruleEditId || createId(),
    name: value("name").trim(),
    templateId: value("templateId"),
    delivery: value("delivery"),
    enabled: form.elements.enabled.checked,
    audience: value("audience"),
    daysBefore: Number(value("daysBefore")),
    hour: Number(value("hour")),
    services: value("services")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    meta: {
      templateName: value("metaName").trim(),
      language: value("metaLanguage").trim(),
      parameters: value("metaParameters")
        .split(",")
        .map((s) => s.trim().replace(/^\{|\}$/g, ""))
        .filter(Boolean),
    },
  };
}
function previewRule() {
  const form = $("#rule-form"),
    t = templates.find((t) => t.id === form.elements.templateId.value),
    c = clients.find((c) => c.id === $("#rule-preview-client").value);
  $("#rule-preview").textContent =
    t && c
      ? fillTemplate(t.body, c, "", settings)
      : "Añade un cliente y elige una plantilla para ver el mensaje.";
  $("#rule-meta").open = form.elements.delivery.value === "meta";
}
function editRule(rule = null) {
  ruleEditId = rule?.id || null;
  const form = $("#rule-form");
  form.reset();
  templateOptions(form.elements.templateId, rule?.templateId);
  form.elements.audience.value = rule?.audience || "all";
  for (const name of ["name", "delivery", "daysBefore", "hour"])
    if (rule) form.elements.namedItem(name).value = rule[name];
  form.elements.enabled.checked = rule?.enabled || false;
  form.elements.services.value = rule?.services.join(", ") || "";
  form.elements.metaName.value = rule?.meta.templateName || "";
  form.elements.metaLanguage.value = rule?.meta.language || "es";
  form.elements.metaParameters.value =
    rule?.meta.parameters.join(", ") || "nombre, servicio, vence";
  $("#rule-title").textContent = rule ? "Editar regla" : "Nueva regla";
  $("#rule-error").textContent = "";
  $("#rule-preview-client").replaceChildren(
    ...clients.map((c) => {
      const option = element("option", c.name + " · " + c.service);
      option.value = c.id;
      return option;
    }),
  );
  previewRule();
  $("#rule-dialog").showModal();
}
async function renderRules() {
  const sequence = ++ruleRenderSequence,
    list = $("#rule-list");
  if (!list) return;
  list.replaceChildren(
    ...rules.map((rule) => {
      const card = element("article", undefined, "rule-card");
      card.append(
        element("strong", rule.name),
        element(
          "span",
          rule.enabled ? "Activa" : "Preparada · desactivada",
          `pill ${rule.enabled ? "active" : "none"}`,
        ),
        element(
          "p",
          `${rule.daysBefore} días antes · ${String(rule.hour).padStart(2, "0")}:00 Lima · ${rule.services.join(", ") || "Todas las plataformas"}`,
        ),
        element("small", deliveryLabels[rule.delivery]),
      );
      const actions = element("div", undefined, "actions");
      actions.append(
        button("Editar", () => editRule(rule)),
        button("Duplicar", async () => {
          const next = {
            ...structuredClone(rule),
            id: createId(),
            name: rule.name + " (copia)",
            enabled: false,
          };
          if (await persistState({ rules: [...rules, next] })) {
            rules.push(next);
            renderRules();
          }
        }),
        button(rule.enabled ? "Desactivar" : "Activar", async () => {
          const next = rules.map((r) =>
            r.id === rule.id ? { ...r, enabled: !r.enabled } : r,
          );
          if (await persistState({ rules: next })) {
            rules = next;
            renderRules();
          }
        }),
        button("Eliminar", async () => {
          if (
            !confirm(
              "¿Eliminar esta regla? Las tareas no reservadas dejarán de estar disponibles.",
            )
          )
            return;
          const next = rules.filter((r) => r.id !== rule.id);
          if (await persistState({ rules: next })) {
            rules = next;
            renderRules();
          }
        }),
      );
      card.append(actions);
      return card;
    }),
  );
  if (!rules.length)
    list.append(
      element(
        "p",
        "Todavía no hay reglas. Crea una y elige cualquier mensaje de tu biblioteca.",
        "muted",
      ),
    );
  try {
    const all = (await buildRuleTasks(snapshot())).filter(
        (task) => !externalCompleted.has(task.id),
      ),
      query = $("#task-search").value.toLocaleLowerCase(),
      tasks = all.filter((t) =>
        [t.clientName, t.ruleName, t.text].some((v) =>
          v.toLocaleLowerCase().includes(query),
        ),
      );
    if (sequence !== ruleRenderSequence) return;
    $("#task-summary").textContent =
      `${all.length} pendientes según tus reglas y autorizaciones. ${tasks.length} coinciden con la búsqueda.`;
    $("#task-list").replaceChildren(
      ...tasks.map((task) => {
        const card = element("article", undefined, "rule-card");
        card.append(
          element("strong", task.clientName + " · " + task.ruleName),
          element(
            "small",
            `${task.phone} · ${formatDate(task.dueDate)} · ${deliveryLabels[task.delivery]}`,
          ),
          element("pre", task.text, "message-preview"),
        );
        if (task.delivery === "manual")
          card.append(
            button("Revisar y abrir WhatsApp", () => {
              const client = clients.find((c) => c.id === task.clientId);
              if (!client) return;
              openMessage(client);
              currentTask = task;
              $("#message-template").value = rules.find(
                (r) => r.id === task.ruleId,
              ).templateId;
              messageTemplateId = $("#message-template").value;
              $("#message-text").value = task.text;
              $("#confirm-task").hidden = false;
              $("#confirm-manual-message").hidden = true;
              updateLink();
            }),
          );
        else
          card.append(
            element(
              "p",
              externalTaskStates.get(task.id) ||
                "Preparada. Requiere conectar el servicio elegido.",
              "muted",
            ),
          );
        return card;
      }),
    );
    if (!tasks.length)
      $("#task-list").append(
        element(
          "p",
          "No hay mensajes pendientes. Las reglas desactivadas y los clientes sin autorización no generan tareas.",
          "muted",
        ),
      );
  } catch (error) {
    $("#task-summary").textContent = error.message;
  }
}
$("#new-rule").addEventListener("click", () => editRule());
$("#rule-form").addEventListener("input", previewRule);
$("#rule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const rule = ruleFormData(),
      next = ruleEditId
        ? rules.map((r) => (r.id === ruleEditId ? rule : r))
        : [...rules, rule];
    validateWorkspace(snapshot({ rules: next }));
    if (!(await persistState({ rules: next })))
      throw Error("No se pudo guardar; revisa el aviso del gestor.");
    rules = next;
    $("#rule-dialog").close();
    renderRules();
    notify("Regla guardada. No se conectó ni se envió ningún mensaje.");
  } catch (error) {
    $("#rule-error").textContent = error.message;
  }
});
$("#confirm-task").addEventListener("click", async () => {
  if (
    !currentTask ||
    !confirm(
      "¿Confirmas que tú enviaste este mensaje en WhatsApp? Abrir la conversación no equivale a enviarlo.",
    )
  )
    return;
  const next = [
    ...taskReceipts.filter((r) => r.id !== currentTask.id),
    {
      id: currentTask.id,
      signature: currentTask.signature,
      completedAt: new Date().toISOString(),
    },
  ];
  const nextGrowth = structuredClone(growth);
  try {
    nextGrowth.interactions.push(
      manualMessage(
        recipient,
        $("#message-text").value,
        "sent_manual",
        createId(),
      ),
    );
  } catch (error) {
    notify(error.message);
    return;
  }
  if (await persistState({ taskReceipts: next, growth: nextGrowth })) {
    growth = nextGrowth;
    renderInbox();
    taskReceipts = next;
    $("#message-dialog").close();
    renderRules();
    notify(
      "Envío confirmado por ti. No se vuelve a preparar para este vencimiento.",
    );
  }
});
$("#task-search").addEventListener("input", renderRules);
async function refreshIntegrations(generate = false) {
  if (!secureMode || authProvider !== "cloudflare-access") {
    $("#integration-status").textContent =
      "Preparada, sin conectar. La API de tareas se activa en la versión privada de Cloudflare; el modo actual permite enviar por wa.me con tu confirmación.";
    return;
  }
  try {
    const data = await api(
      generate ? "/api/message-tasks/refresh" : "/api/message-tasks",
      generate ? { method: "POST", body: "{}" } : {},
    );
    $("#integration-status").textContent = data.configured
      ? "Credencial instalada. Debes conectar y comprobar tu herramienta externa."
      : "Integración preparada, sin conectar: no hay una credencial instalada.";
    externalCompleted = new Set(
      data.tasks
        .filter((row) => ["completed", "accepted"].includes(row.state))
        .map((row) => row.id),
    );
    externalTaskStates = new Map(
      data.tasks.map((row) => [
        row.id,
        {
          pending: "En cola, pendiente de recoger por la herramienta.",
          claimed: "Reservada por la herramienta; pendiente de resultado.",
          completed: "Completada según la herramienta.",
          accepted: "Aceptada por Meta; no confirma entrega.",
          uncertain: "Resultado incierto: revisión necesaria.",
          rejected: "Falló; revisión necesaria.",
          cancelled: "Cancelada por cambios en los datos.",
          processing: "Procesando.",
          rate_limited: "Proveedor ocupado; pendiente de reintento.",
        }[row.state] || row.state,
      ]),
    );
    const table = element("table"),
      head = element("tr");
    for (const text of ["Cliente / regla", "Estado", "Último cambio"])
      head.append(element("th", text));
    const thead = element("thead");
    thead.append(head);
    table.append(thead);
    const tbody = element("tbody");
    for (const row of data.tasks) {
      const tr = element("tr");
      for (const text of [
        row.task.clientName + " · " + row.task.ruleName,
        externalTaskStates.get(row.id),
        new Date(row.updated * 1000).toLocaleString("es-PE", {
          timeZone: "America/Lima",
        }),
      ])
        tr.append(element("td", text));
      tbody.append(tr);
    }
    table.append(tbody);
    $("#integration-history").replaceChildren(table);
    renderRules();
  } catch (error) {
    $("#integration-status").textContent = error.message;
  }
}
$("#refresh-tasks").addEventListener("click", async () => {
  await refreshIntegrations(true);
  await renderRules();
});
$("#refresh-integration").addEventListener("click", () =>
  refreshIntegrations(),
);
renderRules();
refreshIntegrations();

$("#toggle-account-password").addEventListener("click", () => {
  const input = $("#account-password");
  input.type = input.type === "password" ? "text" : "password";
  $("#toggle-account-password").textContent =
    input.type === "password" ? "Mostrar contraseña" : "Ocultar contraseña";
});
$("#account-dialog").addEventListener("close", () => {
  $("#account-password").value = "";
  $("#account-password").type = "password";
});

$("#message-new-template").addEventListener("click", () => {
  $("#message-template-editor").hidden = false;
  for (const id of [
    "#message-new-name",
    "#message-new-context",
    "#message-new-body",
    "#message-new-error",
  ]) {
    const node = $(id);
    if ("value" in node) node.value = "";
    else node.textContent = "";
  }
  $("#message-contexts").replaceChildren(
    ...[...new Set(templates.map((t) => t.context || "General"))].map(
      (context) => {
        const option = element("option");
        option.value = context;
        return option;
      },
    ),
  );
  $("#message-new-name").focus();
});
$("#message-cancel-template").addEventListener("click", () => {
  $("#message-template-editor").hidden = true;
});
$("#message-free").addEventListener("click", () => {
  if (
    $("#message-text").value &&
    !confirm("¿Empezar un mensaje libre y reemplazar el texto actual?")
  )
    return;
  $("#message-template").value = "__custom";
  messageTemplateId = "__custom";
  $("#message-text").value = "";
  $("#message-template-editor").hidden = true;
  updateLink();
  $("#message-text").focus();
});
for (const field of fields)
  $("#message-new-variables").append(
    button(
      `{${field}}`,
      () => {
        const input = $("#message-new-body");
        input.setRangeText(
          `{${field}}`,
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        input.focus();
      },
      "variable",
    ),
  );
$("#message-save-template").addEventListener("click", async () => {
  const template = {
    id: createId(),
    name: $("#message-new-name").value.trim(),
    context: $("#message-new-context").value.trim() || "General",
    body: $("#message-new-body").value.trim(),
  };
  if (!template.name || !template.body) {
    $("#message-new-error").textContent =
      "Escribe un nombre y el texto de tu plantilla.";
    return;
  }
  const next = [...templates, template];
  if (!(await persist(templateKey, next))) {
    $("#message-new-error").textContent =
      "No se pudo guardar. Revisa el aviso del gestor.";
    return;
  }
  templates = next;
  refreshTemplates(template.id);
  templateOptions($("#message-template"), template.id);
  compose();
  $("#message-template-editor").hidden = true;
  notify(
    "Plantilla y categoría guardadas. Puedes reutilizarlas para cualquier cliente.",
  );
});
function openIncome() {
  const form = $("#income-form");
  form.reset();
  form.elements.date.value = todayLima();
  $("#income-error").textContent = "";
  const none = element("option", "Ingreso sin vincular cliente");
  none.value = "";
  $("#income-client").replaceChildren(
    none,
    ...clients.map((c) => {
      const option = element("option", c.name + " · " + c.service);
      option.value = c.id;
      return option;
    }),
  );
  $("#income-dialog").showModal();
}
$("#new-income").addEventListener("click", openIncome);
$("#income-client").addEventListener("change", () => {
  const c = clients.find((c) => c.id === $("#income-client").value);
  if (!c) return;
  const form = $("#income-form");
  form.elements.amount.value = (c.price / 100).toFixed(2);
  form.elements.service.value = c.service;
  form.elements.description.value = `${form.elements.kind.value === "renewal" ? "Renovación" : "Venta"} · ${c.name}`;
});
$("#income-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target));
    data.amount = cents(data.amount);
    if (data.amount <= 0 || !validDate(data.date) || !data.description.trim())
      throw Error(
        "Indica fecha, descripción e importe cobrado mayor que cero.",
      );
    const client = clients.find((c) => c.id === data.clientId);
    if (data.clientId && !client) throw Error("Cliente no disponible.");
    if (
      client &&
      data.kind === "sale" &&
      ledger.some(
        (m) =>
          m.kind === "sale" &&
          (m.clientId === client.id ||
            (!m.clientId &&
              m.description === `Venta · ${client.name}` &&
              m.service === client.service)),
      )
    )
      throw Error(
        "Este cliente ya tiene una venta registrada. Usa Renovación para un nuevo periodo o revisa el movimiento existente.",
      );
    const entry = {
      ...data,
      id: createId(),
      description: data.description.trim(),
    };
    if (!entry.clientId) delete entry.clientId;
    const next = [...ledger, entry];
    if (await persistState({ ledger: next })) {
      ledger = next;
      $("#finance-month").value = data.date.slice(0, 7);
      renderFinance();
      $("#income-dialog").close();
      notify("Ingreso registrado en Finanzas.");
    } else $("#income-error").textContent = $("#status").textContent;
  } catch (error) {
    $("#income-error").textContent = error.message;
  }
});

$("#add-customer").addEventListener("click", () => {
  $("#account-filter").value = "all";
  $("#search").value = "";
  $("#filter").value = "all";
  render();
  editClient();
});
function downloadClientFile(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    link = element("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#export-clients-csv").addEventListener("click", () => {
  downloadClientFile(
    exportClientCSV(clients),
    "text/csv;charset=utf-8",
    `clientes-${todayLima()}.csv`,
  );
  notify(`Descargada la cartera completa: ${clients.length} clientes.`);
});
$("#export-clients-xlsx").addEventListener("click", async () => {
  try {
    const bytes = await exportClientExcel(clients, globalThis.ExcelJS);
    downloadClientFile(
      bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      `clientes-${todayLima()}.xlsx`,
    );
    notify(`Descargada la cartera completa: ${clients.length} clientes.`);
  } catch (error) {
    notify(error.message);
  }
});
let pendingClientImport = null;
$("#import-clients").addEventListener("click", () => {
  pendingClientImport = null;
  $("#client-import-file").value = "";
  $("#client-import-status").textContent = "";
  $("#client-import-preview").replaceChildren();
  $("#confirm-client-import").disabled = true;
  $("#client-import-dialog").showModal();
});
$("#download-client-example").addEventListener("click", () => {
  const example = {
    id: "",
    name: "Nombre de ejemplo",
    phone: "",
    whatsappUsername: "",
    email: "",
    service: "Max",
    profile: "",
    expires: "",
    price: 0,
    pin: "",
    notes: "",
    accountId: "",
    reminderConsent: false,
  };
  downloadClientFile(
    exportClientCSV([example]),
    "text/csv;charset=utf-8",
    "plantilla-clientes.csv",
  );
});
$("#client-import-file").addEventListener("change", async (event) => {
  pendingClientImport = null;
  $("#confirm-client-import").disabled = true;
  $("#client-import-preview").replaceChildren();
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024)
      throw Error("El archivo supera 5 MB. Divide la importación.");
    let rows;
    if (/\.csv$/i.test(file.name)) rows = parseCSV(await file.text());
    else if (/\.xlsx$/i.test(file.name))
      rows = await readExcelRows(await file.arrayBuffer(), globalThis.ExcelJS);
    else throw Error("Usa CSV o Excel .xlsx; convierte archivos .xls a .xlsx.");
    const result = prepareClientImport(rows, snapshot());
    pendingClientImport = result;
    const invalid = result.preview.filter((r) =>
        r.status.startsWith("Error"),
      ).length,
      duplicates = result.preview.filter((r) =>
        r.status.startsWith("Duplicado"),
      ).length;
    $("#client-import-status").textContent =
      `${result.clients.length} válidos · ${duplicates} duplicados omitidos · ${invalid} filas con errores. Vista previa de hasta 200 filas.`;
    const table = element("table"),
      head = element("tr");
    for (const text of ["Fila", "Cliente", "Resultado"])
      head.append(element("th", text));
    table.append(head);
    for (const row of result.preview.slice(0, 200)) {
      const tr = element("tr");
      for (const text of [row.row, row.name, row.status])
        tr.append(element("td", String(text)));
      table.append(tr);
    }
    $("#client-import-preview").append(table);
    $("#confirm-client-import").textContent =
      `Importar ${result.clients.length} clientes válidos`;
    $("#confirm-client-import").disabled = !result.clients.length;
  } catch (error) {
    $("#client-import-status").textContent = error.message;
  }
});
$("#confirm-client-import").addEventListener("click", async () => {
  if (!pendingClientImport?.clients.length) return;
  const next = [...clients, ...pendingClientImport.clients];
  if (await persistState({ clients: next })) {
    const count = pendingClientImport.clients.length;
    clients = next;
    pendingClientImport = null;
    $("#account-filter").value = "all";
    $("#filter").value = "all";
    $("#search").value = "";
    render();
    $("#client-import-dialog").close();
    notify(`Importados ${count} clientes. No se crearon cobros financieros.`);
  } else $("#client-import-status").textContent = $("#status").textContent;
});
$("#client-import-dialog").addEventListener("close", () => {
  pendingClientImport = null;
  $("#client-import-file").value = "";
});

const growthUI = initializeGrowth({
  getState: snapshot,
  today: todayLima,
  save: async (next) => {
    if (!(await persistState({ growth: next }))) return false;
    growth = next;
    return true;
  },
  openMessage,
  notify,
});
window.addEventListener("hashchange", () => growthUI.render());

let pendingLogo = settings.logoDataUrl || "";
let installPrompt = null;
function applyBrand() {
  const name = settings.crmName || "Nexo CRM",
    logo = settings.logoDataUrl || "app-icon.svg";
  document.title = name;
  $("#brand-name").textContent = name;
  $("#crm-heading").textContent = name;
  $("#brand-logo").src = logo;
  $("#crm-logo-preview").src = logo;
  $("#crm-name").value = settings.crmName || "";
  $("#storage-footer").textContent =
    `${name} · ${secureMode ? "Sesión privada · Datos en el servidor" : "Datos guardados en este navegador"}.`;
  if (navigator.serviceWorker?.controller)
    navigator.serviceWorker.controller.postMessage({
      type: "brand",
      name,
      logo: settings.logoDataUrl || "",
    });
}
$("#crm-logo-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (
      file.size > 100000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    )
      throw Error("Elige PNG, JPG o WebP de hasta 100 KB.");
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    const reader = new FileReader();
    reader.onload = () => {
      pendingLogo = reader.result;
      $("#crm-logo-preview").src = pendingLogo;
      $("#crm-logo-status").textContent =
        "Vista previa lista. Pulsa Guardar configuración para aplicar.";
    };
    reader.readAsDataURL(file);
  } catch (error) {
    $("#crm-logo-status").textContent = error.message;
    e.target.value = "";
  }
});
$("#remove-crm-logo").onclick = () => {
  pendingLogo = "";
  $("#crm-logo-file").value = "";
  $("#crm-logo-preview").src = "app-icon.svg";
  $("#crm-logo-status").textContent =
    "Pulsa Guardar configuración para restablecer el logo.";
};
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("#install-app").hidden = false;
});
$("#install-app").onclick = async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  const result = await installPrompt.userChoice;
  $("#install-status").textContent =
    result.outcome === "accepted"
      ? "Instalación solicitada."
      : "Puedes instalarla más adelante desde el menú del navegador.";
  installPrompt = null;
  $("#install-app").hidden = true;
};
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("./sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      (navigator.serviceWorker.controller || reg.active)?.postMessage({
        type: "brand",
        name: settings.crmName || "Nexo CRM",
        logo: settings.logoDataUrl || "",
      });
    })
    .catch(() => {
      $("#install-status").textContent =
        "La instalación no está disponible en este navegador; puedes usar la web.";
    });
navigator.serviceWorker?.addEventListener("controllerchange", () =>
  applyBrand(),
);
applyBrand();

function showAssignedPassword() {
  document.dispatchEvent(new Event("client-cost-updated"));
  const input = $("#client-account-password");
  input.value =
    accounts.find((a) => a.id === $("#client-account").value)?.password || "";
  input.type = "password";
  $("#toggle-client-account-password").textContent = "Mostrar contraseña";
}
$("#toggle-client-account-password").onclick = () => {
  const input = $("#client-account-password");
  input.type = input.type === "password" ? "text" : "password";
  $("#toggle-client-account-password").textContent =
    input.type === "password" ? "Mostrar contraseña" : "Ocultar contraseña";
};
$("#client-dialog").addEventListener("close", () => {
  $("#client-account-password").value = "";
  $("#client-account-password").type = "password";
});

const procurementUI = initializeProcurement({
  getState: snapshot,
  today: todayLima,
  money,
  cents,
  createId,
  notify,
  save: async (overrides) => {
    if (!(await persistState(overrides))) return false;
    if (overrides.procurement) procurement = overrides.procurement;
    if (overrides.ledger) ledger = overrides.ledger;
    renderFinance();
    renderSupplierOverview();
    return true;
  },
});
window.addEventListener("hashchange", () => {
  procurementUI.render();
  renderSupplierOverview();
});

const reportWeekly = document.querySelector("#reports-weekly"),
  reportFinance = document.querySelector("#reports-finance"),
  reportHour = document.querySelector("#reports-hour");
reportWeekly.checked = reports.clientsWeekly;
reportFinance.checked = reports.financeTwiceMonthly;
reportHour.value = reports.hour;
document
  .querySelector("#reports-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const next = validateReports({
        clientsWeekly: reportWeekly.checked,
        financeTwiceMonthly: reportFinance.checked,
        hour: Number(reportHour.value),
      });
      if (await persistState({ reports: next })) {
        reports = next;
        notify(
          "Programación guardada. El envío requiere servidor y correo conectado.",
        );
      }
    } catch (e) {
      notify(e.message);
    }
  });
for (const kind of ["clients", "finance"])
  document
    .querySelector("#download-report-" + kind)
    .addEventListener("click", () => {
      try {
        const day = todayLima(),
          blob = new Blob([workbook(reportSheets(snapshot(), kind, day))], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = kind + "-" + day + ".xlsx";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        notify(e.message);
      }
    });
if (secureMode)
  api("/api/report-status")
    .then((s) => {
      document.querySelector("#reports-status").textContent = s.configured
        ? "Correo conectado. Destinatario: " +
          s.recipient +
          ". El servidor revisa la programación automáticamente."
        : "Correo pendiente de conexión. Destinatario: " + s.recipient;
      const states = {
        accepted: "Aceptado por correo",
        rejected: "Rechazado: revisar conexión",
        failed: "No se pudo preparar",
        processing: "En proceso: revisar si persiste",
        uncertain: "Resultado incierto: revisar antes de reenviar",
      };
      document.querySelector("#reports-history").textContent =
        (s.recent || [])
          .map(
            (r) =>
              `${r.day} · ${r.kind === "clients" ? "Clientes" : "Finanzas"} · ${states[r.state] || r.state}`,
          )
          .join("\n") || "Aún no hay intentos de envío.";
    })
    .catch(() => {
      document.querySelector("#reports-status").textContent =
        "No se pudo comprobar el servicio de correo.";
    });

function renderInbox() {
  const query = $("#inbox-search").value.trim().toLocaleLowerCase();
  const matches = clients.filter((c) =>
    [c.name, c.phone, c.whatsappUsername, c.email, c.service].some((v) =>
      (v || "").toLocaleLowerCase().includes(query),
    ),
  );
  if (!clients.some((c) => c.id === inboxClientId)) inboxClientId = "";
  const list = $("#inbox-contacts");
  list.replaceChildren();
  for (const c of matches) {
    const row = element(
      "button",
      undefined,
      "inbox-contact" + (c.id === inboxClientId ? " selected" : ""),
    );
    row.type = "button";
    row.setAttribute("aria-pressed", String(c.id === inboxClientId));
    row.append(
      element("strong", c.name),
      element(
        "small",
        `${c.phone || c.whatsappUsername || "Sin número"} · ${c.service || "Sin servicio"}`,
      ),
    );
    row.addEventListener("click", () => {
      inboxClientId = c.id;
      $("#inbox-received").value = "";
      renderInbox();
    });
    list.append(row);
  }
  if (!matches.length)
    list.append(
      element(
        "p",
        "No hay contactos que coincidan. Añádelos desde Clientes.",
        "muted",
      ),
    );
  const c = clients.find((c) => c.id === inboxClientId);
  $("#inbox-title").textContent = c?.name || "Selecciona un contacto";
  $("#inbox-contact").textContent = c
    ? `${c.phone || c.whatsappUsername || "Sin contacto WhatsApp"} · ${c.service || "Sin servicio"}${c.archived ? " · Archivado" : ""}`
    : "";
  for (const id of [
    "inbox-compose",
    "inbox-profile",
    "inbox-received",
    "inbox-save-received",
  ])
    $("#" + id).disabled = !c;
  const history = $("#inbox-history");
  history.replaceChildren();
  if (!c) return;
  const entries = conversationEntries(snapshot(), c.id);
  for (const i of entries) {
    const row = element(
      "article",
      undefined,
      "inbox-bubble " + (i.kind === "sent_manual" ? "outgoing" : "incoming"),
    );
    row.append(
      element(
        "small",
        `${i.name} · ${new Date(i.occurredAt).toLocaleString("es-PE", { timeZone: "America/Lima" })}`,
      ),
      element("p", i.body),
    );
    history.append(row);
  }
  if (!entries.length)
    history.append(
      element(
        "p",
        "No hay mensajes registrados. Esta bandeja no importa conversaciones de WhatsApp Web.",
        "muted",
      ),
    );
}
async function saveConversation(c, body, kind) {
  const next = structuredClone(growth);
  next.interactions.push(manualMessage(c, body, kind, createId()));
  if (!(await persistState({ growth: next }))) return false;
  growth = next;
  renderInbox();
  growthUI.render();
  return true;
}
$("#inbox-search").addEventListener("input", renderInbox);
$("#inbox-compose").addEventListener("click", () => {
  const c = clients.find((c) => c.id === inboxClientId);
  if (c) openMessage(c);
});
$("#inbox-profile").addEventListener("click", () => {
  const c = clients.find((c) => c.id === inboxClientId);
  if (c) growthUI.showContact(c);
});
$("#inbox-received-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const c = clients.find((c) => c.id === inboxClientId);
    if (
      await saveConversation(c, $("#inbox-received").value, "received_manual")
    ) {
      $("#inbox-received").value = "";
      notify("Mensaje recibido registrado manualmente.");
    }
  } catch (e) {
    notify(e.message);
  }
});
$("#confirm-manual-message").addEventListener("click", async () => {
  if (!recipient || currentTask) return;
  const btn = $("#confirm-manual-message");
  btn.disabled = true;
  try {
    if (
      !confirm(
        "¿Confirmas que ya enviaste este texto en WhatsApp? Se guardará en el historial del cliente.",
      )
    )
      return;
    if (
      await saveConversation(recipient, $("#message-text").value, "sent_manual")
    ) {
      $("#message-dialog").close();
      notify(
        "Envío registrado por tu confirmación; WhatsApp no verificó la entrega.",
      );
    }
  } catch (e) {
    $("#message-error").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});
window.addEventListener("hashchange", renderInbox);

function promotionKindFields() {
  const kind = $("#promotion-kind").value;
  $("#promotion-value-label").hidden = kind === "gift";
  $("#promotion-value").required = kind !== "gift";
  $("#promotion-value").max = kind === "percent" ? "100" : "999999";
  $("#promotion-gift-label").hidden = kind !== "gift";
  $("#promotion-form").elements.giftService.required = kind === "gift";
}
function renderPromotions() {
  const cards = $("#promotion-cards");
  cards.replaceChildren();
  for (const o of promotions.offers) {
    const card = element("article", undefined, "account-card");
    card.append(
      element("h4", o.name),
      element(
        "p",
        o.kind === "percent"
          ? `${o.value / 100}% de descuento`
          : o.kind === "amount"
            ? `${money(o.value)} de descuento`
            : `Gratis: ${o.giftService}`,
      ),
      element("p", o.notes, "muted"),
    );
    const actions = element("div", undefined, "actions");
    actions.append(
      button("Personalizar para un cliente", () => openPromotion(o)),
      button("Editar", () => {
        const f = $("#promotion-form");
        for (const k of ["id", "name", "kind", "giftService", "notes"])
          f.elements[k].value = o[k];
        f.elements.value.value = (o.value / 100).toFixed(2);
        promotionKindFields();
        f.scrollIntoView({ block: "center" });
      }),
      button("Eliminar", async () => {
        if (
          !confirm(
            "¿Eliminar esta promoción? Se conservarán las ofertas ya aplicadas.",
          )
        )
          return;
        const next = {
          ...promotions,
          offers: promotions.offers.filter((x) => x.id !== o.id),
        };
        if (await persistState({ promotions: next })) {
          promotions = next;
          renderPromotions();
        }
      }),
    );
    card.append(actions);
    cards.append(card);
  }
  if (!promotions.offers.length)
    cards.append(
      element("p", "Crea tu primer descuento o producto gratis.", "muted"),
    );
  const history = $("#promotion-history");
  history.replaceChildren();
  for (const a of [...promotions.applications].reverse()) {
    const c = clients.find((c) => c.id === a.clientId);
    const card = element("article", undefined, "inset");
    card.append(
      element("strong", `${c?.name || "Cliente histórico"} · ${a.name}`),
      element(
        "p",
        `${a.service} · Base ${money(a.base)} − ${money(a.discount)} = ${money(a.final)}${a.giftService ? " · Regalo: " + a.giftService + " (asignación manual)" : ""}`,
      ),
      element(
        "small",
        `${new Date(a.occurredAt).toLocaleString("es-PE", { timeZone: "America/Lima" })} · ${a.ledgerId ? "Cobro registrado" : "Sin cobro registrado"}${a.updateClientPrice ? " · Precio del cliente actualizado" : ""}`,
      ),
      element("p", a.notes, "muted"),
    );
    history.append(card);
  }
  if (!promotions.applications.length)
    history.append(element("p", "Aún no hay promociones aplicadas.", "muted"));
}
function openPromotion(o) {
  if (!clients.length) {
    notify("Añade un cliente para personalizar esta oferta.");
    return;
  }
  const f = $("#promotion-apply-form");
  f.reset();
  f.elements.offerId.value = o.id;
  $("#promotion-error").textContent = "";
  $("#promotion-client").replaceChildren(
    ...clients.map((c) => {
      const n = element("option", `${c.name} · ${c.service || "Sin servicio"}`);
      n.value = c.id;
      return n;
    }),
  );
  $("#promotion-source").replaceChildren(
    element("option", "Servicio actual del cliente"),
  );
  $("#promotion-source").firstChild.value = "client";
  for (const combo of combos) {
    const opt = element("option", combo.name);
    opt.value = combo.id;
    $("#promotion-source").append(opt);
  }
  $("#promotion-custom-value").value = (o.value / 100).toFixed(2);
  $("#promotion-custom-value").max = o.kind === "percent" ? "100" : "999999";
  $("#promotion-custom-value-label").hidden = o.kind === "gift";
  $("#promotion-custom-value").required = o.kind !== "gift";
  $("#promotion-custom-gift-label").hidden = o.kind !== "gift";
  $("#promotion-custom-gift").required = o.kind === "gift";
  $("#promotion-custom-gift").value = o.giftService;
  $("#promotion-custom-notes").value = o.notes;
  loadPromotionBase();
  $("#promotion-dialog").showModal();
}
function loadPromotionBase() {
  const c = clients.find((c) => c.id === $("#promotion-client").value),
    combo = combos.find((c) => c.id === $("#promotion-source").value);
  $("#promotion-base").value = ((combo?.price ?? c?.price ?? 0) / 100).toFixed(
    2,
  );
  $("#promotion-update-price").disabled = !!combo;
  $("#promotion-update-price").checked = !combo;
  previewPromotion();
}
function selectedPromotion() {
  const offer = promotions.offers.find(
      (o) => o.id === $("#promotion-apply-form").elements.offerId.value,
    ),
    client = clients.find((c) => c.id === $("#promotion-client").value);
  if (!offer || !client)
    throw Error("Selecciona una promoción y un cliente válidos.");
  const custom = {
    ...offer,
    value:
      offer.kind === "gift"
        ? 0
        : cents($("#promotion-custom-value").value || "0"),
    giftService:
      offer.kind === "gift" ? $("#promotion-custom-gift").value.trim() : "",
    notes: $("#promotion-custom-notes").value.trim(),
  };
  validatePromotions({ offers: [custom], applications: [] });
  const result = promotionPrice(cents($("#promotion-base").value), custom),
    combo = combos.find((c) => c.id === $("#promotion-source").value);
  return {
    offer: custom,
    client,
    result,
    service: combo?.services || client.service,
    updateClientPrice: !combo && $("#promotion-update-price").checked,
  };
}
function previewPromotion() {
  try {
    const { offer, result } = selectedPromotion();
    $("#promotion-total").textContent =
      `Base ${money(result.base)} · Descuento ${money(result.discount)} · Precio final ${money(result.final)}${result.gift ? " · Gratis: " + result.gift : ""}`;
    $("#promotion-error").textContent = "";
  } catch (e) {
    $("#promotion-total").textContent =
      "Completa los datos para calcular la oferta.";
    $("#promotion-error").textContent = e.message;
  }
}
$("#promotion-kind").addEventListener("change", promotionKindFields);
$("#promotion-reset").addEventListener("click", () => {
  $("#promotion-form").reset();
  $("#promotion-form").elements.id.value = "";
  promotionKindFields();
});
$("#promotion-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const f = e.target,
      data = Object.fromEntries(new FormData(f));
    const o = {
      id: data.id || createId(),
      name: data.name.trim(),
      kind: data.kind,
      value: data.kind === "gift" ? 0 : cents(data.value || "0"),
      giftService: data.kind === "gift" ? data.giftService.trim() : "",
      notes: data.notes.trim(),
    };
    const next = {
      ...promotions,
      offers: promotions.offers.some((x) => x.id === o.id)
        ? promotions.offers.map((x) => (x.id === o.id ? o : x))
        : [...promotions.offers, o],
    };
    validatePromotions(next);
    if (await persistState({ promotions: next })) {
      promotions = next;
      f.reset();
      f.elements.id.value = "";
      promotionKindFields();
      renderPromotions();
      notify("Promoción guardada.");
    }
  } catch (e) {
    notify(e.message);
  }
});
$("#promotion-client").addEventListener("change", loadPromotionBase);
$("#promotion-source").addEventListener("change", loadPromotionBase);
$("#promotion-apply-form").addEventListener("input", previewPromotion);
$("#promotion-message").addEventListener("click", () => {
  try {
    const { offer, client, result, service } = selectedPromotion();
    $("#promotion-dialog").close();
    openMessage(client);
    $("#message-text").value =
      `Hola ${client.name} 👋\n\n*${offer.name}*\n${service}\nPrecio habitual: ${money(result.base)}\nDescuento: ${money(result.discount)}\n*Precio final: ${money(result.final)}*${result.gift ? "\n🎁 Producto gratis: " + result.gift : ""}\n${offer.notes}\n\n${settings.payments}`;
    updateLink();
  } catch (e) {
    $("#promotion-error").textContent = e.message;
  }
});
$("#promotion-apply-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#promotion-apply-button");
  btn.disabled = true;
  try {
    const { offer, client, result, service, updateClientPrice } =
      selectedPromotion();
    if (
      !confirm(
        `¿Aplicar ${offer.name} a ${client.name}? Precio final ${money(result.final)}${result.gift ? " y regalo " + result.gift : ""}. No cambia cobros anteriores.`,
      )
    )
      return;
    const paid = $("#promotion-paid").checked && result.final > 0,
      ledgerId = paid ? createId() : "",
      a = {
        id: createId(),
        clientId: client.id,
        offerId: offer.id,
        name: offer.name,
        kind: offer.kind,
        value: offer.value,
        giftService: offer.giftService,
        notes: offer.notes,
        service,
        occurredAt: new Date().toISOString(),
        ledgerId,
        updateClientPrice,
        ...result,
      };
    delete a.gift;
    const next = {
        ...promotions,
        applications: [...promotions.applications, a],
      },
      nextClients = updateClientPrice
        ? clients.map((c) =>
            c.id === client.id ? { ...c, price: result.final } : c,
          )
        : clients,
      nextLedger = paid
        ? [
            ...ledger,
            {
              id: ledgerId,
              kind: "sale",
              date: todayLima(),
              description: `Promoción · ${offer.name} · ${client.name}`,
              clientId: client.id,
              service,
              amount: result.final,
            },
          ]
        : ledger;
    validatePromotions(next);
    if (
      await persistState({
        promotions: next,
        clients: nextClients,
        ledger: nextLedger,
      })
    ) {
      promotions = next;
      clients = nextClients;
      ledger = nextLedger;
      $("#promotion-dialog").close();
      render();
      renderModules();
      notify(
        paid
          ? "Promoción aplicada y nuevo cobro registrado."
          : "Promoción aplicada sin registrar ingresos.",
      );
    } else $("#promotion-error").textContent = $("#status").textContent;
  } catch (e) {
    $("#promotion-error").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});
promotionKindFields();

function supplierWhatsappLink(r, label = "WhatsApp") {
  if (!r.supplier?.phone) return null;
  try {
    const a = element("a", label, "button whatsapp");
    a.href = whatsappUrl(
      r.supplier.phone,
      `Hola ${r.supplierName}, quisiera consultar la renovación de ${r.service}${r.expires ? " con vencimiento " + formatDate(r.expires) : ""}${r.cost === null ? "" : ". Importe registrado: " + money(r.cost)}.`,
    );
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  } catch {
    return null;
  }
}
function showSupplierDetail(r) {
  const card = element("article", undefined, "account-card");
  const status = element(
    "span",
    r.label,
    "pill " +
      (r.days !== null && r.days <= 0
        ? "expired"
        : r.days !== null && r.days <= 7
          ? "soon"
          : "none"),
  );
  card.append(
    element("h3", r.service),
    element("p", r.category + (r.detail ? " · " + r.detail : ""), "muted"),
    element("strong", "Proveedor: " + r.supplierName),
    element(
      "p",
      r.supplier
        ? `${r.supplier.phone || "Sin teléfono"}${r.supplier.email ? " · " + r.supplier.email : ""}`
        : "Contacto pendiente en Finanzas",
    ),
    status,
    element(
      "p",
      `Importe del periodo: ${r.cost === null ? "Sin coste registrado" : money(r.cost)}${r.months > 0 ? " / " + r.months + " mes(es)" : r.months === 0 ? " · Pago único" : " · Periodo no configurado"}`,
    ),
    element(
      "small",
      r.monthly === null
        ? "Sin estimación mensual"
        : `${money(r.monthly)} estimados al mes`,
    ),
  );
  if (r.expires)
    card.append(element("small", "Renovación: " + formatDate(r.expires)));
  const actions = element("div", undefined, "actions");
  if (r.supplier?.phone) {
    try {
      const link = element("a", "WhatsApp del proveedor", "button whatsapp");
      link.href = whatsappUrl(
        r.supplier.phone,
        `Hola ${r.supplierName}, quisiera consultar la renovación de ${r.service}${r.expires ? " con vencimiento " + formatDate(r.expires) : ""}${r.cost === null ? "" : ". Importe registrado: " + money(r.cost)}.`,
      );
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      actions.append(link);
    } catch {
      actions.append(
        element("small", "Revisa el número del proveedor en Finanzas."),
      );
    }
  } else
    actions.append(
      element("small", "Añade el teléfono del proveedor para usar WhatsApp."),
    );
  const edit = element("a", "Ver en Finanzas", "button secondary");
  edit.href = "#finance-suppliers";
  actions.append(edit);
  card.append(actions);
  const body = $("#supplier-overview-detail-body");
  body.replaceChildren(card);
  for (const a of body.querySelectorAll('a[href="#finance-suppliers"]'))
    a.addEventListener("click", () => $("#supplier-overview-detail").close());
  $("#supplier-overview-detail").showModal();
}
function renderSupplierOverview() {
  const data = supplierOverview(snapshot(), todayLima());
  $("#supplier-monthly").textContent = money(data.monthly);
  $("#supplier-upcoming").textContent = money(data.dueCost);
  $("#supplier-paid").textContent = money(data.paid);
  $("#supplier-overview-summary").textContent =
    `${data.rows.length} servicios · ${data.upcoming.length} requieren atención${data.unknownMonthly ? " · " + data.unknownMonthly + " sin estimación mensual" : ""}${data.unknownDue ? " · " + data.unknownDue + " importes pendientes de definir" : ""}`;
  const q = $("#supplier-overview-search").value.trim().toLocaleLowerCase(),
    rows = data.rows.filter((r) =>
      [
        r.service,
        r.supplierName,
        r.detail,
        r.supplier?.phone,
        r.supplier?.email,
      ].some((v) => (v || "").toLocaleLowerCase().includes(q)),
    ),
    pages = Math.max(1, Math.ceil(rows.length / 10));
  supplierOverviewPage = Math.min(supplierOverviewPage, pages);
  const list = $("#supplier-overview-rows");
  list.replaceChildren();
  const first = (supplierOverviewPage - 1) * 10;
  for (const r of rows.slice(first, first + 10)) {
    const row = element("tr");
    row.append(element("td", r.service), element("td", r.supplierName));
    const date = element("td");
    date.append(
      element(
        "span",
        r.label,
        "pill " +
          (r.days !== null && r.days <= 0
            ? "expired"
            : r.days !== null && r.days <= 7
              ? "soon"
              : "none"),
      ),
    );
    row.append(
      date,
      element("td", r.cost === null ? "Sin definir" : money(r.cost)),
    );
    const actions = element("td"),
      buttons = element("div", undefined, "actions"),
      wa = supplierWhatsappLink(r);
    if (wa) buttons.append(wa);
    buttons.append(button("Detalle", () => showSupplierDetail(r)));
    actions.append(buttons);
    row.append(actions);
    list.append(row);
  }
  if (!rows.length) {
    const tr = element("tr"),
      td = element(
        "td",
        data.rows.length
          ? "No hay coincidencias."
          : "Añade cuentas o herramientas desde Finanzas.",
        "empty",
      );
    td.colSpan = 5;
    tr.append(td);
    list.append(tr);
  }
  $("#supplier-page-status").textContent = rows.length
    ? `${first + 1}–${Math.min(first + 10, rows.length)} de ${rows.length}`
    : "0 registros";
  $("#supplier-page-prev").disabled = supplierOverviewPage <= 1;
  $("#supplier-page-next").disabled = supplierOverviewPage >= pages;
}
$("#supplier-overview-search").addEventListener("input", () => {
  supplierOverviewPage = 1;
  renderSupplierOverview();
});
$("#supplier-page-prev").addEventListener("click", () => {
  if (supplierOverviewPage > 1) supplierOverviewPage--;
  renderSupplierOverview();
});
$("#supplier-page-next").addEventListener("click", () => {
  supplierOverviewPage++;
  renderSupplierOverview();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderSupplierOverview();
});
