import { todayLima } from "./crm.mjs";
import { defaultReports, validateReports } from "./report-config.mjs";
export { defaultReports, validateReports };
export function dueReports(r, now = new Date()) {
  r = validateReports(r);
  const day = todayLima(now),
    date = new Date(day + "T12:00:00Z");
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Lima",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  if (hour < r.hour) return [];
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return [
    r.clientsWeekly && date.getUTCDay() === 5 ? "clients" : null,
    r.financeTwiceMonthly && [15, last].includes(date.getUTCDate())
      ? "finance"
      : null,
  ]
    .filter(Boolean)
    .map((kind) => ({ kind, day, id: kind + ":" + day }));
}
export function reportSheets(state, kind, day = todayLima()) {
  const clients = state.clients || [],
    accounts = state.accounts || [],
    ledger = state.ledger || [];
  if (kind === "clients")
    return [
      {
        name: "Clientes",
        rows: [
          [
            "ID",
            "Nombre",
            "Teléfono",
            "Usuario WhatsApp",
            "Correo",
            "Servicio",
            "Perfil",
            "Renovar el",
            "Precio venta S/",
            "Coste por perfil S/",
            "Estado",
            "Notas",
          ],
          ...clients.map((c) => {
            const a = accounts.find((a) => a.id === c.accountId);
            return [
              c.id,
              c.name,
              c.phone,
              c.whatsappUsername || "",
              c.email,
              c.service,
              c.profile,
              c.expires,
              c.price / 100,
              a?.capacity && a.costCents !== undefined
                ? a.costCents / a.capacity / 100
                : "",
              c.archived
                ? "Archivado"
                : !c.expires
                  ? "Sin servicio"
                  : c.expires < day
                    ? "Vencido"
                    : "Vigente",
              c.notes,
            ];
          }),
        ],
      },
      {
        name: "Historial de servicios",
        rows: [
          [
            "Cliente ID",
            "Nombre",
            "Servicio",
            "Vencimiento",
            "Precio S/",
            "Finalizado",
          ],
          ...clients.flatMap((c) =>
            (c.serviceHistory || []).map((h) => [
              c.id,
              c.name,
              h.service,
              h.expires,
              h.price / 100,
              h.endedAt,
            ]),
          ),
        ],
      },
      {
        name: "Compras",
        rows: [
          ["Fecha", "Cliente ID", "Descripción", "Servicio", "Importe S/"],
          ...ledger
            .filter((l) => l.kind !== "expense")
            .map((l) => [
              l.date,
              l.clientId || "",
              l.description,
              l.service,
              l.amount / 100,
            ]),
        ],
      },
    ];
  const movements = ledger.filter(
    (l) => l.date.startsWith(day.slice(0, 7)) && l.date <= day,
  );
  const income = movements
      .filter((l) => l.kind !== "expense")
      .reduce((s, l) => s + l.amount, 0),
    expenses = movements
      .filter((l) => l.kind === "expense")
      .reduce((s, l) => s + l.amount, 0);
  return [
    {
      name: "Resumen",
      rows: [
        ["Concepto", "Valor"],
        ["Periodo", day.slice(0, 7)],
        ["Hasta", day],
        ["Ingresos cobrados S/", income / 100],
        ["Gastos pagados S/", expenses / 100],
        ["Resultado de caja S/", (income - expenses) / 100],
        [
          "Renovaciones cobradas",
          movements.filter((l) => l.kind === "renewal").length,
        ],
        [
          "Criterio",
          "Solo movimientos registrados; no incluye ventas pendientes ni gastos sin registrar.",
        ],
      ],
    },
    {
      name: "Movimientos",
      rows: [
        [
          "Fecha",
          "Tipo",
          "Descripción",
          "Servicio",
          "Cliente ID",
          "Proveedor ID",
          "Cuenta ID",
          "Categoría",
          "Referencia",
          "Importe S/",
        ],
        ...movements.map((l) => [
          l.date,
          l.kind,
          l.description,
          l.service,
          l.clientId || "",
          l.supplierId || "",
          l.accountId || "",
          l.category || "",
          l.reference || "",
          l.amount / 100,
        ]),
      ],
    },
    {
      name: "Costes de cuentas",
      rows: [
        [
          "Servicio",
          "Cuenta",
          "Proveedor",
          "Coste cuenta S/",
          "Perfiles",
          "Coste por perfil S/",
          "Periodo meses",
          "Criterio",
        ],
        ...accounts.map((a) => [
          a.service,
          a.email,
          a.provider,
          a.costCents === undefined ? "" : a.costCents / 100,
          a.capacity,
          a.costCents === undefined ? "" : a.costCents / a.capacity / 100,
          a.costIntervalMonths || "",
          "Coste configurado; no es un gasto pagado",
        ]),
      ],
    },
  ];
}
// Minimal OOXML workbook, stored ZIP; strings are literal cells, never formulas.
export function workbook(sheets) {
  const enc = new TextEncoder(),
    files = [],
    xml = (s) =>
      String(s ?? "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  files.push([
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  ]);
  files.push([
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  ]);
  files.push([
    "xl/workbook.xml",
    `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  ]);
  files.push([
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  ]);
  sheets.forEach((s, i) =>
    files.push([
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet xmlns="${ns}"><sheetData>${s.rows
        .map(
          (row, j) =>
            `<row r="${j + 1}">${row
              .map((v, k) => {
                let col = "",
                  n = k + 1;
                while (n) {
                  col = String.fromCharCode(65 + ((n - 1) % 26)) + col;
                  n = Math.floor((n - 1) / 26);
                }
                return typeof v === "number" && Number.isFinite(v)
                  ? `<c r="${col}${j + 1}"><v>${v}</v></c>`
                  : `<c r="${col}${j + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
              })
              .join("")}</row>`,
        )
        .join("")}</sheetData></worksheet>`,
    ]),
  );
  const parts = [],
    directory = [];
  let offset = 0;
  const header = (size) => new Uint8Array(size),
    put = (b, p, v, size = 4) => {
      const d = new DataView(b.buffer);
      size === 2 ? d.setUint16(p, v, true) : d.setUint32(p, v, true);
    };
  for (const [name, content] of files) {
    const filename = enc.encode(name),
      data = enc.encode(content);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let k = 0; k < 8; k++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const h = header(30);
    put(h, 0, 0x04034b50);
    put(h, 4, 20, 2);
    put(h, 14, crc);
    put(h, 18, data.length);
    put(h, 22, data.length);
    put(h, 26, filename.length, 2);
    parts.push(h, filename, data);
    const c = header(46);
    put(c, 0, 0x02014b50);
    put(c, 4, 20, 2);
    put(c, 6, 20, 2);
    put(c, 16, crc);
    put(c, 20, data.length);
    put(c, 24, data.length);
    put(c, 28, filename.length, 2);
    put(c, 42, offset);
    directory.push(c, filename);
    offset += 30 + filename.length + data.length;
  }
  const length = directory.reduce((s, b) => s + b.length, 0),
    end = header(22);
  put(end, 0, 0x06054b50);
  put(end, 8, files.length, 2);
  put(end, 10, files.length, 2);
  put(end, 12, length);
  put(end, 16, offset);
  parts.push(...directory, end);
  const result = new Uint8Array(offset + length + 22);
  let p = 0;
  for (const b of parts) {
    result.set(b, p);
    p += b.length;
  }
  return result;
}
export function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
