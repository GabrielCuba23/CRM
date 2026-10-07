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
  await page.goto(process.env.CRM_TEST_URL || "http://127.0.0.1:8000/");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  await page.locator("#new-client").click();
  await page.locator("#client-form [name=name]").fill("José & Ana");
  await page.locator("#client-form [name=phone]").fill("987654321");
  await page.locator("#client-form [name=service]").fill("Max");
  await page.locator("#client-form [name=expires]").fill(today);
  await page.locator("#client-form [name=reminderConsent]").check();
  await page.locator("#client-form button[type=submit]").click();
  await page.waitForFunction(
    () => !document.querySelector("#client-dialog").open,
  );
  await page.locator("nav [data-view=automation]").click();
  for (let i = 0; i < 5; i++) {
    await page.locator("#new-rule").click();
    await page.locator("#rule-form [name=name]").fill("Regla " + i);
    await page.locator("#rule-form [name=templateId]").selectOption("renew");
    await page.locator("#rule-form [name=daysBefore]").fill("0");
    await page.locator("#rule-form [name=hour]").fill("0");
    if (i === 0) await page.locator("#rule-form [name=enabled]").check();
    assert(
      (await page.locator("#rule-preview").innerText()).includes("José & Ana"),
    );
    await page.locator("#rule-form button[type=submit]").click();
    await page.waitForFunction(
      () => !document.querySelector("#rule-dialog").open,
    );
  }
  assert.equal(await page.locator("#rule-list .rule-card").count(), 5);
  await page.waitForFunction(
    () => document.querySelectorAll("#task-list .rule-card").length === 1,
  );
  await page.locator("#task-list button").click();
  const text = await page.locator("#message-text").inputValue(),
    link = await page.locator("#open-whatsapp").getAttribute("href");
  assert.equal(new URL(link).searchParams.get("text"), text);
  assert.equal(new URL(link).pathname, "/51987654321");
  await page.evaluate(() =>
    document
      .querySelector("#open-whatsapp")
      .addEventListener("click", (e) => e.preventDefault(), { capture: true }),
  );
  await page.locator("#open-whatsapp").click();
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("crm.workspace.v2")).taskReceipts
          .length,
    ),
    0,
  );
  await page.locator("#confirm-task").click();
  await page.waitForFunction(
    () => !document.querySelector("#message-dialog").open,
  );
  await page.waitForFunction(
    () => document.querySelectorAll("#task-list .rule-card").length === 0,
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("crm.workspace.v2")).taskReceipts
          .length,
    ),
    1,
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll("#rule-list .rule-card").length === 5,
  );
  assert.equal(await page.locator("#task-list .rule-card").count(), 0);
  await page
    .locator("#rule-list .rule-card")
    .first()
    .getByRole("button", { name: "Duplicar", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("#rule-list .rule-card").length === 6,
  );
  assert(
    (await page.locator("#rule-list .rule-card").last().innerText()).includes(
      "desactivada",
    ),
  );
  await page.locator("nav [data-view=integrations]").click();
  assert(
    (await page.locator("#integration-status").innerText()).includes(
      "sin conectar",
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("nav [data-view=automation]").click();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({ path: "/tmp/crm-rules-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: six configurable rules, preview, wa.me encoding, opening does not complete, explicit confirmation, persistence, integration disconnected and mobile layout. No messages sent.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
