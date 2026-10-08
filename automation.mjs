import { isFormer } from "./lifecycle.mjs";
import {
  fillTemplate,
  normalizePhone,
  todayLima,
  validDate,
  whatsappUrl,
} from "./crm.mjs";
export const deliveryLabels = {
  manual: "WhatsApp con mi confirmación",
  integration: "Zapier / Make / n8n",
  meta: "API oficial de Meta",
};
export function taskIdentity(rule, client) {
  return JSON.stringify([rule.id, client.id, client.expires]);
}
export function ruleDueDate(rule, client) {
  if (!validDate(client.expires)) return null;
  return new Date(
    Date.parse(client.expires + "T12:00:00Z") - rule.daysBefore * 86400000,
  )
    .toISOString()
    .slice(0, 10);
}
export async function fingerprint(value) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function ruleTask(
  state,
  rule,
  client,
  { now = new Date(), includeFuture = false } = {},
) {
  const former = isFormer(client, todayLima(now));
  if (!rule.enabled || !client.expires) return null;
  if (rule.audience === "former") {
    if (!former || !client.marketingConsent) return null;
  } else {
    if (
      client.archived ||
      !client.reminderConsent ||
      (rule.audience === "current" && former)
    )
      return null;
  }
  if (
    rule.services.length &&
    !rule.services.some(
      (s) => s.toLocaleLowerCase() === client.service.toLocaleLowerCase(),
    )
  )
    return null;
  const dueDate = ruleDueDate(rule, client);
  if (!dueDate) return null;
  const day = todayLima(now),
    hour = Number(
      new Intl.DateTimeFormat("en", {
        hour: "numeric",
        hourCycle: "h23",
        timeZone: "America/Lima",
      }).format(now),
    );
  // Recover unfinished tasks for seven days. Renewal generates a new identity.
  const latest = new Date(Date.parse(dueDate + "T12:00:00Z") + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  if (
    !includeFuture &&
    (day < dueDate || (day === dueDate && hour < rule.hour) || day > latest)
  )
    return null;
  const template = state.templates.find((t) => t.id === rule.templateId);
  if (!template) return null;
  // Passwords are deliberately absent from scheduled tasks and integration payloads.
  if (template.body.includes("{contrasena}")) return null;
  let phone, text, link;
  try {
    phone = normalizePhone(client.phone);
    text = fillTemplate(template.body, client, "", state.settings);
    link = whatsappUrl(phone, text);
  } catch {
    return null;
  }
  const id = taskIdentity(rule, client),
    signature = await fingerprint({ rule, phone, text, dueDate });
  if ((state.taskReceipts || []).some((r) => r.id === id)) return null;
  return {
    id,
    signature,
    ruleId: rule.id,
    ruleName: rule.name,
    clientId: client.id,
    clientName: client.name,
    expires: client.expires,
    dueDate,
    hour: rule.hour,
    delivery: rule.delivery,
    phone,
    text,
    whatsappUrl: link,
    meta: rule.meta,
  };
}
export async function buildRuleTasks(state, options = {}) {
  const tasks = [];
  for (const rule of state.rules || [])
    for (const client of state.clients) {
      const task = await ruleTask(state, rule, client, options);
      if (task) tasks.push(task);
    }
  return tasks.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.hour - b.hour ||
      a.clientName.localeCompare(b.clientName),
  );
}
