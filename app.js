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
let clients = [],
  templates = [],
  accounts = [],
  combos = [],
  ledger = [],
  settings = { business: "Nexo Streaming", payments: "", dark: false },
  available = true,
  recipient = null;
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
    ledger,
    settings,
    ...overrides,
  };
}
function persistState(overrides = {}) {
  if (!available) {
    notify(
      "El almacenamiento no está disponible. No se guardaron los cambios.",
    );
    return false;
  }
  try {
    const state = validateWorkspace(snapshot(overrides));
    localStorage.setItem(workspaceKey, JSON.stringify(state));
    return true;
  } catch (error) {
    notify(`No se pudieron guardar los cambios: ${error.message}`);
    return false;
  }
}
function persist(key, value) {
  return persistState(
    key === storageKey ? { clients: value } : { templates: value },
  );
}
try {
  const saved = localStorage.getItem(workspaceKey);
  if (saved) {
    const state = validateWorkspace(JSON.parse(saved));
    ({ clients, templates, accounts, combos, ledger, settings } = state);
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
  $("#total").textContent = clients.length;
  const states = clients.map((c) => subscriptionStatus(c.expires));
  $("#active").textContent = states.filter(
    (s) => s === "active" || s === "soon",
  ).length;
  $("#soon").textContent = states.filter((s) => s === "soon").length;
  $("#expired").textContent = states.filter((s) => s === "expired").length;
  const query = $("#search").value.trim().toLocaleLowerCase();
  const matches = clients.filter(
    (c) =>
      [c.name, c.email, c.phone, c.service, c.profile].some((v) =>
        v.toLocaleLowerCase().includes(query),
      ) &&
      ($("#account-filter").value === "all" ||
        c.accountId === $("#account-filter").value) &&
      ($("#filter").value === "all" ||
        subscriptionStatus(c.expires) === $("#filter").value),
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
      element("small", c.phone || "Sin teléfono"),
    );
    const service = element("td");
    service.append(
      element("strong", c.service || "Sin servicio"),
      element("small", c.profile || "Sin perfil"),
    );
    const expiry = element("td");
    const state = subscriptionStatus(c.expires);
    expiry.append(
      element("span", labels[state], `pill ${state}`),
      element("small", formatDate(c.expires)),
    );
    const actions = element("td", undefined, "row-actions");
    actions.append(
      button("Renovar", () => openRenew(c)),
      button("WhatsApp →", () => openMessage(c), "whatsapp"),
      button("Editar", () => editClient(c)),
      button(
        "Eliminar",
        () => {
          if (confirm(`¿Eliminar a ${c.name}?`)) {
            const next = clients.filter((x) => x.id !== c.id);
            if (persist(storageKey, next)) {
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
}
function editClient(c = {}) {
  refreshAccountOptions(c.accountId || "");
  $("#client-form").reset();
  $("#client-error").textContent = "";
  for (const key of [
    "id",
    "name",
    "phone",
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
  $("#client-form").elements.paid.disabled = !!c.id;
  $("#client-dialog").showModal();
}
$("#new-client").addEventListener("click", () => editClient());
$("#client-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    data.name = data.name.trim();
    if (!data.name) throw Error("Introduce el nombre del cliente.");
    data.phone = normalizePhone(data.phone);
    data.price = cents(data.price || "0");
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
    const isNew = !data.id;
    const paid = data.paid === "on";
    delete data.paid;
    data.id ||= createId();
    const next = clients.some((c) => c.id === data.id)
      ? clients.map((c) => (c.id === data.id ? data : c))
      : [...clients, data];
    const nextLedger =
      isNew && paid
        ? [
            ...ledger,
            {
              id: createId(),
              kind: "sale",
              date: todayLima(),
              description: `Venta · ${data.name}`,
              service: data.service,
              amount: data.price,
            },
          ]
        : ledger;
    if (persistState({ clients: next, ledger: nextLedger })) {
      clients = next;
      ledger = nextLedger;
      render();
      $("#client-dialog").close();
      notify("Cliente guardado.");
    }
  } catch (error) {
    $("#client-error").textContent = error.message;
  }
});
$("#search").addEventListener("input", render);
$("#filter").addEventListener("change", render);
$("#account-filter").addEventListener("change", render);
for (const close of document.querySelectorAll(".close"))
  close.addEventListener("click", () => close.closest("dialog").close());
function templateOptions(select, selected) {
  select.replaceChildren(
    ...templates.map((t) => {
      const option = element("option", t.name);
      option.value = t.id;
      return option;
    }),
  );
  if (templates.some((t) => t.id === selected)) select.value = selected;
}
function loadTemplate() {
  const t = templates.find((t) => t.id === $("#template-select").value);
  $("#template-name").value = t.name;
  $("#template-body").value = t.body;
}
function refreshTemplates(selected) {
  templateOptions($("#template-select"), selected);
  templateOptions($("#message-template"));
  loadTemplate();
}
$("#template-select").addEventListener("change", loadTemplate);
$("#template-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#template-name").value.trim(),
    body = $("#template-body").value.trim();
  if (!name || !body) {
    notify("Completa el nombre y el texto de la plantilla.");
    return;
  }
  const id = $("#template-select").value;
  const next = templates.map((t) => (t.id === id ? { id, name, body } : t));
  if (persist(templateKey, next)) {
    templates = next;
    refreshTemplates(id);
    notify("Plantilla guardada.");
  }
});
$("#add-template").addEventListener("click", () => {
  const id = createId();
  const next = [
    ...templates,
    { id, name: "Nueva plantilla", body: "Hola {nombre} 👋" },
  ];
  if (persist(templateKey, next)) {
    templates = next;
    refreshTemplates(id);
    $("#template-name").focus();
  }
});
$("#delete-template").addEventListener("click", () => {
  if (templates.length === 1) {
    notify("Conserva al menos una plantilla.");
    return;
  }
  if (!confirm("¿Eliminar esta plantilla?")) return;
  const next = templates.filter((t) => t.id !== $("#template-select").value);
  if (persist(templateKey, next)) {
    templates = next;
    refreshTemplates();
    notify("Plantilla eliminada.");
  }
});
for (const key of fields)
  $("#variables").append(
    button(
      `{${key}}`,
      () => {
        const input = $("#template-body");
        input.setRangeText(
          `{${key}}`,
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        input.focus();
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
  recipient = c;
  $("#message-password").value = "";
  $("#recipient").textContent = `Para ${c.name} · ${c.phone || "Sin teléfono"}`;
  templateOptions($("#message-template"));
  compose();
  $("#message-dialog").showModal();
}
$("#message-template").addEventListener("change", () => {
  if (confirm("¿Reemplazar el mensaje con la plantilla seleccionada?"))
    compose();
  else $("#message-template").value = messageTemplateId;
});
$("#message-password").addEventListener("input", compose);
$("#message-text").addEventListener("input", updateLink);
$("#open-whatsapp").addEventListener("click", (event) => {
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
$("#message-dialog").addEventListener("close", () => {
  $("#message-password").value = "";
  $("#message-text").value = "";
  $("#open-whatsapp").removeAttribute("href");
  recipient = null;
});
initializeModules();
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
    "expires",
    "capacity",
  ])
    $("#account-form").elements.namedItem(key).value =
      a[key] || (key === "capacity" ? 5 : "");
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
  const use = button("Asignar perfil →", () => useAccount(a));
  use.disabled = !free.length || state === "expired";
  actions.append(use);
  if (!onlyFree)
    actions.append(
      button("Editar", () => editAccount(a)),
      button("Clientes", () => {
        $("#account-filter").value = a.id;
        location.hash = "customers";
        render();
      }),
      button(
        "Eliminar",
        () => {
          if (clients.some((c) => c.accountId === a.id)) {
            notify(
              "Libera o elimina los clientes vinculados antes de eliminar la cuenta.",
            );
            return;
          }
          if (confirm(`¿Eliminar la cuenta ${a.email}?`)) {
            const next = accounts.filter((x) => x.id !== a.id);
            if (persistState({ accounts: next })) {
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
      () => {
        openMessage(c);
        $("#message-template").value = templates.some((t) => t.id === "renew")
          ? "renew"
          : templates[0].id;
        compose();
      },
      "whatsapp",
    ),
    button("Renovar", () => openRenew(c)),
    button(
      "Liberar perfil",
      () => {
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
          if (persistState({ clients: next })) {
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
  $("#nav-clients").textContent = clients.length;
  $("#nav-accounts").textContent = accounts.length;
  $("#nav-free").textContent = accounts
    .filter((a) => subscriptionStatus(a.expires) !== "expired")
    .reduce((sum, a) => sum + availableProfiles(a, clients).length, 0);
  const due = clients
    .filter((c) => ["expired", "soon"].includes(subscriptionStatus(c.expires)))
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
        () => useAccount(a),
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
        button("Preparar oferta", () => {
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
          () => {
            if (confirm(`¿Eliminar ${c.name}?`)) {
              const next = combos.filter((x) => x.id !== c.id);
              if (persistState({ combos: next })) {
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
        const action = element("td");
        action.append(
          button(
            "Eliminar",
            () => {
              if (
                confirm(
                  "¿Eliminar este movimiento? No cambia el vencimiento del cliente.",
                )
              ) {
                const next = ledger.filter((x) => x.id !== m.id);
                if (persistState({ ledger: next })) {
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
  const id = location.hash.slice(1) || "home";
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
  $("#quick-sale").addEventListener("click", () => editClient());
  $("#new-account").addEventListener("click", () => editAccount());
  $("#client-account").addEventListener("change", chooseAccount);
  $("#account-search").addEventListener("input", renderModules);
  $("#renewal-search").addEventListener("input", renderModules);
  $("#finance-month").addEventListener("change", renderFinance);
  $("#account-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const a = Object.fromEntries(new FormData(event.target));
      a.id ||= createId();
      a.service = a.service.trim();
      a.capacity = Number(a.capacity);
      if (!a.service || !validDate(a.expires))
        throw Error("Completa la plataforma y un vencimiento válido.");
      const next = accounts.some((x) => x.id === a.id)
        ? accounts.map((x) => (x.id === a.id ? a : x))
        : [...accounts, a];
      const nextClients = clients.map((c) =>
        c.accountId === a.id ? { ...c, email: a.email, service: a.service } : c,
      );
      if (persistState({ accounts: next, clients: nextClients })) {
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
  $("#renew-form").addEventListener("submit", (event) => {
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
                service: c.service,
                amount,
              },
            ]
          : ledger;
      if (persistState({ clients: next, ledger: nextLedger })) {
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
  $("#new-expense").addEventListener("click", () => {
    $("#expense-form").reset();
    $("#expense-form").elements.date.value = todayLima();
    $("#expense-dialog").showModal();
  });
  $("#expense-form").addEventListener("submit", (event) => {
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
      if (persistState({ ledger: next })) {
        ledger = next;
        renderFinance();
        $("#expense-dialog").close();
        notify("Gasto registrado.");
      }
    } catch (error) {
      notify(error.message);
    }
  });
  $("#combo-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target));
      data.name = data.name.trim();
      data.services = data.services.trim();
      data.price = cents(data.price);
      data.id = createId();
      const next = [...combos, data];
      if (persistState({ combos: next })) {
        combos = next;
        event.target.reset();
        renderModules();
        notify("Combo guardado.");
      }
    } catch (error) {
      notify(error.message);
    }
  });
  $("#offer-form").addEventListener("submit", (event) => {
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
      const phones = [...new Set(selected.map((c) => normalizePhone(c.phone)))];
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
  $("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const next = {
      ...settings,
      business: $("#business-name").value.trim(),
      payments: $("#payment-methods").value.trim(),
    };
    if (persistState({ settings: next })) {
      settings = next;
      notify("Configuración guardada.");
    }
  });
  $("#theme-toggle").addEventListener("click", () => {
    const next = { ...settings, dark: !settings.dark };
    if (persistState({ settings: next })) {
      settings = next;
      document.documentElement.classList.toggle("dark", settings.dark);
    }
  });
  $("#export-data").addEventListener("click", () => {
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
      localStorage.setItem(workspaceKey, JSON.stringify(state));
      ({ clients, templates, accounts, combos, ledger, settings } = state);
      available = true;
      refreshAccountOptions();
      refreshTemplates();
      render();
      $("#business-name").value = settings.business;
      $("#payment-methods").value = settings.payments;
      document.documentElement.classList.toggle("dark", settings.dark);
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
