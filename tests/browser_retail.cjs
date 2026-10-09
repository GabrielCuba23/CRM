const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const base = process.env.RETAIL_PUBLIC_URL;
  const password = process.env.CRM_TEST_PASSWORD;
  assert(base && password, "Run with tests/run_retail_browser.py");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--no-proxy-server",
      "--host-resolver-rules=MAP *.retail.test 127.0.0.1",
    ],
  });
  const errors = [];
  // Self-signed certificate only for these disposable local HTTPS hosts.
  const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const admin = await adminContext.newPage();
  admin.on("pageerror", (error) => errors.push(error.message));
  const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
  const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
  const ownerA = await contextA.newPage(),
    ownerB = await contextB.newPage();
  for (const page of [ownerA, ownerB])
    page.on("pageerror", (error) => errors.push(error.message));
  try {
    await admin.goto(base + "/");
    await admin.locator("#login-section").waitFor({ state: "visible" });
    await admin
      .locator("#login-form [name=email]")
      .fill(process.env.RETAIL_ADMIN_EMAIL);
    await admin
      .locator("#login-form [name=password]")
      .fill(process.env.RETAIL_ADMIN_PASSWORD);
    await admin.locator("#login-form button").click();
    await admin.locator("#dashboard").waitFor({ state: "visible" });
    async function create(name, slug, email, brand) {
      await admin.locator("#show-create").click();
      for (const [field, value] of Object.entries({
        name,
        slug,
        ownerEmail: email,
        crmName: brand,
        business: name,
      }))
        await admin.locator(`#create-form [name=${field}]`).fill(value);
      await admin.locator("#create-form button[type=submit]").click();
      await admin.locator("#invitation-section").waitFor({ state: "visible" });
      const link = await admin.locator("#invitation-link").inputValue();
      assert(new URL(link).hash.startsWith("#token="));
      const instance = await admin
        .locator("#instances tr")
        .filter({ hasText: email })
        .locator("a")
        .getAttribute("href");
      await admin.locator("#close-invitation").click();
      assert.equal(await admin.locator("#invitation-link").inputValue(), "");
      return { link, url: instance };
    }
    const first = await create(
      "Empresa Alpha",
      "alpha",
      "alpha@example.com",
      "Alpha CRM",
    );
    const second = await create(
      "Empresa Beta",
      "beta",
      "beta@example.com",
      "Beta CRM",
    );
    assert.equal(await admin.locator("#count-total").textContent(), "2");
    async function activate(page, instance, email) {
      await page.goto(instance.link);
      await page.locator("#activate-form").waitFor({ state: "visible" });
      assert.equal(
        new URL(page.url()).hash,
        "",
        "Remove the token from browser history",
      );
      assert.equal(await page.evaluate(() => localStorage.length), 0);
      await page.locator("[name=email]").fill(email);
      await page.locator("[name=password]").fill(password);
      await page.locator("[name=confirmation]").fill(password);
      await page.locator("#activate-form button").click();
      await page.locator("#login-link").waitFor({ state: "visible" });
      await page.locator("#login-link a").click();
      await page.locator("#login-form [name=email]").fill(email);
      await page.locator("#login-form [name=password]").fill(password);
      await page.locator("#login-form button").click();
      await page.locator(".crm-sidebar").waitFor({ state: "visible" });
    }
    await activate(ownerA, first, "alpha@example.com");
    await activate(ownerB, second, "beta@example.com");
    await ownerA.waitForFunction(() => document.title.includes("Alpha CRM"));
    await ownerB.waitForFunction(() => document.title.includes("Beta CRM"));
    const read = (page) =>
      page.evaluate(async () => {
        const response = await fetch("/api/workspace");
        return { status: response.status, body: await response.json() };
      });
    const stateA = await read(ownerA),
      stateB = await read(ownerB);
    assert.equal(stateA.status, 200);
    assert.equal(stateB.status, 200);
    assert.deepEqual(stateA.body.state.clients, []);
    assert.deepEqual(stateB.body.state.clients, []);
    assert.equal(stateA.body.state.settings.crmName, "Alpha CRM");
    assert.equal(stateB.body.state.settings.crmName, "Beta CRM");
    const stored = await ownerA.evaluate(async () => {
      const session = await (await fetch("/api/session")).json();
      const workspace = await (await fetch("/api/workspace")).json();
      workspace.state.settings.business = "Dato privado solo Alpha";
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
        },
        body: JSON.stringify(workspace),
      });
      return response.status;
    });
    assert.equal(stored, 200);
    assert.equal(
      (await read(ownerB)).body.state.settings.business,
      "Empresa Beta",
    );
    assert.equal(
      (await read(ownerA)).body.state.settings.business,
      "Dato privado solo Alpha",
    );
    const cookieA = (await contextA.cookies()).find(
      (cookie) => cookie.name === "__Host-nexo_session",
    );
    assert(cookieA && cookieA.httpOnly && cookieA.secure);
    const replay = await browser.newContext({ ignoreHTTPSErrors: true });
    await replay.addCookies([
      { ...cookieA, domain: new URL(second.url).hostname },
    ]);
    const replayPage = await replay.newPage();
    await replayPage.goto(second.url + "/login");
    assert.equal(
      (await read(replayPage)).status,
      401,
      "Alpha cookie cannot access Beta",
    );
    await replay.close();
    assert.equal(
      await ownerA.evaluate(async () => (await fetch("/api/instances")).status),
      404,
    );
    assert.equal(
      await admin.evaluate(async () => (await fetch("/api/workspace")).status),
      404,
    );
    await admin.reload();
    const rowA = admin
      .locator("#instances tr")
      .filter({ hasText: "alpha@example.com" });
    await rowA.getByRole("button", { name: "Suspender", exact: true }).click();
    await rowA
      .getByRole("button", { name: "Reactivar", exact: true })
      .waitFor({ state: "visible" });
    assert.equal((await read(ownerA)).status, 403);
    assert.equal((await read(ownerB)).status, 200);
    await rowA.getByRole("button", { name: "Reactivar", exact: true }).click();
    await rowA
      .getByRole("button", { name: "Suspender", exact: true })
      .waitFor({ state: "visible" });
    assert.equal(
      (await read(ownerA)).status,
      401,
      "Suspension revokes previous sessions",
    );
    await admin.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await admin.locator("#logout").click();
    await admin.locator("#login-section").waitFor({ state: "visible" });
    assert.equal(await admin.locator("#instances tr").count(), 0);
    assert.equal(await admin.locator("#invitation-link").inputValue(), "");
    assert.deepEqual(errors, []);
    console.log(
      "Retail HTTPS browser: admin panel, two owners, branding, independent state, cookie replay rejection, suspension and mobile passed. No real external sends.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
