const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let instances = [
      {
        id: "a".repeat(32),
        name: "CRM prueba",
        ownerEmail: "client@example.com",
        status: "pending",
        stage: "queued",
        url: null,
      },
    ];
    await page.route("https://panel.test/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      let result;
      if (path === "/api/session")
        result = {
          email: "gabostreaming0@gmail.com",
          csrf: "test-csrf",
          authProvider: "cloudflare-access",
          baseDomain: "test.workers.dev",
          provisioningConfigured: true,
        };
      else if (path === "/api/instances" && request.method() === "GET")
        result = { instances };
      else if (path === "/api/instances" && request.method() === "POST") {
        const data = request.postDataJSON();
        assert.equal(request.headers()["x-csrf-token"], "test-csrf");
        const instance = {
          id: "b".repeat(32),
          ...data,
          status: "pending",
          stage: "queued",
          url: null,
        };
        instances.push(instance);
        result = { instance, queued: true, authProvider: "cloudflare-access" };
      } else if (path.endsWith("/invitation"))
        result = {
          activationUrl: instances[0].url,
          instance: instances[0],
          authProvider: "cloudflare-access",
        };
      if (result) return route.fulfill({ json: result });
      const files = {
        "/": "retail/templates/panel.html",
        "/retail-static/panel.js": "retail/static/panel.js",
        "/retail-static/panel.css": "retail/static/panel.css",
      };
      if (files[path])
        return route.fulfill({
          body: fs.readFileSync(files[path]),
          contentType: path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".css")
              ? "text/css"
              : "text/html",
        });
      return route.fulfill({ status: 404, body: "Not found" });
    });
    await page.goto("https://panel.test/");
    await page.locator("#dashboard").waitFor({ state: "visible" });
    assert.equal(await page.locator(".security-settings").isVisible(), false);
    assert.match(
      await page.locator("#instances").innerText(),
      /Pendiente de publicación/,
    );
    assert.equal(await page.locator("#instances a").count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "En preparación" }).count(),
      1,
    );
    assert.equal(
      await page.getByRole("button", { name: "Renovar invitación" }).count(),
      0,
    );
    assert(
      (
        await page
          .locator("#instances")
          .evaluate((element) => getComputedStyle(element).fontFamily)
      ).length,
    );
    await page.locator("#show-create").click();
    for (const [field, value] of Object.entries({
      name: "Otra marca",
      ownerEmail: "another@example.com",
      slug: "otra-marca",
      crmName: "Otra marca",
      business: "Otra empresa",
    }))
      await page.locator(`#create-form [name="${field}"]`).fill(value);
    await page.locator("#create-form button[type=submit]").click();
    await page.waitForFunction(
      () => document.querySelector("#instances").children.length === 2,
    );
    assert.equal(await page.locator("#invitation-section").isVisible(), false);
    instances[0] = {
      ...instances[0],
      status: "active",
      stage: "ready",
      url: "https://crm-a.test.workers.dev/",
    };
    await page.reload();
    await page.getByRole("button", { name: "Acceso propietario" }).click();
    await page.locator("#invitation-section").waitFor({ state: "visible" });
    assert.match(
      await page.locator("#invitation-description").innerText(),
      /código/,
    );
    assert.doesNotMatch(
      await page.locator("#invitation-description").innerText(),
      /48 horas/,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("#dashboard").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      "Cloudflare panel browser: pending queue, creation, owner access, mobile and no script errors verified.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
