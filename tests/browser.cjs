const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.clock.setFixedTime(new Date("2026-10-06T15:00:00Z"));
  await page.goto(process.env.CRM_TEST_URL || "http://127.0.0.1:8000/");
  await page.locator("#new-account").click();
  await page.locator("#account-form [name=service]").fill("Netflix");
  await page.locator("#account-form [name=email]").fill("cuenta@example.com");
  await page.locator("#account-form [name=provider]").fill("Proveedor");
  await page.locator("#account-form [name=expires]").fill("2027-12-31");
  await page.locator("#account-form [name=capacity]").fill("2");
  await page
    .locator(
      "#account-form button[type=submit], #account-form button:not([type])",
    )
    .click();
  assert.equal(await page.locator("#nav-free").innerText(), "2");
  await page.locator(".platform-card").click();
  await page.locator("#client-form [name=name]").fill("Ana & José");
  await page.locator("#client-form [name=phone]").fill("987654321");
  await page.locator("#client-form [name=expires]").fill("2026-10-01");
  await page.locator("#client-form [name=price]").fill("20.50");
  await page.locator("#client-form [name=pin]").fill("1234");
  await page.locator("#client-form [name=paid]").check();
  await page.locator("#client-form button[type=submit]").click();
  assert.equal(await page.locator("#nav-free").innerText(), "1");
  assert.equal(await page.locator("#nav-renewals").innerText(), "1");
  await page.locator("nav a[data-view=customers]").click();
  await page.locator("#clients button").filter({ hasText: "WhatsApp" }).click();
  const href = await page.locator("#open-whatsapp").getAttribute("href");
  assert.equal(new URL(href).pathname, "/51987654321");
  assert(new URL(href).searchParams.get("text").includes("Ana & José"));
  assert(new URL(href).searchParams.get("text").includes("cuenta@example.com"));
  await page.locator("#message-template").selectOption("password");
  await page.locator("#message-password").fill("testing-pass");
  assert(
    (await page.locator("#message-text").inputValue()).includes("testing-pass"),
  );
  assert(
    !(await page.evaluate(() => JSON.stringify(localStorage))).includes(
      "testing-pass",
    ),
  );
  await page.locator("#message-dialog .close").click();
  await page.waitForFunction(
    () => document.querySelector("#message-password").value === "",
  );
  await page.locator("#clients button").filter({ hasText: "Renovar" }).click();
  await page.locator("#renew-form [name=expires]").fill("2027-01-01");
  await page.locator("#renew-form [name=amount]").fill("25");
  await page.locator("#renew-form button:not([type])").click();
  assert.equal(await page.locator("#nav-renewals").innerText(), "0");
  await page.locator("nav a[data-view=finance]").click();
  await page.locator("#finance-month").fill("2026-10");
  assert((await page.locator("#income").innerText()).includes("45.50"));
  await page.locator("#new-expense").click();
  await page
    .locator("#expense-form [name=description]")
    .fill("Proveedor Netflix");
  await page.locator("#expense-form [name=amount]").fill("10");
  await page.locator("#expense-form button:not([type])").click();
  assert((await page.locator("#profit").innerText()).includes("35.50"));
  await page.locator("nav a[data-view=combos]").click();
  await page.locator("#combo-form [name=name]").fill("Familiar");
  await page.locator("#combo-form [name=services]").fill("Netflix + Max");
  await page.locator("#combo-form [name=price]").fill("35");
  await page.locator("#combo-form button").click();
  await page
    .locator("#combo-cards button")
    .filter({ hasText: "Preparar oferta" })
    .click();
  await page.locator("#offer-form button:not([type])").click();
  assert(
    (await page.locator("#message-text").inputValue()).includes("Familiar"),
  );
  await page.locator("#message-dialog .close").click();
  await page.reload();
  await page.locator("nav a[data-view=customers]").click();
  assert.equal(await page.locator("#clients tr").count(), 1);
  assert((await page.locator("#clients").innerText()).includes("Ana & José"));
  await page.locator("nav a[data-view=templates]").click();
  await page.locator("#add-template").click();
  await page.locator("#template-name").fill("Prueba");
  await page.locator("#template-body").fill("Hola {nombre}\nPago: {pago} & ✅");
  await page.locator("#template-form button[type=submit]").click();
  await page.reload();
  assert.equal(await page.locator("#template-select option").count(), 4);
  await page.locator("nav a[data-view=settings]").click();
  await page.locator("#business-name").fill("Mi Streaming");
  await page.locator("#payment-methods").fill("Yape 987654321");
  await page.locator("#settings-form button").click();
  await page.locator("#theme-toggle").click();
  assert(
    await page.locator("html").evaluate((e) => e.classList.contains("dark")),
  );
  await page.locator("#theme-toggle").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-data").click();
  const download = await downloadPromise;
  await download.saveAs(
    require("node:path").join(
      require("node:os").tmpdir(),
      "crm-backup-test.json",
    ),
  );
  await page.locator("nav a[data-view=customers]").click();
  await page.locator("#clients button").filter({ hasText: "Eliminar" }).click();
  assert.equal(await page.locator("#clients tr").count(), 0);
  await page.locator("nav a[data-view=settings]").click();
  await page
    .locator("#import-data")
    .setInputFiles(
      require("node:path").join(
        require("node:os").tmpdir(),
        "crm-backup-test.json",
      ),
    );
  await page.waitForFunction(
    () =>
      document.querySelector("#backup-status").textContent ===
      "Respaldo restaurado.",
  );
  await page.locator("nav a[data-view=customers]").click();
  assert.equal(await page.locator("#clients tr").count(), 1);
  await page.screenshot({
    path: require("node:path").join(
      require("node:os").tmpdir(),
      "crm-desktop.png",
    ),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("nav a[data-view=home]").click();
  await page.screenshot({
    path: require("node:path").join(
      require("node:os").tmpdir(),
      "crm-mobile.png",
    ),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: account inventory, sale, WhatsApp encoding, transient password, renewal, finances, combos, persistence, templates, theme, backup restore, mobile layout; no browser errors",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
