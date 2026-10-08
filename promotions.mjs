export const emptyPromotions = () => ({ offers: [], applications: [] });
export function promotionPrice(base, offer) {
  if (!Number.isSafeInteger(base) || base < 0 || base > 99999900)
    throw Error("Precio base no válido.");
  if (
    !offer ||
    !["percent", "amount", "gift"].includes(offer.kind) ||
    !Number.isSafeInteger(offer.value) ||
    offer.value < 0 ||
    (offer.kind === "percent" && offer.value > 10000) ||
    (offer.kind === "amount" && offer.value > 99999900) ||
    (offer.kind === "gift" && offer.value !== 0)
  )
    throw Error("Descuento no válido.");
  const discount =
    offer.kind === "percent"
      ? Math.floor((base * offer.value + 5000) / 10000)
      : offer.kind === "amount"
        ? Math.min(base, offer.value)
        : 0;
  return {
    base,
    discount,
    final: base - discount,
    gift: offer.kind === "gift" ? offer.giftService : "",
  };
}
export function validatePromotions(p = emptyPromotions()) {
  const text = (x, keys) =>
    x && keys.every((k) => typeof x[k] === "string" && x[k].length <= 8000);
  if (!p || !Array.isArray(p.offers) || !Array.isArray(p.applications))
    throw Error("Promociones no válidas.");
  for (const rows of [p.offers, p.applications])
    if (
      rows.length > 10000 ||
      new Set(rows.map((x) => x.id)).size !== rows.length
    )
      throw Error("Promociones no válidas.");
  for (const o of p.offers) {
    if (
      !text(o, ["id", "name", "kind", "giftService", "notes"]) ||
      !o.id ||
      !o.name.trim() ||
      (o.kind === "gift" && !o.giftService.trim())
    )
      throw Error("Oferta no válida.");
    promotionPrice(0, o);
  }
  for (const a of p.applications) {
    if (
      !text(a, [
        "id",
        "clientId",
        "offerId",
        "name",
        "kind",
        "giftService",
        "notes",
        "service",
        "occurredAt",
        "ledgerId",
      ]) ||
      !a.id ||
      !a.clientId ||
      !Number.isFinite(Date.parse(a.occurredAt)) ||
      typeof a.updateClientPrice !== "boolean"
    )
      throw Error("Aplicación no válida.");
    const expected = promotionPrice(a.base, {
      kind: a.kind,
      value: a.value,
      giftService: a.giftService,
    });
    if (a.discount !== expected.discount || a.final !== expected.final)
      throw Error("Total de promoción no válido.");
  }
  const offerKeys = ["id", "name", "kind", "value", "giftService", "notes"],
    applicationKeys = [
      "id",
      "clientId",
      "offerId",
      "name",
      "kind",
      "value",
      "giftService",
      "notes",
      "service",
      "occurredAt",
      "ledgerId",
      "updateClientPrice",
      "base",
      "discount",
      "final",
    ];
  return {
    offers: p.offers.map((o) =>
      Object.fromEntries(offerKeys.map((k) => [k, o[k]])),
    ),
    applications: p.applications.map((a) =>
      Object.fromEntries(applicationKeys.map((k) => [k, a[k]])),
    ),
  };
}
