import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyGrowth,
  validateGrowth,
  leadScore,
  segmentContacts,
  socialMetrics,
} from "../growth.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
test("dynamic segmentation scores actual payments and caps at 100", () => {
  const state = emptyState();
  state.growth = emptyGrowth();
  state.clients = [
    {
      id: "a",
      name: "Ana",
      email: "ana@example.com",
      phone: "51911111111",
      service: "Netflix",
      profile: "",
      expires: "2099-01-01",
      notes: "familia",
      whatsappUsername: "",
      accountId: "",
      pin: "",
      price: 2000,
    },
  ];
  state.ledger = [];
  assert.equal(leadScore(state.clients[0], state, "2026-10-07"), 40);
  state.ledger = [
    {
      id: "pay",
      clientId: "a",
      kind: "sale",
      amount: 2000,
      service: "Netflix",
      date: "2026-10-07",
      description: "Pago",
    },
  ];
  assert.equal(leadScore(state.clients[0], state, "2026-10-07"), 70);
  const segment = {
    query: "familia",
    service: "Netflix",
    status: "active",
    minScore: 70,
  };
  assert.equal(segmentContacts(segment, state, "2026-10-07").length, 1);
  segment.minScore = 71;
  assert.equal(segmentContacts(segment, state, "2026-10-07").length, 0);
  state.growth.scoring.paid = 100;
  assert.equal(leadScore(state.clients[0], state, "2026-10-07"), 100);
});
test("draft campaigns and social interactions persist with strict validation", () => {
  const state = emptyState(),
    g = emptyGrowth();
  g.segments.push({
    id: "seg",
    name: "Familias",
    query: "",
    service: "Netflix",
    status: "all",
    persona: "Familias",
    minScore: 0,
  });
  g.campaigns.push({
    id: "c",
    name: "Oferta",
    channel: "whatsapp",
    segmentId: "seg",
    subject: "",
    body: "Hola {nombre}",
    status: "draft",
  });
  g.posts.push({
    id: "p",
    name: "Post",
    network: "Instagram",
    body: "Oferta",
    scheduledAt: "2026-10-10T14:00:00Z",
    status: "draft",
  });
  g.interactions.push({
    id: "i",
    name: "Consulta",
    clientId: "contact",
    network: "Instagram",
    kind: "dm",
    body: "Precio",
    agent: "Gabriel",
    outcome: "won",
    occurredAt: "2026-10-07T14:00:00Z",
  });
  state.growth = g;
  assert.deepEqual(cleanState(state).growth, g);
  assert.equal(socialMetrics(g).find((m) => m.network === "Instagram").won, 1);
  g.posts[0].status = "published";
  assert.throws(() => validateGrowth(g));
});

test("branding preserves raster logos and rejects active markup", () => {
  const state = emptyState();
  state.settings.crmName = "Mi marca";
  state.settings.logoDataUrl = "data:image/png;base64,YQ==";
  assert.equal(cleanState(state).settings.crmName, "Mi marca");
  assert.equal(
    cleanState(state).settings.logoDataUrl,
    state.settings.logoDataUrl,
  );
  state.settings.logoDataUrl = "data:image/svg+xml;base64,YQ==";
  assert.throws(() => cleanState(state));
});
