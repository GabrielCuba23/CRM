import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyProcurement,
  accountMargin,
  validateProcurement,
} from "../procurement.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
const catalog = () => ({
  suppliers: [{ id: "s", name: "Proveedor", email: "", phone: "", notes: "" }],
  offers: [
    {
      id: "o",
      name: "Netflix",
      supplierId: "s",
      type: "product",
      costCents: 4000,
      intervalMonths: 1,
      capacity: 5,
      notes: "",
    },
    {
      id: "tool",
      name: "Hosting",
      supplierId: "s",
      type: "business",
      costCents: 12000,
      intervalMonths: 12,
      capacity: 1,
      notes: "",
    },
  ],
});
test("an unknown sale price leaves forecast margins pending, while an explicit zero stays known", () => {
  const account = { id: "a", costCents: 1000, capacity: 2 };
  const clients = [
    { id: "known", name: "Sin cargo", accountId: "a", price: 0 },
    { id: "pending", name: "Por completar", accountId: "a", price: 0, pricePending: true },
  ];
  const result = accountMargin(account, clients);
  assert.equal(result.revenue, null);
  assert.equal(result.margin, null);
  assert.equal(result.profiles[0].price, 0);
  assert.equal(result.profiles[0].margin, -500);
  assert.equal(result.profiles[1].price, null);
  assert.equal(result.profiles[1].margin, null);
  assert.equal(accountMargin(account, clients.slice(0, 1)).revenue, 0);
});
test("account margin allocates all capacity, includes unsold cost and does not mutate cash ledger", () => {
  const a = { id: "a", costCents: 4000, capacity: 5 };
  const c = [{ id: "c", name: "Ana", accountId: "a", price: 1200 }];
  assert.deepEqual(accountMargin(a, c), {
    cost: 4000,
    revenue: 1200,
    margin: -2800,
    unitCost: 800,
    occupied: 1,
    capacity: 5,
    profiles: [{ id: "c", name: "Ana", price: 1200, margin: 400 }],
  });
  assert.equal(accountMargin({ id: "old", capacity: 5 }, []), null);
  assert.equal(
    accountMargin({ id: "free", costCents: 0, capacity: 5 }, []).margin,
    0,
  );
});
test("supplier catalog and historical account/payment costs survive private schema, changed offer price leaves snapshot unchanged", () => {
  const state = emptyState();
  state.procurement = catalog();
  state.accounts = [
    {
      id: "a",
      service: "Netflix",
      email: "a@example.com",
      provider: "Proveedor",
      expires: "2099-01-01",
      capacity: 5,
      supplierId: "s",
      offerId: "o",
      costCents: 4000,
      costIntervalMonths: 1,
    },
  ];
  state.ledger = [
    {
      id: "m",
      date: "2026-10-07",
      kind: "expense",
      amount: 4000,
      description: "Compra",
      service: "Netflix",
      supplierId: "s",
      offerId: "o",
      accountId: "a",
      category: "purchase",
      reference: "001",
    },
  ];
  state.procurement.offers[0].costCents = 5000;
  const clean = cleanState(state);
  assert.equal(clean.accounts[0].costCents, 4000);
  assert.equal(clean.ledger[0].amount, 4000);
  assert.deepEqual(clean.procurement, state.procurement);
  state.accounts[0].offerId = "tool";
  assert.throws(() => cleanState(state));
});
test("invalid supplier references, fractions, negative costs and duplicate IDs rejected; old workspaces stay compatible", () => {
  assert.deepEqual(validateProcurement(), emptyProcurement());
  const p = catalog();
  p.offers[0].costCents = -1;
  assert.throws(() => validateProcurement(p));
  p.offers[0].costCents = 1.5;
  assert.throws(() => validateProcurement(p));
  p.offers[0].costCents = 100;
  p.offers[0].supplierId = "missing";
  assert.throws(() => validateProcurement(p));
  assert.deepEqual(cleanState(emptyState()).procurement, emptyProcurement());
});
