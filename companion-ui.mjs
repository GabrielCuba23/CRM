import { matchContact, importVisibleMessages, normalizeCompanionPhone } from "./companions/conversations.mjs";
import { availableProfiles, cents, fillTemplate, formatDate, money, normalizePhone, subscriptionStatus, todayLima } from "./crm.mjs";

// A focused extension surface. The web CRM continues to own its full interface;
// every operation here uses the same validated workspace and revision transport.
export function initializeCompanion({ companion, getState, commit, notify, isBusy = () => false, getLoadError = () => "", reloadWorkspace, openWebCRM }) {
  if (!companion) return;
  const node = (tag, text = "", className = "") => {
    const item = document.createElement(tag);
    if (text !== "") item.textContent = text;
    if (className) item.className = className;
    return item;
  };
  const css = node("link");
  css.rel = "stylesheet";
  css.href = new URL("./companion-ui.css", import.meta.url).href;
  document.head.append(css);
  document.body.classList.add("nexo-compact");
  const root = node("section", "", "compact-workspace");
  root.id = "companion-workspace";
  root.setAttribute("aria-label", "CRM de WhatsApp");
  const toolbar = node("div", "", "compact-toolbar");
  const syncLabel = node("span", "Conectado al CRM", "compact-sync-label");
  const status = node("p", "", "compact-status");
  status.id = "companion-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const navigation = node("nav", "", "compact-tabs");
  navigation.setAttribute("aria-label", "Secciones del CRM");
  const content = node("div", "", "compact-content");
  content.id = "compact-content";
  root.append(toolbar, navigation, status, content);
  document.querySelector("main").prepend(root);

  let tab = "chat", currentContext = null, contextKey = "", contextVersion = 0;
  let openedGroupKey = "", openedAccountId = "", selectedServiceId = "";
  let clientSearch = "", accountSearch = "", linkSearch = "", linkPhone = "";
  let composeClientId = "", localBusy = false, capturing = false, autoCapture = false;
  let visibilityVersion = 0, destroyed = false;
  const drafts = new Map(), openDetails = new Set();
  const labels = { active: "Vigente", soon: "Por vencer", expired: "Vencido", none: "Sin fecha" };
  const tabs = new Map();

  function setStatus(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
    status.hidden = !text;
    if (text) notify?.(text);
  }
  function report(error) {
    const text = error?.message || "No se pudo completar la operación.";
    const formError = document.querySelector(".compact-dialog[open] .compact-form-error");
    if (formError) { formError.textContent = text; formError.scrollIntoView({ block: "nearest" }); }
    else setStatus(text, true);
  }
  function clientById(id) { return getState().clients.find(item => item.id === id); }
  function accountById(id) { return getState().accounts.find(item => item.id === id); }
  function contactPhone(value) { try { return normalizePhone(value); } catch { return ""; } }
  function groupKey(client) { const phone = contactPhone(client.phone); return phone ? "phone:" + phone : "client:" + client.id; }
  function groups() {
    const result = new Map();
    for (const client of getState().clients) {
      const key = groupKey(client);
      if (!result.has(key)) result.set(key, { key, phone: contactPhone(client.phone), clients: [] });
      result.get(key).clients.push(client);
    }
    for (const group of result.values()) group.clients.sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)) || a.name.localeCompare(b.name, "es"));
    return [...result.values()].sort((a, b) => a.clients[0].name.localeCompare(b.clients[0].name, "es"));
  }
  function matchedChat() { return matchContact(getState().clients, currentContext || {}); }
  function chatIdentified() { return Boolean(currentContext?.chatId && !currentContext.isGroup && !currentContext.ambiguous); }
  function clientBelongsToChat(client) {
    const match = matchedChat();
    return chatIdentified() && Boolean(match.phone) && match.matches.some(item => item.id === client?.id);
  }
  async function run(action, button) {
    if (localBusy || isBusy()) return;
    localBusy = true;
    if (button) button.disabled = true;
    syncLabel.textContent = "Guardando…";
    try { return await action(); }
    catch (error) { report(error); }
    finally { localBusy = false; syncLabel.textContent = getLoadError() ? "Datos no disponibles" : "Conectado al CRM"; if (button?.isConnected) button.disabled = false; }
  }
  function button(label, action, className = "compact-secondary", id) {
    const item = node("button", label, className);
    item.type = "button";
    if (id) item.id = id;
    item.addEventListener("click", () => run(() => action(item), item));
    return item;
  }
  function empty(title, text) {
    const box = node("div", "", "compact-empty");
    box.append(node("h3", title), node("p", text));
    return box;
  }
  function details(title, key) {
    const item = node("details", "", "compact-details");
    item.open = openDetails.has(key);
    item.append(node("summary", title));
    item.addEventListener("toggle", () => item.open ? openDetails.add(key) : openDetails.delete(key));
    return item;
  }
  function pill(client) {
    const state = client.archived ? "archived" : subscriptionStatus(client.expires);
    return node("span", client.archived ? "Archivado" : labels[state], "compact-pill " + state);
  }
  function priceText(client) { return client.pricePending ? "Precio sin indicar" : money(client.price || 0); }
  function infoRow(label, value) {
    const row = node("div", "", "compact-info-row");
    row.append(node("span", label), node("strong", value || "Sin indicar"));
    return row;
  }
  function preserveFocus(renderAction) {
    const active = document.activeElement, id = active?.id;
    const restore = Boolean(id && root.contains(active));
    const selection = active && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
    renderAction();
    if (!restore) return;
    const replacement = document.getElementById(id);
    if (replacement && replacement !== active) {
      replacement.focus({ preventScroll: true });
      if (selection && replacement.setSelectionRange) replacement.setSelectionRange(...selection);
    }
  }
  function render() {
    if (destroyed) return;
    for (const [key, item] of tabs) {
      item.setAttribute("aria-current", key === tab ? "page" : "false");
      item.classList.toggle("active", key === tab);
    }
    content.replaceChildren();
    if (getLoadError()) {
      syncLabel.textContent = "Datos no disponibles";
      const problem = empty("No se pudieron cargar tus datos", "Pulsa Actualizar para reintentar. Tus fichas y cuentas permanecen guardadas en el CRM.");
      problem.id = "compact-load-error";
      problem.append(node("p", getLoadError(), "compact-form-error"));
      content.append(problem);
      return;
    }
    syncLabel.textContent = "Conectado al CRM";
    if (tab === "chat") renderChat();
    else if (tab === "clients") renderClients();
    else renderAccounts();
  }
  function changeTab(next) {
    if (tab !== next) visibilityVersion++;
    tab = next;
    if (tab !== "chat") autoCapture = false;
    setStatus("");
    render();
  }
  for (const [key, label] of [["chat", "Chat actual"], ["clients", "Clientes"], ["accounts", "Cuentas"]]) {
    const item = button(label, () => changeTab(key), "compact-tab", "compact-tab-" + key);
    tabs.set(key, item);
    navigation.append(item);
  }
  toolbar.append(syncLabel,
    button("Actualizar", async () => {
      if (document.querySelector(".compact-dialog[open]")) throw Error("Guarda o cierra el formulario antes de actualizar.");
      await reloadWorkspace();
      render();
      setStatus("Datos actualizados.");
    }, "compact-text-button", "compact-refresh"),
    button("Abrir CRM ↗", () => openWebCRM(), "compact-text-button", "compact-open-web"));

  function renderChat() {
    const heading = node("div", "", "compact-chat-heading");
    const match = matchedChat();
    const name = node("h2", match.matches[0]?.name || currentContext?.name || "Tu conversación");
    name.id = "compact-chat-name";
    const phone = node("p", "", "compact-muted");
    phone.id = "compact-chat-phone";
    phone.textContent = match.phone ? "+" + match.phone : "";
    if (match.matches.length && currentContext?.name && currentContext.name !== match.matches[0].name && !contactPhone(currentContext.name))
      phone.textContent += " · WhatsApp: " + currentContext.name;
    heading.append(name, phone);
    content.append(heading);
    if (currentContext?.isGroup) {
      content.append(empty("Abre un chat individual", "Las fichas se muestran en conversaciones con una persona."));
      return;
    }
    if (!chatIdentified()) {
      content.append(empty("Identifica este contacto", currentContext?.name
        ? "Abre la información del contacto en WhatsApp para mostrar su teléfono. Si ya está abierta, ciérrala y vuelve a abrirla. También puedes buscar su ficha en Clientes."
        : "Abre una conversación en WhatsApp para consultar sus servicios."));
      return;
    }
    if (!match.phone) { renderLink(); return; }
    if (!match.matches.length) {
      const box = empty("Cliente nuevo", "Este teléfono todavía no tiene una ficha en el CRM.");
      box.append(button("Crear cliente", () => openClientForm({ name: currentContext.name || "", phone: match.phone }), "compact-primary", "compact-new-client"));
      content.append(box);
      return;
    }
    renderClientDetail({ key: "phone:" + match.phone, phone: match.phone, clients: match.matches }, true);
  }
  function renderLink() {
    const section = node("section", "", "compact-card compact-link-card");
    section.append(node("h3", "Vincular contacto"), node("p", "WhatsApp oculta el número. Elige su ficha o confirma su teléfono una vez.", "compact-muted"));
    const search = node("input");
    search.type = "search";
    search.placeholder = "Buscar cliente por nombre o teléfono";
    search.id = "compact-link-search";
    search.value = linkSearch;
    search.setAttribute("aria-label", "Buscar ficha para vincular");
    const results = node("div", "", "compact-link-results");
    results.id = "compact-link-results";
    function showResults() {
      results.replaceChildren();
      if (!linkSearch.trim()) return;
      const query = linkSearch.toLocaleLowerCase("es");
      for (const group of groups().filter(item => item.phone && item.clients.some(client => `${client.name} ${client.phone}`.toLocaleLowerCase("es").includes(query))).slice(0, 8)) {
        const client = group.clients[0];
        const item = button(`${client.name} · +${group.phone}`, async () => bindPhone(group.phone), "compact-result-button");
        item.dataset.clientId = client.id;
        results.append(item);
      }
      if (!results.childNodes.length) results.append(node("p", "No hay coincidencias.", "compact-muted"));
    }
    search.addEventListener("input", () => { linkSearch = search.value; showResults(); });
    const label = node("label", "O escribe el teléfono", "compact-field");
    const input = node("input");
    input.type = "tel";
    input.id = "compact-link-phone";
    input.placeholder = "+51 987 654 321";
    input.value = linkPhone;
    input.addEventListener("input", () => { linkPhone = input.value; });
    label.append(input);
    const bind = button("Vincular este chat", async () => bindPhone(input.value), "compact-primary", "compact-bind");
    section.append(search, results, label, bind);
    content.append(section);
    showResults();
  }
  async function bindPhone(value) {
    const number = normalizePhone(value), expectedVersion = contextVersion;
    const before = await companion.getContext();
    if (expectedVersion !== contextVersion || !before?.chatId || before.chatId !== currentContext?.chatId || before.isGroup || before.ambiguous)
      throw Error("El chat cambió. Revisa el contacto antes de vincularlo.");
    if (!confirm(`¿Este chat «${before.name || "Contacto"}» corresponde al teléfono +${number}?`)) return;
    await companion.bindConversation({ chatId: before.chatId, phone: number });
    // Binding itself may broadcast a new phone before its RPC returns. Verify
    // the peer and confirmed phone again, rather than treating that as a switch.
    const linked = await companion.getContext();
    if (linked?.chatId !== before.chatId || linked.name !== before.name || linked.isGroup || linked.ambiguous || contactPhone(linked.phone) !== number)
      throw Error("El chat cambió. Revisa la nueva conversación.");
    updateContext(linked);
    render();
    setStatus("Contacto vinculado.");
  }
  function renderClients() {
    if (openedGroupKey) {
      const group = groups().find(item => item.key === openedGroupKey);
      if (group) {
        content.append(button("← Clientes", () => { openedGroupKey = ""; composeClientId = ""; render(); }, "compact-back"));
        renderClientDetail(group, false);
        return;
      }
      openedGroupKey = "";
    }
    const heading = node("div", "", "compact-section-heading");
    heading.append(node("h2", "Clientes"), button("+ Nuevo", () => openClientForm(), "compact-primary", "compact-new-client"));
    const search = node("input");
    search.type = "search";
    search.id = "compact-client-search";
    search.placeholder = "Nombre, teléfono o servicio";
    search.setAttribute("aria-label", "Buscar clientes");
    search.value = clientSearch;
    const list = node("div", "", "compact-list");
    list.id = "compact-client-list";
    function renderList() {
      list.replaceChildren();
      const query = clientSearch.toLocaleLowerCase("es");
      for (const group of groups().filter(item => item.clients.some(client => `${client.name} ${client.phone} ${client.service}`.toLocaleLowerCase("es").includes(query)))) {
        const lead = group.clients[0];
        const item = button("", () => { openedGroupKey = group.key; composeClientId = ""; selectedServiceId = ""; render(); }, "compact-list-item");
        item.dataset.groupKey = group.key;
        const avatar = node("span", lead.name.trim().slice(0, 1).toLocaleUpperCase("es"), "compact-avatar");
        const text = node("span", "", "compact-list-text");
        text.append(node("strong", lead.name), node("small", group.phone ? "+" + group.phone : "Sin teléfono"), node("small", [...new Set(group.clients.map(client => client.service || "Sin servicio"))].join(" · ")));
        item.append(avatar, text, node("span", "›", "compact-chevron"));
        list.append(item);
      }
      if (!list.childNodes.length) list.append(empty("Sin coincidencias", "Crea un cliente o prueba otra búsqueda."));
    }
    search.addEventListener("input", () => { clientSearch = search.value; renderList(); });
    content.append(heading, search, list);
    renderList();
  }
  function renderClientDetail(group, inChat) {
    const lead = group.clients[0];
    if (!inChat) {
      const heading = node("div", "", "compact-person-heading");
      heading.append(node("span", lead.name.slice(0, 1).toLocaleUpperCase("es"), "compact-avatar"), node("div"));
      heading.lastChild.append(node("h2", lead.name), node("p", group.phone ? "+" + group.phone : "Sin teléfono", "compact-muted"));
      heading.append(button("Editar datos", () => openContactForm(group), "compact-text-button", "compact-edit-contact"));
      content.append(heading);
    }
    if (inChat) {
      const contactTools = node("div", "", "compact-contact-tools");
      contactTools.append(node("span", "Datos del cliente", "compact-muted"), button("Editar datos", () => openContactForm(group), "compact-text-button", "compact-edit-contact"));
      content.append(contactTools);
    }
    const top = node("div", "", "compact-section-heading");
    const addService = button("+ Añadir servicio", () => openClientForm({ name: lead.name, phone: lead.phone, whatsappUsername: lead.whatsappUsername || "", lockContact: true }), "compact-text-button", "compact-add-service");
    addService.disabled = !group.phone;
    if (!group.phone) addService.title = "Completa el teléfono en Editar datos para reunir sus servicios en una sola ficha.";
    top.append(node("h3", "Servicios"), addService);
    const services = node("div", "", "compact-services");
    services.id = "compact-services";
    for (const client of group.clients) services.append(serviceCard(client));
    content.append(top, services);
    if (!group.phone) content.append(node("p", "Completa el teléfono en Editar datos para añadir otro servicio a este cliente.", "compact-muted"));
    const info = details("Información e historial", "person:" + group.key);
    if (lead.notes) info.append(node("p", lead.notes, "compact-note"));
    const emails = [...new Set(group.clients.map(client => client.email).filter(Boolean))];
    if (emails.length) info.append(infoRow("Correo", emails.join(" · ")));
    const ids = new Set(group.clients.map(client => client.id));
    const payments = getState().ledger.filter(entry => ids.has(entry.clientId));
    info.append(node("h4", "Pagos registrados"));
    if (!payments.length) info.append(node("p", "Sin pagos registrados.", "compact-muted"));
    for (const entry of payments.slice(-10).reverse()) info.append(infoRow(formatDate(entry.date), money(entry.amount)));
    const history = group.clients.flatMap(client => client.serviceHistory || []);
    if (history.length) {
      info.append(node("h4", "Servicios anteriores"));
      for (const entry of history.slice(-10).reverse()) info.append(infoRow(entry.service || "Servicio", formatDate(entry.expires)));
    }
    content.append(info);
    const active = group.clients.find(client => client.id === composeClientId);
    if (active) renderComposer(active, group);
    const conversation = details("Conversación guardada", "conversation:" + group.key);
    const entries = (getState().growth?.interactions || []).filter(entry => ids.has(entry.clientId) && entry.network === "WhatsApp").sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    if (!entries.length) conversation.append(node("p", "Los mensajes guardados desde WhatsApp aparecerán aquí.", "compact-muted"));
    for (const entry of entries.slice(0, 15)) {
      const row = node("article", "", "compact-conversation-entry");
      row.append(node("small", `${entry.kind === "sent_manual" ? "Saliente" : "Recibido"} · ${new Date(entry.occurredAt).toLocaleString("es-PE", { timeZone: "America/Lima" })}`), node("p", entry.body));
      conversation.append(row);
    }
    if (inChat && chatIdentified()) {
      const options = node("div", "", "compact-capture-options");
      const select = node("select");
      select.id = "compact-capture-service";
      select.setAttribute("aria-label", "Servicio para guardar la conversación");
      for (const client of group.clients) {
        const option = node("option", client.service || "Sin servicio");
        option.value = client.id;
        select.append(option);
      }
      if (group.clients.some(client => client.id === selectedServiceId)) select.value = selectedServiceId;
      else selectedServiceId = select.value;
      select.addEventListener("change", () => { selectedServiceId = select.value; autoCapture = false; });
      const capture = button("Guardar textos visibles", () => captureVisible(), "compact-secondary", "compact-capture");
      const automaticLabel = node("label", "", "compact-check");
      const automatic = node("input");
      automatic.type = "checkbox";
      automatic.id = "compact-auto-capture";
      automatic.checked = autoCapture;
      automatic.addEventListener("change", () => {
        if (!automatic.checked) { autoCapture = false; return; }
        if (!confirm("¿Guardar los nuevos textos visibles de este chat mientras mantienes abierto el panel?")) { automatic.checked = false; return; }
        autoCapture = true;
        void run(() => captureVisible());
      });
      automaticLabel.append(automatic, document.createTextNode(" Guardar nuevos textos mientras trabajo"));
      options.append(select, capture, automaticLabel, node("small", "Solo textos cargados del chat vinculado; se detiene al cambiar de chat u ocultar Nexo.", "compact-muted"));
      conversation.append(options);
    }
    content.append(conversation);
  }
  function serviceCard(client) {
    const card = node("article", "", "compact-card compact-service");
    card.dataset.clientId = client.id;
    const heading = node("div", "", "compact-section-heading");
    heading.append(node("h3", client.service || "Ficha sin servicio"), pill(client));
    const description = node("div", "", "compact-service-data");
    description.append(infoRow("Vence", formatDate(client.expires)), infoRow("Perfil", client.profile || "Sin asignar"), infoRow("Precio", priceText(client)));
    const actions = node("div", "", "compact-service-actions");
    const renew = button(client.archived ? "Reactivar" : "Renovar", () => client.archived ? openClientForm({ ...client, accountId: "", profile: "", expires: "", reactivate: true }) : openRenewForm(client), "compact-primary");
    renew.dataset.action = "renew";
    const compose = button("Mensaje", () => { composeClientId = client.id; render(); document.querySelector("#compact-compose")?.scrollIntoView({ block: "nearest" }); }, "compact-secondary");
    compose.dataset.action = "compose";
    const more = node("details", "", "compact-service-more");
    const summary = node("summary", "⋯");
    summary.setAttribute("aria-label", "Más acciones de " + (client.service || client.name));
    const menu = node("div", "", "compact-more-menu");
    const edit = button("Editar servicio", () => openClientForm(client), "compact-text-button");
    edit.dataset.action = "edit";
    const archive = button("Archivar y liberar perfil", async () => {
      if (!confirm(`¿Archivar ${client.service || "este servicio"} de ${client.name}? Se libera su perfil y se conserva su historial.`)) return;
      await commit("archiveClient", { id: client.id });
      render();
      setStatus("Servicio archivado y perfil liberado.");
    }, "compact-text-button");
    archive.dataset.action = "archive";
    archive.disabled = Boolean(client.archived);
    const remove = button("Eliminar servicio", async () => {
      if (!confirm(`¿Eliminar definitivamente la ficha de ${client.service || "este servicio"} de ${client.name}? Los movimientos financieros se conservan.`)) return;
      await commit("deleteClient", { id: client.id });
      if (composeClientId === client.id) composeClientId = "";
      render();
      setStatus("Ficha de servicio eliminada.");
    }, "compact-danger");
    remove.dataset.action = "delete";
    menu.append(edit, archive, remove);
    more.append(summary, menu);
    actions.append(renew, compose, more);
    card.append(heading, description, actions);
    return card;
  }
  function renderComposer(client, group) {
    const box = node("section", "", "compact-card compact-compose");
    box.id = "compact-compose";
    box.append(node("h3", "Mensaje al cliente"));
    const service = node("select");
    service.id = "compact-compose-service";
    service.setAttribute("aria-label", "Servicio del mensaje");
    for (const item of group.clients) {
      const option = node("option", item.service || "Sin servicio");
      option.value = item.id;
      service.append(option);
    }
    service.value = client.id;
    service.addEventListener("change", () => { composeClientId = service.value; render(); });
    const template = node("select");
    template.id = "compact-template";
    template.setAttribute("aria-label", "Plantilla del mensaje");
    template.append(node("option", "Mensaje libre"));
    template.firstChild.value = "";
    for (const item of getState().templates) {
      const option = node("option", item.name);
      option.value = item.id;
      template.append(option);
    }
    let draft = drafts.get(client.id);
    if (!draft) {
      const first = getState().templates.find(item => item.id === "welcome") || getState().templates[0];
      const generated = first ? fillTemplate(first.body, client, accountById(client.accountId)?.password || "", getState().settings) : "";
      draft = { template: first?.id || "", text: generated, generated };
      drafts.set(client.id, draft);
    } else if (draft.template && draft.text === draft.generated) {
      const currentTemplate = getState().templates.find(item => item.id === draft.template);
      if (currentTemplate) {
        draft.generated = fillTemplate(currentTemplate.body, client, accountById(client.accountId)?.password || "", getState().settings);
        draft.text = draft.generated;
      }
    }
    template.value = draft.template;
    const text = node("textarea");
    text.id = "compact-message-text";
    text.rows = 7;
    text.maxLength = 8000;
    text.placeholder = "Escribe tu mensaje…";
    text.setAttribute("aria-label", "Mensaje editable");
    text.value = draft.text;
    text.addEventListener("input", () => { draft.text = text.value; });
    template.addEventListener("change", () => {
      const selected = getState().templates.find(item => item.id === template.value);
      if (draft.text.trim() && !confirm("¿Reemplazar el mensaje con esta plantilla?")) { template.value = draft.template; return; }
      draft.template = template.value;
      draft.text = selected ? fillTemplate(selected.body, clientById(client.id) || client, accountById(client.accountId)?.password || "", getState().settings) : "";
      draft.generated = draft.text;
      text.value = draft.text;
    });
    const actions = node("div", "", "compact-compose-actions");
    actions.append(button("Copiar", async () => {
      if (!draft.text.trim()) throw Error("Escribe un mensaje antes de copiarlo.");
      await companion.copyText(draft.text);
      setStatus("Mensaje copiado.");
    }, "compact-secondary", "compact-copy-message"), button("Preparar en WhatsApp", async () => {
      const freshClient = clientById(client.id);
      if (!freshClient) throw Error("La ficha ya no está disponible.");
      await requireLinked(freshClient);
      if (!draft.text.trim()) throw Error("Escribe el mensaje antes de prepararlo.");
      const result = await companion.prepareMessage({ phone: normalizeCompanionPhone(freshClient.phone), text: draft.text });
      if (result?.prepared) setStatus("Borrador preparado. Revisa y pulsa Enviar en WhatsApp.");
      else if (result?.clipboard) setStatus("Había un borrador. Se conservó y el mensaje nuevo se copió para que lo pegues.");
      else throw Error("No se pudo preparar el mensaje. Puedes copiarlo y pegarlo en el chat correcto.");
    }, "compact-primary", "compact-prepare-message"));
    box.append(service, template, text, actions, node("small", "El envío lo confirmas en WhatsApp.", "compact-muted"));
    if (!clientBelongsToChat(client)) box.append(node("p", "Abre el chat de este cliente para preparar el mensaje. Puedes copiarlo ahora.", "compact-muted"));
    content.append(box);
  }

  function renderAccounts() {
    const selected = accountById(openedAccountId);
    if (selected) { renderAccountDetail(selected); return; }
    openedAccountId = "";
    const heading = node("div", "", "compact-section-heading");
    heading.append(node("h2", "Cuentas"), button("+ Nueva", () => openAccountForm(), "compact-primary", "compact-new-account"));
    const search = node("input");
    search.id = "compact-account-search";
    search.type = "search";
    search.placeholder = "Plataforma o correo";
    search.setAttribute("aria-label", "Buscar cuentas");
    search.value = accountSearch;
    const list = node("div", "", "compact-list");
    list.id = "compact-account-list";
    const renderList = () => {
      list.replaceChildren();
      for (const account of getState().accounts.filter(item => `${item.service} ${item.email}`.toLocaleLowerCase("es").includes(accountSearch.toLocaleLowerCase("es")))) {
        const free = availableProfiles(account, getState().clients);
        const expired = subscriptionStatus(account.expires) === "expired";
        const item = button("", () => { openedAccountId = account.id; render(); }, "compact-list-item");
        item.dataset.accountId = account.id;
        const label = node("span", "", "compact-list-text");
        label.append(node("strong", account.service), node("small", account.email), node("small", expired ? "Cuenta vencida · Renueva para asignar" : `${free.length} libres · ${account.capacity - free.length} ocupados`, expired ? "compact-expired-hint" : ""));
        item.append(label, node("span", "›", "compact-chevron"));
        list.append(item);
      }
      if (!list.childNodes.length) list.append(empty(getState().accounts.length ? "Sin coincidencias" : "Sin cuentas registradas", getState().accounts.length ? "Prueba otra búsqueda." : "Crea una cuenta con su capacidad real y vencimiento para gestionar sus perfiles."));
    };
    search.addEventListener("input", () => { accountSearch = search.value; renderList(); });
    content.append(heading, search, list);
    renderList();
  }
  function renderAccountDetail(account) {
    const section = node("section", "", "compact-account-detail");
    section.id = "compact-account-detail";
    const back = button("← Cuentas", () => { openedAccountId = ""; render(); }, "compact-back");
    const heading = node("div", "", "compact-section-heading");
    heading.append(node("h2", account.service), button("Editar", () => openAccountForm(account), "compact-secondary", "compact-edit-account"));
    const statusName = subscriptionStatus(account.expires);
    section.append(back, heading, node("p", account.email, "compact-account-email"), infoRow("Vence", formatDate(account.expires)), node("span", labels[statusName], "compact-pill " + statusName));
    if (statusName === "expired") section.append(node("p", "Renueva esta cuenta para poder asignar perfiles.", "compact-expired-hint"));
    const accountInfo = details("Datos de la cuenta", "account:" + account.id);
    if (account.provider) accountInfo.append(infoRow("Proveedor", account.provider));
    if (account.password) {
      const password = node("input");
      password.type = "password";
      password.value = account.password;
      password.readOnly = true;
      password.autocomplete = "off";
      password.setAttribute("aria-label", "Contraseña de la cuenta");
      const toggle = button("Mostrar contraseña", () => {
        const visible = password.type === "password";
        password.type = visible ? "text" : "password";
        toggle.textContent = visible ? "Ocultar contraseña" : "Mostrar contraseña";
      }, "compact-text-button");
      accountInfo.append(password, toggle);
    }
    section.append(accountInfo);
    const profileHeading = node("div", "", "compact-section-heading");
    profileHeading.append(node("h3", `Perfiles · ${account.capacity}`), button("+ Añadir perfil", async () => {
      const latest = accountById(account.id);
      if (!latest) throw Error("La cuenta ya no está disponible.");
      if (latest.capacity >= 50) throw Error("La cuenta alcanzó el máximo de 50 perfiles.");
      if (!confirm(`¿Confirmas que esta cuenta admite ${latest.capacity + 1} perfiles?`)) return;
      await commit("setCapacity", { id: latest.id, capacity: latest.capacity + 1 });
      render();
      setStatus("Perfil añadido.");
    }, "compact-text-button", "compact-add-profile"));
    section.append(profileHeading);
    for (let index = 1; index <= account.capacity; index++) {
      const profile = "Perfil " + index;
      const occupant = getState().clients.find(client => client.accountId === account.id && client.profile === profile);
      const row = node("article", "", "compact-profile");
      row.dataset.profile = profile;
      row.dataset.status = occupant ? "occupied" : "free";
      row.classList.toggle("is-ineligible", !occupant && statusName === "expired");
      const text = node("div");
      text.append(node("strong", profile), node("small", occupant ? occupant.name : statusName === "expired" ? "Sin asignar · cuenta vencida" : "Libre"));
      row.append(text);
      if (occupant) row.append(button("Ver ficha", () => { tab = "clients"; openedGroupKey = groupKey(occupant); render(); }, "compact-text-button"));
      else {
        const assign = button("Asignar", () => {
          const match = matchedChat();
          const lead = match.matches[0];
          openClientForm({ name: lead?.name || (match.phone ? currentContext?.name || "" : ""), phone: match.phone || "", lockContact: Boolean(lead), accountId: account.id, profile, email: account.email, service: account.service });
        }, "compact-secondary");
        assign.disabled = statusName === "expired";
        if (assign.disabled) assign.title = "Renueva la cuenta antes de asignar perfiles";
        row.append(assign);
      }
      section.append(row);
    }
    const remove = button("Eliminar cuenta", async () => {
      if (getState().clients.some(client => client.accountId === account.id)) throw Error("Libera los perfiles ocupados antes de eliminar la cuenta.");
      if (!confirm(`¿Eliminar la cuenta ${account.email}?`)) return;
      await commit("deleteAccount", { id: account.id });
      openedAccountId = "";
      render();
      setStatus("Cuenta eliminada.");
    }, "compact-danger", "compact-delete-account");
    remove.disabled = getState().clients.some(client => client.accountId === account.id);
    if (remove.disabled) remove.title = "Libera los perfiles ocupados antes de eliminar la cuenta";
    section.append(remove);
    content.append(section);
  }

  function field(form, label, name, options = {}) {
    const wrapper = node("label", label, "compact-field");
    const input = node(options.tag || "input");
    input.name = name;
    if (options.tag !== "select" && options.tag !== "textarea") input.type = options.type || "text";
    for (const [key, value] of Object.entries(options)) if (!["tag", "value"].includes(key)) input[key] = value;
    if (options.value !== undefined) input.value = options.value;
    input.id = `${form.id}-${name}`;
    wrapper.append(input);
    form.append(wrapper);
    return input;
  }
  function modal(name, title, submitLabel, onSubmit) {
    const dialog = node("dialog", "", "compact-dialog");
    dialog.id = `compact-${name}-dialog`;
    const form = node("form", "", "compact-form");
    form.id = `compact-${name}-form`;
    const heading = node("div", "", "compact-section-heading");
    heading.append(node("h2", title), button("×", () => dialog.close(), "compact-close"));
    heading.lastChild.setAttribute("aria-label", "Cerrar formulario");
    const body = node("div", "", "compact-form-body");
    const error = node("p", "", "compact-form-error");
    error.id = `compact-${name}-error`;
    error.setAttribute("role", "alert");
    const footer = node("div", "", "compact-form-footer");
    const submit = node("button", submitLabel, "compact-primary");
    submit.type = "submit";
    footer.append(button("Cancelar", () => dialog.close(), "compact-secondary"), submit);
    form.append(heading, body, error, footer);
    dialog.append(form);
    document.body.append(dialog);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (localBusy || isBusy()) return;
      localBusy = true;
      submit.disabled = true;
      error.textContent = "";
      try {
        await onSubmit(form);
        dialog.close();
        render();
      } catch (cause) {
        error.textContent = cause?.message || "No se guardaron los cambios.";
        error.scrollIntoView({ block: "nearest" });
      } finally { localBusy = false; submit.disabled = false; }
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.addEventListener("cancel", () => {});
    return { dialog, form, body };
  }
  function formData(form) { return Object.fromEntries(new FormData(form)); }
  function openContactForm(group) {
    const lead = group.clients[0], ids = group.clients.map(client => client.id);
    const { dialog, body } = modal("contact", "Datos del cliente", "Guardar datos", async form => {
      const values = formData(form);
      await commit("updateContact", { ids, name: values.name.trim(), phone: values.phone.trim(), whatsappUsername: values.whatsappUsername.trim() });
      openedGroupKey = values.phone.trim() ? "phone:" + normalizePhone(values.phone) : "client:" + lead.id;
      setStatus("Datos actualizados en todos los servicios del cliente.");
    });
    field(body, "Nombre", "name", { required: true, maxLength: 120, value: lead.name, autocomplete: "name" });
    field(body, "WhatsApp", "phone", { type: "tel", value: lead.phone, required: ids.length > 1, placeholder: "+51 987 654 321", autocomplete: "tel" });
    const extra = node("details", "", "compact-details");
    extra.append(node("summary", "Más opciones"));
    field(extra, "Usuario de WhatsApp · opcional", "whatsappUsername", { maxLength: 100, value: lead.whatsappUsername || "", placeholder: "@usuario" });
    const remove = button("Eliminar cliente y sus servicios", async () => {
      if (!confirm(`¿Eliminar definitivamente a ${lead.name} y sus ${ids.length} ficha${ids.length === 1 ? "" : "s"} de servicio? Los movimientos financieros se conservan.`)) return;
      await commit("deleteContact", { ids });
      openedGroupKey = "";
      composeClientId = "";
      dialog.close();
      render();
      setStatus("Cliente y fichas de servicio eliminados.");
    }, "compact-danger", "compact-delete-contact");
    extra.append(remove);
    body.append(extra);
    dialog.showModal();
  }
  function openClientForm(initial = {}) {
    const editing = Boolean(initial.id), reactivating = Boolean(initial.reactivate);
    const { dialog, form, body } = modal("client", reactivating ? "Reactivar servicio" : editing ? "Editar servicio" : initial.lockContact ? "Añadir servicio" : "Nuevo cliente", "Guardar", async inputForm => {
      const values = formData(inputForm);
      const pricePending = !values.price.trim();
      await commit("saveClient", { ...(editing ? { id: initial.id } : {}), name: values.name.trim(), phone: values.phone.trim(), accountId: values.accountId || "", service: values.service.trim(), email: values.email.trim(), profile: values.profile.trim(), expires: values.expires || "", price: pricePending ? 0 : cents(values.price), pricePending, pin: values.pin.trim(), notes: values.notes.trim(), paid: values.paid === "on", ...(reactivating ? { reactivate: true } : {}) });
      setStatus(editing ? "Servicio actualizado." : "Ficha guardada.");
    });
    // The form's initial contact stays fixed if WhatsApp changes while it is open.
    const name = field(body, "Nombre", "name", { value: initial.name || "", required: true, maxLength: 120, autocomplete: "name" });
    const phone = field(body, "WhatsApp", "phone", { value: initial.phone || "", type: "tel", placeholder: "+51 987 654 321", autocomplete: "tel" });
    name.id = "compact-client-name";
    phone.id = "compact-client-phone";
    name.readOnly = editing || Boolean(initial.lockContact);
    phone.readOnly = editing || Boolean(initial.lockContact);
    if (name.readOnly) name.title = "Edita la información de todos sus servicios desde Editar datos";
    if (phone.readOnly) phone.title = name.title;
    const account = field(body, "Cuenta", "accountId", { tag: "select" });
    account.id = "compact-client-account";
    const none = node("option", "Sin cuenta asignada");
    none.value = "";
    account.append(none);
    for (const item of getState().accounts) {
      const option = node("option", `${item.service} · ${item.email}`);
      option.value = item.id;
      option.disabled = subscriptionStatus(item.expires) === "expired" && item.id !== initial.accountId;
      account.append(option);
    }
    account.value = initial.accountId || "";
    const service = field(body, "Servicio", "service", { value: initial.service || "", maxLength: 80, placeholder: "Netflix, Disney+, Max…" });
    const profileWrap = node("div", "", "compact-profile-field");
    const profile = field(profileWrap, "Perfil", "profile", { value: initial.profile || "", maxLength: 80, placeholder: "Nombre o número del perfil" });
    body.append(profileWrap);
    const profileSelect = node("select");
    profileSelect.id = "compact-client-profile-select";
    profileSelect.setAttribute("aria-label", "Perfil libre de la cuenta");
    profileWrap.append(profileSelect);
    const expires = field(body, "Vencimiento", "expires", { type: "date", value: initial.expires || "" });
    const price = field(body, "Precio (S/) · opcional", "price", { type: "number", min: "0", max: "999999", step: "0.01", value: initial.pricePending || initial.price === undefined ? "" : (initial.price / 100).toFixed(2), placeholder: "Sin indicar" });
    const extras = node("details", "", "compact-details");
    extras.append(node("summary", "Correo, PIN y notas"));
    const email = field(extras, "Correo de acceso", "email", { type: "email", maxLength: 254, value: initial.email || "" });
    field(extras, "PIN", "pin", { maxLength: 20, value: initial.pin || "", autocomplete: "off" });
    field(extras, "Notas", "notes", { tag: "textarea", rows: 2, maxLength: 1000, value: initial.notes || "" });
    body.append(extras);
    if (!editing || reactivating) {
      const paidLabel = node("label", "", "compact-check");
      const paid = node("input");
      paid.name = "paid";
      paid.type = "checkbox";
      paid.addEventListener("change", () => { price.required = paid.checked; });
      paidLabel.append(paid, document.createTextNode(" Registrar como cobrado"));
      body.append(paidLabel);
    }
    function selectAccount(keepProfile = false) {
      const selected = accountById(account.value);
      profileSelect.replaceChildren();
      profileSelect.hidden = !selected;
      profile.closest("label").hidden = Boolean(selected);
      service.readOnly = Boolean(selected);
      email.readOnly = Boolean(selected);
      if (!selected) return;
      const free = availableProfiles(selected, getState().clients.filter(item => item.id !== initial.id));
      for (const value of free) { const option = node("option", value); option.value = value; profileSelect.append(option); }
      if (keepProfile && free.includes(initial.profile)) profileSelect.value = initial.profile;
      profile.value = profileSelect.value || "";
      service.value = selected.service;
      email.value = selected.email;
      if (!free.length) { const option = node("option", "Sin perfiles libres"); option.value = ""; profileSelect.append(option); }
    }
    account.addEventListener("change", () => selectAccount(false));
    profileSelect.addEventListener("change", () => { profile.value = profileSelect.value; });
    selectAccount(true);
    dialog.showModal();
    (name.value ? expires : name).focus();
  }
  function openRenewForm(client) {
    const { dialog, body } = modal("renew", `Renovar ${client.service || "servicio"}`, "Confirmar renovación", async form => {
      const values = formData(form);
      await commit("renewClient", { id: client.id, expires: values.expires, amount: values.amount.trim() ? cents(values.amount) : null, paid: values.paid === "on" });
      setStatus("Servicio renovado.");
    });
    body.append(node("p", client.name, "compact-muted"));
    const base = client.expires && client.expires > todayLima() ? client.expires : todayLima();
    const next = new Date(base + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 30);
    field(body, "Nuevo vencimiento", "expires", { type: "date", required: true, value: next.toISOString().slice(0, 10) });
    const amount = field(body, "Importe (S/) · opcional", "amount", { type: "number", min: "0", max: "999999", step: "0.01", value: client.pricePending ? "" : ((client.price || 0) / 100).toFixed(2) });
    const paidLabel = node("label", "", "compact-check");
    const paid = node("input");
    paid.type = "checkbox";
    paid.name = "paid";
    paid.addEventListener("change", () => { amount.required = paid.checked; });
    paidLabel.append(paid, document.createTextNode(" Registrar cobro en finanzas"));
    body.append(paidLabel);
    dialog.showModal();
  }
  function openAccountForm(initial = {}) {
    const { dialog, body } = modal("account", initial.id ? "Editar cuenta" : "Nueva cuenta", "Guardar cuenta", async form => {
      const values = formData(form);
      await commit("saveAccount", { ...(initial.id ? { id: initial.id } : {}), service: values.service.trim(), email: values.email.trim(), password: values.password, provider: values.provider.trim(), expires: values.expires, capacity: Number(values.capacity) });
      setStatus(initial.id ? "Cuenta actualizada." : "Cuenta creada.");
    });
    field(body, "Plataforma", "service", { required: true, maxLength: 80, value: initial.service || "", placeholder: "Netflix" });
    field(body, "Correo de acceso", "email", { type: "email", required: true, maxLength: 254, value: initial.email || "" });
    field(body, "Vencimiento de la cuenta", "expires", { type: "date", required: true, value: initial.expires || "" });
    field(body, "Capacidad real de perfiles", "capacity", { type: "number", required: true, min: "1", max: "50", step: "1", value: initial.capacity ?? "", placeholder: "Sin indicar" });
    const extra = node("details", "", "compact-details");
    extra.append(node("summary", "Contraseña y proveedor"));
    field(extra, "Contraseña", "password", { type: "password", autocomplete: "new-password", maxLength: 512, value: initial.password || "" });
    field(extra, "Proveedor", "provider", { maxLength: 120, value: initial.provider || "" });
    body.append(extra);
    dialog.showModal();
  }

  async function requireLinked(client) {
    const before = await companion.getContext();
    if (!before?.chatId || before.isGroup || before.ambiguous) throw Error("Abre una conversación individual de WhatsApp.");
    let expected = "", actual = "";
    try { expected = normalizeCompanionPhone(client.phone); actual = normalizeCompanionPhone(before.phone); } catch {}
    if (!expected || expected !== actual) throw Error("Abre y vincula el chat de este cliente antes de preparar o guardar mensajes.");
    if (before.chatId !== currentContext?.chatId) { updateContext(before); throw Error("La conversación cambió. Revisa el destinatario."); }
    return before;
  }
  async function captureVisible() {
    if (capturing) return;
    capturing = true;
    const version = contextVersion, visibleVersion = visibilityVersion, targetId = selectedServiceId;
    const assertCurrent = () => {
      if (version !== contextVersion || visibleVersion !== visibilityVersion || targetId !== selectedServiceId || companion.isVisible?.() === false || tab !== "chat" || document.querySelector(".compact-dialog[open]")) throw Error("La captura se detuvo al cambiar de chat, ficha o vista.");
    };
    try {
      const client = clientById(selectedServiceId);
      if (!client) throw Error("Selecciona el servicio de esta conversación.");
      assertCurrent();
      const before = await requireLinked(client);
      assertCurrent();
      const messages = await companion.captureVisibleMessages();
      assertCurrent();
      const after = await companion.getContext();
      assertCurrent();
      if (after?.chatId !== before.chatId || after?.phone !== before.phone) throw Error("El chat cambió durante la lectura.");
      const result = await importVisibleMessages(getState().growth, client, after, messages, { expectedChatId: before.chatId });
      assertCurrent();
      if (result.count) await commit("saveGrowth", { growth: result.growth });
      setStatus(result.count ? `${result.count} mensajes guardados.` : "Los textos visibles ya estaban guardados.");
      render();
    } catch (error) { autoCapture = false; throw error; }
    finally { capturing = false; }
  }
  function identityKey(context) {
    // Names help clear transient UI drafts, never establish customer identity.
    return JSON.stringify([context?.tabId ?? null, context?.chatId || "", context?.name || "", context?.phone || "", Boolean(context?.isGroup), Boolean(context?.ambiguous), context?.phoneSource || "", context?.identityState || ""]);
  }
  function updateContext(next) {
    if (destroyed) return;
    const key = identityKey(next);
    currentContext = next || null;
    if (key === contextKey) return;
    contextKey = key;
    contextVersion++;
    autoCapture = false;
    selectedServiceId = "";
    linkPhone = "";
    linkSearch = "";
    composeClientId = "";
    if (tab === "chat") setStatus("");
    render();
  }
  companion.onContext?.(updateContext);
  document.addEventListener("nexo-companion-visibility", event => {
    if (event.detail?.visible === false) {
      visibilityVersion++;
      autoCapture = false;
      const checkbox = document.querySelector("#compact-auto-capture");
      if (checkbox) checkbox.checked = false;
    }
  });
  Promise.resolve().then(() => companion.getContext()).then(updateContext).catch(report);
  const contextTimer = setInterval(async () => {
    if (destroyed || document.hidden || companion.isVisible?.() === false) return;
    let capturingAutomatically = false;
    try {
      updateContext(await companion.getContext());
      if (autoCapture && !capturing && !localBusy && !isBusy() && !document.querySelector(".compact-dialog[open]")) {
        capturingAutomatically = true;
        await captureVisible();
      }
    } catch (error) { if (autoCapture || capturingAutomatically) { autoCapture = false; report(error); } }
  }, 1200);
  window.addEventListener("pagehide", () => { destroyed = true; clearInterval(contextTimer); autoCapture = false; drafts.clear(); }, { once: true });
  render();
  return { refresh: () => preserveFocus(render), isBusy: () => localBusy || capturing };
}
