import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../cloud/state.mjs";
import { availableProfiles } from "../crm.mjs";
import { applyWorkspaceCommand } from "../companions/workspace.mjs";

function fixture() {
  const state = emptyState();
  state.accounts = [{ id: "account", service: "Netflix", email: "fixture@example.test", provider: "Proveedor", expires: "2026-12-31", capacity: 2, password: " fixture value " }];
  state.clients = [{ id: "client", name: "Persona de prueba", phone: "51987654321", email: "fixture@example.test", service: "Netflix", profile: "Perfil 1", expires: "2026-10-01", notes: "Conservar", accountId: "account", pin: "", price: 1500, reminderConsent: true, marketingConsent: false, serviceHistory: [], extraExistingField: "keep" }];
  state.ledger = [{ id: "old-payment", kind: "sale", date: "2026-09-01", description: "Pago anterior", clientId: "client", service: "Netflix", amount: 1500 }];
  let sequence = 0;
  const options = { today: "2026-10-26", now: "2026-10-26T15:00:00Z", createId: () => `new-${++sequence}` };
  return { state, run: (command, input, snapshot = state) => applyWorkspaceCommand(snapshot, command, input, options) };
}

test("adding a second service for one phone leaves the first service intact and records only an actual payment", () => {
  const { state, run } = fixture();
  const next = run("saveClient", { name: "Persona de prueba", phone: "+51 987 654 321", service: "Max", expires: "2026-11-26", price: 1000, pricePending: false, paid: true });
  assert.equal(next.clients.length, 2);
  assert.deepEqual(next.clients[0], state.clients[0]);
  assert.notEqual(next.clients[1].id, state.clients[0].id);
  assert.equal(next.clients[1].phone, state.clients[0].phone);
  assert.equal(next.clients[1].reminderConsent, false);
  assert.equal(next.ledger.length, 2);
  assert.equal(next.ledger[1].clientId, next.clients[1].id);
  assert.equal(state.clients.length, 1);
  assert.equal(state.ledger.length, 1);
});

test("editing preserves lifecycle, consent, password and unrelated modules and never repeats a sale", () => {
  const { state, run } = fixture();
  state.settings.business = "Existing business";
  const next = run("saveClient", { id: "client", notes: "Actualizada", paid: true });
  assert.equal(next.clients[0].notes, "Actualizada");
  assert.equal(next.clients[0].reminderConsent, true);
  assert.equal(next.clients[0].extraExistingField, "keep");
  assert.deepEqual(next.clients[0].serviceHistory, []);
  assert.deepEqual(next.ledger, state.ledger);
  assert.deepEqual(next.accounts, state.accounts);
  assert.deepEqual(next.settings, state.settings);
});

test("blank prices stay unknown while an explicit zero remains a known free service", () => {
  const { run } = fixture();
  const pending = run("saveClient", { id: "client", pricePending: true });
  assert.equal(pending.clients[0].price, 0);
  assert.equal(pending.clients[0].pricePending, true);
  const unchanged = run("saveClient", { id: "client", name: "Nombre actualizado" }, pending);
  assert.equal(unchanged.clients[0].pricePending, true);
  const zero = run("saveClient", { id: "client", price: 0 }, pending);
  assert.equal(zero.clients[0].pricePending, false);
  assert.equal(zero.ledger.length, 1);
  assert.throws(() => run("saveClient", { id: "client", price: 10, pricePending: true }), /pendiente/);
  const newPending = run("saveClient", { name: "Sin precio", paid: true });
  assert.equal(newPending.clients[1].pricePending, true);
  assert.equal(newPending.ledger.length, 1);
});

test("renewal updates only the chosen service, validates dates and adds a payment exactly once", () => {
  const { state, run } = fixture();
  const next = run("renewClient", { id: "client", expires: "2026-11-26", amount: 1500, paid: true });
  assert.equal(next.clients[0].expires, "2026-11-26");
  assert.equal(next.ledger.length, 2);
  assert.equal(next.ledger[1].kind, "renewal");
  assert.throws(() => run("renewClient", { id: "client", expires: "2026-11-26", amount: 1500, paid: true }, next), /posterior/);
  assert.equal(next.ledger.length, 2);
  assert.equal(state.clients[0].expires, "2026-10-01");
  for (const expires of ["2026-02-30", "2026-10-26", "2026-10-01"])
    assert.throws(() => run("renewClient", { id: "client", expires, paid: false }), /vencimiento/);
});

test("unpaid renewal permits unknown amount without a phantom payment and paid renewal requires an amount", () => {
  const { state, run } = fixture();
  state.clients[0].price = 0;
  state.clients[0].pricePending = true;
  const next = run("renewClient", { id: "client", expires: "2026-11-26", amount: null, paid: false });
  assert.equal(next.clients[0].pricePending, true);
  assert.deepEqual(next.ledger, state.ledger);
  assert.throws(() => run("renewClient", { id: "client", expires: "2026-11-26", amount: null, paid: true }), /importe/);
  assert.throws(() => run("renewClient", { id: "client", expires: "2026-11-26", amount: -1, paid: false }), /importe/);
});

test("expired service still occupies its profile and failed assignment cannot mutate original data", () => {
  const { state, run } = fixture();
  const before = structuredClone(state);
  assert.throws(() => run("saveClient", { name: "Otra persona", accountId: "account", profile: "Perfil 1" }), /perfil no está disponible/);
  assert.deepEqual(state, before);
  assert.deepEqual(availableProfiles(state.accounts[0], state.clients), ["Perfil 2"]);
  const next = run("saveClient", { name: "Otra persona", accountId: "account", profile: "Perfil 2" });
  assert.equal(next.clients[1].service, "Netflix");
  assert.equal(next.clients[1].email, "fixture@example.test");
  assert.deepEqual(availableProfiles(next.accounts[0], next.clients), []);
});

test("expired mother account permits metadata edits but refuses new or changed profile assignments", () => {
  const { state, run } = fixture();
  state.accounts[0].expires = "2026-10-01";
  assert.throws(() => run("saveClient", { name: "Nueva persona", accountId: "account", profile: "Perfil 2" }), /cuenta madre/);
  assert.throws(() => run("saveClient", { id: "client", profile: "Perfil 2" }), /cuenta madre/);
  const next = run("saveClient", { id: "client", notes: "Contacto actualizado" });
  assert.equal(next.clients[0].notes, "Contacto actualizado");
});

test("archive releases inventory once and preserves service history, while delete retains historical payments", () => {
  const { state, run } = fixture();
  const archived = run("archiveClient", { id: "client" });
  assert.equal(archived.clients[0].archived, true);
  assert.equal(archived.clients[0].accountId, "");
  assert.equal(archived.clients[0].reminderConsent, false);
  assert.equal(archived.clients[0].serviceHistory[0].profile, "Perfil 1");
  assert.equal(run("archiveClient", { id: "client" }, archived).clients[0].serviceHistory.length, 1);
  assert.deepEqual(archived.ledger, state.ledger);
  assert.throws(() => run("renewClient", { id: "client", expires: "2026-11-26", paid: false }, archived), /Reactiva/);
  const deleted = run("deleteClient", { id: "client" });
  assert.equal(deleted.clients.length, 0);
  assert.deepEqual(deleted.ledger, state.ledger);
  assert.deepEqual(availableProfiles(deleted.accounts[0], deleted.clients), ["Perfil 1", "Perfil 2"]);
});

test("reactivation preserves the old service history and records a new payment only when explicitly paid", () => {
  const { run } = fixture();
  const archived = run("archiveClient", { id: "client" });
  assert.throws(() => run("saveClient", { id: "client", accountId: "account", profile: "Perfil 2" }, archived), /Reactiva/);
  const next = run("saveClient", { id: "client", reactivate: true, expires: "2026-11-26", accountId: "account", profile: "Perfil 2", paid: false }, archived);
  assert.equal(next.clients[0].archived, false);
  assert.equal(next.clients[0].serviceHistory.length, 1);
  assert.equal(next.clients[0].profile, "Perfil 2");
  assert.equal(next.ledger.length, 1);
});

test("account requires explicit capacity and profile removal cannot orphan occupied slots", () => {
  const { state, run } = fixture();
  assert.throws(() => run("saveAccount", { service: "Max", email: "new@example.test", expires: "2026-12-31" }), /capacidad real/);
  const next = run("setCapacity", { id: "account", capacity: 3 });
  assert.deepEqual(availableProfiles(next.accounts[0], next.clients), ["Perfil 2", "Perfil 3"]);
  next.clients[0].profile = "Perfil 3";
  assert.throws(() => run("setCapacity", { id: "account", capacity: 2 }, next), /Libera o reasigna/);
  assert.equal(next.accounts[0].capacity, 3);
  assert.equal(state.accounts[0].capacity, 2);
  assert.throws(() => run("deleteAccount", { id: "account" }), /perfiles ocupados/);
  const deletedClient = run("deleteClient", { id: "client" });
  assert.equal(run("deleteAccount", { id: "account" }, deletedClient).accounts.length, 0);
});

test("account edits propagate access fields and preserve exact password and procurement metadata when omitted", () => {
  const { state, run } = fixture();
  state.accounts[0].costCents = 2000;
  state.accounts[0].costIntervalMonths = 3;
  const next = run("saveAccount", { id: "account", email: "changed@example.test", service: "New platform" });
  assert.equal(next.accounts[0].password, " fixture value ");
  assert.equal(next.accounts[0].costCents, 2000);
  assert.equal(next.accounts[0].costIntervalMonths, 3);
  assert.equal(next.clients[0].email, "changed@example.test");
  assert.equal(next.clients[0].service, "New platform");
  assert.deepEqual(next.ledger, state.ledger);
  const changed = run("saveAccount", { id: "account", password: " new exact value " }, next);
  assert.equal(changed.accounts[0].password, " new exact value ");
});

test("stale selected records and unsupported operations fail instead of creating unintended data", () => {
  const { state, run } = fixture();
  for (const command of ["saveClient", "renewClient", "archiveClient", "deleteClient", "saveAccount", "setCapacity", "deleteAccount"])
    assert.throws(() => run(command, { id: "does-not-exist" }), /ya no existe/);
  assert.throws(() => run("anything", {}), /no disponible/);
  assert.throws(() => run("saveClient", { name: "Unpaid", paid: "false" }), /pago/);
  assert.equal(state.clients.length, 1);
});

test("conversation updates remain validated, copied and isolated from the caller's state", () => {
  const { state, run } = fixture();
  const growth = { segments: [], campaigns: [], posts: [], interactions: [], scoring: { email: 10, phone: 10, active: 20, paid: 30 } };
  const next = run("saveGrowth", { growth });
  assert.deepEqual(next.growth, growth);
  growth.scoring.email = 100;
  assert.equal(next.growth.scoring.email, 10);
  assert.equal(state.growth, undefined);
  assert.throws(() => run("saveGrowth", { growth: { interactions: [] } }), /Marketing/);
});

function groupedFixture() {
  const base = fixture();
  base.state.clients.push({ ...structuredClone(base.state.clients[0]), id: "second-service", phone: "987654321", service: "Max", accountId: "", profile: "", notes: "Notas específicas de Max", price: 900, reminderConsent: false, whatsappUsername: "@existing" });
  base.state.clients.push({ ...structuredClone(base.state.clients[0]), id: "other-contact", name: "Otra persona", phone: "51912345678", accountId: "", profile: "" });
  return base;
}

test("editing a grouped customer's identity updates every normalized-phone service atomically and preserves service details", () => {
  const { state, run } = groupedFixture();
  const next = run("updateContact", { ids: ["second-service", "client"], name: " Nombre actualizado ", phone: "+51 999 888 777" });
  for (let index = 0; index < 2; index++) {
    assert.equal(next.clients[index].name, "Nombre actualizado");
    assert.equal(next.clients[index].phone, "51999888777");
    const { name, phone, ...actual } = next.clients[index];
    const { name: oldName, phone: oldPhone, ...expected } = state.clients[index];
    assert.deepEqual(actual, expected);
  }
  assert.deepEqual(next.clients[2], state.clients[2]);
  assert.deepEqual(next.accounts, state.accounts);
  assert.deepEqual(next.ledger, state.ledger);
  assert.equal(state.clients[0].name, "Persona de prueba");
  assert.equal(state.clients[1].phone, "987654321");
});

test("group identity updates reject partial, duplicate, missing and mixed-contact selections", () => {
  const { state, run } = groupedFixture();
  const before = structuredClone(state);
  for (const ids of [[], ["client", "client"], ["missing"], ["client"], ["client", "other-contact"]])
    assert.throws(() => run("updateContact", { ids, name: "Cambio", phone: "51999888777" }));
  assert.deepEqual(state, before);
  // A newly added service cannot be silently left behind by an older selection.
  state.clients.push({ ...structuredClone(state.clients[1]), id: "newly-added" });
  assert.throws(() => run("updateContact", { ids: ["client", "second-service"], name: "Cambio" }), /otros servicios/);
});

test("group identity cannot silently merge with another existing contact", () => {
  const { state, run } = groupedFixture();
  assert.throws(() => run("updateContact", { ids: ["client", "second-service"], name: "Cambio", phone: "+51 912 345 678" }), /otro contacto/);
  assert.equal(state.clients[0].phone, "51987654321");
  assert.throws(() => run("updateContact", { ids: ["client", "second-service"], name: "Cambio", phone: "" }), /mantener juntos/);
});

test("contact updates require a name and can update a WhatsApp reference without changing service information", () => {
  const { run } = groupedFixture();
  for (const name of ["", "   ", undefined, "n".repeat(121)])
    assert.throws(() => run("updateContact", { ids: ["client", "second-service"], name }), /nombre/);
  const next = run("updateContact", { ids: ["client", "second-service"], name: "Nuevo nombre", whatsappUsername: " @new-reference " });
  assert.equal(next.clients[0].phone, "51987654321");
  assert.equal(next.clients[1].phone, "51987654321");
  assert.equal(next.clients[0].whatsappUsername, "@new-reference");
  assert.equal(next.clients[1].whatsappUsername, "@new-reference");
  assert.equal(next.clients[1].notes, "Notas específicas de Max");
});

test("blank-phone fichas remain distinct contacts and a single ficha may clear or repair its number", () => {
  const { state, run } = fixture();
  state.clients[0].phone = "";
  state.clients.push({ ...structuredClone(state.clients[0]), id: "another-blank", accountId: "", profile: "" });
  assert.throws(() => run("updateContact", { ids: ["client", "another-blank"], name: "Mix" }), /contactos diferentes/);
  const updated = run("updateContact", { ids: ["client"], name: "Solo una ficha", phone: "" });
  assert.equal(updated.clients[0].phone, "");
  assert.equal(updated.clients[1].name, "Persona de prueba");
  const repaired = run("updateContact", { ids: ["client"], name: "Con teléfono", phone: "999888777" });
  assert.equal(repaired.clients[0].phone, "51999888777");
});

test("deleting a complete contact releases all its services and preserves financial and conversation history", () => {
  const { state, run } = groupedFixture();
  state.growth = { segments: [], campaigns: [], posts: [], interactions: [{ id: "interaction", name: "Entrada de prueba", clientId: "client", network: "WhatsApp", kind: "received_manual", body: "Texto de prueba", agent: "", outcome: "open", occurredAt: "2026-10-26T15:00:00Z" }], scoring: { email: 10, phone: 10, active: 20, paid: 30 } };
  const next = run("deleteContact", { ids: ["client", "second-service"] });
  assert.deepEqual(next.clients.map(client => client.id), ["other-contact"]);
  assert.deepEqual(next.ledger, state.ledger);
  assert.deepEqual(next.growth, state.growth);
  assert.deepEqual(availableProfiles(next.accounts[0], next.clients), ["Perfil 1", "Perfil 2"]);
  assert.equal(state.clients.length, 3);
  assert.throws(() => run("deleteContact", { ids: ["client"] }), /otros servicios/);
  assert.throws(() => run("deleteContact", { ids: ["client", "other-contact"] }), /contactos diferentes/);
});
