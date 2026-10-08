export function isFormer(client, today) {
  return client.archived === true || !client.expires || client.expires < today;
}
export function archiveContact(client, at) {
  if (client.archived) return client;
  return {
    ...client,
    archived: true,
    accountId: "",
    profile: "",
    pin: "",
    reminderConsent: false,
    serviceHistory: [
      ...(client.serviceHistory || []),
      {
        id: at,
        service: client.service,
        accountId: client.accountId,
        profile: client.profile,
        expires: client.expires,
        price: client.price,
        endedAt: at,
      },
    ],
  };
}
export function validateLifecycle(c) {
  if (
    (c.archived !== undefined && typeof c.archived !== "boolean") ||
    (c.marketingConsent !== undefined &&
      typeof c.marketingConsent !== "boolean")
  )
    throw Error("Estado de cliente no válido.");
  if (c.archived && c.accountId)
    throw Error("Un cliente archivado no puede ocupar una cuenta.");
  if (
    c.serviceHistory !== undefined &&
    (!Array.isArray(c.serviceHistory) ||
      c.serviceHistory.length > 1000 ||
      !c.serviceHistory.every(
        (r) =>
          r &&
          ["id", "service", "accountId", "profile", "expires", "endedAt"].every(
            (k) => typeof r[k] === "string" && r[k].length <= 8000,
          ) &&
          Number.isSafeInteger(r.price) &&
          r.price >= 0 &&
          r.price <= 99999900 &&
          Number.isFinite(Date.parse(r.endedAt)),
      ))
  )
    throw Error("Historial de servicios no válido.");
}
