import { normalizePhone } from "../crm.mjs";
import { emptyGrowth, validateGrowth } from "../growth.mjs";
import { contactGroup, contactUsername, normalizeCompanionUsername, normalizeContactPhone } from "./contact-identity.mjs";
export { canonicalUsername, contactGroup, contactKey, contactUsername, normalizeCompanionUsername } from "./contact-identity.mjs";

export const visibleMessageLimit = 100;

// Unlike the legacy CRM form, page context must never guess a country code.
export function normalizeCompanionPhone(value) {
  if (typeof value !== "string")
    throw Error("Indica el teléfono completo con código de país.");
  const raw = value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+") && !raw.startsWith("00") && digits.length < 10)
    throw Error("Indica el teléfono completo con código de país.");
  return normalizePhone(raw);
}

export function matchContact(clients, context = {}) {
  if (!Array.isArray(clients)) throw Error("La lista de clientes no es válida.");
  if (context?.isGroup)
    return { phone: "", matches: [], reason: "group" };
  if (context?.ambiguous)
    return { phone: "", matches: [], reason: "ambiguous-chat" };
  const username = normalizeCompanionUsername(context?.username || context?.whatsappUsername);
  const trustedUsername = username && ["visible", "manual"].includes(context?.usernameSource);
  const usernameRows = trustedUsername ? clients.filter(client => contactUsername(client) === username) : [];
  const usernamePhones = new Set(usernameRows.map(client => normalizeContactPhone(client.phone)).filter(Boolean));
  if (!context?.phone) {
    if (!trustedUsername) return { phone: "", username: "", matches: [], reason: "missing-phone" };
    if (!identity(context.chatId)) return { phone: "", username, matches: [], reason: "unidentified-chat" };
    if (usernamePhones.size > 1) return { phone: "", username, matches: [], reason: "ambiguous-username" };
    const matches = usernameRows.length ? contactGroup(clients, usernameRows[0]) : [];
    return { phone: [...usernamePhones][0] || "", username, matches, matchedBy: "username", reason: matches.length > 1 ? "ambiguous" : matches.length ? "matched" : "new" };
  }
  let phone;
  try {
    phone = normalizeCompanionPhone(context.phone);
  } catch {
    return { phone: "", matches: [], reason: "invalid-phone" };
  }
  // Only an identified chat context can select the customer's services. In
  // particular, typing a number while another named chat is open is not a link.
  if (!identity(context.chatId))
    return { phone: "", matches: [], reason: "unidentified-chat" };
  if (context.phoneSource !== undefined && !["visible", "manual"].includes(context.phoneSource))
    return { phone: "", matches: [], reason: "unverified-phone" };
  if (trustedUsername && (usernamePhones.size > 1 || [...usernamePhones].some(number => number !== phone)))
    return { phone: "", username, matches: [], reason: "identity-conflict" };
  const matches = clients.filter((client) => {
    try {
      return normalizeContactPhone(client?.phone) === phone;
    } catch {
      return false;
    }
  });
  const phoneGroup = matches.length ? contactGroup(clients, matches[0]) : [];
  const usernameGroup = usernameRows.length ? contactGroup(clients, usernameRows[0]) : [];
  if (phoneGroup.length && usernameGroup.length && !usernameGroup.some(row => phoneGroup.some(match => match.id === row.id)))
    return { phone: "", username, matches: [], reason: "identity-conflict" };
  const grouped = phoneGroup.length ? phoneGroup : usernameGroup;
  return {
    phone,
    username: trustedUsername ? username : "",
    matches: grouped,
    matchedBy: phoneGroup.length ? "phone" : usernameGroup.length ? "username" : "phone",
    reason: grouped.length > 1 ? "ambiguous" : grouped.length ? "matched" : "new",
  };
}

function identity(value) {
  return typeof value === "string" && value.trim() && value.length <= 512
    ? value.trim()
    : "";
}

async function entryId(clientId, phone, sourceId, direction) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([clientId, phone, sourceId, direction])),
  );
  return "wa-web-" + Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Import only an explicitly captured, identified direct chat's visible text.
 * Row context is mandatory, so a chat switch cannot attach text to another client.
 * capturedAt is used when the source lacks an unambiguous ISO timestamp; the name
 * then explicitly labels the stored time as capture time, not message send time.
 */
export async function importVisibleMessages(
  growth,
  client,
  context,
  messages,
  { now = new Date(), expectedChatId, clients } = {},
) {
  if (!client?.id || typeof client.id !== "string")
    throw Error("Selecciona una ficha antes de guardar la conversación.");
  if (!context || context.isGroup || context.ambiguous)
    throw Error("Selecciona una conversación individual de WhatsApp.");
  if (context.phone && context.phoneSource !== undefined && !["visible", "manual"].includes(context.phoneSource))
    throw Error("Confirma el teléfono de esta conversación antes de guardar sus mensajes.");
  let phone = "", username = "";
  try {
    if (context.phone) {
      phone = normalizeCompanionPhone(context.phone);
      if (client.phone) {
        if (normalizeContactPhone(client.phone) !== phone) throw Error();
      }
      const result = matchContact(Array.isArray(clients) ? clients : [client], context);
      if (!result.matches.some(row => row.id === client.id)) throw Error();
    } else {
      username = normalizeCompanionUsername(context.username);
      const result = matchContact(Array.isArray(clients) ? clients : [client], context);
      if (!username || !["visible", "manual"].includes(context.usernameSource) || !result.matches.some(row => row.id === client.id)) throw Error();
    }
  } catch {
    throw Error("El teléfono del chat no coincide con la ficha seleccionada.");
  }
  const chatId = identity(context.chatId);
  if (!chatId || (expectedChatId !== undefined && expectedChatId !== chatId))
    throw Error("La conversación cambió. Vuelve a capturar sus mensajes.");
  if (!Array.isArray(messages) || messages.length > visibleMessageLimit)
    throw Error(`Captura como máximo ${visibleMessageLimit} mensajes visibles por vez.`);
  const timestamp = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(timestamp.getTime())) throw Error("Hora de captura no válida.");
  const base = validateGrowth(growth ?? emptyGrowth());
  const selectedGroup = contactGroup(Array.isArray(clients) ? clients : [client], client);
  const storedPhones = new Set(selectedGroup.map(row => normalizeContactPhone(row.phone)).filter(Boolean));
  const sourceIdentity = storedPhones.size === 1 ? [...storedPhones][0] : contactUsername(client) || username || phone;
  const interactions = [...base.interactions];
  const known = new Set(interactions.map((row) => row.id));
  let count = 0, duplicates = 0, skipped = 0;
  for (const message of messages) {
    let rowPhone = "";
    try { rowPhone = normalizeCompanionPhone(message?.phone); } catch {}
    if ((phone ? rowPhone !== phone : rowPhone || normalizeCompanionUsername(message?.username) !== username) || identity(message?.chatId) !== chatId)
      throw Error("Los mensajes no pertenecen a la conversación seleccionada.");
    const sourceId = identity(message?.id || message?.sourceId);
    if (!sourceId || !["received", "sent"].includes(message.direction) ||
        typeof message.body !== "string" || !message.body.trim() ||
        message.body.length > 8000) {
      skipped++;
      continue;
    }
    let occurredAt = timestamp.toISOString(), originalTime = false;
    if (message.occurredAt !== undefined) {
      if (typeof message.occurredAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(message.occurredAt) ||
          !Number.isFinite(Date.parse(message.occurredAt))) {
        skipped++;
        continue;
      }
      occurredAt = new Date(message.occurredAt).toISOString();
      originalTime = true;
    }
    const id = await entryId(client.id, sourceIdentity, sourceId, message.direction);
    if (known.has(id)) {
      duplicates++;
      continue;
    }
    if (interactions.length >= 10000)
      throw Error("El historial alcanzó el límite de este formato. Exporta un respaldo antes de continuar.");
    interactions.push({
      id,
      name: `WhatsApp Web visible · ${message.direction === "sent" ? "saliente" : "entrante"}${originalTime ? "" : " · hora de captura"}`,
      clientId: client.id,
      network: "WhatsApp",
      kind: message.direction === "sent" ? "sent_manual" : "received_manual",
      body: message.body.trim(),
      agent: "WhatsApp Web visible",
      outcome: message.direction === "sent" ? "answered" : "open",
      occurredAt,
    });
    known.add(id);
    count++;
  }
  return {
    growth: validateGrowth({ ...base, interactions }),
    count,
    duplicates,
    skipped,
  };
}
