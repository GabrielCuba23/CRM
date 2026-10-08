import { dueReports, reportSheets, workbook, base64 } from "../reports.mjs";
export function reportStatus(env) {
  return {
    configured: !!(
      env.RESEND_API_KEY &&
      env.REPORT_FROM_EMAIL &&
      env.OWNER_EMAIL
    ),
    recipient: env.OWNER_EMAIL || "",
    delivery: "resend",
  };
}
export async function processReports(
  env,
  { now = new Date(), send = fetch } = {},
) {
  if (!reportStatus(env).configured) return 0;
  const row = await env.DB.prepare(
    "SELECT body FROM workspace WHERE id=1",
  ).first();
  if (!row) return 0;
  const state = JSON.parse(row.body);
  let accepted = 0;
  for (const task of dueReports(state.reports, now)) {
    const claim = await env.DB.prepare(
      "INSERT OR IGNORE INTO email_reports(id,kind,day,state,attempted) VALUES(?,?,?,'processing',?)",
    )
      .bind(task.id, task.kind, task.day, now.getTime())
      .run();
    if (!claim.meta.changes) continue;
    let result = "failed",
      providerId = null;
    try {
      const content = base64(
        workbook(reportSheets(state, task.kind, task.day)),
      );
      const payload = {
        from: env.REPORT_FROM_EMAIL,
        to: [env.OWNER_EMAIL],
        subject: `${state.settings.business} · ${task.kind === "clients" ? "Clientes" : "Finanzas"} · ${task.day}`,
        text: `Reporte del CRM al ${task.day}, hora de Lima. Las contraseñas y los PIN no se incluyen.`,
        attachments: [{ filename: `${task.kind}-${task.day}.xlsx`, content }],
      };
      result = "uncertain";
      const response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": task.id,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });
      if (response.ok) {
        const data = await response.json();
        if (typeof data.id === "string" && data.id) {
          result = "accepted";
          providerId = data.id;
          accepted++;
        }
      } else result = response.status >= 500 ? "uncertain" : "rejected";
    } catch {}
    await env.DB.prepare(
      "UPDATE email_reports SET state=?,provider_id=? WHERE id=?",
    )
      .bind(result, providerId, task.id)
      .run();
  }
  return accepted;
}
