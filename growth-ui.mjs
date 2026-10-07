import {
  emptyGrowth,
  validateGrowth,
  networks,
  segmentContacts,
  leadScore,
  paymentsFor,
  socialMetrics,
} from "./growth.mjs";
export function initializeGrowth({
  getState,
  today,
  save,
  openMessage,
  notify,
}) {
  const $ = (s) => document.querySelector(s),
    node = (tag, text) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      return n;
    },
    option = (text, value) => {
      const n = node("option", text);
      n.value = value;
      return n;
    },
    action = (text, fn) => {
      const n = node("button", text);
      n.type = "button";
      n.className = "secondary";
      n.onclick = fn;
      return n;
    };
  let busy = false;
  async function change(fn) {
    if (busy) return;
    busy = true;
    try {
      const next = structuredClone(getState().growth || emptyGrowth());
      fn(next);
      validateGrowth(next);
      if (await save(next)) {
        render();
        notify("Cambios guardados. No se realizó ningún envío externo.");
        return true;
      }
    } catch (e) {
      notify(e.message);
    } finally {
      busy = false;
    }
  }
  function showContact(c) {
    const state = getState(),
      body = $("#contact-detail-body");
    $("#contact-detail-name").textContent = c.name + " · Ficha 360";
    body.replaceChildren(
      node(
        "p",
        `${c.email || "Sin correo"} · ${c.phone || c.whatsappUsername || "Sin contacto"} · ${c.service || "Sin servicio"}`,
      ),
      node(
        "p",
        `Puntuación: ${leadScore(c, state, today())}/100 · Vence: ${c.expires || "Sin fecha"}`,
      ),
      node("p", c.notes || "Sin notas"),
      node("h3", "Pagos registrados"),
    );
    const payments = paymentsFor(c, state.ledger);
    for (const m of payments)
      body.append(
        node(
          "p",
          `${m.date} · ${m.description} · S/ ${(m.amount / 100).toFixed(2)}`,
        ),
      );
    if (!payments.length) body.append(node("p", "Sin pagos vinculados."));
    body.append(node("h3", "Redes sociales"));
    const entries = (state.growth || emptyGrowth()).interactions
      .filter((i) => i.clientId === c.id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    for (const i of entries)
      body.append(
        node(
          "p",
          `${new Date(i.occurredAt).toLocaleString("es-PE", { timeZone: "America/Lima" })} · ${i.network} · ${i.agent || "Sin agente"} · ${i.outcome}: ${i.body}`,
        ),
      );
    if (!entries.length)
      body.append(node("p", "Sin interacciones sociales registradas."));
    body.append(
      node(
        "p",
        "Los emails, chats y respuestas externas se incorporarán al conectar sus proveedores.",
      ),
    );
    body.append(
      action("Preparar WhatsApp", () => {
        $("#contact-detail").close();
        openMessage(c);
      }),
    );
    $("#contact-detail").showModal();
  }
  function audience(segment, campaign) {
    const state = getState(),
      list = segmentContacts(segment, state, today()),
      box = $("#marketing-audience");
    box.hidden = false;
    box.replaceChildren(
      node(
        "h3",
        `${campaign?.name || segment?.name || "Todos los contactos"} · ${list.length} contactos`,
      ),
    );
    for (const c of list) {
      const row = node("p");
      row.append(
        node("span", `${c.name} · ${leadScore(c, state, today())}/100 `),
        action("Ficha 360", () => showContact(c)),
      );
      if (campaign?.channel === "whatsapp")
        row.append(
          action("Preparar mensaje", async () => {
            await openMessage(c);
            const select = $("#message-template");
            select.value = "__custom";
            const text = $("#message-text");
            const { fillTemplate } = await import("./crm.mjs");
            text.value = fillTemplate(
              campaign.body,
              c,
              "",
              getState().settings,
            );
            text.dispatchEvent(new Event("input", { bubbles: true }));
          }),
        );
      box.append(row);
    }
    if (!list.length)
      box.append(node("p", "Ningún contacto coincide con este segmento."));
  }
  function card(title, text) {
    const c = node("article");
    c.className = "inset";
    c.append(node("h3", title), node("p", text));
    return c;
  }
  function render() {
    const state = getState(),
      g = state.growth || emptyGrowth();
    for (const [k, v] of Object.entries(g.scoring))
      $("#score-form").elements[k].value = v;
    const selected = $("#campaign-segment").value;
    $("#campaign-segment").replaceChildren(
      option("Todos los contactos", ""),
      ...g.segments.map((s) => option(s.name, s.id)),
    );
    $("#campaign-segment").value = g.segments.some((s) => s.id === selected)
      ? selected
      : "";
    $("#social-client").replaceChildren(
      option("Seleccionar contacto", ""),
      ...state.clients.map((c) => option(c.name, c.id)),
    );
    $("#segments-list").replaceChildren(
      ...g.segments.map((s) => {
        const c = card(
          s.name,
          `${segmentContacts(s, state, today()).length} contactos · ${s.persona || "Sin buyer persona definido"}`,
        );
        c.append(
          action("Ver lista", () => audience(s)),
          action("Eliminar", () => {
            if (
              confirm(
                "¿Eliminar el segmento? Las campañas asociadas pasarán a todos los contactos.",
              )
            )
              change((n) => {
                n.segments = n.segments.filter((r) => r.id !== s.id);
                n.campaigns.forEach((c) => {
                  if (c.segmentId === s.id) c.segmentId = "";
                });
              });
          }),
        );
        return c;
      }),
    );
    $("#campaigns-list").replaceChildren(
      ...g.campaigns.map((c) => {
        const s = g.segments.find((s) => s.id === c.segmentId),
          n = card(
            c.name,
            `${c.channel} · Borrador · ${segmentContacts(s, state, today()).length} contactos`,
          );
        n.append(
          action("Editar", () => {
            const form = $("#campaign-form");
            for (const k of ["name", "channel", "segmentId", "subject", "body"])
              form.elements[k].value = c[k];
            form.dataset.editId = c.id;
            form.scrollIntoView({ block: "center" });
          }),
          node("p", c.subject),
          node("p", c.body),
          action("Ver contactos / preparar", () => audience(s, c)),
          action("Eliminar", () => {
            if (confirm("¿Eliminar este borrador?"))
              change((g) => {
                g.campaigns = g.campaigns.filter((r) => r.id !== c.id);
              });
          }),
        );
        return n;
      }),
    );
    $("#posts-list").replaceChildren(
      ...[...g.posts]
        .sort((a, b) =>
          (a.scheduledAt || "9999").localeCompare(b.scheduledAt || "9999"),
        )
        .map((p) => {
          const c = card(
            p.name,
            `${p.network} · Borrador · ${p.scheduledAt ? new Date(p.scheduledAt).toLocaleString("es-PE", { timeZone: "America/Lima" }) : "Sin fecha"}`,
          );
          c.append(
            action("Editar", () => {
              const form = $("#post-form");
              for (const k of ["name", "network", "body"])
                form.elements[k].value = p[k];
              form.elements.scheduledAt.value = p.scheduledAt
                ? new Date(Date.parse(p.scheduledAt) - 5 * 3600000)
                    .toISOString()
                    .slice(0, 16)
                : "";
              form.dataset.editId = p.id;
              form.scrollIntoView({ block: "center" });
            }),
            node("p", p.body),
            action("Eliminar", () => {
              if (confirm("¿Eliminar el borrador?"))
                change((n) => {
                  n.posts = n.posts.filter((r) => r.id !== p.id);
                });
            }),
          );
          return c;
        }),
    );
    $("#social-metrics").replaceChildren(
      ...socialMetrics(g)
        .filter((m) => m.interactions > 0)
        .map((m) =>
          (() => {
            const n = card(
                m.network,
                `${m.interactions} interacciones · ${m.contacts} contactos · ${m.answered} atendidas · ${m.won} convertidas`,
              ),
              meter = node("meter");
            meter.min = 0;
            meter.max = m.interactions;
            meter.value = m.answered;
            meter.setAttribute(
              "aria-label",
              `${m.answered} de ${m.interactions} atendidas`,
            );
            n.append(meter);
            return n;
          })(),
        ),
    );
    if (!g.interactions.length)
      $("#social-metrics").append(
        node(
          "p",
          "Sin interacciones registradas. Conexiones externas pendientes.",
        ),
      );
    $("#interactions-list").replaceChildren(
      ...[...g.interactions].reverse().map((i) => {
        const contact = state.clients.find((c) => c.id === i.clientId),
          c = card(
            `${i.network} · ${contact?.name || "Contacto eliminado"}`,
            `${i.kind} · ${i.outcome} · ${i.agent || "Sin agente"}: ${i.body}`,
          );
        if (contact) c.append(action("Ver ficha", () => showContact(contact)));
        if (i.outcome === "open")
          c.append(
            action("Marcar respondida", () =>
              change((n) => {
                n.interactions.find((x) => x.id === i.id).outcome = "answered";
              }),
            ),
          );
        if (i.outcome !== "won")
          c.append(
            action("Marcar convertida", () =>
              change((n) => {
                n.interactions.find((x) => x.id === i.id).outcome = "won";
              }),
            ),
          );
        return c;
      }),
    );
    const agents = new Map();
    for (const i of g.interactions) {
      const key = i.agent || "Sin agente",
        a = agents.get(key) || { total: 0, answered: 0 };
      a.total++;
      if (i.outcome !== "open") a.answered++;
      agents.set(key, a);
    }
    $("#agent-metrics").replaceChildren(
      ...[...agents].map(([name, a]) =>
        node("p", `${name}: ${a.answered}/${a.total} interacciones atendidas`),
      ),
    );
  }
  for (const select of document.querySelectorAll(".network-select"))
    select.replaceChildren(...networks.map((n) => option(n, n)));
  for (const [selector, collection] of [
    ["#segment-form", "segments"],
    ["#campaign-form", "campaigns"],
    ["#post-form", "posts"],
    ["#interaction-form", "interactions"],
  ])
    $(selector).onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target,
        data = Object.fromEntries(new FormData(form));
      data.id = form.dataset.editId || crypto.randomUUID();
      if (collection === "segments") data.minScore = Number(data.minScore);
      if (collection === "campaigns" || collection === "posts")
        data.status = "draft";
      if (collection === "posts" && data.scheduledAt)
        data.scheduledAt = new Date(data.scheduledAt + "-05:00").toISOString();
      if (collection === "interactions") {
        data.name = "Interacción social";
        data.occurredAt = new Date().toISOString();
        if (!getState().clients.some((c) => c.id === data.clientId)) {
          notify("Selecciona un contacto existente.");
          return;
        }
      }
      const saved = await change((g) => {
        const index = g[collection].findIndex((r) => r.id === data.id);
        if (index < 0) g[collection].push(data);
        else g[collection][index] = data;
      });
      if (saved) {
        form.reset();
        delete form.dataset.editId;
      }
    };
  $("#score-form").onsubmit = (e) => {
    e.preventDefault();
    change((g) => {
      g.scoring = Object.fromEntries(
        [...new FormData(e.target)].map(([k, v]) => [k, Number(v)]),
      );
    });
  };
  render();
  return { render, showContact };
}
