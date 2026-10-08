const { chromium } = require("playwright");
const assert = require("node:assert/strict");
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
    await p.locator("#client-form [name=name]").fill("Cliente histórico");
    await p.locator("#client-form [name=service]").fill("Netflix");
    await p.locator("#client-form [name=expires]").fill("2020-01-01");
    await p.locator("#client-form [name=price]").fill("12");
    await p.locator("#client-form button[type=submit]").click();
    await p.waitForFunction(
      () => !document.querySelector("#client-dialog").open,
    );
    await p.locator("#filter").selectOption("former");
    assert.equal(await p.locator("#clients tr").count(), 1);
    await p
      .locator("#clients")
      .getByRole("button", { name: "Archivar", exact: true })
      .click();
    await p.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("crm.workspace.v2")).clients[0]
          .archived,
    );
    await p
      .locator("#clients")
      .getByRole("button", { name: "Ficha 360" })
      .click();
    assert(
      (await p.locator("#contact-detail-body").innerText()).includes("Venta"),
    );
    assert(
      (await p.locator("#contact-detail-body").innerText()).includes(
        "Historial de servicios",
      ),
    );
    await p.locator("#contact-detail .close").click();
    await p
      .locator("#clients")
      .getByRole("button", { name: "Reactivar / nueva venta" })
      .click();
    await p.locator("#client-form [name=service]").fill("Spotify");
    await p.locator("#client-form [name=expires]").fill("2099-01-01");
    await p.locator("#client-form [name=price]").fill("15");
    await p.locator("#client-form button[type=submit]").click();
    await p.waitForFunction(
      () => !document.querySelector("#client-dialog").open,
    );
    const s = await p.evaluate(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")),
    );
    assert.equal(s.clients.length, 1);
    assert.equal(s.clients[0].archived, false);
    assert.equal(s.clients[0].serviceHistory[0].service, "Netflix");
    assert.equal(s.ledger.length, 2);
    assert(s.ledger.every((m) => m.clientId === s.clients[0].id));
    await p.reload();
    await p.locator("#filter").selectOption("current");
    assert.equal(await p.locator("#clients tr").count(), 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS former contacts, archive, purchase/service history, reactivation with same contact and new sale, persistence.",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
