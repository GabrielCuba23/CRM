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
    await p.locator("#client-form [name=name]").fill("Contacto chat");
    await p.locator("#client-form [name=phone]").fill("987654321");
    await p.locator("#client-form [name=service]").fill("Max");
    await p.locator("#client-form button[type=submit]").click();
    await p.waitForFunction(
      () => !document.querySelector("#client-dialog").open,
    );
    await p.locator("nav [data-view=messages]").click();
    await p.locator(".inbox-contact").click();
    await p
      .locator("#inbox-received")
      .fill("<img src=x onerror=alert(1)> ¿Puedo renovar?");
    await p.locator("#inbox-received-form button").click();
    await p.waitForFunction(
      () => document.querySelectorAll(".inbox-bubble").length === 1,
    );
    assert.equal(await p.locator(".inbox-bubble img").count(), 0);
    await p.locator("#inbox-compose").click();
    await p.locator("#message-text").fill("Sí, podemos renovar 👋");
    await p.locator("#message-text").dispatchEvent("input");
    assert.match(
      await p.locator("#open-whatsapp").getAttribute("href"),
      /^https:\/\/wa.me\/51987654321/,
    );
    assert.equal(await p.locator(".inbox-bubble").count(), 1);
    await p.locator("#confirm-manual-message").click();
    await p.waitForFunction(
      () => !document.querySelector("#message-dialog").open,
    );
    assert.equal(await p.locator(".inbox-bubble").count(), 2);
    await p.reload();
    await p.locator(".inbox-contact").click();
    assert.equal(await p.locator(".inbox-bubble").count(), 2);
    await p.locator('#messages a[href="#templates"]').click();
    await p.waitForFunction(
      () =>
        !document.querySelector("#automation").hidden &&
        document.querySelector("#predefined-messages").open,
    );
    assert.equal(await p.locator("#template-form").isVisible(), true);
    await p.locator("#add-template").click();
    await p.locator("#template-name").fill("Mensaje chat propio");
    await p.locator("#template-context").fill("Chat soporte");
    await p.locator("#template-body").fill("Hola {nombre}, ¿cómo estás?");
    await p.locator("#template-form button[type=submit]").click();
    await p.waitForFunction(() =>
      JSON.parse(localStorage.getItem("crm.workspace.v2")).templates.some(
        (t) => t.name === "Mensaje chat propio",
      ),
    );
    await p.locator("nav [data-view=messages]").click();
    await p.locator("#inbox-compose").click();
    assert.match(
      await p.locator("#message-template").textContent(),
      /Mensaje chat propio/,
    );
    await p.locator("#message-dialog .close").click();
    await p.setViewportSize({ width: 390, height: 844 });
    assert.equal(await p.locator("#inbox-compose").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: manual incoming/outgoing history, explicit confirmation, persistence, templates moved and still available, safe rendering, mobile; no WhatsApp sends.",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
