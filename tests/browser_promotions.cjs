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
    p.on("dialog", (d) => d.accept());
    await p.goto(process.env.CRM_TEST_URL || "http://127.0.0.1:8012/");
    await p.locator("nav [data-view=customers]").click();
    await p.locator("#add-customer").click();
    await p.locator("#client-form [name=name]").fill("Cliente descuento");
    await p.locator("#client-form [name=service]").fill("Netflix");
    await p.locator("#client-form [name=price]").fill("100");
    await p.locator("#client-form [name=paid]").uncheck();
    await p.locator("#client-form button[type=submit]").click();
    await p.waitForFunction(
      () => !document.querySelector("#client-dialog").open,
    );
    await p.locator("nav [data-view=combos]").click();
    const f = p.locator("#promotion-form");
    await f.locator("[name=name]").fill("Especial 15%");
    await f.locator("[name=value]").fill("15");
    await f.locator("button:not([type])").click();
    await p.waitForFunction(
      () => document.querySelectorAll("#promotion-cards article").length === 1,
    );
    await p
      .locator("#promotion-cards button")
      .filter({ hasText: "Personalizar" })
      .click();
    assert.match(await p.locator("#promotion-total").textContent(), /85.00/);
    await p.locator("#promotion-custom-value").fill("10");
    assert.match(await p.locator("#promotion-total").textContent(), /90.00/);
    await p.locator("#promotion-paid").check();
    await p.locator("#promotion-apply-button").click();
    await p.waitForFunction(
      () => !document.querySelector("#promotion-dialog").open,
    );
    let state = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")),
    );
    assert.equal(state.clients[0].price, 9000);
    assert.equal(state.ledger.length, 1);
    assert.equal(state.ledger[0].amount, 9000);
    assert.equal(state.promotions.applications[0].discount, 1000);
    await f.locator("[name=name]").fill("Regalo Spotify");
    await f.locator("[name=kind]").selectOption("gift");
    await f.locator("[name=giftService]").fill("Spotify 30 días");
    await f.locator("button:not([type])").click();
    await p.waitForFunction(
      () => document.querySelectorAll("#promotion-cards article").length === 2,
    );
    await p
      .locator("#promotion-cards article")
      .filter({ hasText: "Regalo Spotify" })
      .locator("button")
      .filter({ hasText: "Personalizar" })
      .click();
    await p.locator("#promotion-message").click();
    assert.match(
      await p.locator("#message-text").inputValue(),
      /Producto gratis: Spotify 30 días/,
    );
    state = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")),
    );
    assert.equal(state.promotions.applications.length, 1);
    await p.locator("#message-dialog .close").click();
    await p
      .locator("#promotion-cards article")
      .filter({ hasText: "Regalo Spotify" })
      .locator("button")
      .filter({ hasText: "Personalizar" })
      .click();
    await p.locator("#promotion-update-price").uncheck();
    await p.locator("#promotion-apply-button").click();
    await p.waitForFunction(
      () => !document.querySelector("#promotion-dialog").open,
    );
    state = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")),
    );
    assert.equal(state.ledger.length, 1);
    assert.equal(
      state.promotions.applications[1].giftService,
      "Spotify 30 días",
    );
    assert.equal(state.clients[0].price, 9000);
    await p.reload();
    await p.waitForSelector("#promotion-cards article");
    assert.equal(await p.locator("#promotion-history article").count(), 2);
    await p.setViewportSize({ width: 390, height: 844 });
    assert.ok(await f.isVisible());
    assert.deepEqual(errors, []);
    console.log(
      "PASS: custom percentage preview, exact paid sale, free-product history, WhatsApp quote without mutation, reload, mobile; no sends.",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
