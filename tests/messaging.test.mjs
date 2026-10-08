import test from "node:test";
import assert from "node:assert/strict";
import { manualMessage, conversationEntries } from "../messaging.mjs";
import { emptyGrowth, validateGrowth } from "../growth.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
test("Manual WhatsApp history preserves identity, direction and private schema without delivery claims", () => {
  const s = emptyState(),
    c = { id: "c", name: "Ana" };
  s.growth = emptyGrowth();
  s.growth.interactions = [
    manualMessage(
      c,
      "Hola 👋",
      "received_manual",
      "1",
      new Date("2026-10-08T14:00Z"),
    ),
    manualMessage(
      c,
      "Respuesta",
      "sent_manual",
      "2",
      new Date("2026-10-08T15:00Z"),
    ),
    manualMessage({ id: "other" }, "Otro", "received_manual", "3"),
  ];
  assert.equal(conversationEntries(s, "c").length, 2);
  assert.equal(
    conversationEntries(s, "c")[1].name,
    "Envío confirmado manualmente",
  );
  assert.equal(cleanState(s).growth.interactions[0].network, "WhatsApp");
  assert.throws(() => manualMessage(c, " ", "sent_manual", "4"));
  assert.throws(() => manualMessage(c, "x", "delivered", "4"));
  s.growth.interactions[0].network = "Facebook";
  assert.throws(() => validateGrowth(s.growth));
});
