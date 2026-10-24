import { matchContact, importVisibleMessages, normalizeCompanionPhone } from "./companions/conversations.mjs";

// This module stays inactive on the web and Android. Only the packaged extension
// provides this transport; customer data never enters the WhatsApp page DOM.
export function initializeCompanion({ companion, getState, saveGrowth, openClient, openRenew, openMessage, showClient, notify, isBusy }) {
  if (!companion) return;
  const node = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text) result.textContent = text;
    if (className) result.className = className;
    return result;
  };
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL("./companion-ui.css", import.meta.url).href;
  document.head.append(css);
  const box = node("section", "", "companion-box");
  box.id = "companion-workspace";
  box.setAttribute("aria-label", "Cliente de WhatsApp Web");
  const title = node("h2", "Tu conversación de WhatsApp");
  const identity = node("p", "Abre una conversación individual en WhatsApp Web.");
  const phoneLabel = node("label", "Teléfono internacional de este chat");
  const phone = node("input");
  phone.id = "companion-phone";
  phone.type = "tel";
  phone.placeholder = "Ej. +51 987 654 321";
  phone.autocomplete = "off";
  phoneLabel.append(phone);
  const selectorLabel = node("label", "Ficha / servicio del cliente");
  const selector = node("select");
  selector.id = "companion-client";
  selectorLabel.append(selector);
  const actions = node("div", "", "companion-actions");
  const action = (label, id, fn) => {
    const button = node("button", label, "button secondary");
    button.type = "button";
    button.id = id;
    button.addEventListener("click", () => Promise.resolve().then(fn).catch(report));
    actions.append(button);
    return button;
  };
  const status = node("p", "Selecciona una ficha para trabajar con este chat.", "muted");
  status.id = "companion-status";
  status.setAttribute("role", "status");
  const automaticLabel = node("label", "", "companion-toggle");
  const automatic = node("input");
  automatic.type = "checkbox";
  automatic.id = "companion-auto-capture";
  automaticLabel.append(automatic, document.createTextNode(" Guardar nuevos textos visibles de este chat mientras trabajo"));
  const details = node("small", "Solo se registran textos cargados en la conversación vinculada. Puedes detener el registro en cualquier momento. Los archivos, audios y mensajes anteriores sin cargar permanecen en WhatsApp.");
  box.append(title, identity, phoneLabel, selectorLabel, actions, automaticLabel, details, status);
  document.querySelector("main").prepend(box);
  const banner = document.querySelector("#messages .mode-banner");
  if (banner) banner.textContent = "Conectado mediante la extensión de WhatsApp Web. Vincula el chat y registra sus textos visibles. Revisa y envía los borradores desde WhatsApp.";
  const prepare = document.querySelector("#open-whatsapp");
  if (prepare) prepare.textContent = "Preparar en WhatsApp Web";

  let context = null, busy = false, observedState = null;
  function report(error) {
    automatic.checked = false;
    status.textContent = error?.message || "No se pudo completar la operación.";
    notify(status.textContent);
  }
  function selectedClient() {
    const client = getState().clients.find((item) => item.id === selector.value);
    if (!client) throw Error("Selecciona la ficha de este cliente; si es nuevo, crea y guarda su ficha primero.");
    return client;
  }
  function refreshMatches() {
    const previous = selector.value;
    const contact = { ...context, phone: phone.value };
    const result = matchContact(getState().clients, contact);
    const empty = node("option", "Selecciona la ficha / servicio");
    empty.value = "";
    selector.replaceChildren(empty);
    for (const client of result.matches) {
      const option = node("option", `${client.name} · ${client.service || "Sin servicio"}${client.profile ? " · " + client.profile : ""}`);
      option.value = client.id;
      selector.append(option);
    }
    if (result.matches.some((client) => client.id === previous)) selector.value = previous;
    else if (result.matches.length === 1) selector.value = result.matches[0].id;
    if (selector.value !== previous) automatic.checked = false;
    if (result.reason === "group") status.textContent = "Selecciona una conversación individual para vincular un cliente.";
    else if (!phone.value) status.textContent = "WhatsApp no muestra el teléfono. Escríbelo con código de país y pulsa Vincular este chat.";
    else if (!result.matches.length) status.textContent = "No hay ficha con ese teléfono. Puedes crearla aquí mismo.";
    else if (result.matches.length > 1) status.textContent = "Este teléfono tiene varios servicios. Selecciona la ficha correcta.";
    else status.textContent = "Ficha disponible. Puedes vender, renovar o preparar una respuesta.";
    observedState = getState().clients;
  }
  function updateContext(next) {
    const changed = context?.chatId !== next?.chatId;
    if (changed) automatic.checked = false;
    const changedPhone = context?.phone !== next?.phone;
    context = next;
    identity.textContent = next?.name ? `Chat abierto: ${next.name}${next.isGroup ? " · Grupo" : ""}` : "Abre una conversación individual en WhatsApp Web.";
    if (changed || changedPhone) {
      phone.value = next?.phone || "";
      if (changed) selector.value = "";
      refreshMatches();
    }
  }
  async function currentLinkedContext() {
    const latest = await companion.getContext();
    if (!latest?.chatId || latest.isGroup) throw Error("Abre y vincula una conversación individual.");
    if (!context?.chatId || latest.chatId !== context.chatId) {
      updateContext(latest);
      throw Error("La conversación cambió. Revisa y vincula el chat antes de continuar.");
    }
    const expected = normalizeCompanionPhone(phone.value);
    if (!latest.phone || normalizeCompanionPhone(latest.phone) !== expected)
      throw Error("Pulsa Vincular este chat para confirmar su teléfono antes de registrar mensajes.");
    return latest;
  }
  async function capture() {
    if (busy || isBusy()) return;
    busy = true;
    try {
      const client = selectedClient();
      const linked = await currentLinkedContext();
      const messages = await companion.captureVisibleMessages();
      const after = await companion.getContext();
      if (after?.chatId !== linked.chatId || after?.phone !== linked.phone)
        throw Error("La conversación cambió durante la lectura. No se guardaron mensajes.");
      const result = await importVisibleMessages(getState().growth, client, after, messages, { expectedChatId: linked.chatId });
      if (result.count && !(await saveGrowth(result.growth))) throw Error("No se pudieron guardar los mensajes. Recarga los datos del CRM antes de continuar.");
      status.textContent = result.count ? `${result.count} mensajes guardados en el CRM.` : "Los textos visibles ya están registrados o no contienen mensajes nuevos.";
    } finally { busy = false; }
  }
  action("Actualizar chat", "companion-context-refresh", async () => { updateContext(await companion.getContext()); refreshMatches(); });
  action("Vincular este chat", "companion-bind", async () => {
    if (!context?.chatId || context.isGroup) throw Error("Abre una conversación individual.");
    const normalized = normalizeCompanionPhone(phone.value);
    if (!confirm(`¿Confirmas que la conversación «${context.name || "Chat abierto"}» corresponde al teléfono +${normalized}?`)) return;
    if (!companion.bindConversation) throw Error("Actualiza la extensión para vincular esta conversación.");
    const linked = await companion.bindConversation({ phone: normalized, chatId: context.chatId });
    updateContext(linked?.context || linked || await companion.getContext());
    refreshMatches();
    status.textContent = "Chat vinculado. Selecciona la ficha o crea un cliente nuevo.";
  });
  action("Nuevo cliente / venta", "companion-new-client", async () => {
    const latest = await currentLinkedContext();
    openClient({ name: latest.name || "", phone: normalizeCompanionPhone(latest.phone) });
  });
  action("Ficha completa", "companion-open-client", () => showClient(selectedClient()));
  action("Renovar", "companion-renew", () => {
    const client = selectedClient();
    openRenew(client);
  });
  action("Preparar respuesta / entrega", "companion-compose", () => openMessage(selectedClient()));
  action("Guardar textos visibles", "companion-capture", capture);
  action("Recargar datos del CRM", "companion-reload", () => {
    if (isBusy() || document.querySelector("dialog[open]")) throw Error("Guarda o cierra el formulario abierto antes de recargar.");
    location.reload();
  });
  phone.addEventListener("input", () => { automatic.checked = false; refreshMatches(); });
  selector.addEventListener("change", () => { automatic.checked = false; });
  automatic.addEventListener("change", async () => {
    if (!automatic.checked) { status.textContent = "Registro automático detenido."; return; }
    try {
      selectedClient();
      await currentLinkedContext();
      if (!confirm("¿Guardar en el CRM los nuevos textos visibles de este chat vinculado mientras mantienes abierta la extensión?")) { automatic.checked = false; return; }
      await capture();
    } catch (error) { report(error); }
  });
  if (companion.onContext) companion.onContext(updateContext);
  Promise.resolve().then(() => companion.getContext()).then(updateContext).catch(report);
  const timer = setInterval(async () => {
    if (document.hidden || busy || isBusy()) return;
    try {
      updateContext(await companion.getContext());
      if (observedState !== getState().clients) refreshMatches();
      if (automatic.checked) await capture();
    } catch (error) { if (automatic.checked) report(error); }
  }, 5000);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  return { refresh: refreshMatches };
}
