export const fields = [
  "nombre",
  "telefono",
  "correo",
  "servicio",
  "perfil",
  "vence",
  "contrasena",
  "pin",
  "negocio",
  "pago",
];
export const defaultTemplates = [
  {
    id: "welcome",
    name: "Entrega de acceso",
    body: "Hola {nombre} 👋\n\n*✅ {servicio}*\n\n*📧 Correo:* {correo}\n*☑️ Perfil:* {perfil}\n*📍 Vence:* {vence}\n\n¡Gracias por confiar en nosotros! Si necesitas ayuda, escríbenos.",
  },
  {
    id: "renew",
    name: "Recordatorio de renovación",
    body: "Hola {nombre} 👋\nTu suscripción de *{servicio}* vence el *{vence}*.\n\n¿Deseas renovarla? Responde a este mensaje y te ayudamos. 🙌",
  },
  {
    id: "password",
    name: "Entrega con contraseña",
    body: "Hola {nombre} 👋\n\n*✅ {servicio}*\n*📧 Correo:* {correo}\n*🔑 Contraseña:* {contrasena}\n*☑️ Perfil:* {perfil}\n*📍 Vence:* {vence}\n\n¡Disfruta tu servicio!",
  },
];
export function normalizePhone(value) {
  const raw = String(value).trim();
  if (
    !raw ||
    /[^\d+\s().-]/.test(raw) ||
    (raw.includes("+") && !/^\+[^+]*$/.test(raw))
  )
    throw new Error("Introduce un teléfono válido, con código de país.");
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!raw.startsWith("+") && digits.length === 9 && digits.startsWith("9"))
    digits = "51" + digits;
  if (
    !/^[1-9]\d{7,14}$/.test(digits) ||
    (digits.startsWith("51") && !/^519\d{8}$/.test(digits))
  )
    throw new Error(
      "Para Perú usa +51 seguido de 9 dígitos que empiecen con 9.",
    );
  return digits;
}
export function formatDate(value) {
  if (!value) return "Sin fecha";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
export function subscriptionStatus(expires, today = todayLima()) {
  if (!expires) return "none";
  const days = Math.round(
    (Date.parse(expires + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) /
      86400000,
  );
  return days < 0 ? "expired" : days <= 7 ? "soon" : "active";
}
export function fillTemplate(body, client, password = "", settings = {}) {
  const values = {
    nombre: client.name,
    telefono: client.phone,
    correo: client.email || "No indicado",
    servicio: client.service || "Tu servicio",
    perfil: client.profile || "No indicado",
    vence: formatDate(client.expires),
    contrasena: password,
    pin: client.pin || "Sin PIN",
    negocio: settings.business || "Nuestro equipo",
    pago: settings.payments || "Consulta los medios de pago",
  };
  return body.replace(
    /\{(nombre|telefono|correo|servicio|perfil|vence|contrasena|pin|negocio|pago)\}/g,
    (_, key) => values[key],
  );
}
export function whatsappUrl(phone, message) {
  if (!message.trim())
    throw new Error("Escribe un mensaje antes de abrir WhatsApp.");
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(message)}`;
}
export function todayLima(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function money(value) {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
  }).format(value / 100);
}
export function cents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value)) || Number(value) > 999999)
    throw Error("Introduce un importe válido, con hasta dos decimales.");
  return Math.round(Number(value) * 100);
}
export function availableProfiles(account, clients) {
  const occupied = new Set(
    clients.filter((c) => c.accountId === account.id).map((c) => c.profile),
  );
  return Array.from(
    { length: account.capacity },
    (_, index) => `Perfil ${index + 1}`,
  ).filter((profile) => !occupied.has(profile));
}
export function validateWorkspace(state) {
  const string = (value) => typeof value === "string";
  const strings = (o, keys) => o && keys.every((k) => string(o[k]));
  const date = (v) => v === "" || validDate(v);
  const unique = (list) =>
    new Set(list.map((x) => x?.id)).size === list.length &&
    list.every((x) => x && typeof x.id === "string" && x.id);
  if (
    !state ||
    state.version !== 2 ||
    !["clients", "accounts", "templates", "combos", "ledger"].every(
      (k) => Array.isArray(state[k]) && unique(state[k]),
    )
  )
    throw Error("Formato de respaldo no válido.");
  if (
    !state.clients.every(
      (c) =>
        strings(c, [
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
        ]) &&
        c.name.trim() &&
        date(c.expires) &&
        Number.isInteger(c.price) &&
        c.price >= 0,
    )
  )
    throw Error("Datos de clientes no válidos.");
  if (
    !state.accounts.every(
      (a) =>
        strings(a, ["id", "service", "email", "provider", "expires"]) &&
        a.service.trim() &&
        validDate(a.expires) &&
        Number.isInteger(a.capacity) &&
        a.capacity >= 1 &&
        a.capacity <= 50,
    )
  )
    throw Error("Datos de cuentas no válidos.");
  if (
    !state.templates.length ||
    !state.templates.every(
      (t) =>
        strings(t, ["id", "name", "body"]) && t.name.trim() && t.body.trim(),
    )
  )
    throw Error("Plantillas no válidas.");
  if (
    !state.combos.every(
      (c) =>
        strings(c, ["id", "name", "services"]) &&
        c.name.trim() &&
        c.services.trim() &&
        Number.isInteger(c.price) &&
        c.price >= 0,
    )
  )
    throw Error("Combos no válidos.");
  if (
    !state.ledger.every(
      (m) =>
        strings(m, ["id", "description", "date", "service", "kind"]) &&
        validDate(m.date) &&
        ["sale", "renewal", "expense"].includes(m.kind) &&
        Number.isInteger(m.amount) &&
        m.amount >= 0,
    )
  )
    throw Error("Movimientos no válidos.");
  if (
    !strings(state.settings, ["business", "payments"]) ||
    typeof state.settings.dark !== "boolean"
  )
    throw Error("Configuración no válida.");
  for (const account of state.accounts) {
    const assigned = state.clients.filter((c) => c.accountId === account.id);
    if (
      new Set(assigned.map((c) => c.profile)).size !== assigned.length ||
      assigned.some(
        (c) =>
          !Array.from(
            { length: account.capacity },
            (_, i) => `Perfil ${i + 1}`,
          ).includes(c.profile),
      )
    )
      throw Error("Hay perfiles duplicados o fuera de capacidad.");
  }
  if (
    state.clients.some(
      (c) => c.accountId && !state.accounts.some((a) => a.id === c.accountId),
    )
  )
    throw Error("Hay clientes con cuentas inexistentes.");
  return state;
}

export function createId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // getRandomValues also works on HTTP origins where randomUUID is unavailable.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
