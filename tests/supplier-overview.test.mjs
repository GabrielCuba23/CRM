import test from "node:test";
import assert from "node:assert/strict";
import { supplierOverview } from "../supplier-overview.mjs";
import { validateProcurement } from "../procurement.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
const fixture = () => {
  const s = emptyState();
  s.procurement = {
    suppliers: [
      {
        id: "p",
        name: "Proveedor",
        phone: "987654321",
        email: "p@example.com",
        notes: "",
      },
    ],
    offers: [
      {
        id: "o",
        supplierId: "p",
        name: "Hosting",
        type: "business",
        costCents: 12000,
        intervalMonths: 12,
        capacity: 1,
        notes: "",
        nextRenewal: "2026-10-11",
      },
      {
        id: "catalog",
        supplierId: "p",
        name: "No comprado",
        type: "product",
        costCents: 99900,
        intervalMonths: 1,
        capacity: 5,
        notes: "",
      },
    ],
  };
  s.accounts = [
    {
      id: "a",
      service: "Netflix",
      email: "account@example.com",
      provider: "Proveedor",
      supplierId: "p",
      capacity: 5,
      expires: "2026-10-12",
      costCents: 5000,
      costIntervalMonths: 1,
    },
    {
      id: "unknown",
      service: "Max",
      email: "old@example.com",
      provider: "Sin contacto",
      capacity: 5,
      expires: "2099-01-01",
    },
  ];
  s.ledger = [
    {
      id: "l",
      kind: "expense",
      date: "2026-10-08",
      description: "Hosting",
      service: "Hosting",
      amount: 1000,
      supplierId: "p",
    },
  ];
  return s;
};
test("Supplier dashboard reuses acquired accounts and operating catalog without duplicate product costs", () => {
  const s = fixture(),
    original = JSON.stringify(s),
    d = supplierOverview(s, "2026-10-08");
  assert.equal(d.rows.length, 3);
  assert.equal(d.monthly, 6000);
  assert.equal(d.paid, 1000);
  assert.equal(d.dueCost, 17000);
  assert.equal(d.unknownMonthly, 1);
  assert.equal(d.rows[0].label, "Vence en 3 días");
  assert.equal(d.rows[1].label, "Vence en 4 días");
  assert.equal(d.rows[1].supplier.phone, "987654321");
  assert.equal(JSON.stringify(s), original);
  s.procurement.offers[0].costCents = 24000;
  assert.equal(supplierOverview(s, "2026-10-08").monthly, 7000);
  assert.equal(
    supplierOverview(s, "2026-10-12").rows[0].label,
    "Vencido hace 1 día",
  );
});
test("Optional operating renewal date survives private cleaning, malformed dates rejected", () => {
  const s = fixture();
  assert.equal(cleanState(s).procurement.offers[0].nextRenewal, "2026-10-11");
  s.procurement.offers[0].nextRenewal = "2026-02-30";
  assert.throws(() => validateProcurement(s.procurement));
  delete s.procurement.offers[0].nextRenewal;
  assert.doesNotThrow(() => cleanState(s));
});
