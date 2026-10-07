const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(process.env.CRM_TEST_URL || "http://127.0.0.1:8011/");
    await page.locator("nav [data-view=customers]").click();
    await page.locator("#add-customer").click();
    await page.locator("#client-form [name=name]").fill("Contacto Marketing");
    await page.locator("#client-form [name=phone]").fill("987654321");
    await page.locator("#client-form button[type=submit]").click();
    await page.waitForFunction(
      () => !document.querySelector("#client-dialog").open,
    );
    await page.locator("nav [data-view=marketing]").click();
    await page.locator("#segment-form [name=name]").fill("Mi lista");
    await page.locator("#segment-form [name=minScore]").fill("10");
    await page
      .locator("#segment-form [name=persona]")
      .fill("Familias que buscan entretenimiento");
    await page.locator("#segment-form button").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#segments-list")
        .textContent.includes("1 contactos"),
    );
    await page.locator("#campaign-form [name=name]").fill("Oferta");
    await page.locator("#campaign-segment").selectOption({ label: "Mi lista" });
    await page
      .locator("#campaign-form [name=body]")
      .fill("Hola {nombre} 👋 oferta & personalizada");
    await page.locator("#campaign-form button").click();
    await page.waitForFunction(() =>
      document.querySelector("#campaigns-list").textContent.includes("Oferta"),
    );
    await page
      .locator("#campaigns-list")
      .getByRole("button", { name: "Ver contactos / preparar" })
      .click();
    await page
      .locator("#marketing-audience")
      .getByRole("button", { name: "Preparar mensaje" })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("#message-text")
        .value.includes("Contacto Marketing"),
    );
    assert.equal(
      new URL(
        await page.locator("#open-whatsapp").getAttribute("href"),
      ).searchParams.get("text"),
      "Hola Contacto Marketing 👋 oferta & personalizada",
    );
    await page.locator("#message-dialog .close").click();
    await page.locator("nav [data-view=social]").click();
    await page.locator("#post-form [name=name]").fill("Post de prueba");
    await page.locator("#post-form [name=network]").selectOption("Instagram");
    await page
      .locator("#post-form [name=scheduledAt]")
      .fill("2026-10-10T09:00");
    await page.locator("#post-form [name=body]").fill("Contenido de prueba");
    await page.locator("#post-form button").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#posts-list")
        .textContent.includes("Post de prueba"),
    );
    await page
      .locator("#social-client")
      .selectOption({ label: "Contacto Marketing" });
    await page
      .locator("#interaction-form [name=network]")
      .selectOption("Instagram");
    await page.locator("#interaction-form [name=agent]").fill("Gabriel");
    await page
      .locator("#interaction-form [name=body]")
      .fill("Consulta de precio");
    await page.locator("#interaction-form button").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#interactions-list")
        .textContent.includes("Consulta de precio"),
    );
    await page
      .locator("#interactions-list")
      .getByRole("button", { name: "Marcar respondida" })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("#social-metrics")
        .textContent.includes("1 atendidas"),
    );
    await page
      .locator("#interactions-list")
      .getByRole("button", { name: "Ver ficha" })
      .click();
    assert(
      (await page.locator("#contact-detail-body").innerText()).includes(
        "Consulta de precio",
      ),
    );
    await page.locator("#contact-detail .close").click();
    await page.reload();
    await page.waitForFunction(() =>
      document
        .querySelector("#posts-list")
        .textContent.includes("Post de prueba"),
    );
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")),
    );
    assert.equal(state.growth.campaigns.length, 1);
    assert.equal(state.growth.posts[0].scheduledAt, "2026-10-10T14:00:00.000Z");
    assert.equal(state.growth.interactions[0].outcome, "answered");
    assert.equal(state.growth.interactions[0].clientId, state.clients[0].id);
    await page.locator("nav [data-view=settings]").click();
    await page.locator("#crm-name").fill("Mi marca CRM");
    await page.locator("#crm-logo-file").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        await page.evaluate(() => {
          const c = document.createElement("canvas");
          c.width = c.height = 192;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#7356ed";
          ctx.fillRect(0, 0, 192, 192);
          return c.toDataURL("image/png").split(",")[1];
        }),
        "base64",
      ),
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#crm-logo-status")
        .textContent.includes("Vista previa lista"),
    );
    await page.locator("#settings-form button:not([type])").click();
    await page.waitForFunction(() => document.title === "Mi marca CRM");
    assert.equal(await page.locator("#brand-name").innerText(), "Mi marca CRM");
    await page.reload();
    await page.waitForFunction(() => document.title === "Mi marca CRM");
    assert(
      (await page.locator("#brand-logo").getAttribute("src")).startsWith(
        "data:image/png;base64,",
      ),
    );
    await page.waitForFunction(() => navigator.serviceWorker?.controller);
    const installedManifest = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return (await fetch("manifest.webmanifest")).json();
    });
    assert.equal(installedManifest.name, "Mi marca CRM");
    assert.equal(
      await page.evaluate(async () => (await caches.keys()).length),
      0,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "Marketing and social browser: segments, campaign personalization, planning, linked interactions, metrics and persistence passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
