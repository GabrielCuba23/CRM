const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.accept());
    await p.goto(process.env.CRM_TEST_URL || "http://127.0.0.1:8011/");
    await p.locator("nav [data-view=finance]").click();
    await p.locator("#supplier-section summary").click();
    await p.locator("#supplier-form [name=name]").fill("Proveedor de prueba");
    await p.locator("#supplier-form button").first().click();
    await p.waitForFunction(() =>
      document
        .querySelector("#suppliers-list")
        .textContent.includes("Proveedor de prueba"),
    );
    await p
      .locator("#offer-supplier")
      .selectOption({ label: "Proveedor de prueba" });
    await p.locator("#supplier-offer-form [name=name]").fill("Netflix");
    await p.locator("#supplier-offer-form [name=cost]").fill("40");
    await p.locator("#supplier-offer-form button").first().click();
    await p.waitForFunction(() =>
      document
        .querySelector("#supplier-offers")
        .textContent.includes("Netflix"),
    );
    assert((await p.locator("#expenses").innerText()).includes("0.00"));
    await p.locator("#new-account").click();
    await p
      .locator("#account-supplier")
      .selectOption({ label: "Proveedor de prueba" });
    await p
      .locator("#account-offer")
      .selectOption({ label: "Netflix · S/ 40.00 / 1 mes" });
    assert.equal(await p.locator("#account-cost").inputValue(), "40.00");
    assert(
      (await p.locator("#account-cost-preview").innerText()).includes("8.00"),
    );
    await p.locator("#account-form [name=email]").fill("a@example.com");
    await p.locator("#account-form [name=expires]").fill("2099-01-01");
    await p.locator("#account-form button:not([type])").click();
    await p.waitForFunction(
      () => !document.querySelector("#account-dialog").open,
    );
    await p.locator("nav [data-view=customers]").click();
    await p.locator("#add-customer").click();
    await p.locator("#client-form [name=name]").fill("Cliente");
    await p
      .locator("#client-account")
      .selectOption({ label: "Netflix · a@example.com" });
    await p.locator("#client-form [name=price]").fill("12");
    assert((await p.locator("#client-cost-info").innerText()).includes("4.00"));
    await p.locator("#client-form button[type=submit]").click();
    await p.waitForFunction(
      () => !document.querySelector("#client-dialog").open,
    );
    await p.locator("nav [data-view=finance]").click();
    const marginText = (
      await p.locator("#account-margins").innerText()
    ).replace(/\s/g, "");
    assert(marginText.includes("-S/28.00") || marginText.includes("S/-28.00"));
    await p
      .locator("#supplier-offers")
      .getByRole("button", { name: "Registrar pago" })
      .click();
    await p
      .locator("#payment-account")
      .selectOption({ label: "Netflix · a@example.com" });
    await p.locator("#supplier-payment-form [name=reference]").fill("FACT-001");
    await p.locator("#supplier-payment-form button:not([type])").click();
    await p.waitForFunction(
      () => !document.querySelector("#supplier-payment-dialog").open,
    );
    assert((await p.locator("#expenses").innerText()).includes("40.00"));
    const state = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")),
    );
    assert.equal(
      state.ledger.find((m) => m.kind === "expense").accountId,
      state.accounts[0].id,
    );
    await p
      .locator("#supplier-offers")
      .getByRole("button", { name: "Registrar pago" })
      .click();
    await p.locator("#supplier-payment-form [name=reference]").fill("FACT-001");
    await p.locator("#supplier-payment-form button:not([type])").click();
    await p.waitForFunction(() =>
      document
        .querySelector("#supplier-payment-error")
        .textContent.includes("Ya existe"),
    );
    await p.locator("#supplier-payment-close").click();
    await p
      .locator("#offer-supplier")
      .selectOption({ label: "Proveedor de prueba" });
    await p.locator("#supplier-offer-form [name=name]").fill("Hosting");
    await p
      .locator("#supplier-offer-form [name=type]")
      .selectOption("business");
    await p.locator("#supplier-offer-form [name=cost]").fill("120");
    await p
      .locator("#supplier-offer-form [name=intervalMonths]")
      .selectOption("12");
    await p.locator("#supplier-offer-form button").first().click();
    await p.waitForFunction(() =>
      document.querySelector("#operating-budget").textContent.includes("10.00"),
    );
    await p
      .locator("#supplier-offers article")
      .filter({ hasText: "Hosting" })
      .getByRole("button", { name: "Registrar pago" })
      .click();
    await p.locator("#supplier-payment-form [name=reference]").fill("HOST-001");
    await p.locator("#supplier-payment-form button:not([type])").click();
    await p.waitForFunction(
      () => !document.querySelector("#supplier-payment-dialog").open,
    );
    assert((await p.locator("#expenses").innerText()).includes("160.00"));
    const expenseRows = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")).ledger.filter(
        (m) => m.kind === "expense",
      ),
    );
    assert.equal(expenseRows.length, 2);
    assert.equal(expenseRows[1].category, "operating");
    await p.reload();
    await p.waitForFunction(() =>
      document
        .querySelector("#supplier-offers")
        .textContent.includes("Hosting"),
    );
    assert.equal(
      await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem("crm.workspace.v2")).accounts[0]
            .costCents,
      ),
      4000,
    );
    await p.setViewportSize({ width: 390, height: 844 });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const legacy = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")),
    );
    delete legacy.procurement;
    delete legacy.growth;
    for (const a of legacy.accounts)
      for (const k of [
        "supplierId",
        "offerId",
        "costCents",
        "costIntervalMonths",
      ])
        delete a[k];
    for (const m of legacy.ledger)
      for (const k of [
        "supplierId",
        "offerId",
        "accountId",
        "category",
        "reference",
      ])
        delete m[k];
    await p.locator("nav [data-view=settings]").click();
    await p
      .locator("#import-data")
      .setInputFiles({
        name: "respaldo-antiguo.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(legacy)),
      });
    await p.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("crm.workspace.v2")).procurement
          .suppliers.length === 0,
    );
    assert.equal(
      await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem("crm.workspace.v2")).accounts.length,
      ),
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS suppliers, resale and operating catalogs, historical account cost, per-profile margin, cash expenses, reference deduplication, persistence and mobile.",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
