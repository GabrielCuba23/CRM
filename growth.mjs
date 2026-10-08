import { isFormer } from "./lifecycle.mjs";
export const networks = [
  "Facebook",
  "Instagram",
  "LinkedIn",
  "TikTok",
  "X",
  "Google Business",
];
export function emptyGrowth() {
  return {
    segments: [],
    campaigns: [],
    posts: [],
    interactions: [],
    scoring: { email: 10, phone: 10, active: 20, paid: 30 },
  };
}
export function validateGrowth(g) {
  const fail = () => {
    throw Error("Datos de Marketing o Redes no válidos.");
  };
  const text = (r, keys) =>
    r && keys.every((k) => typeof r[k] === "string" && r[k].length <= 8000);
  if (
    !g ||
    typeof g !== "object" ||
    !g.scoring ||
    !["email", "phone", "active", "paid"].every(
      (k) =>
        Number.isInteger(g.scoring[k]) &&
        g.scoring[k] >= 0 &&
        g.scoring[k] <= 100,
    )
  )
    fail();
  for (const key of ["segments", "campaigns", "posts", "interactions"])
    if (
      !Array.isArray(g[key]) ||
      g[key].length > 10000 ||
      !g[key].every((r) => text(r, ["id", "name"]) && r.id && r.name.trim()) ||
      new Set(g[key].map((r) => r.id)).size !== g[key].length
    )
      fail();
  for (const r of g.segments)
    if (
      !text(r, ["query", "service", "status", "persona"]) ||
      ![
        "all",
        "active",
        "soon",
        "expired",
        "none",
        "former",
        "archived",
        "current",
      ].includes(r.status) ||
      !Number.isInteger(r.minScore) ||
      r.minScore < 0 ||
      r.minScore > 100
    )
      fail();
  for (const r of g.campaigns)
    if (
      !text(r, ["channel", "segmentId", "subject", "body", "status"]) ||
      !["email", "whatsapp", "rss"].includes(r.channel) ||
      r.status !== "draft" ||
      !r.body.trim() ||
      (r.segmentId && !g.segments.some((s) => s.id === r.segmentId))
    )
      fail();
  for (const r of g.posts)
    if (
      !text(r, ["network", "body", "scheduledAt", "status"]) ||
      !networks.includes(r.network) ||
      !r.body.trim() ||
      r.status !== "draft" ||
      (r.scheduledAt && !Number.isFinite(Date.parse(r.scheduledAt)))
    )
      fail();
  for (const r of g.interactions)
    if (
      !text(r, [
        "clientId",
        "network",
        "kind",
        "body",
        "agent",
        "outcome",
        "occurredAt",
      ]) ||
      !r.clientId ||
      (["received_manual", "sent_manual"].includes(r.kind) &&
        r.network !== "WhatsApp") ||
      ![...networks, "WhatsApp"].includes(r.network) ||
      !["comment", "dm", "review", "received_manual", "sent_manual"].includes(
        r.kind,
      ) ||
      !["open", "answered", "won"].includes(r.outcome) ||
      !r.body.trim() ||
      !Number.isFinite(Date.parse(r.occurredAt))
    )
      fail();
  const keys = {
    segments: [
      "id",
      "name",
      "query",
      "service",
      "status",
      "persona",
      "minScore",
    ],
    campaigns: [
      "id",
      "name",
      "channel",
      "segmentId",
      "subject",
      "body",
      "status",
    ],
    posts: ["id", "name", "network", "body", "scheduledAt", "status"],
    interactions: [
      "id",
      "name",
      "clientId",
      "network",
      "kind",
      "body",
      "agent",
      "outcome",
      "occurredAt",
    ],
  };
  return Object.fromEntries([
    ...Object.entries(keys).map(([k, fields]) => [
      k,
      g[k].map((r) => Object.fromEntries(fields.map((f) => [f, r[f]]))),
    ]),
    [
      "scoring",
      Object.fromEntries(
        ["email", "phone", "active", "paid"].map((k) => [k, g.scoring[k]]),
      ),
    ],
  ]);
}
export function clientStatus(c, today) {
  if (c.archived) return "none";
  if (!c.expires) return "none";
  const days = Math.round(
    (Date.parse(c.expires + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) /
      86400000,
  );
  return days < 0 ? "expired" : days <= 3 ? "soon" : "active";
}
export function paymentsFor(c, ledger) {
  return ledger.filter(
    (m) =>
      m.kind !== "expense" &&
      (m.clientId === c.id ||
        (!m.clientId &&
          m.service === c.service &&
          ["Venta · " + c.name, "Renovación · " + c.name].includes(
            m.description,
          ))),
  );
}
export function leadScore(c, state, today) {
  const w = (state.growth || emptyGrowth()).scoring;
  return Math.min(
    100,
    (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) ? w.email : 0) +
      (c.phone ? w.phone : 0) +
      (["active", "soon"].includes(clientStatus(c, today)) ? w.active : 0) +
      (paymentsFor(c, state.ledger).some((m) => m.amount > 0) ? w.paid : 0),
  );
}
export function segmentContacts(segment, state, today) {
  return state.clients.filter(
    (c) =>
      !segment ||
      ((!segment.service ||
        c.service.toLocaleLowerCase() ===
          segment.service.toLocaleLowerCase()) &&
        (segment.status === "all" ||
          (segment.status === "former"
            ? isFormer(c, today)
            : segment.status === "archived"
              ? !!c.archived
              : segment.status === "current"
                ? !isFormer(c, today)
                : !c.archived && clientStatus(c, today) === segment.status)) &&
        leadScore(c, state, today) >= segment.minScore &&
        [
          c.name,
          c.email,
          c.phone,
          c.whatsappUsername || "",
          c.service,
          c.notes,
        ].some((v) =>
          v.toLocaleLowerCase().includes(segment.query.toLocaleLowerCase()),
        )),
  );
}
export function socialMetrics(g) {
  return networks.map((network) => {
    const rows = g.interactions.filter((i) => i.network === network);
    return {
      network,
      interactions: rows.length,
      contacts: new Set(rows.map((i) => i.clientId)).size,
      answered: rows.filter((i) => i.outcome !== "open").length,
      won: rows.filter((i) => i.outcome === "won").length,
    };
  });
}
