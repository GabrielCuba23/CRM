import test from "node:test";
import assert from "node:assert/strict";
import { promotionPrice, validatePromotions } from "../promotions.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
test("Custom percentages, cent rounding, capped soles and bonus gift preserve exact totals", () => {
  for (const percent of [500, 1000, 1500, 2000])
    assert.equal(
      promotionPrice(10000, { kind: "percent", value: percent }).final,
      10000 - percent,
    );
  assert.equal(promotionPrice(999, { kind: "percent", value: 500 }).final, 949);
  assert.equal(promotionPrice(500, { kind: "amount", value: 1000 }).final, 0);
  assert.equal(
    promotionPrice(1234, {
      kind: "gift",
      value: 0,
      giftService: "Spotify 30 días",
    }).final,
    1234,
  );
  assert.equal(
    promotionPrice(1500, { kind: "percent", value: 10000 }).final,
    0,
  );
  assert.throws(() => promotionPrice(1000, { kind: "percent", value: 10001 }));
  assert.throws(() => promotionPrice(1000, { kind: "amount", value: -1 }));
});
test("Promotion snapshots roundtrip, old backups work and forged totals fail", () => {
  const state = emptyState();
  assert.deepEqual(cleanState(state).promotions, {
    offers: [],
    applications: [],
  });
  state.promotions = {
    offers: [
      {
        id: "o",
        name: "Especial",
        kind: "percent",
        value: 1000,
        giftService: "",
        notes: "",
      },
    ],
    applications: [
      {
        id: "a",
        clientId: "c",
        offerId: "o",
        name: "Especial",
        kind: "percent",
        value: 1000,
        giftService: "",
        notes: "Solo este ciclo",
        service: "Max",
        occurredAt: "2026-10-08T14:00:00Z",
        ledgerId: "",
        updateClientPrice: false,
        base: 2000,
        discount: 200,
        final: 1800,
      },
    ],
  };
  assert.equal(cleanState(state).promotions.applications[0].final, 1800);
  state.promotions.offers[0].value = 2000;
  assert.equal(
    validatePromotions(state.promotions).applications[0].value,
    1000,
  );
  state.promotions.applications[0].final = 1900;
  assert.throws(() => cleanState(state));
});
