const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(process.env.CRM_TEST_URL || "http://127.0.0.1:8011/");
  await page.locator("#new-account").click();
  await page.locator("#account-form [name=service]").fill("Netflix");
  await page.locator("#account-form [name=email]").fill("account@example.com");
  await page.locator("#account-form [name=expires]").fill("2099-12-31");
  await page.locator("#account-password").fill("fixture-password");
  await page.locator("#toggle-account-password").click();
  assert.equal(
    await page.locator("#account-password").getAttribute("type"),
    "text",
  );
  await page
    .locator(
      "#account-form button:not([type]),#account-form button[type=submit]",
    )
    .click();
  await page.waitForFunction(
    () => !document.querySelector("#account-dialog").open,
  );
  await page.locator("nav [data-view=accounts]").click();
  assert(
    !(await page.locator("#account-cards").innerText()).includes(
      "fixture-password",
    ),
  );
  await page
    .locator("#account-cards")
    .getByRole("button", { name: "Editar", exact: true })
    .click();
  assert.equal(
    await page.locator("#account-password").inputValue(),
    "fixture-password",
  );
  assert.equal(
    await page.locator("#account-password").getAttribute("type"),
    "password",
  );
  await page.locator("#account-dialog .close").first().click();
  await page.locator("nav [data-view=customers]").click();
  await page.locator("#add-customer").click();
  await page.locator("#client-form [name=name]").fill("Ana");
  await page.locator("#client-form [name=phone]").fill("987654321");
  const account = await page.evaluate(
    () => JSON.parse(localStorage.getItem("crm.workspace.v2")).accounts[0].id,
  );
  await page.locator("#client-account").selectOption(account);
  assert.equal(
    await page.locator("#client-account-password").inputValue(),
    "fixture-password",
  );
  assert.equal(
    await page.locator("#client-account-password").getAttribute("type"),
    "password",
  );
  await page.locator("#client-form [name=price]").fill("20.50");
  assert(await page.locator("#client-form [name=paid]").isChecked());
  await page.locator("#client-form button[type=submit]").click();
  await page.waitForFunction(
    () => !document.querySelector("#client-dialog").open,
  );
  await page.locator("nav [data-view=finance]").click();
  assert((await page.locator("#income").innerText()).includes("20.50"));
  await page.locator("nav [data-view=customers]").click();
  await page
    .locator("#clients")
    .getByRole("button", { name: "Editar", exact: true })
    .click();
  await page.locator("#client-form [name=notes]").fill("Editado");
  await page.locator("#client-form button[type=submit]").click();
  await page.waitForFunction(
    () => !document.querySelector("#client-dialog").open,
  );
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("crm.workspace.v2")).ledger.length,
    ),
    1,
  );
  await page
    .locator("#clients")
    .getByRole("button", { name: "WhatsApp →", exact: true })
    .click();
  await page.locator("#message-template").selectOption("password");
  assert(
    (await page.locator("#message-text").inputValue()).includes(
      "fixture-password",
    ),
  );
  await page.locator("#message-new-template").click();
  await page.locator("#message-new-name").fill("Amigo personalizado");
  await page.locator("#message-new-context").fill("Amigos");
  await page
    .locator("#message-new-body")
    .fill("Hola {nombre} 👋 mensaje 100% personalizado & listo");
  await page.locator("#message-save-template").click();
  await page.waitForFunction(
    () => document.querySelector("#message-template-editor").hidden,
  );
  assert(
    (await page.locator("#message-text").inputValue()).includes("Hola Ana"),
  );
  assert(
    (
      await page.locator("#message-template option").last().innerText()
    ).includes("Mensaje libre"),
  );
  const link = new URL(
    await page.locator("#open-whatsapp").getAttribute("href"),
  );
  assert.equal(
    link.searchParams.get("text"),
    await page.locator("#message-text").inputValue(),
  );
  await page.locator("#message-free").click();
  await page.locator("#message-text").fill("Mi texto libre sin plantilla ✅");
  assert.equal(
    new URL(
      await page.locator("#open-whatsapp").getAttribute("href"),
    ).searchParams.get("text"),
    "Mi texto libre sin plantilla ✅",
  );
  await page.locator("#message-dialog .close").click();
  await page.locator("#add-customer").click();
  await page.locator("#client-form [name=name]").fill("Amigo sin teléfono");
  await page.locator("#client-form [name=whatsappUsername]").fill("@amigo");
  await page.locator("#client-form button[type=submit]").click();
  await page.waitForFunction(
    () => !document.querySelector("#client-dialog").open,
  );
  const friend = page
    .locator("#clients tr")
    .filter({ hasText: "Amigo sin teléfono" });
  await friend.getByRole("button", { name: "WhatsApp →", exact: true }).click();
  assert.equal(await page.locator("#open-whatsapp").getAttribute("href"), null);
  assert((await page.locator("#recipient").innerText()).includes("@amigo"));
  await page.locator("#message-dialog .close").click();
  await page.locator("nav [data-view=finance]").click();
  await page.locator("#new-income").click();
  const friendId = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")).clients.find(
        (c) => c.whatsappUsername === "@amigo",
      ).id,
  );
  await page.locator("#income-client").selectOption(friendId);
  await page.locator("#income-form [name=amount]").fill("10");
  await page.locator("#income-form button[type=submit]").click();
  await page.waitForFunction(
    () => !document.querySelector("#income-dialog").open,
  );
  assert((await page.locator("#income").innerText()).includes("30.50"));
  await page.locator("#new-income").click();
  await page.locator("#income-client").selectOption(friendId);
  await page.locator("#income-form [name=amount]").fill("10");
  await page.locator("#income-form button[type=submit]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#income-error")
      .textContent.includes("ya tiene una venta"),
  );
  await page.locator("#income-dialog .close").first().click();
  await page.locator("nav [data-view=customers]").click();
  await page.locator("#import-clients").click();
  await page.locator("#client-import-file").setInputFiles({
    name: "clientes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "nombre,telefono,usuario_whatsapp,servicio\nNuevo,987654322,,Max\nUsername,,@nuevo,Max\nError,123,,Max",
    ),
  });
  await page.waitForFunction(
    () => !document.querySelector("#confirm-client-import").disabled,
  );
  assert(
    (await page.locator("#client-import-status").innerText()).includes(
      "2 válidos",
    ),
  );
  await page.locator("#confirm-client-import").click();
  await page.waitForFunction(
    () => !document.querySelector("#client-import-dialog").open,
  );
  assert.equal(await page.locator("#clients tr").count(), 4);
  const download = page.waitForEvent("download");
  await page.locator("#export-clients-xlsx").click();
  const file = await download;
  const path = await file.path();
  await page.locator("#import-clients").click();
  await page.locator("#client-import-file").setInputFiles({
    name: "clientes.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: require("node:fs").readFileSync(path),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#client-import-status")
      .textContent.includes("4 duplicados"),
  );
  assert(await page.locator("#confirm-client-import").isDisabled());
  await page.locator("#client-import-dialog .close").first().click();
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll("#clients tr").length === 4,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: stored account password, hidden lists, manual password fill, inline templates/categories/free text, automatic sale once, username-only client, manual income duplicate guard, CSV preview/import, Excel export/reimport and persistence. No sends.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
