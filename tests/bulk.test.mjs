import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  parseCSV,
  prepareClientImport,
  exportClientCSV,
  exportClientExcel,
  readExcelRows,
} from "../bulk.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
const require = createRequire(import.meta.url),
  ExcelJS = require("../vendor/exceljs-4.4.0.min.js");
test("CSV reads BOM, quoted commas, escaped quotes, newlines and semicolon decimals", () => {
  assert.deepEqual(
    parseCSV(
      '\uFEFFnombre,notas\r\n"Ana, José","Dijo ""hola""\nsegunda línea"',
    ),
    [
      ["nombre", "notas"],
      ["Ana, José", 'Dijo "hola"\nsegunda línea'],
    ],
  );
  const rows = parseCSV(
    "nombre;telefono;precio;vence\nAna;987654321;20,50;07/11/2026",
  );
  const result = prepareClientImport(rows, emptyState());
  assert.equal(result.clients[0].price, 2050);
  assert.equal(result.clients[0].expires, "2026-11-07");
  assert.equal(result.clients[0].phone, "51987654321");
  assert.throws(() => parseCSV('nombre\n"sin cerrar'));
  assert.throws(() =>
    prepareClientImport([["telefono"], ["987654321"]], emptyState()),
  );
});
test("Import skips duplicates, reports invalid rows and accepts username-only clients without opting in", () => {
  const state = emptyState();
  const rows = parseCSV(
    "nombre,telefono,usuario_whatsapp,servicio,perfil,autoriza_recordatorios\nAna,987654321,,Max,Perfil 1,\nAna,987654321,,Max,Perfil 1,\nAmigo,,@amigo,Max,,\nMal,123,,Max,,\nSin permiso,,,Max,,quizá",
  );
  const result = prepareClientImport(rows, state);
  assert.equal(result.clients.length, 2);
  assert.equal(result.clients[1].phone, "");
  assert.equal(result.clients[1].whatsappUsername, "@amigo");
  assert.equal(result.clients[1].reminderConsent, false);
  assert.equal(
    result.preview.filter((r) => r.status.startsWith("Duplicado")).length,
    1,
  );
  assert.equal(
    result.preview.filter((r) => r.status.startsWith("Error")).length,
    2,
  );
  assert.equal(state.clients.length, 0);
  assert.equal(
    prepareClientImport(rows, { ...state, clients: result.clients }).clients
      .length,
    0,
  );
});
test("Linked-account import respects capacity and unique profiles", () => {
  const state = emptyState();
  state.accounts = [
    {
      id: "account",
      email: "test@example.com",
      service: "Netflix",
      provider: "",
      expires: "2099-01-01",
      capacity: 1,
      password: "fixture-secret",
    },
  ];
  const result = prepareClientImport(
    parseCSV(
      "nombre,telefono,cuenta_madre\nAna,987654321,account\nJosé,987654322,account",
    ),
    state,
  );
  assert.equal(result.clients.length, 1);
  assert.equal(result.clients[0].profile, "Perfil 1");
  assert.equal(result.clients[0].service, "Netflix");
  assert(!JSON.stringify(result.clients).includes("fixture-secret"));
});
test("CSV export covers all clients and neutralizes spreadsheet formulas while round-tripping usernames", () => {
  const state = emptyState(),
    result = prepareClientImport(
      parseCSV("nombre,usuario_whatsapp\n=1+1,@amigo"),
      state,
    );
  const csv = exportClientCSV(result.clients);
  assert(csv.includes("'=1+1"));
  assert(csv.includes("'@amigo"));
  const again = prepareClientImport(parseCSV(csv), state);
  assert.equal(again.clients[0].name, "=1+1");
  assert.equal(again.clients[0].whatsappUsername, "@amigo");
});
test("Excel exports and imports Unicode, phone strings and username-only clients; formulas are rejected", async () => {
  const state = emptyState(),
    clients = prepareClientImport(
      parseCSV(
        "nombre,telefono,usuario_whatsapp,precio\nJosé & Ana,987654321,,20.50\nAmigo,,@amigo,0",
      ),
      state,
    ).clients;
  const bytes = await exportClientExcel(clients, ExcelJS),
    rows = await readExcelRows(bytes, ExcelJS);
  const result = prepareClientImport(rows, state);
  assert.equal(result.clients.length, 2);
  assert.equal(result.clients[0].name, "José & Ana");
  assert.equal(result.clients[0].price, 2050);
  assert.equal(result.clients[1].whatsappUsername, "@amigo");
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Clientes");
  sheet.addRow(["nombre"]);
  sheet.addRow([{ formula: "1+1", result: 2 }]);
  await assert.rejects(
    readExcelRows(await workbook.xlsx.writeBuffer(), ExcelJS),
  );
});
test("Account credentials and optional usernames survive private schema validation; invalid credentials fail", () => {
  const state = emptyState();
  state.accounts = [
    {
      id: "account",
      email: "test@example.com",
      service: "Netflix",
      provider: "",
      expires: "2099-01-01",
      capacity: 1,
      password: "fixture-only-secret",
    },
  ];
  const clean = cleanState(state);
  assert.equal(clean.accounts[0].password, "fixture-only-secret");
  state.accounts[0].password = { unexpected: true };
  assert.throws(() => cleanState(state));
});
