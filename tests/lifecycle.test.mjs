import test from "node:test";
import assert from "node:assert/strict";
import { archiveContact, isFormer, validateLifecycle } from "../lifecycle.mjs";
import { segmentContacts } from "../growth.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
import { ruleTask } from "../automation.mjs";
const client = {
  id: "c",
  name: "Ana",
  phone: "51987654321",
  email: "",
  service: "Netflix",
  accountId: "",
  profile: "Perfil 1",
  pin: "1234",
  expires: "2026-10-01",
  notes: "",
  price: 1200,
  reminderConsent: true,
};
test("archive releases profile and preserves immutable service history and contact identity", () => {
  const old = { ...client, accountId: "a" };
  const archived = archiveContact(old, "2026-10-07T14:00:00Z");
  assert.equal(archived.id, old.id);
  assert.equal(archived.accountId, "");
  assert.equal(archived.profile, "");
  assert.equal(archived.serviceHistory[0].accountId, "a");
  assert.equal(archived.serviceHistory[0].price, 1200);
  assert.equal(archived.reminderConsent, false);
  assert.equal(old.accountId, "a");
  assert.equal(
    archiveContact(archived, "2026-10-08T14:00:00Z").serviceHistory.length,
    1,
  );
  validateLifecycle(archived);
});
test("old, expired and archived contacts remain segmentable and persist privately", () => {
  const state = emptyState();
  state.clients = [archiveContact(client, "2026-10-07T14:00:00Z")];
  assert(isFormer(state.clients[0], "2026-10-07"));
  assert.equal(
    segmentContacts(
      { query: "", service: "", status: "former", minScore: 0 },
      state,
      "2026-10-07",
    ).length,
    1,
  );
  assert.equal(cleanState(state).clients[0].serviceHistory.length, 1);
  state.clients[0].archived = "yes";
  assert.throws(() => cleanState(state));
});
test("former-contact rule needs marketing consent and legacy reminders exclude archives", async () => {
  const state = emptyState();
  const c = archiveContact(client, "2026-10-07T14:00:00Z");
  const rule = {
    id: "r",
    name: "Reventa",
    enabled: true,
    templateId: state.templates[0].id,
    delivery: "manual",
    daysBefore: -6,
    hour: 9,
    services: [],
    meta: { templateName: "", language: "es", parameters: [] },
  };
  const options = { now: new Date("2026-10-07T15:00:00Z") };
  assert.equal(await ruleTask(state, rule, c, options), null);
  rule.audience = "former";
  assert.equal(await ruleTask(state, rule, c, options), null);
  c.marketingConsent = true;
  assert(await ruleTask(state, rule, c, options));
});
