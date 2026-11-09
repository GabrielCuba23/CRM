import { normalizePhone, whatsappUrl } from "./crm.mjs";
import { contactUsername } from "./companions/contact-identity.mjs";

export function whatsappContact(client) {
  let phone = "";
  try {
    phone = normalizePhone(client?.phone || "");
  } catch {
    // An invalid phone can still have an explicit, usable username.
  }
  const username = contactUsername(client);
  return {
    kind: phone ? "phone" : username ? "username" : "missing",
    phone,
    username,
  };
}

export function whatsappMessageLink(client, text) {
  if (typeof text !== "string" || !text.trim())
    throw Error("Escribe un mensaje antes de abrir WhatsApp.");
  if (text.length > 8000)
    throw Error("El mensaje debe tener como máximo 8000 caracteres.");
  const contact = whatsappContact(client);
  if (contact.kind === "missing")
    throw Error("Añade un teléfono válido o un @usuario de WhatsApp al cliente.");
  return {
    ...contact,
    // WhatsApp documents recipient links for phones only. Username contacts
    // use its generic share link; the UI must offer copying the username and
    // selecting the correct conversation manually.
    url: contact.phone
      ? whatsappUrl(contact.phone, text)
      : `https://wa.me/?text=${encodeURIComponent(text)}`,
  };
}

export function conversationEntries(state, clientId) {
  return (state.growth?.interactions || [])
    .filter((i) => i.clientId === clientId && i.network === "WhatsApp")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
export function manualMessage(client, body, kind, id, now = new Date()) {
  if (
    !client?.id ||
    !body.trim() ||
    body.length > 8000 ||
    !["received_manual", "sent_manual"].includes(kind)
  )
    throw Error("Mensaje o cliente no válido.");
  return {
    id,
    name:
      kind === "sent_manual"
        ? "Envío confirmado manualmente"
        : "Mensaje recibido registrado manualmente",
    clientId: client.id,
    network: "WhatsApp",
    kind,
    body: body.trim(),
    agent: "Propietario",
    outcome: kind === "sent_manual" ? "answered" : "open",
    occurredAt: now.toISOString(),
  };
}
