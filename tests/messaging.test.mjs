import test from "node:test";
import assert from "node:assert/strict";
import {
  manualMessage,
  conversationEntries,
  whatsappContact,
  whatsappMessageLink,
} from "../messaging.mjs";
import { emptyGrowth, validateGrowth } from "../growth.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";

test("Mobile WhatsApp contacts normalize Peruvian numbers and prefer a valid phone", () => {
  for (const phone of ["987654321", "+51 987 654 321", "51987654321", "0051 (987) 654-321"])
    assert.deepEqual(whatsappContact({ phone, whatsappUsername: "@Ana_01" }), {
      kind: "phone",
      phone: "51987654321",
      username: "@ana_01",
    });
  assert.equal(whatsappContact({ phone: "+1 (202) 555-0123" }).phone, "12025550123");
  assert.deepEqual(whatsappContact({ name: "Ana" }), {
    kind: "missing", phone: "", username: "",
  });
});

test("Mobile WhatsApp links encode the complete message and contain only normalized phone digits", () => {
  const text = "Hola Ana 👋\nRenovación & entrega + pago: S/ 20? #sí";
  const link = whatsappMessageLink({ phone: "987 654 321" }, text);
  const url = new URL(link.url);
  assert.equal(link.kind, "phone");
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/51987654321");
  assert.equal(url.searchParams.get("text"), text);
  assert.deepEqual([...url.searchParams.keys()], ["text"]);
  assert.equal(url.hash, "");
});

test("Username-only contacts use WhatsApp sharing and preserve a copyable username", () => {
  for (const client of [
    { whatsappUsername: " @Ana.01 " },
    { name: "@Ana.01" },
    { phone: "bad number", whatsappUsername: "ana.01" },
  ]) {
    const link = whatsappMessageLink(client, "Entrega lista");
    assert.equal(link.kind, "username");
    assert.equal(link.username, "@ana.01");
    assert.equal(link.phone, "");
    assert.equal(link.url, "https://wa.me/?text=Entrega%20lista");
    assert.equal(new URL(link.url).pathname, "/");
  }
});

test("Mobile WhatsApp links reject missing contacts and invalid text without changing records", () => {
  const client = Object.freeze({ id: "c", name: "Ana", phone: "987654321" });
  for (const value of [undefined, null, 12, "", " \n "])
    assert.throws(() => whatsappMessageLink(client, value), /Escribe un mensaje/);
  assert.throws(() => whatsappMessageLink(client, "a".repeat(8001)), /8000/);
  assert.doesNotThrow(() => whatsappMessageLink(client, "a".repeat(8000)));
  for (const invalid of [
    null,
    { name: "Ana" },
    { phone: "+51 123456789" },
    { phone: "https://wa.me/51987654321" },
    { name: "Ana @ana.01" },
    { whatsappUsername: "@ana.01?text=other" },
  ]) {
    assert.equal(whatsappContact(invalid).kind, "missing");
    assert.throws(() => whatsappMessageLink(invalid, "Hola"), /teléfono válido o un @usuario/);
  }
  assert.equal(client.phone, "987654321");
});

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
