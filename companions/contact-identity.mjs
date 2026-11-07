// Usernames are identifiers only when entered in the explicit field, or when
// the complete visible name is an @handle. Ordinary display names are never keys.
export function canonicalUsername(value) {
  if (typeof value !== "string") return "";
  const name = value.trim().replace(/^@/, "");
  return /^[a-z0-9_][a-z0-9._]{1,63}$/i.test(name) ? "@" + name.toLowerCase() : "";
}

export function normalizeCompanionUsername(value) {
  return typeof value === "string" && value.trim().startsWith("@") ? canonicalUsername(value) : "";
}

export function contactUsername(client) {
  return canonicalUsername(client?.whatsappUsername) || canonicalUsername(client?.username) || normalizeCompanionUsername(client?.name);
}

export function normalizeContactPhone(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^\+?[\d\s().-]+$/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Existing CRM records accept a local Peruvian mobile number. This applies
  // only to stored contacts; WhatsApp page context never infers a country.
  if (/^9\d{8}$/.test(digits)) digits = "51" + digits;
  return /^[1-9]\d{7,14}$/.test(digits) && (!digits.startsWith("51") || /^519\d{8}$/.test(digits)) ? digits : "";
}
const contactPhone = client => normalizeContactPhone(client?.phone);

export function contactGroup(clients, selected) {
  if (!Array.isArray(clients) || !selected) return [];
  const phoneSets = new Map();
  for (const client of clients) {
    const username = contactUsername(client), number = contactPhone(client);
    if (!username) continue;
    if (!phoneSets.has(username)) phoneSets.set(username, new Set());
    if (number) phoneSets.get(username).add(number);
  }
  const selectedUsername = contactUsername(selected), selectedPhones = phoneSets.get(selectedUsername);
  const number = contactPhone(selected) || (selectedPhones?.size === 1 ? [...selectedPhones][0] : "");
  if (!number) return clients.filter(client => client.id === selected.id || selectedUsername && !selectedPhones?.size && contactUsername(client) === selectedUsername);
  const usernames = new Set(clients.filter(client => contactPhone(client) === number).map(contactUsername).filter(username => username && phoneSets.get(username)?.size === 1));
  return clients.filter(client => client.id === selected.id || contactPhone(client) === number || !contactPhone(client) && usernames.has(contactUsername(client)));
}

export function contactKey(clients, selected) {
  const group = contactGroup(clients, selected);
  const phones = [...new Set(group.map(contactPhone).filter(Boolean))];
  if (phones.length === 1) return "phone:" + phones[0];
  const username = contactUsername(selected);
  if (username && group.every(client => contactUsername(client) === username) && !phones.length) {
    const conflicting = clients.some(client => contactUsername(client) === username && contactPhone(client));
    if (!conflicting) return "username:" + username;
  }
  return "client:" + String(selected?.id || "");
}
