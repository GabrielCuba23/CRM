// Shared, browser-independent campaign data. No delivery is performed here.
// Keep this module free of crm.mjs imports: the workspace validator imports it.
export const OUTREACH_LIMITS = Object.freeze({ contacts: 5000, campaigns: 50, recipients: 2000, templates: 200, media: 10, bytes: 700000, fileBytes: 20 * 1024 * 1024 });
export const recipientStates = Object.freeze(["pending", "prepared", "sending", "sent_observed", "sent_manual", "failed", "uncertain", "skipped"]);
export const campaignStates = Object.freeze(["draft", "scheduled", "running", "paused", "completed", "cancelled"]);
const sources = ["manual", "excel", "whatsapp", "crm"];
const terminal = new Set(["sent_observed", "sent_manual", "uncertain", "skipped"]);
const owns = (value, key) => Object.hasOwn(value, key);
const nowValue = value => value instanceof Date ? value.toISOString() : value || new Date().toISOString();
const idValue = () => globalThis.crypto?.randomUUID?.() || `outreach-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function fail(message = "Los datos de campañas o contactos no son válidos.") { throw Error(message); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
function text(value, max = 8000, required = false) {
  if (typeof value !== "string" || value.length > max || required && !value.trim()) fail();
  return value;
}
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(); return value; }
function timestamp(value, optional = true) {
  if (optional && value === "") return "";
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) fail("La fecha de la campaña no es válida.");
  return value;
}
function strings(value, max = 100, length = 100) {
  if (!Array.isArray(value) || value.length > max) fail();
  const result = value.map(item => text(item, length, true).trim());
  if (new Set(result).size !== result.length) fail("Hay etiquetas o identificadores duplicados.");
  return result;
}
function rows(value, maximum, clean) {
  if (!Array.isArray(value) || value.length > maximum) fail("La lista supera el límite de registros permitido.");
  const result = value.map(clean);
  if (new Set(result.map(row => row.id)).size !== result.length) fail("Hay identificadores duplicados.");
  return result;
}
function cleanFields(value = {}) {
  if (!object(value) || Object.keys(value).length > 40) fail("Las columnas personalizadas no son válidas.");
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 100 || ["__proto__", "prototype", "constructor"].includes(key)) fail("Una columna personalizada no es válida.");
    result[key] = text(item, 1000);
  }
  return result;
}
export function emptyOutreach() {
  return { version: 1, contacts: [], campaigns: [], templates: [], labels: [], exclusions: [], settings: { countryCode: "51" } };
}
export function normalizeRecipientPhone(value, countryCode = "51") {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) fail("Introduce un teléfono válido con código de país.");
  const raw = String(value ?? "").trim();
  if (!/^[+\d\s().-]+$/.test(raw) || !/^\d{1,4}$/.test(String(countryCode))) fail("Introduce un teléfono válido con código de país.");
  const international = raw.startsWith("+") || raw.startsWith("00");
  let phone = raw.replace(/[^\d]/g, "");
  if (raw.startsWith("00")) phone = phone.slice(2);
  if (String(countryCode) === "51" && phone.length === 9) phone = "51" + phone;
  else if (!international && String(countryCode) !== "51" && phone.length <= 10) phone = String(countryCode) + phone;
  if (!/^[1-9]\d{6,14}$/.test(phone)) fail("Introduce un teléfono válido con código de país.");
  return phone;
}
function cleanMedia(value) {
  if (!object(value)) fail("El adjunto no es válido.");
  const type = value.type ?? value.mime;
  if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm))$/.test(type || "")) fail("Usa una imagen JPEG, PNG, WebP o GIF, o un video MP4 o WebM.");
  const result = { id: text(value.id, 100, true), name: text(value.name, 200, true), type, size: integer(value.size, 1, OUTREACH_LIMITS.fileBytes), sha256: text(value.sha256 || "", 64) };
  if (result.sha256 && !/^[a-f0-9]{64}$/.test(result.sha256)) fail("La huella del archivo no es válida.");
  return result;
}
function cleanContact(value) {
  if (!object(value)) fail();
  const source = value.source || "manual";
  if (!sources.includes(source)) fail();
  const phone = value.phone ? normalizeRecipientPhone(value.phone) : "";
  if (value.phone && phone !== value.phone) fail("Guarda los teléfonos con su código de país.");
  for (const flag of ["archived", "marketingConsent"]) if (value[flag] !== undefined && typeof value[flag] !== "boolean") fail();
  return { id: text(value.id, 100, true), name: text(value.name, 160, true), phone, fields: cleanFields(value.fields), labels: strings(value.labels || [], 30, 80), source, archived: value.archived === true, marketingConsent: value.marketingConsent === true };
}
function cleanRecipient(value) {
  if (!object(value) || !recipientStates.includes(value.status)) fail("El estado del destinatario no es válido.");
  const phone = normalizeRecipientPhone(value.phone);
  if (phone !== value.phone) fail("Guarda los teléfonos con su código de país.");
  return { id: text(value.id, 100, true), name: text(value.name, 160, true), phone, fields: cleanFields(value.fields), labels: strings(value.labels || [], 30, 80), status: value.status, attempts: integer(value.attempts ?? 0, 0, 100), error: text(value.error || "", 1000), sentAt: timestamp(value.sentAt || ""), evidence: text(value.evidence || "", 1000) };
}
function cleanTemplate(value) {
  if (!object(value)) fail();
  const media = rows(value.media || [], OUTREACH_LIMITS.media, cleanMedia);
  if (media.reduce((sum, item) => sum + item.size, 0) > OUTREACH_LIMITS.fileBytes) fail("Los adjuntos de un mensaje admiten hasta 20 MB en total.");
  const body = text(value.body ?? "", 8000);
  if (!body.trim() && !media.length) fail("Escribe un mensaje o añade una foto o video.");
  return { id: text(value.id, 100, true), name: text(value.name, 160, true), body, media };
}
function cleanCampaign(value) {
  if (!object(value) || !campaignStates.includes(value.status)) fail("El estado de la campaña no es válido.");
  const media = rows(value.media || [], OUTREACH_LIMITS.media, cleanMedia);
  if (media.reduce((sum, item) => sum + item.size, 0) > OUTREACH_LIMITS.fileBytes) fail("Los adjuntos de un mensaje admiten hasta 20 MB en total.");
  const body = text(value.body ?? "", 8000);
  if (!body.trim() && !media.length) fail("Escribe un mensaje o añade una foto o video.");
  const recipients = rows(value.recipients || [], OUTREACH_LIMITS.recipients, cleanRecipient);
  if (new Set(recipients.map(row => row.phone)).size !== recipients.length) fail("Un teléfono solo puede aparecer una vez en la campaña.");
  return { id: text(value.id, 100, true), name: text(value.name, 160, true), body, media, recipients, status: value.status, createdAt: timestamp(value.createdAt, false), updatedAt: timestamp(value.updatedAt, false), scheduledAt: timestamp(value.scheduledAt || ""), delaySeconds: integer(value.delaySeconds ?? 5, 0, 86400), batchSize: integer(value.batchSize ?? 20, 1, 1000), batchPauseSeconds: integer(value.batchPauseSeconds ?? 30, 0, 86400) };
}
export function validateOutreach(value) {
  if (value === undefined || value === null) return emptyOutreach();
  if (!object(value) || value.version !== 1 || !object(value.settings)) fail();
  const countryCode = text(value.settings.countryCode, 4, true);
  if (!/^\d{1,4}$/.test(countryCode)) fail("El código de país no es válido.");
  const result = { version: 1, contacts: rows(value.contacts, OUTREACH_LIMITS.contacts, cleanContact), campaigns: rows(value.campaigns, OUTREACH_LIMITS.campaigns, cleanCampaign), templates: rows(value.templates, OUTREACH_LIMITS.templates, cleanTemplate), labels: strings(value.labels, 100, 80), exclusions: strings(value.exclusions, 5000, 15), settings: { countryCode } };
  if (new Set(result.contacts.filter(row => row.phone).map(row => row.phone)).size !== result.contacts.filter(row => row.phone).length) fail("Hay contactos con el mismo teléfono. Revisa los duplicados antes de guardar.");
  if (result.exclusions.some(phone => normalizeRecipientPhone(phone) !== phone)) fail("Un número excluido no es válido.");
  if (new TextEncoder().encode(JSON.stringify(result)).length > OUTREACH_LIMITS.bytes) fail("Las campañas superan el espacio disponible. Exporta y elimina campañas antiguas antes de continuar.");
  return result;
}
export const cleanOutreach = validateOutreach;
export function dedupeRecipients(input, { countryCode = "51", exclusions = [] } = {}) {
  if (!Array.isArray(input) || input.length > 10000) fail("La lista supera 10 000 destinatarios.");
  const excluded = new Set(exclusions.map(phone => normalizeRecipientPhone(phone, countryCode)));
  const seen = new Map();
  for (const source of input) {
    const phone = normalizeRecipientPhone(source.phone, countryCode);
    if (excluded.has(phone)) continue;
    const labels = [...new Set(source.labels || [])];
    const fields = cleanFields(Object.fromEntries(Object.entries(source.fields || {}).map(([key, value]) => [key, String(value ?? "")])));
    if (seen.has(phone)) {
      const current = seen.get(phone);
      current.labels = [...new Set([...current.labels, ...labels])];
      for (const [key, value] of Object.entries(fields)) if (!current.fields[key]) current.fields[key] = value;
      continue;
    }
    seen.set(phone, { id: String(source.id || `recipient-${phone}`), name: String(source.name || phone).trim(), phone, fields, labels, status: "pending", attempts: 0, error: "", sentAt: "", evidence: "" });
  }
  if (seen.size > OUTREACH_LIMITS.recipients) fail(`Una campaña admite hasta ${OUTREACH_LIMITS.recipients} destinatarios.`);
  return [...seen.values()].map(cleanRecipient);
}
const headerKey = value => String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[\s_-]+/g, "");
export function recipientsFromRows(rowsInput, { mapping = {}, countryCode = "51" } = {}) {
  if (!Array.isArray(rowsInput) || rowsInput.length < 2 || rowsInput.length > 10001 || !Array.isArray(rowsInput[0])) fail("El archivo necesita cabeceras y al menos un destinatario.");
  const headers = rowsInput[0].map(value => String(value ?? "").trim());
  if (headers.length > 40) fail("El archivo admite hasta 40 columnas.");
  const locate = (specified, aliases) => Number.isInteger(specified) ? specified : typeof specified === "string" ? headers.indexOf(specified) : headers.findIndex(name => aliases.includes(headerKey(name)));
  const phoneIndex = locate(mapping.phone, ["telefono", "phone", "whatsapp", "numero", "numerowhatsapp", "movil"]);
  const nameIndex = locate(mapping.name, ["nombre", "name", "cliente", "contacto"]);
  if (phoneIndex < 0 || phoneIndex >= headers.length) fail("Selecciona la columna de teléfono.");
  const candidates = [], preview = [];
  const known = new Set();
  let duplicates = 0, invalid = 0;
  for (let index = 1; index < rowsInput.length; index++) {
    const row = rowsInput[index];
    if (!Array.isArray(row)) fail("Una fila del archivo no es válida.");
    if (row.every(value => String(value ?? "").trim() === "")) continue;
    const name = String(row[nameIndex] || row[phoneIndex] || "").trim();
    try {
      const phone = normalizeRecipientPhone(row[phoneIndex], countryCode);
      if (known.has(phone)) { duplicates++; preview.push({ row: index + 1, name, phone, status: "Duplicado: omitido" }); continue; }
      const fields = {};
      for (let column = 0; column < headers.length; column++) {
        const key = headers[column];
        if (!key) continue;
        if (["__proto__", "constructor", "prototype"].includes(key)) fail("Una columna del archivo no es válida.");
        const value = row[column];
        if (typeof value === "object" && value !== null && !(value instanceof Date)) fail("Pega valores, no fórmulas ni objetos, antes de importar.");
        fields[key] = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
      }
      const result = dedupeRecipients([{ name, phone, fields }], { countryCode })[0];
      candidates.push(result); known.add(phone);
      preview.push({ row: index + 1, name, phone, status: "Listo para importar" });
    } catch (error) { invalid++; preview.push({ row: index + 1, name, phone: "", status: "Error: " + error.message }); }
  }
  if (candidates.length > OUTREACH_LIMITS.recipients) fail(`La lista admite hasta ${OUTREACH_LIMITS.recipients} destinatarios.`);
  return { recipients: candidates, preview, duplicates, invalid };
}
export function recipientsFromClients(clients, { onlyConsented = false, service = "", query = "", excludedPhones = [] } = {}) {
  const selected = (clients || []).filter(row => !row.archived && (!onlyConsented || row.marketingConsent === true) && (!service || row.service === service) && (!query || `${row.name} ${row.phone} ${row.service}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es"))));
  const byPhone = new Map();
  for (const row of selected) {
    let phone; try { phone = normalizeRecipientPhone(row.phone); } catch { continue; }
    if (!byPhone.has(phone)) byPhone.set(phone, { name: row.name, phone, fields: { servicio: row.service || "", servicios: row.service || "", vence: row.expires || "", perfil: row.profile || "", correo: row.email || "" }, labels: [] });
    else {
      const item = byPhone.get(phone);
      item.fields.servicios = [...new Set([...item.fields.servicios.split(" · "), row.service].filter(Boolean))].join(" · ");
    }
  }
  return dedupeRecipients([...byPhone.values()], { exclusions: excludedPhones });
}
export function personalizeMessage(body, recipient, { business = "" } = {}) {
  text(body, 8000);
  const fields = { ...recipient.fields, nombre: recipient.name || "", name: recipient.name || "", telefono: recipient.phone || "", phone: recipient.phone || "", negocio: business };
  const normalized = new Map(Object.entries(fields).map(([key, value]) => [headerKey(key), String(value ?? "")]));
  return body.replace(/\{([^{}\n]{1,100})\}/g, (match, key) => normalized.has(headerKey(key)) ? normalized.get(headerKey(key)) : match);
}
export function createCampaign(input, { id = idValue(), now } = {}) {
  const at = nowValue(now);
  return cleanCampaign({ id, name: input.name || "Nueva campaña", body: input.body || "", media: input.media || [], recipients: dedupeRecipients(input.recipients || [], { exclusions: input.exclusions || [] }), status: "draft", createdAt: at, updatedAt: at, scheduledAt: input.scheduledAt || "", delaySeconds: input.delaySeconds ?? 5, batchSize: input.batchSize ?? 20, batchPauseSeconds: input.batchPauseSeconds ?? 30 });
}
export function updateCampaign(campaign, input, { now } = {}) {
  const current = cleanCampaign(campaign);
  if (["running", "scheduled"].includes(current.status)) fail("Pausa la campaña antes de editarla.");
  if (current.recipients.some(row => row.attempts || terminal.has(row.status)) && ["body", "media", "recipients"].some(key => owns(input, key))) fail("Duplica la campaña para cambiar un mensaje que ya tiene intentos registrados.");
  const next = { ...current, updatedAt: nowValue(now) };
  for (const key of ["name", "body", "media", "scheduledAt", "delaySeconds", "batchSize", "batchPauseSeconds"]) if (owns(input, key)) next[key] = structuredClone(input[key]);
  if (owns(input, "recipients")) next.recipients = dedupeRecipients(input.recipients);
  return cleanCampaign(next);
}
export function transitionCampaign(campaign, action, { now } = {}) {
  const next = cleanCampaign(campaign), at = nowValue(now);
  if (["start", "resume"].includes(action)) {
    if (["completed", "cancelled"].includes(next.status)) fail("Duplica esta campaña para iniciar otra entrega.");
    if (!next.recipients.some(row => row.status === "pending" || row.status === "prepared")) fail("No hay destinatarios pendientes. Revisa los errores antes de reintentar.");
    next.status = next.scheduledAt && Date.parse(next.scheduledAt) > Date.parse(at) ? "scheduled" : "running";
  } else if (action === "pause") {
    if (!["running", "scheduled", "paused"].includes(next.status)) fail("Esta campaña no está en ejecución.");
    next.status = "paused";
  } else if (action === "cancel") {
    if (next.status === "completed") fail("La campaña ya terminó.");
    next.status = "cancelled";
  } else if (action === "complete") {
    if (next.recipients.some(row => ["pending", "prepared", "sending"].includes(row.status))) fail("Quedan destinatarios pendientes o un intento sin resultado.");
    next.status = "completed";
  } else if (action === "retryFailed") {
    if (["running", "scheduled"].includes(next.status)) fail("Pausa la campaña antes de reintentar.");
    next.recipients = next.recipients.map(row => row.status === "failed" ? { ...row, status: "pending", error: "" } : row);
    next.status = "paused";
  } else if (action === "recover") {
    if (["running", "scheduled"].includes(next.status)) next.status = "paused";
    next.recipients = next.recipients.map(row => row.status === "sending" ? { ...row, status: "uncertain", error: "El intento se interrumpió. Revisa WhatsApp antes de marcarlo o reintentarlo." } : row);
  } else fail("La operación de campaña no es válida.");
  next.updatedAt = at;
  return cleanCampaign(next);
}
export function recordRecipientResult(campaign, recipientId, result, { now } = {}) {
  const next = cleanCampaign(campaign), recipient = next.recipients.find(row => row.id === recipientId);
  if (!recipient || !object(result) || !recipientStates.includes(result.status) || result.status === "pending") fail("El resultado del destinatario no es válido.");
  if (terminal.has(recipient.status) && !(result.reviewed === true && ["sent_manual", "skipped", "failed"].includes(result.status) && recipient.status === "uncertain")) fail("Este destinatario ya tiene un resultado. No se volverá a enviar automáticamente.");
  if (result.status === "sending") {
    if (next.status !== "running") fail("Inicia la campaña antes de enviar.");
    if (recipient.status !== "sending") recipient.attempts++;
  }
  recipient.status = result.status;
  recipient.error = String(result.error || "");
  recipient.evidence = typeof result.evidence === "string" ? result.evidence : result.evidence ? JSON.stringify(result.evidence) : "";
  recipient.sentAt = ["sent_observed", "sent_manual"].includes(result.status) ? result.sentAt || nowValue(now) : "";
  next.updatedAt = nowValue(now);
  return cleanCampaign(next);
}
export function campaignReportRows(campaign) {
  const current = cleanCampaign(campaign);
  return [["campaña", "nombre", "telefono", "estado", "intentos", "fecha", "evidencia", "error"], ...current.recipients.map(row => [current.name, row.name, row.phone, row.status, row.attempts, row.sentAt, row.evidence, row.error])];
}
function csv(rowsInput) {
  return "\uFEFF" + rowsInput.map(row => row.map(value => {
    let s = String(value ?? ""); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n");
}
export function contactExportRows(contacts) {
  return [["nombre", "telefono", "etiquetas", "origen"], ...(contacts || []).map(row => [String(row.name || ""), String(row.phone || ""), (row.labels || []).join(" · "), row.source || "crm"])];
}
export function exportContactsCSV(contacts) { return csv(contactExportRows(contacts)); }
export function exportCampaignCSV(campaign) { return csv(campaignReportRows(campaign)); }
export function campaignSummary(campaign) {
  const counts = Object.fromEntries(recipientStates.map(state => [state, 0]));
  for (const row of campaign.recipients || []) if (owns(counts, row.status)) counts[row.status]++;
  return { total: campaign.recipients?.length || 0, ...counts, sent: counts.sent_manual + counts.sent_observed };
}
