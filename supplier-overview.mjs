export function supplierOverview(state, today) {
  const catalog = state.procurement || { suppliers: [], offers: [] };
  const supplierFor = (a) =>
    catalog.suppliers.find((s) => s.id === a.supplierId) ||
    (() => {
      const matches = catalog.suppliers.filter(
        (s) =>
          s.name.toLocaleLowerCase() === (a.provider || "").toLocaleLowerCase(),
      );
      return matches.length === 1 ? matches[0] : null;
    })();
  const rows = (state.accounts || []).map((a) => ({
    id: "account:" + a.id,
    service: a.service,
    detail: a.email,
    category: "Cuenta para revender",
    supplier: supplierFor(a),
    supplierName: supplierFor(a)?.name || a.provider || "Sin proveedor",
    expires: a.expires || "",
    cost: a.costCents ?? null,
    months: a.costIntervalMonths ?? null,
    source: "account",
  }));
  for (const o of catalog.offers.filter((o) => o.type === "business")) {
    const supplier = catalog.suppliers.find((s) => s.id === o.supplierId);
    rows.push({
      id: "offer:" + o.id,
      service: o.name,
      detail: o.notes,
      category:
        o.intervalMonths === 0
          ? "Compra de pago único"
          : "Herramienta del negocio",
      supplier,
      supplierName: supplier?.name || "Sin proveedor",
      expires: o.intervalMonths === 0 ? "" : o.nextRenewal || "",
      cost: o.costCents,
      months: o.intervalMonths,
      source: "offer",
    });
  }
  for (const row of rows) {
    row.days = row.expires
      ? Math.round(
          (Date.parse(row.expires + "T00:00:00Z") -
            Date.parse(today + "T00:00:00Z")) /
            86400000,
        )
      : null;
    row.monthly =
      row.cost !== null && row.months > 0
        ? Math.round(row.cost / row.months)
        : null;
    row.label =
      row.months === 0
        ? "Pago único"
        : row.days === null
          ? "Sin fecha de renovación"
          : row.days < 0
            ? `Vencido hace ${-row.days} día${row.days === -1 ? "" : "s"}`
            : row.days === 0
              ? "Vence hoy"
              : `Vence en ${row.days} día${row.days === 1 ? "" : "s"}`;
  }
  rows.sort(
    (a, b) =>
      (a.days ?? Infinity) - (b.days ?? Infinity) ||
      a.service.localeCompare(b.service),
  );
  const monthly = rows.reduce((sum, r) => sum + (r.monthly ?? 0), 0),
    upcoming = rows.filter(
      (r) => r.months !== 0 && r.days !== null && r.days <= 7,
    ),
    dueCost = upcoming.reduce((sum, r) => sum + (r.cost ?? 0), 0),
    paid = (state.ledger || [])
      .filter(
        (l) =>
          l.kind === "expense" &&
          l.date.startsWith(today.slice(0, 7)) &&
          l.date <= today &&
          (l.supplierId ||
            l.accountId ||
            ["purchase", "operating"].includes(l.category)),
      )
      .reduce((sum, l) => sum + l.amount, 0);
  return {
    rows,
    monthly,
    upcoming,
    dueCost,
    paid,
    unknownMonthly: rows.filter((r) => r.months !== 0 && r.monthly === null)
      .length,
    unknownDue: upcoming.filter((r) => r.cost === null).length,
  };
}
