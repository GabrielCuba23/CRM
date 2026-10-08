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
    await p.goto(process.env.CRM_TEST_URL || "http://127.0.0.1:8012/");
    await p.locator("nav [data-view=settings]").click();
    await p.locator("#reports-weekly").check();
    await p.locator("#reports-finance").check();
    await p.locator("#reports-hour").fill("10");
    await p.locator("#reports-form button").click();
    await p.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("crm.workspace.v2")).reports.hour ===
        10,
    );
    await p.reload();
    await p.locator("nav [data-view=settings]").click();
    assert.equal(await p.locator("#reports-weekly").isChecked(), true);
    assert.equal(await p.locator("#reports-hour").inputValue(), "10");
    for (const kind of ["clients", "finance"]) {
      const download = p.waitForEvent("download");
      await p.locator("#download-report-" + kind).click();
      const d = await download;
      assert.match(d.suggestedFilename(), /\.xlsx$/);
      const path = await d.path(),
        ExcelJS = require("../vendor/exceljs-4.4.0.min.js"),
        fs = require("node:fs");
      const w = new ExcelJS.Workbook();
      await w.xlsx.load(fs.readFileSync(path));
      assert.ok(w.worksheets.length >= 3);
    }
    await p.setViewportSize({ width: 390, height: 844 });
    assert.ok(await p.locator("#reports-form").isVisible());
    assert.deepEqual(errors, []);
    console.log(
      "Report schedules persist, both downloadable Excel files open, mobile view works; no email sent.",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
