import { validatePurchaseLinks } from "../procurement.mjs";
import { emptyGrowth, validateGrowth } from "../growth.mjs";
import { defaultTemplates, validateWorkspace, validDate } from "../crm.mjs";
export function emptyState() {
  return {
    version: 2,
    rules: [],
    taskReceipts: [],
    clients: [],
    accounts: [],
    combos: [],
    ledger: [],
    templates: structuredClone(defaultTemplates),
    settings: { business: "Nexo Streaming", payments: "", dark: false },
    automation: {
      enabled: false,
      templateName: "",
      language: "es",
      parameters: ["nombre", "servicio", "vence"],
      hour: 9,
    },
  };
}
export function cleanState(raw) {
  validateWorkspace(raw);
  const keys = {
    clients: [
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
      "reminderConsent",
    ],
    accounts: [
      "id",
      "service",
      "email",
      "provider",
      "expires",
      "capacity",
      "password",
      "supplierId",
      "offerId",
      "costCents",
      "costIntervalMonths",
    ],
    templates: ["id", "name", "body", "context"],
    combos: ["id", "name", "services", "price"],
    ledger: [
      "id",
      "description",
      "date",
      "service",
      "kind",
      "amount",
      "clientId",
      "supplierId",
      "offerId",
      "accountId",
      "category",
      "reference",
    ],
  };
  const state = {
    procurement: validatePurchaseLinks(raw),
    growth: validateGrowth(raw.growth || emptyGrowth()),
    version: 2,
    settings: Object.fromEntries(
      ["business", "payments", "dark", "crmName", "logoDataUrl"]
        .filter((k) => raw.settings[k] !== undefined)
        .map((k) => [k, raw.settings[k]]),
    ),
    automation: raw.automation || emptyState().automation,
  };
  for (const [collection, fields] of Object.entries(keys)) {
    if (raw[collection].length > 10000)
      throw Error("Hay demasiados registros para este formato.");
    state[collection] = raw[collection].map((row) => {
      for (const field of fields) {
        const value = row[field];
        if (typeof value === "string" && value.length > 8000)
          throw Error("Un campo supera el tamaño permitido.");
      }
      if (
        "price" in row &&
        (!Number.isSafeInteger(row.price) || row.price > 99999900)
      )
        throw Error("Precio fuera de rango.");
      if (
        "amount" in row &&
        (!Number.isSafeInteger(row.amount) || row.amount > 99999900)
      )
        throw Error("Importe fuera de rango.");
      if ("expires" in row && row.expires && !validDate(row.expires))
        throw Error("Fecha no válida.");
      if (
        collection === "ledger" &&
        (!["sale", "renewal", "expense"].includes(row.kind) ||
          !validDate(row.date))
      )
        throw Error("Movimiento no válido.");
      return Object.fromEntries(
        fields.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]),
      );
    });
  }
  state.rules = (raw.rules || []).map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    templateId: r.templateId,
    delivery: r.delivery,
    daysBefore: r.daysBefore,
    hour: r.hour,
    services: [...r.services],
    meta: {
      templateName: r.meta.templateName,
      language: r.meta.language,
      parameters: [...r.meta.parameters],
    },
  }));
  state.taskReceipts = (raw.taskReceipts || []).map((r) => ({
    id: r.id,
    signature: r.signature,
    completedAt: r.completedAt,
  }));
  state.automation = Object.fromEntries(
    ["enabled", "templateName", "language", "parameters", "hour"].map((k) => [
      k,
      state.automation[k],
    ]),
  );
  if (new TextEncoder().encode(JSON.stringify(state)).length > 1000000)
    throw Error(
      "El conjunto de datos supera 1 MB. Exporta un respaldo antes de dividirlo o ampliar el servicio.",
    );
  return state;
}
