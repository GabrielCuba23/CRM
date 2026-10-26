import {
  availableProfiles,
  createId as defaultCreateId,
  normalizePhone,
  subscriptionStatus,
  todayLima,
  validDate,
  validateWorkspace,
} from "../crm.mjs";
import { archiveContact } from "../lifecycle.mjs";

const owns = (object, field) => Object.hasOwn(object, field);
const clientTextFields = ["name", "phone", "whatsappUsername", "email", "service", "profile", "expires", "notes", "accountId", "pin"];
const accountTextFields = ["service", "email", "provider", "expires", "password", "supplierId", "offerId"];

function mergeText(target, input, fields) {
  for (const field of fields) {
    if (!owns(input, field)) continue;
    if (typeof input[field] !== "string" || input[field].length > 8000)
      throw Error("Un campo de texto no es válido.");
    target[field] = field === "password" ? input[field] : input[field].trim();
  }
}

function amount(value, message = "Introduce un importe válido en céntimos.") {
  if (!Number.isSafeInteger(value) || value < 0 || value > 99999900)
    throw Error(message);
  return value;
}

function requireId(rows, id, message) {
  const record = rows.find(row => row.id === id);
  if (!record) throw Error(message);
  return record;
}

function capacity(value, clients, accountId) {
  if (!Number.isInteger(value) || value < 1 || value > 50)
    throw Error("Indica la capacidad real de la cuenta: entre 1 y 50 perfiles.");
  const allowed = new Set(Array.from({ length: value }, (_, i) => `Perfil ${i + 1}`));
  if (clients.some(client => client.accountId === accountId && !allowed.has(client.profile)))
    throw Error("Libera o reasigna los perfiles ocupados antes de reducir la capacidad.");
  return value;
}

function contactKey(client) {
  // Blank or malformed legacy numbers do not establish a shared identity.
  try { return `phone:${normalizePhone(client.phone)}`; }
  catch { return `client:${client.id}`; }
}

function requireWholeContact(clients, ids) {
  if (!Array.isArray(ids) || !ids.length ||
      ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length)
    throw Error("Selecciona todas las fichas del contacto una sola vez.");
  const selected = ids.map(id => requireId(clients, id, "El contacto cambió. Actualiza sus datos antes de continuar."));
  const key = contactKey(selected[0]);
  if (selected.some(client => contactKey(client) !== key))
    throw Error("Las fichas seleccionadas pertenecen a contactos diferentes.");
  const expected = clients.filter(client => contactKey(client) === key);
  if (expected.length !== selected.length)
    throw Error("El contacto tiene otros servicios. Actualiza y selecciona todas sus fichas.");
  return selected;
}

/**
 * Pure commands used by the WhatsApp workspace. The caller persists the returned
 * snapshot using the same server revision as the web CRM, then adopts it only
 * after that save succeeds. Input, existing records and unrelated modules are
 * never modified in place.
 */
export function applyWorkspaceCommand(state, command, input = {}, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Datos de operación no válidos.");
  const next = structuredClone(state);
  validateWorkspace(next);
  const makeId = options.createId || defaultCreateId;
  const today = typeof options.today === "function" ? options.today() : options.today || todayLima();
  if (!validDate(today)) throw Error("La fecha de trabajo no es válida.");
  const nowValue = typeof options.now === "function" ? options.now() : options.now ?? new Date();
  const now = new Date(nowValue).toISOString();
  if (owns(input, "paid") && typeof input.paid !== "boolean")
    throw Error("Indica si el pago fue registrado.");

  if (command === "updateContact") {
    const contact = requireWholeContact(next.clients, input.ids);
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120)
      throw Error("Introduce el nombre del cliente, con hasta 120 caracteres.");
    if (owns(input, "phone") && typeof input.phone !== "string")
      throw Error("Introduce un teléfono válido, con código de país.");
    const rawPhone = owns(input, "phone") ? input.phone.trim() : contact[0].phone;
    const phone = rawPhone ? normalizePhone(rawPhone) : "";
    if (!phone && contact.length > 1)
      throw Error("Conserva un teléfono para mantener juntos los servicios de este cliente.");
    const selected = new Set(input.ids);
    if (phone && next.clients.some(client => !selected.has(client.id) && contactKey(client) === `phone:${phone}`))
      throw Error("Ese teléfono ya pertenece a otro contacto. No se combinaron sus fichas.");
    if (owns(input, "whatsappUsername") &&
        (typeof input.whatsappUsername !== "string" || input.whatsappUsername.length > 100))
      throw Error("Introduce un usuario de WhatsApp válido.");
    next.clients = next.clients.map(client => selected.has(client.id) ? {
      ...client, name: input.name.trim(), phone,
      ...(owns(input, "whatsappUsername") ? { whatsappUsername: input.whatsappUsername.trim() } : {}),
    } : client);
  } else if (command === "deleteContact") {
    requireWholeContact(next.clients, input.ids);
    const selected = new Set(input.ids);
    // As with deleting one service, historical payments and interactions stay
    // intact; all of this contact's current inventory assignments are released.
    next.clients = next.clients.filter(client => !selected.has(client.id));
  } else if (command === "saveClient") {
    const previous = input.id ? requireId(next.clients, input.id, "La ficha ya no existe. Actualiza los datos.") : null;
    const client = previous ? { ...previous } : {
      id: makeId(), name: "", phone: "", email: "", service: "", profile: "",
      expires: "", notes: "", accountId: "", pin: "", price: 0, pricePending: true,
      reminderConsent: false, marketingConsent: false,
    };
    mergeText(client, input, clientTextFields);
    if (!client.name) throw Error("Introduce el nombre del cliente.");
    client.phone = client.phone ? normalizePhone(client.phone) : "";
    if (client.expires && !validDate(client.expires)) throw Error("Introduce un vencimiento válido.");
    for (const field of ["reminderConsent", "marketingConsent", "pricePending"]) {
      if (!owns(input, field)) continue;
      if (typeof input[field] !== "boolean") throw Error("El estado de la ficha no es válido.");
      client[field] = input[field];
    }
    if (owns(input, "price")) {
      client.price = amount(input.price, "Introduce un precio válido.");
      if (!owns(input, "pricePending")) client.pricePending = false;
    } else if (input.pricePending === true) client.price = 0;
    amount(client.price, "Introduce un precio válido.");
    if (client.pricePending && client.price !== 0)
      throw Error("Un precio pendiente debe permanecer vacío.");
    if (input.reactivate !== undefined && typeof input.reactivate !== "boolean")
      throw Error("La reactivación no es válida.");
    const reactivating = previous?.archived === true && input.reactivate === true;
    if (reactivating) {
      if (!client.expires || client.expires <= today)
        throw Error("Indica un vencimiento futuro para reactivar el servicio.");
      client.archived = false;
    }
    if (client.archived && client.accountId)
      throw Error("Reactiva el servicio antes de asignarle una cuenta.");
    if (client.accountId) {
      const account = requireId(next.accounts, client.accountId, "La cuenta no está disponible.");
      const changedAssignment = !previous || previous.accountId !== account.id || previous.profile !== client.profile || reactivating;
      if (changedAssignment && subscriptionStatus(account.expires, today) === "expired")
        throw Error("Renueva la cuenta madre antes de asignar un perfil.");
      const others = next.clients.filter(row => row.id !== client.id);
      if (!availableProfiles(account, others).includes(client.profile))
        throw Error("Ese perfil no está disponible. Selecciona un perfil libre.");
      client.email = account.email;
      client.service = account.service;
    }
    next.clients = previous
      ? next.clients.map(row => row.id === client.id ? client : row)
      : [...next.clients, client];
    if ((!previous || reactivating) && input.paid === true && !client.pricePending && client.price > 0) {
      next.ledger.push({
        id: makeId(), kind: "sale", date: today,
        description: `${reactivating ? "Reventa" : "Venta"} · ${client.name}`,
        clientId: client.id, service: client.service, amount: client.price,
      });
    }
  } else if (command === "renewClient") {
    const client = requireId(next.clients, input.id, "La ficha ya no existe. Actualiza los datos.");
    if (client.archived) throw Error("Reactiva el servicio antes de renovarlo.");
    if (!validDate(input.expires) || input.expires <= today || (client.expires && input.expires <= client.expires))
      throw Error("El nuevo vencimiento debe ser posterior al actual y a hoy.");
    const hasAmount = input.amount !== undefined && input.amount !== null && input.amount !== "";
    if (hasAmount) amount(input.amount, "Introduce un importe cobrado válido.");
    if (input.paid === true && !hasAmount)
      throw Error("Indica el importe cobrado o desmarca Registrar cobro.");
    client.expires = input.expires;
    if (input.paid === true && input.amount > 0) {
      next.ledger.push({
        id: makeId(), kind: "renewal", date: today, description: `Renovación · ${client.name}`,
        clientId: client.id, service: client.service, amount: input.amount,
      });
    }
  } else if (command === "archiveClient") {
    const client = requireId(next.clients, input.id, "La ficha ya no existe. Actualiza los datos.");
    next.clients = next.clients.map(row => row.id === client.id ? archiveContact(row, now) : row);
  } else if (command === "deleteClient") {
    requireId(next.clients, input.id, "La ficha ya no existe. Actualiza los datos.");
    // Match the web CRM: deleting a service releases its profile but does not
    // rewrite financial records or erase historical conversation entries.
    next.clients = next.clients.filter(row => row.id !== input.id);
  } else if (command === "saveAccount") {
    const previous = input.id ? requireId(next.accounts, input.id, "La cuenta ya no existe. Actualiza los datos.") : null;
    const account = previous ? { ...previous } : { id: makeId(), service: "", email: "", provider: "", expires: "" };
    mergeText(account, input, accountTextFields);
    if (!account.service || !account.email || !validDate(account.expires))
      throw Error("Completa la plataforma, el correo y un vencimiento válido.");
    if (!/^[^\s@]+@[^\s@]+$/.test(account.email)) throw Error("Introduce un correo de cuenta válido.");
    account.capacity = capacity(owns(input, "capacity") ? input.capacity : account.capacity, next.clients, account.id);
    if (owns(input, "costCents")) {
      if (input.costCents === null || input.costCents === undefined) delete account.costCents;
      else account.costCents = amount(input.costCents, "Introduce un coste válido.");
    }
    if (owns(input, "costIntervalMonths")) account.costIntervalMonths = input.costIntervalMonths;
    const supplier = (next.procurement?.suppliers || []).find(row => row.id === account.supplierId);
    if (supplier) account.provider = supplier.name;
    next.accounts = previous
      ? next.accounts.map(row => row.id === account.id ? account : row)
      : [...next.accounts, account];
    next.clients = next.clients.map(row => row.accountId === account.id ? { ...row, email: account.email, service: account.service } : row);
  } else if (command === "setCapacity") {
    const account = requireId(next.accounts, input.id, "La cuenta ya no existe. Actualiza los datos.");
    account.capacity = capacity(input.capacity, next.clients, account.id);
  } else if (command === "deleteAccount") {
    requireId(next.accounts, input.id, "La cuenta ya no existe. Actualiza los datos.");
    if (next.clients.some(row => row.accountId === input.id))
      throw Error("Libera o reasigna los perfiles ocupados antes de eliminar la cuenta.");
    next.accounts = next.accounts.filter(row => row.id !== input.id);
  } else if (command === "saveGrowth") {
    next.growth = structuredClone(input.growth);
  } else {
    throw Error("Operación del CRM no disponible.");
  }
  return validateWorkspace(next);
}
