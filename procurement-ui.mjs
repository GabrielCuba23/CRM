import {
  emptyProcurement,
  validateProcurement,
  accountMargin,
} from "./procurement.mjs";
export function initializeProcurement({
  getState,
  save,
  today,
  money,
  cents,
  createId,
  notify,
}) {
  const $ = (s) => document.querySelector(s),
    el = (tag, text) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      return n;
    },
    opt = (name, id) => {
      const n = el("option", name);
      n.value = id;
      return n;
    },
    btn = (text, fn) => {
      const n = el("button", text);
      n.type = "button";
      n.className = "secondary";
      n.onclick = fn;
      return n;
    };
  let busy = false;
  const period = (n) =>
    n === 0 ? "Pago único" : `${n} mes${n === 1 ? "" : "es"}`;
  const p = () => getState().procurement || emptyProcurement();
  async function change(fn) {
    if (busy) return;
    busy = true;
    try {
      const next = structuredClone(p());
      fn(next);
      validateProcurement(next);
      if (await save({ procurement: next })) {
        render();
        notify("Proveedor / catálogo guardado.");
        return true;
      }
    } catch (e) {
      notify(e.message);
    } finally {
      busy = false;
    }
  }
  function accountOptions(a = {}) {
    const catalog = p(),
      supplier = $("#account-supplier");
    supplier.replaceChildren(
      opt("Sin proveedor registrado", ""),
      ...catalog.suppliers.map((s) => opt(s.name, s.id)),
    );
    supplier.value = a.supplierId || "";
    offerOptions(a.offerId || "");
  }
  function offerOptions(selected = "") {
    const items = p().offers.filter(
      (o) =>
        o.supplierId === $("#account-supplier").value && o.type === "product",
    );
    $("#account-offer").replaceChildren(
      opt("Coste manual", ""),
      ...items.map((o) =>
        opt(
          `${o.name} · ${money(o.costCents)} / ${period(o.intervalMonths)}`,
          o.id,
        ),
      ),
    );
    $("#account-offer").value = selected;
  }
  function costPreview() {
    const f = $("#account-form");
    try {
      const cost = f.elements.cost.value.trim()
          ? cents(f.elements.cost.value)
          : null,
        capacity = Number(f.elements.capacity.value);
      $("#account-cost-preview").textContent =
        cost === null
          ? "Coste sin definir."
          : `Coste por perfil: ${money(cost / capacity)} · ${capacity} perfiles · ${period(Number(f.elements.costIntervalMonths.value))}.`;
    } catch {
      $("#account-cost-preview").textContent = "Introduce un coste válido.";
    }
  }
  function clientPreview() {
    const account = getState().accounts.find(
        (a) => a.id === $("#client-account").value,
      ),
      node = $("#client-cost-info");
    if (!node) return;
    try {
      node.textContent =
        account?.costCents !== undefined
          ? `Coste por perfil: ${money(account.costCents / account.capacity)} / ${period(account.costIntervalMonths ?? 1)} · Margen previsto del perfil: ${money(cents($("#client-form").elements.price.value) - account.costCents / account.capacity)}. Usa un precio de venta para ese mismo periodo.`
          : "Esta cuenta no tiene un coste definido.";
    } catch {
      node.textContent = "Introduce un precio de venta válido.";
    }
  }
  function startPayment(o) {
    const f = $("#supplier-payment-form");
    f.reset();
    f.elements.offerId.value = o.id;
    f.elements.date.value = today();
    f.elements.amount.value = (o.costCents / 100).toFixed(2);
    f.elements.description.value = `${o.type === "product" ? "Compra de producto" : "Herramienta del negocio"} · ${o.name}`;
    $("#payment-account").replaceChildren(
      opt("Sin cuenta vinculada", ""),
      ...getState()
        .accounts.filter((a) => a.offerId === o.id)
        .map((a) => opt(`${a.service} · ${a.email}`, a.id)),
    );
    $("#supplier-payment-error").textContent = "";
    $("#supplier-payment-dialog").showModal();
  }
  function render() {
    const state = getState(),
      catalog = p(),
      current = $("#offer-supplier").value;
    $("#offer-supplier").replaceChildren(
      opt("Seleccionar proveedor", ""),
      ...catalog.suppliers.map((s) => opt(s.name, s.id)),
    );
    $("#offer-supplier").value = catalog.suppliers.some((s) => s.id === current)
      ? current
      : "";
    const month = $("#finance-month").value,
      paidFor = (supplierId) =>
        state.ledger
          .filter(
            (m) =>
              m.kind === "expense" &&
              m.supplierId === supplierId &&
              m.date.slice(0, 7) === month,
          )
          .reduce((v, m) => v + m.amount, 0);
    $("#suppliers-list").replaceChildren(
      ...catalog.suppliers.map((s) => {
        const card = el("article");
        card.className = "inset";
        card.append(
          el("h4", s.name),
          el("p", `${s.email || ""} ${s.phone || ""}`),
          el("p", s.notes),
          el("p", `Pagado en ${month}: ${money(paidFor(s.id))}`),
          btn("Editar", () => {
            const f = $("#supplier-form");
            for (const k of ["name", "email", "phone", "notes"])
              f.elements[k].value = s[k];
            f.dataset.id = s.id;
            f.scrollIntoView({ block: "center" });
          }),
          btn("Eliminar", () => {
            if (
              catalog.offers.some((o) => o.supplierId === s.id) ||
              state.accounts.some((a) => a.supplierId === s.id) ||
              state.ledger.some((m) => m.supplierId === s.id)
            ) {
              notify(
                "Conserva este proveedor: tiene productos, cuentas o pagos vinculados.",
              );
              return;
            }
            if (confirm("¿Eliminar el proveedor?"))
              change(
                (n) => (n.suppliers = n.suppliers.filter((x) => x.id !== s.id)),
              );
          }),
        );
        return card;
      }),
    );
    const overhead = catalog.offers
      .filter((o) => o.type === "business" && o.intervalMonths > 0)
      .reduce((v, o) => v + o.costCents / o.intervalMonths, 0);
    $("#operating-budget").textContent =
      `Presupuesto mensual equivalente de herramientas registradas: ${money(overhead)}. Es una previsión; incluye cada servicio una vez y excluye pagos únicos. No genera gastos automáticamente.`;
    $("#supplier-offers").replaceChildren(
      ...catalog.offers.map((o) => {
        const card = el("article");
        card.className = "inset";
        card.append(
          el(
            "h4",
            `${o.name} · ${catalog.suppliers.find((s) => s.id === o.supplierId)?.name}`,
          ),
          el(
            "p",
            `${o.type === "product" ? "Para revender" : "Herramienta del negocio"} · ${money(o.costCents)} / ${period(o.intervalMonths)}${o.type === "product" ? ` · ${o.capacity} perfiles` : ""}`,
          ),
          el("p", o.notes),
          btn("Registrar pago", () => startPayment(o)),
          btn("Editar", () => {
            const f = $("#supplier-offer-form");
            for (const k of [
              "name",
              "supplierId",
              "type",
              "intervalMonths",
              "capacity",
              "notes",
            ])
              f.elements[k].value = o[k];
            f.elements.cost.value = (o.costCents / 100).toFixed(2);
            f.dataset.id = o.id;
            f.scrollIntoView({ block: "center" });
          }),
          btn("Eliminar", () => {
            if (
              state.accounts.some((a) => a.offerId === o.id) ||
              state.ledger.some((m) => m.offerId === o.id)
            ) {
              notify(
                "Conserva este producto: tiene cuentas o pagos vinculados.",
              );
              return;
            }
            if (confirm("¿Eliminar el producto / servicio?"))
              change((n) => (n.offers = n.offers.filter((x) => x.id !== o.id)));
          }),
        );
        return card;
      }),
    );
    $("#account-margins").replaceChildren(
      ...state.accounts.map((a) => {
        const m = accountMargin(a, state.clients),
          card = el("article");
        card.className = "inset";
        card.append(el("h4", `${a.service} · ${a.email}`));
        if (!m) {
          card.append(
            el("p", "Coste sin definir. Edita la cuenta madre para indicarlo."),
          );
          return card;
        }
        card.append(
          el(
            "p",
            `${a.provider || "Sin proveedor"} · Coste ${money(m.cost)} / ${period(a.costIntervalMonths ?? 1)} · Coste por perfil ${money(m.unitCost)}`,
          ),
          el(
            "p",
            `${m.occupied}/${m.capacity} perfiles asignados · Precios de venta sumados ${money(m.revenue)}`,
          ),
        );
        const result = el(
          "strong",
          `Margen previsto de la cuenta: ${money(m.margin)}`,
        );
        result.className = m.margin < 0 ? "error" : "";
        card.append(result);
        const offer = catalog.offers.find((o) => o.id === a.offerId);
        if (offer)
          card.append(
            btn("Registrar pago de esta cuenta", () => {
              startPayment(offer);
              $("#payment-account").value = a.id;
              $("#payment-account").dispatchEvent(new Event("change"));
            }),
          );
        for (const c of m.profiles)
          card.append(
            el(
              "p",
              `${c.name}: cobra ${money(c.price)} · margen ${money(c.margin)}`,
            ),
          );
        return card;
      }),
    );
    if (!state.accounts.length)
      $("#account-margins").append(
        el("p", "Añade una cuenta madre con su coste para calcular márgenes."),
      );
    clientPreview();
  }
  $("#supplier-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target,
      r = Object.fromEntries(new FormData(f));
    r.id = f.dataset.id || createId();
    r.name = r.name.trim();
    if (
      await change((n) => {
        const i = n.suppliers.findIndex((s) => s.id === r.id);
        if (i < 0) n.suppliers.push(r);
        else n.suppliers[i] = r;
      })
    ) {
      f.reset();
      delete f.dataset.id;
    }
  };
  $("#supplier-offer-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target,
      r = Object.fromEntries(new FormData(f));
    try {
      r.id = f.dataset.id || createId();
      r.costCents = cents(r.cost);
      delete r.cost;
      r.capacity = Number(r.capacity);
      r.intervalMonths = Number(r.intervalMonths);
      r.name = r.name.trim();
      if (
        await change((n) => {
          const i = n.offers.findIndex((o) => o.id === r.id);
          if (i < 0) n.offers.push(r);
          else n.offers[i] = r;
        })
      ) {
        f.reset();
        delete f.dataset.id;
      }
    } catch (err) {
      notify(err.message);
    }
  };
  for (const [button, form] of [
    ["#supplier-reset", "#supplier-form"],
    ["#offer-reset", "#supplier-offer-form"],
  ])
    $(button).onclick = () => {
      $(form).reset();
      delete $(form).dataset.id;
    };
  $("#account-supplier").onchange = () => {
    offerOptions();
  };
  $("#account-offer").onchange = () => {
    const o = p().offers.find((o) => o.id === $("#account-offer").value);
    if (o) {
      const f = $("#account-form");
      f.elements.service.value = o.name;
      f.elements.cost.value = (o.costCents / 100).toFixed(2);
      f.elements.capacity.value = o.capacity;
      f.elements.costIntervalMonths.value = o.intervalMonths;
    }
    costPreview();
  };
  for (const k of ["cost", "capacity", "costIntervalMonths"])
    $("#account-form").elements[k].addEventListener("input", costPreview);
  $("#payment-account").onchange = () => {
    const a = getState().accounts.find(
        (a) => a.id === $("#payment-account").value,
      ),
      o = p().offers.find(
        (o) => o.id === $("#supplier-payment-form").elements.offerId.value,
      );
    $("#supplier-payment-form").elements.amount.value = (
      (a?.costCents ?? o.costCents) / 100
    ).toFixed(2);
  };
  $("#supplier-payment-close").onclick = () =>
    $("#supplier-payment-dialog").close();
  $("#supplier-payment-form").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const f = e.target,
        data = Object.fromEntries(new FormData(f)),
        state = getState(),
        o = p().offers.find((o) => o.id === data.offerId);
      if (!o) throw Error("Producto no disponible.");
      const amount = cents(data.amount);
      if (amount <= 0) throw Error("Introduce un importe mayor que cero.");
      if (
        data.reference.trim() &&
        state.ledger.some(
          (m) =>
            m.kind === "expense" &&
            m.supplierId === o.supplierId &&
            m.reference === data.reference.trim(),
        )
      )
        throw Error(
          "Ya existe un pago con esa referencia para este proveedor.",
        );
      const entry = {
        id: createId(),
        kind: "expense",
        date: data.date,
        amount,
        description: data.description.trim(),
        service: o.name,
        supplierId: o.supplierId,
        offerId: o.id,
        accountId: data.accountId,
        category: o.type === "product" ? "purchase" : "operating",
        reference: data.reference.trim(),
      };
      if (await save({ ledger: [...state.ledger, entry] })) {
        $("#supplier-payment-dialog").close();
        render();
        notify("Pago registrado como gasto en Finanzas.");
      } else throw Error("No se pudo guardar el pago.");
    } catch (err) {
      $("#supplier-payment-error").textContent = err.message;
    } finally {
      busy = false;
    }
  };
  document.addEventListener("finance-updated", render);
  document.addEventListener("client-cost-updated", clientPreview);
  $("#client-form").elements.price.addEventListener("input", clientPreview);
  render();
  return { render, accountOptions, costPreview };
}
