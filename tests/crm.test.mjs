import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhone,
  fillTemplate,
  whatsappUrl,
  subscriptionStatus,
  todayLima,
  cents,
  availableProfiles,
  validateWorkspace,
  defaultTemplates,
} from "../crm.mjs";

test("Peruvian and international phone normalization rejects malformed numbers", () => {
  for (const phone of [
    "987654321",
    "+51 987 654 321",
    "0051 987654321",
    "51987654321",
  ])
    assert.equal(normalizePhone(phone), "51987654321");
  assert.equal(normalizePhone("+1 (415) 555-2671"), "14155552671");
  for (const phone of [
    "",
    "123",
    "+51 123456789",
    "987abc654321",
    "++51987654321",
  ])
    assert.throws(() => normalizePhone(phone));
});
test("WhatsApp URL round-trips accents, emoji, formatting, newlines and special characters", () => {
  const client = {
    name: "José & Ana",
    phone: "987654321",
    email: "a+b@example.com",
    service: "Max",
    profile: "Perfil 1",
    expires: "2026-11-07",
    pin: "1234",
  };
  const message = fillTemplate(
    "*{servicio}*\n{nombre}\n{correo}\n{contrasena}\n{vence}\n{pin}\n{pago}",
    client,
    "a&b#? ✅",
    { payments: "Yape & Plin" },
  );
  const url = new URL(whatsappUrl(client.phone, message));
  assert.equal(url.pathname, "/51987654321");
  assert.equal(url.searchParams.get("text"), message);
  assert.equal(url.hash, "");
  assert(message.includes("07/11/2026"));
  assert.throws(() => whatsappUrl(client.phone, "  "));
});
test("Expiry boundaries use Lima dates and do not shift with UTC", () => {
  assert.equal(todayLima(new Date("2026-10-07T02:00:00Z")), "2026-10-06");
  assert.equal(subscriptionStatus("2026-10-05", "2026-10-06"), "expired");
  assert.equal(subscriptionStatus("2026-10-06", "2026-10-06"), "soon");
  assert.equal(subscriptionStatus("2026-10-13", "2026-10-06"), "soon");
  assert.equal(subscriptionStatus("2026-10-14", "2026-10-06"), "active");
  assert.equal(subscriptionStatus("", "2026-10-06"), "none");
});
test("Money uses integer cents and rejects invalid precision and values", () => {
  assert.equal(cents("20.50"), 2050);
  assert.equal(cents("0.29"), 29);
  for (const amount of ["-1", "NaN", "1.234", "1e4", "1000000"])
    assert.throws(() => cents(amount));
});
test("Profiles remain occupied until explicitly released, and restore rejects overbooking", () => {
  const a = {
    id: "a",
    service: "Netflix",
    email: "account@example.com",
    provider: "",
    expires: "2026-12-31",
    capacity: 2,
  };
  const client = {
    id: "c",
    name: "Ana",
    email: a.email,
    phone: "51987654321",
    service: a.service,
    profile: "Perfil 1",
    expires: "2026-01-01",
    notes: "",
    accountId: "a",
    pin: "",
    price: 2000,
  };
  assert.deepEqual(availableProfiles(a, [client]), ["Perfil 2"]);
  const state = {
    version: 2,
    clients: [client],
    accounts: [a],
    templates: structuredClone(defaultTemplates),
    combos: [],
    ledger: [],
    settings: { business: "CRM", payments: "", dark: false },
  };
  assert.equal(validateWorkspace(state), state);
  assert.throws(() =>
    validateWorkspace({
      ...state,
      clients: [client, { ...client, id: "second" }],
    }),
  );
  assert.throws(() =>
    validateWorkspace({
      ...state,
      clients: [{ ...client, accountId: "missing" }],
    }),
  );
  assert.throws(() =>
    validateWorkspace({
      ...state,
      accounts: [{ ...a, expires: "2026-02-31" }],
    }),
  );
  assert.throws(() =>
    validateWorkspace({
      ...state,
      ledger: [
        {
          id: "m",
          description: "invalid",
          service: "",
          kind: "sale",
          date: "2026-10-06",
          amount: -100,
        },
      ],
    }),
  );
});
