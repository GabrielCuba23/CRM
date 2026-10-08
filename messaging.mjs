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
