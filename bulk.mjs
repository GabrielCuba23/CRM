import {
  normalizePhone,
  validDate,
  cents,
  availableProfiles,
  subscriptionStatus,
  validateWorkspace,
  createId,
} from "./crm.mjs";
export const clientColumns = [
  "id",
  "nombre",
  "telefono",
  "usuario_whatsapp",
  "correo",
  "servicio",
  "perfil",
  "vence",
  "precio",
  "pin",
  "notas",
  "cuenta_madre",
  "autoriza_recordatorios",
];
const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");
const aliases = {
  id: ["id"],
  name: ["nombre", "name", "cliente"],
  phone: ["telefono", "phone", "whatsapp", "numero", "numerowhatsapp"],
  whatsappUsername: ["usuariowhatsapp", "whatsappusername", "usuario"],
  email: ["correo", "email"],
  service: ["servicio", "service", "plataforma"],
  profile: ["perfil", "profile"],
  expires: ["vence", "expires", "vencimiento", "fechadevencimiento"],
  price: ["precio", "price", "preciodeventa"],
  pin: ["pin"],
  notes: ["notas", "notes"],
  accountId: ["cuentamadre", "accountid"],
  reminderConsent: ["autorizarecordatorios", "reminderconsent", "autorizacion"],
};
export function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/)[0];
  let delimiter = ",";
  if ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length)
    delimiter = ";";
  if (first.includes("\t") && !first.includes(delimiter)) delimiter = "\t";
  const rows = [],
    row = [];
  let field = "",
    quoted = false,
    ended = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          ended = true;
        }
      } else field += ch;
    } else if (ch === '"') {
      if (field || ended) throw Error("CSV con comillas no válidas.");
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
      ended = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push([...row]);
      row.length = 0;
      field = "";
      ended = false;
    } else {
      if (ended && !/\s/.test(ch))
        throw Error("CSV con texto después de cerrar comillas.");
      if (!ended) field += ch;
    }
    if (rows.length > 10001) throw Error("El archivo supera 10 000 clientes.");
  }
  if (quoted) throw Error("CSV con comillas sin cerrar.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
function text(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "")
    .replace(/^'(?=[=+@\-\t\r])/, "")
    .trim();
}
function date(value) {
  if (value === "" || value === undefined || value === null) return "";
  let result = text(value);
  if (typeof value === "number") {
    result = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  const parts = result.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (parts)
    result = `${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  if (!validDate(result))
    throw Error("Vencimiento no válido; usa AAAA-MM-DD o DD/MM/AAAA.");
  return result;
}
function consent(value) {
  const v = normalize(value);
  if (["", "no", "false", "0"].includes(v)) return false;
  if (["si", "true", "1"].includes(v)) return true;
  throw Error("Autorización no válida; usa sí o no.");
}
function key(c) {
  return JSON.stringify([
    c.phone || c.whatsappUsername.toLowerCase() || c.name.toLowerCase(),
    c.service.toLowerCase(),
    c.profile.toLowerCase(),
  ]);
}
export function prepareClientImport(rows, state) {
  if (!Array.isArray(rows) || rows.length < 2)
    throw Error(
      "El archivo necesita cabeceras y al menos una fila de clientes.",
    );
  if (rows.length > 10001) throw Error("El archivo supera 10 000 clientes.");
  const headers = rows[0].map(normalize),
    mapping = {};
  for (const [field, names] of Object.entries(aliases)) {
    const indices = headers.flatMap((h, i) => (names.includes(h) ? [i] : []));
    if (indices.length > 1) throw Error(`Hay varias columnas para ${field}.`);
    mapping[field] = indices[0];
  }
  if (mapping.name === undefined)
    throw Error("Falta la columna nombre. Descarga la plantilla de ejemplo.");
  const known = new Set(
      state.clients.map((c) =>
        key({ ...c, whatsappUsername: c.whatsappUsername || "" }),
      ),
    ),
    knownIds = new Set(state.clients.map((c) => c.id)),
    clients = [],
    preview = [];
  for (let i = 1; i < rows.length; i++) {
    const get = (field) =>
      mapping[field] === undefined ? "" : (rows[i][mapping[field]] ?? "");
    if (rows[i].every((v) => !text(v))) continue;
    try {
      const name = text(get("name"));
      if (!name) throw Error("Falta el nombre.");
      const c = {
        id: /^[A-Za-z0-9_-]{1,100}$/.test(text(get("id")))
          ? text(get("id"))
          : createId(),
        name,
        phone: text(get("phone")) ? normalizePhone(text(get("phone"))) : "",
        whatsappUsername: text(get("whatsappUsername")),
        email: text(get("email")),
        service: text(get("service")),
        profile: text(get("profile")),
        expires: date(get("expires")),
        price: cents(
          text(get("price"))
            .replace(/^S\/?\s*/i, "")
            .replace(",", ".") || "0",
        ),
        pin: text(get("pin")),
        notes: text(get("notes")),
        accountId: "",
        reminderConsent: consent(get("reminderConsent")),
      };
      const account = text(get("accountId"));
      if (account) {
        const matches = state.accounts.filter(
          (a) =>
            a.id === account || a.email.toLowerCase() === account.toLowerCase(),
        );
        if (matches.length !== 1)
          throw Error("Cuenta madre inexistente o ambigua; usa su ID.");
        const a = matches[0];
        if (subscriptionStatus(a.expires) === "expired")
          throw Error("La cuenta madre está vencida.");
        c.accountId = a.id;
        c.email = a.email;
        c.service = a.service;
        if (!c.profile)
          c.profile =
            availableProfiles(a, [...state.clients, ...clients])[0] || "";
      }
      const identity = key(c);
      if (known.has(identity) || knownIds.has(c.id)) {
        preview.push({ row: i + 1, name, status: "Duplicado: omitido" });
        continue;
      }
      if (
        Object.values(c).some((v) => typeof v === "string" && v.length > 8000)
      )
        throw Error("Un campo supera 8000 caracteres.");
      validateWorkspace({
        ...state,
        clients: [...state.clients, ...clients, c],
      });
      clients.push(c);
      known.add(identity);
      knownIds.add(c.id);
      preview.push({ row: i + 1, name, status: "Listo para importar" });
    } catch (error) {
      preview.push({
        row: i + 1,
        name: text(get("name")),
        status: "Error: " + error.message,
      });
    }
  }
  return { clients, preview };
}
function values(c) {
  return [
    c.id,
    c.name,
    c.phone,
    c.whatsappUsername || "",
    c.email,
    c.service,
    c.profile,
    c.expires,
    (c.price / 100).toFixed(2),
    c.pin,
    c.notes,
    c.accountId,
    c.reminderConsent ? "sí" : "no",
  ];
}
export function exportClientCSV(clients) {
  const cell = (value) => {
    let s = String(value ?? "");
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    "\uFEFF" +
    [clientColumns, ...clients.map(values)]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
export async function readExcelRows(buffer, ExcelJS) {
  if (!ExcelJS?.Workbook)
    throw Error("No se pudo cargar el lector de Excel. Recarga la página.");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets = workbook.worksheets.filter((s) => s.rowCount);
  if (sheets.length !== 1)
    throw Error("Usa un Excel con una sola hoja de clientes.");
  const sheet = sheets[0];
  if (sheet.rowCount > 10001 || sheet.columnCount > 100)
    throw Error("Excel supera el tamaño de filas o columnas permitido.");
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = [];
    for (let i = 1; i <= sheet.columnCount; i++) {
      const value = row.getCell(i).value;
      if (value && typeof value === "object" && !(value instanceof Date)) {
        if ("formula" in value || "sharedFormula" in value)
          throw Error(
            "No se importan fórmulas. Pega los valores antes de subir el archivo.",
          );
        if (value.richText)
          values.push(value.richText.map((t) => t.text).join(""));
        else if (value.text) values.push(value.text);
        else values.push("");
      } else values.push(value ?? "");
    }
    rows.push(values);
  });
  return rows;
}
export async function exportClientExcel(clients, ExcelJS) {
  if (!ExcelJS?.Workbook)
    throw Error("No se pudo cargar Excel. Recarga la página.");
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Clientes");
  sheet.addRow(clientColumns);
  for (const client of clients) sheet.addRow(values(client));
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => (column.width = 24));
  return workbook.xlsx.writeBuffer();
}
