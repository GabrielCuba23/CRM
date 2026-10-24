import test from "node:test";
import assert from "node:assert/strict";
import {
  importVisibleMessages,
  matchContact,
  normalizeCompanionPhone,
  visibleMessageLimit,
} from "../companions/conversations.mjs";
import { emptyGrowth } from "../growth.mjs";
import { cleanState, emptyState } from "../cloud/state.mjs";

const context = {
  name: "Ana",
  phone: "+51 912 345 678",
  chatId: "direct-51912345678",
  isGroup: false,
};
const client = {
  id: "ana-netflix",
  name: "Ana",
  phone: "51912345678",
  whatsappUsername: "",
  email: "ana@example.com",
  service: "Netflix",
  profile: "",
  expires: "",
  notes: "",
  accountId: "",
  pin: "",
  price: 0,
};
const captured = (overrides = {}) => ({
  id: "false_51912345678@c.us_ABC123",
  direction: "received",
  body: "Hola, quisiera renovar Netflix 👋",
  phone: context.phone,
  chatId: context.chatId,
  ...overrides,
});
const now = new Date("2026-10-24T15:00:00.000Z");

test("Contact linking never guesses country or display-name identity, and preserves all services for the same phone", () => {
  assert.equal(normalizeCompanionPhone("+51 (912) 345-678"), "51912345678");
  assert.equal(normalizeCompanionPhone("0051912345678"), "51912345678");
  assert.throws(() => normalizeCompanionPhone("912345678"));
  assert.throws(() => normalizeCompanionPhone("51912345678@s.whatsapp.net"));
  const sameName = { ...client, id: "other", phone: "51987654321" };
  const otherService = { ...client, id: "ana-disney", service: "Disney+" };
  assert.equal(matchContact([sameName], context).reason, "new");
  assert.equal(matchContact([client], { name: "Ana" }).reason, "missing-phone");
  assert.equal(matchContact([client], { phone: "912345678" }).reason, "invalid-phone");
  assert.equal(matchContact([client], { ...context, isGroup: true }).reason, "group");
  const match = matchContact([client, sameName, otherService], context);
  assert.equal(match.reason, "ambiguous");
  assert.deepEqual(match.matches.map((row) => row.id), [client.id, otherService.id]);
  assert.equal(matchContact([client], context).matches[0], client);
});

test("Visible conversation capture survives private schema, treats content as text, and never claims delivery", async () => {
  const original = emptyGrowth();
  const htmlText = '<img src=x onerror="steal()"> texto literal';
  const result = await importVisibleMessages(original, client, context, [
    captured({ body: htmlText, secret: "ignored", html: "ignored" }),
    captured({ id: "outbound", direction: "sent", body: "Listo", occurredAt: "2026-10-24T09:55:00-05:00" }),
  ], { now, expectedChatId: context.chatId });
  assert.equal(result.count, 2);
  assert.equal(original.interactions.length, 0);
  assert.equal(result.growth.interactions[0].body, htmlText);
  assert.equal(result.growth.interactions[0].agent, "WhatsApp Web visible");
  assert.match(result.growth.interactions[0].name, /hora de captura/);
  assert.equal(result.growth.interactions[0].occurredAt, now.toISOString());
  assert.equal(result.growth.interactions[1].occurredAt, "2026-10-24T14:55:00.000Z");
  assert.equal(result.growth.interactions[1].kind, "sent_manual");
  assert.doesNotMatch(result.growth.interactions[1].name, /entregado|confirmado|API/i);
  assert.equal(result.growth.interactions[0].secret, undefined);
  const state = emptyState();
  state.clients = [client];
  state.growth = result.growth;
  assert.deepEqual(cleanState(state).growth, result.growth);
});

test("Repeated captures deduplicate deterministically even after reload; client and direction remain separate", async () => {
  const first = await importVisibleMessages(undefined, client, context, [captured(), captured()], { now });
  assert.equal(first.count, 1);
  assert.equal(first.duplicates, 1);
  const restored = JSON.parse(JSON.stringify(first.growth));
  const second = await importVisibleMessages(restored, client, context, [captured()], { now: new Date("2027-01-01T00:00:00Z") });
  assert.equal(second.count, 0);
  assert.equal(second.duplicates, 1);
  const other = await importVisibleMessages(undefined, { ...client, id: "ana-disney" }, context, [captured()], { now });
  assert.notEqual(first.growth.interactions[0].id, other.growth.interactions[0].id);
  const otherDirection = await importVisibleMessages(first.growth, client, context, [captured({ direction: "sent" })], { now });
  assert.equal(otherDirection.count, 1);
});

test("Chat switching, groups, unverified row identity and client phone mismatch cannot attach messages", async () => {
  const original = emptyGrowth();
  const refuse = (selected, chat, messages, options) =>
    assert.rejects(() => importVisibleMessages(original, selected, chat, messages, { now, ...options }));
  await refuse(client, { ...context, isGroup: true }, [captured()]);
  await refuse(client, { ...context, phone: "" }, [captured()]);
  await refuse({ ...client, phone: "51987654321" }, context, [captured()]);
  await refuse(client, context, [captured()], { expectedChatId: "another-chat" });
  await refuse(client, context, [captured({ chatId: "another-chat" })]);
  await refuse(client, context, [captured({ phone: "51987654321" })]);
  await refuse(client, context, [captured({ phone: undefined })]);
  await refuse(client, context, [captured(), captured({ id: "second", chatId: "another-chat" })]);
  assert.deepEqual(original, emptyGrowth());
});

test("Capture skips unsupported/non-text rows, requires stable IDs and validates bounded batches", async () => {
  const result = await importVisibleMessages(undefined, client, context, [
    captured({ id: "" }),
    captured({ id: "attachment", body: { html: "<b>Not text</b>" } }),
    captured({ id: "large", body: "x".repeat(8001) }),
    captured({ id: "blank", body: "  " }),
    captured({ id: "fake-direction", direction: "delivered" }),
    captured({ id: "bad-date", occurredAt: "Ayer a las 14:00" }),
    captured({ id: "valid" }),
  ], { now });
  assert.equal(result.count, 1);
  assert.equal(result.skipped, 6);
  await assert.rejects(() => importVisibleMessages(undefined, client, context,
    Array.from({ length: visibleMessageLimit + 1 }, (_, index) => captured({ id: String(index) })), { now }));
  await assert.rejects(() => importVisibleMessages(undefined, client, context, [captured()], { now: "invalid" }));
});
