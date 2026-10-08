const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const p = await b.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(process.env.CRM_TEST_URL || "http://127.0.0.1:8012/");
    await p.evaluate(async () => {
      const { todayLima } = await import("./crm.mjs"),
        today = todayLima(),
        d = new Date(today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + 3);
      const date = d.toISOString().slice(0, 10);
      const s = {
        version: 2,
        clients: [],
        accounts: [
          {
            id: "a",
            service: "Netflix",
            email: "a@example.com",
            provider: "Mi proveedor",
            supplierId: "p",
            capacity: 5,
            expires: date,
            costCents: 5000,
            costIntervalMonths: 1,
          },
        ],
        templates: [
          { id: "t", name: "Hola", body: "Hola {nombre}", context: "General" },
        ],
        combos: [],
        ledger: [],
        settings: { business: "Negocio", payments: "", dark: false },
        procurement: {
          suppliers: [
            {
              id: "p",
              name: "Mi proveedor",
              phone: "987654321",
              email: "p@example.com",
              notes: "",
            },
          ],
          offers: [
            {
              id: "o",
              name: "Hosting",
              supplierId: "p",
              type: "business",
              costCents: 12000,
              intervalMonths: 12,
              capacity: 1,
              notes: "",
              nextRenewal: date,
            },
          ],
        },
      };
      localStorage.setItem("crm.workspace.v2", JSON.stringify(s));
    });
    await p.reload();
    await p.waitForSelector("#supplier-overview-rows article");
    assert.equal(await p.locator("#supplier-overview-rows article").count(), 2);
    assert.match(await p.locator("#supplier-monthly").textContent(), /60.00/);
    assert.match(
      await p.locator("#supplier-overview-rows").textContent(),
      /Vence en 3 días/,
    );
    const href = await p
      .locator("#supplier-overview-rows .whatsapp")
      .first()
      .getAttribute("href");
    assert.equal(new URL(href).pathname, "/51987654321");
    await p.locator("#supplier-overview .section-head a").click();
    await p
      .locator("#supplier-offers article")
      .filter({ hasText: "Hosting" })
      .locator("button")
      .filter({ hasText: "Editar" })
      .click();
    assert.ok(
      await p.locator("#supplier-offer-form [name=nextRenewal]").inputValue(),
    );
    await p.locator("#supplier-offer-form [name=cost]").fill("240");
    await p.locator("#supplier-offer-form button:not([type])").click();
    await p.waitForFunction(() =>
      document.querySelector("#supplier-monthly").textContent.includes("70.00"),
    );
    await p.locator("nav [data-view=home]").click();
    await p.waitForFunction(() => !document.querySelector("#home").hidden);
    assert.match(await p.locator("#supplier-monthly").textContent(), /70.00/);
    await p.reload();
    assert.match(await p.locator("#supplier-monthly").textContent(), /70.00/);
    await p.setViewportSize({ width: 390, height: 844 });
    assert.ok(await p.locator("#supplier-overview").isVisible());
    assert.deepEqual(errors, []);
    console.log(
      "PASS: home supplier costs, three-day alerts, wa.me, finance updates and persistence, mobile; no sends.",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
