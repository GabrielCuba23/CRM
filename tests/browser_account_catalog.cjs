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
    await p.locator("nav [data-view=messages]").click();
    await p.locator("#new-account").click();
    const f = p.locator("#account-form");
    await f.locator("[name=service]").fill("Producto libre");
    await f.locator("[name=email]").fill("fixture@example.com");
    await f.locator("[name=password]").fill("fixture-password");
    await f.locator("[name=expires]").fill("2099-01-01");
    await f.locator("[name=provider]").fill("Proveedor libre");
    await f.locator("[name=cost]").fill("24");
    await p.locator("#account-create-supplier").click();
    assert.equal(
      await p.locator("#account-supplier-form [name=name]").inputValue(),
      "Proveedor libre",
    );
    await p.locator("#account-supplier-form .close").last().click();
    assert.equal(
      await f.locator("[name=email]").inputValue(),
      "fixture@example.com",
    );
    assert.equal(
      await f.locator("[name=password]").inputValue(),
      "fixture-password",
    );
    await p.locator("#account-create-supplier").click();
    await p.locator("#account-supplier-form [name=phone]").fill("987654321");
    await p.locator("#account-supplier-save").click();
    await p.waitForFunction(
      () => !document.querySelector("#account-supplier-dialog").open,
    );
    assert.equal(
      await f.locator("[name=email]").inputValue(),
      "fixture@example.com",
    );
    assert.ok(await p.locator("#account-supplier").inputValue());
    await p.locator("#account-create-offer").click();
    await p
      .locator("#account-product-form [name=name]")
      .fill("Producto creado aquí");
    await p
      .locator("#account-product-form [name=intervalMonths]")
      .selectOption("3");
    await p.locator("#account-product-form [name=capacity]").fill("4");
    await p.locator("#account-product-save").click();
    await p.waitForFunction(
      () => !document.querySelector("#account-product-dialog").open,
    );
    assert.equal(
      await f.locator("[name=service]").inputValue(),
      "Producto creado aquí",
    );
    assert.equal(await f.locator("[name=cost]").inputValue(), "24.00");
    assert.equal(
      await f.locator("[name=password]").inputValue(),
      "fixture-password",
    );
    assert.ok(await p.locator("#account-offer").inputValue());
    await f.locator("[name=service]").fill("Nombre personalizado de cuenta");
    await f.locator("[name=cost]").fill("27");
    await f.locator("button:not([type])").click();
    await p.waitForFunction(
      () => !document.querySelector("#account-dialog").open,
    );
    assert.equal(new URL(p.url()).hash, "#messages");
    let s = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")),
    );
    assert.equal(s.procurement.suppliers.length, 1);
    assert.equal(s.procurement.offers.length, 1);
    assert.equal(s.accounts[0].supplierId, s.procurement.suppliers[0].id);
    assert.equal(s.accounts[0].offerId, s.procurement.offers[0].id);
    assert.equal(s.accounts[0].costCents, 2700);
    assert.equal(s.procurement.offers[0].costCents, 2400);
    assert.equal(s.ledger.length, 0);
    await p.reload();
    await p.locator("#new-account").click();
    await p.locator("#account-supplier-search").fill("Proveedor libre");
    await p
      .locator("#account-supplier")
      .selectOption(s.procurement.suppliers[0].id);
    await p.locator("#account-offer-search").fill("Producto creado");
    await p.locator("#account-offer").selectOption(s.procurement.offers[0].id);
    assert.equal(await f.locator("[name=cost]").inputValue(), "24.00");
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator("#account-create-supplier").click();
    assert.equal(await p.locator("#account-supplier-dialog").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: create supplier/product from global account modal, cancel preserves draft, cost override keeps catalog snapshot, reload/select/search, mobile, no expenses or sends.",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
