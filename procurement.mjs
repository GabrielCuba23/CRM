export function emptyProcurement() {
  return { suppliers: [], offers: [] };
}
export function validateProcurement(raw = emptyProcurement()) {
  const fail = () => {
      throw Error("Proveedores o costes no válidos.");
    },
    text = (r, ks) =>
      r && ks.every((k) => typeof r[k] === "string" && r[k].length <= 8000),
    money = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 99999900;
  if (!raw || !Array.isArray(raw.suppliers) || !Array.isArray(raw.offers))
    fail();
  for (const rows of [raw.suppliers, raw.offers])
    if (
      rows.length > 10000 ||
      !rows.every((r) => text(r, ["id", "name"]) && r.id && r.name.trim()) ||
      new Set(rows.map((r) => r.id)).size !== rows.length
    )
      fail();
  for (const s of raw.suppliers)
    if (!text(s, ["email", "phone", "notes"])) fail();
  for (const o of raw.offers)
    if (
      !text(o, ["supplierId", "type", "notes"]) ||
      (o.nextRenewal !== undefined &&
        (typeof o.nextRenewal !== "string" ||
          (o.nextRenewal !== "" &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(o.nextRenewal) ||
              !Number.isFinite(Date.parse(o.nextRenewal + "T00:00:00Z")) ||
              new Date(o.nextRenewal + "T00:00:00Z")
                .toISOString()
                .slice(0, 10) !== o.nextRenewal)))) ||
      !raw.suppliers.some((s) => s.id === o.supplierId) ||
      !["product", "business"].includes(o.type) ||
      !money(o.costCents) ||
      !Number.isInteger(o.intervalMonths) ||
      o.intervalMonths < 0 ||
      o.intervalMonths > 36 ||
      !Number.isInteger(o.capacity) ||
      o.capacity < 1 ||
      o.capacity > 50
    )
      fail();
  const fields = {
    suppliers: ["id", "name", "email", "phone", "notes"],
    offers: [
      "id",
      "name",
      "supplierId",
      "type",
      "costCents",
      "intervalMonths",
      "capacity",
      "notes",
      "nextRenewal",
    ],
  };
  return Object.fromEntries(
    Object.entries(fields).map(([k, ks]) => [
      k,
      raw[k].map((r) =>
        Object.fromEntries(
          ks.filter((f) => r[f] !== undefined).map((f) => [f, r[f]]),
        ),
      ),
    ]),
  );
}
export function accountMargin(account, clients) {
  if (account.costCents === undefined) return null;
  const assigned = clients.filter((c) => c.accountId === account.id),
    revenue = assigned.reduce((sum, c) => sum + c.price, 0),
    cost = account.costCents;
  return {
    cost,
    revenue,
    margin: revenue - cost,
    unitCost: cost / account.capacity,
    occupied: assigned.length,
    capacity: account.capacity,
    profiles: assigned.map((c) => ({
      id: c.id,
      name: c.name,
      price: c.price,
      margin: c.price - cost / account.capacity,
    })),
  };
}
export function validatePurchaseLinks(state) {
  const p = validateProcurement(state.procurement);
  for (const a of state.accounts) {
    for (const k of ["supplierId", "offerId"])
      if (a[k] !== undefined && typeof a[k] !== "string")
        throw Error("Referencia de proveedor no válida.");
    if (
      a.costCents !== undefined &&
      (!Number.isSafeInteger(a.costCents) ||
        a.costCents < 0 ||
        a.costCents > 99999900)
    )
      throw Error("Coste de cuenta no válido.");
    if (
      a.costIntervalMonths !== undefined &&
      (!Number.isInteger(a.costIntervalMonths) ||
        a.costIntervalMonths < 0 ||
        a.costIntervalMonths > 36)
    )
      throw Error("Periodo de coste no válido.");
    if (a.supplierId && !p.suppliers.some((s) => s.id === a.supplierId))
      throw Error("Proveedor inexistente.");
    if (
      a.offerId &&
      !p.offers.some(
        (o) =>
          o.id === a.offerId &&
          o.supplierId === a.supplierId &&
          o.type === "product",
      )
    )
      throw Error("Producto del proveedor no válido.");
  }
  for (const m of state.ledger) {
    for (const k of [
      "supplierId",
      "offerId",
      "accountId",
      "category",
      "reference",
    ])
      if (
        m[k] !== undefined &&
        (typeof m[k] !== "string" || m[k].length > 8000)
      )
        throw Error("Referencia de gasto no válida.");
  }
  return p;
}
