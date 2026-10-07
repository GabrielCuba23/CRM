const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.CRM_TEST_PASSWORD)
    throw Error(
      "Run tests/run_secure_browser.py to create an isolated test server.",
    );
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const base = process.env.CRM_TEST_URL;
  await page.goto(base);
  assert(page.url().endsWith("/login"));
  await page.locator("[name=email]").fill("owner@example.com");
  await page.locator("[name=password]").fill("wrong-password");
  await page.locator("#login-form button").click();
  await page.waitForFunction(() =>
    document.querySelector("#login-error").textContent.includes("incorrectos"),
  );
  await page.locator("[name=password]").fill(process.env.CRM_TEST_PASSWORD);
  await page.locator("#login-form button").click();
  await page.waitForSelector("#new-client");
  await page.waitForFunction(() => !document.querySelector("#logout").hidden);
  assert(
    (await page.locator("#deployment-mode").innerText()).includes(
      "Modo privado",
    ),
  );
  await page.locator("#new-client").click();
  await page.locator("#client-form [name=name]").fill("Cliente privado");
  await page.locator("#client-form [name=phone]").fill("987654321");
  await page.locator("#client-form [name=expires]").fill("2027-12-31");
  await page.locator("#client-form [name=reminderConsent]").check();
  await page.locator("#client-form button[type=submit]").click();
  await page.waitForFunction(
    () => !document.querySelector("#client-dialog").open,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("crm.workspace.v2")),
    null,
  );
  await page.locator("nav [data-view=templates]").click();
  for (let i = 0; i < 5; i++) {
    await page.locator("#add-template").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#template-name").value === "Nueva plantilla",
    );
    await page.locator("#template-name").fill(`Soporte ${i}`);
    await page
      .locator("#template-context")
      .fill(i === 0 ? "Bienvenida personalizada" : "Soporte");
    await page
      .locator("#template-body")
      .fill(
        `Hola {nombre}. Consulta ${i}: texto completamente personalizado ✅`,
      );
    await page.locator("#template-form button[type=submit]").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#status").textContent === "Plantilla guardada.",
    );
  }
  assert.equal(await page.locator("#template-select option").count(), 7);
  await page.locator("#template-search").fill("Consulta 4");
  assert.equal(await page.locator("#template-library button").count(), 1);
  assert(
    (await page.locator("#template-preview").innerText()).includes(
      "Tu cliente",
    ),
  );
  await page
    .locator("#preview-client")
    .selectOption({ label: "Cliente privado" });
  assert(
    (await page.locator("#template-preview").innerText()).includes(
      "Cliente privado",
    ),
  );
  await page.locator("#duplicate-template").click();
  await page.waitForFunction(
    () => document.querySelector("#template-select").options.length === 8,
  );
  await page.locator("nav [data-view=automation]").click();
  await page.locator("#legacy-meta summary").click();
  await page.locator("#automation-name").fill("recordatorio_renovacion");
  await page.locator("#automation-language").fill("es_PE");
  await page.locator("#automation-enabled").check();
  await page.locator("#automation-form button").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#status")
      .textContent.includes("Regla de recordatorio guardada"),
  );
  assert(
    (await page.locator("#automation-badge").innerText()).includes(
      "Falta conectar API",
    ),
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#automation-name").value ===
      "recordatorio_renovacion",
  );
  assert(await page.locator("#automation-enabled").isChecked());
  assert.equal(
    await page.locator("#automation-name").inputValue(),
    "recordatorio_renovacion",
  );
  assert.equal(await page.locator("#template-select option").count(), 8);
  await page.locator("nav [data-view=customers]").click();
  assert(
    (await page.locator("#clients").innerText()).includes("Cliente privado"),
  );
  await page.locator("#clients button").filter({ hasText: "WhatsApp" }).click();
  assert.equal(
    new URL(await page.locator("#open-whatsapp").getAttribute("href")).pathname,
    "/51987654321",
  );
  await page.locator("#message-dialog .close").click();
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(base);
  assert(stranger.url().endsWith("/login"));
  assert.equal((await other.request.get(base + "api/workspace")).status(), 401);
  await page.locator("nav [data-view=security]").click();
  assert(
    (await page.locator("#owner-identity").innerText()).includes(
      "owner@example.com",
    ),
  );
  await page
    .locator("#password-form [name=current]")
    .fill(process.env.CRM_TEST_PASSWORD);
  await page
    .locator("#password-form [name=next]")
    .fill(process.env.CRM_TEST_NEXT_PASSWORD);
  await page.locator("#password-form button").click();
  await page.waitForURL("**/login");
  await page.locator("[name=email]").fill("owner@example.com");
  await page
    .locator("[name=password]")
    .fill(process.env.CRM_TEST_NEXT_PASSWORD);
  await page.locator("#login-form button").click();
  await page.waitForSelector("#logout");
  await page.locator("#logout").click();
  await page.waitForURL("**/login");
  assert.equal((await page.request.get(base + "api/workspace")).status(), 401);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "PASS: private login, server persistence, arbitrary contexts and eight messages, preview, automation configuration, anonymous access blocked, password change and logout. No WhatsApp messages sent.",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
