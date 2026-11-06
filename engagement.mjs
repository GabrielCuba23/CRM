// Shared, deterministic line configuration and rule matching. This module never
// reads WhatsApp, starts a runtime, accesses credentials or sends a message.
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);
const fail = (message = 'La configuración de líneas o chatbot no es válida.') => { throw Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function text(value, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) fail();
  return value;
}
function boolean(value, fallback = false) { if (value === undefined) return fallback; if (typeof value !== 'boolean') fail(); return value; }
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(); return value; }
function rows(value, maximum, clean) {
  if (!Array.isArray(value) || value.length > maximum) fail();
  const result = value.map(clean);
  if (new Set(result.map(row => row.id)).size !== result.length) fail('Hay identificadores repetidos.');
  return result;
}
export function normalizeEngagementPhone(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value.trim())) fail('Introduce el teléfono de la línea con su código de país.');
  let number = value.replace(/\D/g, '');
  if (value.trim().startsWith('00')) number = number.slice(2);
  if (number.length === 9) number = '51' + number;
  if (!/^[1-9]\d{6,14}$/.test(number)) fail('Introduce un teléfono válido para la línea.');
  return number;
}
function media(value) {
  if (!object(value) || !/^[a-f0-9]{32}$/.test(value.id || '') || !TYPES.has(value.type) || !/^[a-f0-9]{64}$/.test(value.sha256 || '')) fail('El adjunto del chatbot no es válido.');
  return { id: value.id, name: text(value.name, 200, true), type: value.type, size: integer(value.size, 1, 20971520), sha256: value.sha256 };
}
function rule(value) {
  if (!object(value) || !['exact', 'contains', 'fallback'].includes(value.match)) fail();
  const keywords = value.keywords ?? [];
  if (!Array.isArray(keywords) || keywords.length > 30) fail();
  const cleaned = [...new Set(keywords.map(item => text(item, 100, true).trim()))];
  if (value.match !== 'fallback' && !cleaned.length) fail('Añade al menos una palabra o frase al chatbot.');
  const files = rows(value.media ?? [], 10, media), body = text(value.text ?? '', 8000);
  if (!body.trim() && !files.length) fail('Escribe la respuesta o añade un archivo.');
  if (files.reduce((total, file) => total + file.size, 0) > 20971520) fail('Los archivos de una respuesta superan 20 MiB.');
  return { id: text(value.id, 100, true), name: text(value.name, 160, true), enabled: boolean(value.enabled), match: value.match, keywords: value.match === 'fallback' ? [] : cleaned, text: body, media: files };
}
function line(value) {
  if (!object(value)) fail();
  return { id: text(value.id, 100, true), name: text(value.name, 160, true), phone: normalizeEngagementPhone(value.phone), enabled: boolean(value.enabled), allowBackground: boolean(value.allowBackground) };
}
function hours(value = {}) {
  if (!object(value)) fail();
  const result = { enabled: boolean(value.enabled), start: value.start ?? '09:00', end: value.end ?? '18:00', days: value.days ?? [1, 2, 3, 4, 5, 6, 7] };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(result.end) || !Array.isArray(result.days) || result.days.length > 7) fail('El horario del chatbot no es válido.');
  result.days = [...new Set(result.days.map(day => integer(day, 1, 7)))].sort((a, b) => a - b);
  if (result.enabled && !result.days.length) fail('Selecciona al menos un día para el chatbot.');
  return result;
}
export function emptyEngagement() {
  return { revision: 0, lines: [], bot: { enabled: false, rules: [], cooldownSeconds: 60, timezone: 'America/Lima', hours: hours() } };
}
export function cleanEngagementConfig(value) {
  if (!object(value) || !object(value.bot)) fail();
  const cleaned = { revision: integer(value.revision ?? 0, 0, Number.MAX_SAFE_INTEGER), lines: rows(value.lines ?? [], 5, line), bot: { enabled: boolean(value.bot.enabled), rules: rows(value.bot.rules ?? [], 50, rule), cooldownSeconds: integer(value.bot.cooldownSeconds ?? 60, 0, 86400), timezone: text(value.bot.timezone ?? 'America/Lima', 80, true), hours: hours(value.bot.hours) } };
  if (new Set(cleaned.lines.map(item => item.phone)).size !== cleaned.lines.length) fail('Ese teléfono ya está registrado en otra línea.');
  if (cleaned.bot.rules.filter(item => item.enabled && item.match === 'fallback').length > 1) fail('Solo puede haber una respuesta general activa.');
  try { new Intl.DateTimeFormat('en', { timeZone: cleaned.bot.timezone }); } catch { fail('La zona horaria no es válida.'); }
  if (new TextEncoder().encode(JSON.stringify(cleaned)).length > 700000) fail('La configuración del chatbot supera el límite permitido.');
  return cleaned;
}
export function normalizedBotText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
}
export function inBusinessHours(bot, at = Date.now()) {
  if (!bot?.hours?.enabled) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: bot.timezone || 'America/Lima', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map(part => [part.type, part.value]));
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const number = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const start = number(bot.hours.start), end = number(bot.hours.end), enabledDay = value => bot.hours.days.includes(value);
  if (start === end) return enabledDay(day);
  if (start < end) return enabledDay(day) && minute >= start && minute < end;
  if (minute >= start) return enabledDay(day);
  return minute < end && enabledDay(day === 1 ? 7 : day - 1);
}
export function matchBotRule(bot, message, { at = Date.now(), ignoreEnabled = false } = {}) {
  if (!bot || (!ignoreEnabled && !bot.enabled) || !inBusinessHours(bot, at)) return null;
  const value = normalizedBotText(message);
  if (!value) return null;
  for (const item of bot.rules || []) {
    if (!item.enabled || item.match === 'fallback') continue;
    if ((item.keywords || []).some(keyword => item.match === 'exact' ? value === normalizedBotText(keyword) : value.includes(normalizedBotText(keyword)))) return item;
  }
  return (bot.rules || []).find(item => item.enabled && item.match === 'fallback') || null;
}
export function personalizeBotReply(body, values = {}) {
  const fields = { nombre: values.nombre ?? values.name ?? '', name: values.name ?? values.nombre ?? '', telefono: values.telefono ?? values.phone ?? '', phone: values.phone ?? values.telefono ?? '', servicio: values.servicio ?? values.service ?? '', servicios: values.servicios ?? values.services ?? values.service ?? '', vence: values.vence ?? values.expires ?? '', perfil: values.perfil ?? values.profile ?? '', negocio: values.negocio ?? values.business ?? '', precio: values.precio ?? values.price ?? '' };
  return String(body).replace(/\{([a-z]+)\}/gi, (placeholder, key) => Object.hasOwn(fields, key.toLowerCase()) ? String(fields[key.toLowerCase()]).slice(0, 1000) : placeholder);
}
