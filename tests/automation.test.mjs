import test from "node:test";
import assert from "node:assert/strict";
import { buildRuleTasks } from "../automation.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
import { validateWorkspace } from "../crm.mjs";
const now = new Date("2026-10-06T14:00:00Z");
function fixture() {
  const state = emptyState();
  state.clients = [
    {
      id: "client",
      name: "José & Ana",
      phone: "987654321",
      email: "owner+test@example.com",
      service: "Max",
      expires: "2026-10-09",
      profile: "Perfil 1",
      pin: "",
      price: 0,
      accountId: "",
      notes: "",
      reminderConsent: true,
    },
  ];
  state.templates = [
    {
      id: "message",
      name: "Mi mensaje",
      context: "Libre",
      body: "Hola {nombre} 👋\n*{servicio}* vence {vence} & 📍",
    },
  ];
  state.rules = [
    {
      id: "rule",
      name: "Tres días antes",
      enabled: true,
      templateId: "message",
      daysBefore: 3,
      hour: 9,
      services: ["Max"],
      delivery: "manual",
      meta: {
        templateName: "",
        language: "es",
        parameters: ["nombre", "servicio", "vence"],
      },
    },
  ];
  return state;
}
test("Flexible rules support arbitrary contexts, filters and before/after schedules in Lima", async () => {
  const state = fixture();
  let tasks = await buildRuleTasks(state, { now });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].phone, "51987654321");
  assert.equal(
    new URL(tasks[0].whatsappUrl).searchParams.get("text"),
    tasks[0].text,
  );
  assert.equal(
    (await buildRuleTasks(state, { now: new Date("2026-10-06T13:59:00Z") }))
      .length,
    0,
  );
  assert.equal(
    (await buildRuleTasks(state, { now: new Date("2026-10-07T02:00:00Z") }))[0]
      .dueDate,
    "2026-10-06",
  );
  state.rules[0].services = ["Netflix"];
  assert.equal((await buildRuleTasks(state, { now })).length, 0);
  state.rules[0].services = [];
  state.rules[0].daysBefore = -1;
  assert.equal((await buildRuleTasks(state, { now })).length, 0);
  assert.equal(
    (await buildRuleTasks(state, { now: new Date("2026-10-10T14:00:00Z") }))[0]
      .dueDate,
    "2026-10-10",
  );
});
test("Confirmation, changed expiry, consent and disabled rules control task creation", async () => {
  const state = fixture(),
    task = (await buildRuleTasks(state, { now }))[0];
  state.taskReceipts = [
    { id: task.id, signature: task.signature, completedAt: now.toISOString() },
  ];
  assert.equal((await buildRuleTasks(state, { now })).length, 0);
  state.clients[0].expires = "2026-10-10";
  assert.equal(
    (await buildRuleTasks(state, { now: new Date("2026-10-07T14:00:00Z") }))
      .length,
    1,
  );
  state.clients[0].reminderConsent = false;
  assert.equal(
    (await buildRuleTasks(state, { now: new Date("2026-10-07T14:00:00Z") }))
      .length,
    0,
  );
  state.clients[0].reminderConsent = true;
  state.rules[0].enabled = false;
  assert.equal(
    (await buildRuleTasks(state, { now: new Date("2026-10-07T14:00:00Z") }))
      .length,
    0,
  );
});
test("Rules are not restricted to three slots and scheduled passwords and unknown secrets are rejected", async () => {
  const state = fixture();
  state.rules = Array.from({ length: 35 }, (_, i) => ({
    ...structuredClone(state.rules[0]),
    id: "r" + i,
  }));
  validateWorkspace(state);
  assert.equal((await buildRuleTasks(state, { now })).length, 35);
  state.rules[0].token = "not-stored";
  state.rules[0].meta.secret = "not-stored";
  const clean = cleanState(state);
  assert.equal(clean.rules[0].token, undefined);
  assert.equal(clean.rules[0].meta.secret, undefined);
  state.templates[0].body = "{contrasena}";
  assert.throws(() => validateWorkspace(state));
  assert.equal((await buildRuleTasks(state, { now })).length, 0);
});
test("Old backups remain valid and malformed rules fail validation", () => {
  const old = emptyState();
  delete old.rules;
  delete old.taskReceipts;
  validateWorkspace(old);
  assert.deepEqual(cleanState(old).rules, []);
  for (const mutate of [
    (s) => (s.rules[0].daysBefore = 1.5),
    (s) => (s.rules[0].hour = 24),
    (s) => (s.rules[0].delivery = "unsupported"),
    (s) => (s.rules[0].meta.parameters = ["contrasena"]),
    (s) => (s.rules[0].templateId = "missing"),
  ]) {
    const state = fixture();
    mutate(state);
    assert.throws(() => validateWorkspace(state));
  }
});
