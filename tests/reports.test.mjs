import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  dueReports,
  workbook,
  reportSheets,
  validateReports,
} from "../reports.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
import { processReports } from "../cloud/reports.mjs";
const require = createRequire(import.meta.url),
  ExcelJS = require("../vendor/exceljs-4.4.0.min.js");
const enabled = { clientsWeekly: true, financeTwiceMonthly: true, hour: 9 };
test("Lima Friday, fifteenth, leap month-end and hour gate", () => {
  assert.deepEqual(dueReports(enabled, new Date("2026-10-09T13:59:00Z")), []);
  assert.equal(
    dueReports(enabled, new Date("2026-10-09T14:00:00Z"))[0].kind,
    "clients",
  );
  assert.equal(
    dueReports(enabled, new Date("2026-10-15T14:00:00Z"))[0].kind,
    "finance",
  );
  assert.equal(
    dueReports(enabled, new Date("2028-02-29T14:00:00Z"))[0].kind,
    "finance",
  );
  assert.equal(dueReports(enabled, new Date("2028-02-28T14:00:00Z")).length, 0);
  assert.equal(dueReports(enabled, new Date("2026-05-15T14:00:00Z")).length, 2);
  assert.deepEqual(dueReports(undefined, new Date("2026-05-15T14:00:00Z")), []);
  assert.throws(() => validateReports({ ...enabled, hour: 24 }));
  const s = emptyState();
  s.reports = enabled;
  assert.deepEqual(cleanState(s).reports, enabled);
});
test("Excel includes archived clients, literal text, numeric cost and cutoff ledger; excludes credentials", async () => {
  const s = emptyState();
  s.clients = [
    {
      id: "c",
      name: '=HYPERLINK("bad")',
      phone: "51999999999",
      email: "ana@example.com",
      service: "Max",
      profile: "Perfil 1",
      expires: "2026-10-14",
      price: 1500,
      notes: "<& 👋",
      accountId: "a",
      archived: true,
      serviceHistory: [],
    },
  ];
  s.accounts = [
    {
      id: "a",
      service: "Max",
      email: "account@example.com",
      provider: "P",
      capacity: 5,
      costCents: 5000,
      password: "PRIVATE_PASSWORD",
    },
  ];
  s.ledger = [
    {
      date: "2026-10-10",
      kind: "sale",
      amount: 1500,
      description: "Venta",
      service: "Max",
      clientId: "c",
    },
    {
      date: "2026-10-20",
      kind: "sale",
      amount: 5000,
      description: "Futuro",
      service: "Max",
    },
    {
      date: "2026-10-12",
      kind: "expense",
      amount: 300,
      description: "Hosting",
      service: "",
    },
  ];
  const bytes = workbook(reportSheets(s, "clients", "2026-10-15")),
    w = new ExcelJS.Workbook();
  await w.xlsx.load(bytes);
  assert.equal(
    w.getWorksheet("Clientes").getCell("B2").value,
    s.clients[0].name,
  );
  assert.equal(w.getWorksheet("Clientes").getCell("J2").value, 10);
  assert.equal(w.getWorksheet("Clientes").getCell("K2").value, "Archivado");
  assert.equal(Buffer.from(bytes).includes("PRIVATE_PASSWORD"), false);
  const f = new ExcelJS.Workbook();
  await f.xlsx.load(workbook(reportSheets(s, "finance", "2026-10-15")));
  assert.equal(f.getWorksheet("Resumen").getCell("B4").value, 15);
  assert.equal(f.getWorksheet("Resumen").getCell("B6").value, 12);
  assert.equal(f.getWorksheet("Movimientos").rowCount, 3);
});
test("D1 atomic claim prevents duplicate reports and does not retry unknown provider outcomes", async () => {
  const req = createRequire("/tmp/crm-cloud-tools/package.json"),
    { Miniflare, convertV4MiniflareOptions } = req("miniflare");
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ["DB"],
      compatibilityDate: "2026-10-06",
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    await db.exec(
      (
        await readFile(new URL("../cloud/schema.sql", import.meta.url), "utf8")
      ).replace(/\n/g, " "),
    );
    const s = emptyState();
    s.reports = enabled;
    await db
      .prepare("INSERT INTO workspace VALUES(1,0,?)")
      .bind(JSON.stringify(s))
      .run();
    const env = {
        DB: db,
        OWNER_EMAIL: "owner@example.com",
        RESEND_API_KEY: "fixture",
        REPORT_FROM_EMAIL: "reports@example.com",
      },
      now = new Date("2026-05-15T14:00:00Z");
    let calls = 0;
    const send = async (_, options) => {
      calls++;
      assert.deepEqual(JSON.parse(options.body).to, ["owner@example.com"]);
      return new Response(JSON.stringify({ id: "fixture-id" }));
    };
    await Promise.all([
      processReports(env, { now, send }),
      processReports(env, { now, send }),
    ]);
    assert.equal(calls, 2);
    assert.equal(await processReports(env, { now, send }), 0);
    const next = new Date("2026-05-22T14:00:00Z");
    await processReports(env, {
      now: next,
      send: async () => {
        calls++;
        throw Error("timeout");
      },
    });
    await processReports(env, { now: next, send });
    assert.equal(calls, 3);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT state FROM email_reports WHERE id='clients:2026-05-22'",
          )
          .first()
      ).state,
      "uncertain",
    );
    assert.equal(
      await processReports({ ...env, RESEND_API_KEY: "" }, { now: next, send }),
      0,
    );
  } finally {
    await mf.dispose();
  }
});
