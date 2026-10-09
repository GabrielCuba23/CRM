import { emptyState, cleanState } from "../state.mjs";
import { clientSource, customerSchema } from "./generated-client.mjs";
export const resourceName = (id, slug) =>
  `crm-r-${slug.slice(0, 16).replace(/-$/, "")}-${id}`;
export async function cf(env, method, path, data, fetcher = fetch) {
  const headers = { Authorization: `Bearer ${env.RETAIL_PROVISION_TOKEN}` };
  let body;
  if (data instanceof FormData) body = data;
  else if (data !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(data);
  }
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}${path}`,
    { method, headers, body },
  );
  if (!response.ok)
    throw Error(
      `Cloudflare rechazó una operación de publicación (HTTP ${response.status}).`,
    );
  const result = await response.json();
  if (!result.success) throw Error("Cloudflare no confirmó la publicación.");
  return result.result;
}
async function checkpoint(env, id, fields) {
  const allowed = new Set([
    "stage",
    "database_id",
    "access_id",
    "audience",
    "error",
    "processing",
  ]);
  if (Object.keys(fields).some((key) => !allowed.has(key)))
    throw Error("Etapa no válida.");
  await env.DB.prepare(
    `UPDATE instances SET ${Object.keys(fields)
      .map((key) => `${key}=?`)
      .join(",")} WHERE id=?`,
  )
    .bind(...Object.values(fields), id)
    .run();
}
async function upload(env, row, audience, fetcher) {
  const metadata = {
    main_module: "client.mjs",
    compatibility_date: "2026-10-06",
    bindings: [
      { type: "d1", name: "DB", id: row.database_id },
      { type: "plain_text", name: "OWNER_EMAIL", text: row.owner_email },
      {
        type: "plain_text",
        name: "ACCESS_TEAM_DOMAIN",
        text: env.ACCESS_TEAM_DOMAIN,
      },
      { type: "plain_text", name: "ACCESS_AUD", text: audience },
      { type: "plain_text", name: "INSTANCE_ID", text: row.id },
      {
        type: "secret_text",
        name: "LIFECYCLE_TOKEN",
        text: row.lifecycle_secret,
      },
      { type: "service", name: "CONTROL", service: env.PANEL_WORKER_NAME },
    ],
  };
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append(
    "client.mjs",
    new Blob([clientSource], { type: "application/javascript+module" }),
    "client.mjs",
  );
  await cf(env, "PUT", `/workers/scripts/${row.worker_name}`, form, fetcher);
  await cf(
    env,
    "POST",
    `/workers/scripts/${row.worker_name}/subdomain`,
    { enabled: true },
    fetcher,
  );
}
export async function provisionOne(env, { fetcher = fetch } = {}) {
  if (!env.RETAIL_PROVISION_TOKEN) return { configured: false };
  const row = await env.DB.prepare(
    "UPDATE instances SET processing=1,stage='provisioning' WHERE id=(SELECT id FROM instances WHERE stage='queued' AND processing=0 ORDER BY created_at,id LIMIT 1) AND stage='queued' AND processing=0 RETURNING *",
  ).first();
  if (!row) return { configured: true, processed: 0 };
  try {
    if (
      !/^[a-f0-9]{32}$/.test(row.id) ||
      row.worker_name !== resourceName(row.id, row.slug)
    )
      throw Error("Identificador de instancia no válido.");
    const databases = await cf(
      env,
      "GET",
      "/d1/database?per_page=100",
      undefined,
      fetcher,
    );
    const applications = await cf(
      env,
      "GET",
      "/access/apps?per_page=100",
      undefined,
      fetcher,
    );
    const scripts = await cf(
      env,
      "GET",
      "/workers/scripts",
      undefined,
      fetcher,
    );
    const hostname = `${row.worker_name}.${env.WORKERS_SUBDOMAIN}.workers.dev`;
    if (
      !Array.isArray(databases) ||
      !Array.isArray(applications) ||
      !Array.isArray(scripts) ||
      databases.length >= 100 ||
      applications.length >= 100
    )
      throw Error(
        "Revisa las cuotas y la paginación de recursos antes de continuar.",
      );
    if (
      databases.some((db) => db.name === row.worker_name) ||
      scripts.some(
        (script) => (script.id || script.name) === row.worker_name,
      ) ||
      applications.some((app) => app.domain === hostname)
    )
      throw Error(
        "Ya existen recursos para esta instancia. Revisa el caso antes de publicar; no se sobrescribirán.",
      );
    const database = await cf(
      env,
      "POST",
      "/d1/database",
      { name: row.worker_name },
      fetcher,
    );
    if (typeof database.uuid !== "string" || !database.uuid)
      throw Error("No se confirmó la nueva base de datos.");
    row.database_id = database.uuid;
    await checkpoint(env, row.id, {
      database_id: database.uuid,
      stage: "database_created",
    });
    const state = emptyState();
    state.settings = {
      ...state.settings,
      crmName: row.crm_name,
      business: row.business,
      logoDataUrl: row.logo,
    };
    for (const query of [
      { sql: customerSchema },
      {
        sql: "INSERT INTO workspace(id,revision,body) VALUES(1,0,?)",
        params: [JSON.stringify(cleanState(state))],
      },
    ]) {
      const results = await cf(
        env,
        "POST",
        `/d1/database/${database.uuid}/query`,
        query,
        fetcher,
      );
      if (
        !Array.isArray(results) ||
        !results.length ||
        results.some((result) => result.success === false)
      )
        throw Error("No se confirmó la base vacía de la instancia.");
    }
    await upload(env, row, "not-configured-closed", fetcher);
    await checkpoint(env, row.id, { stage: "worker_locked" });
    const application = await cf(
      env,
      "POST",
      "/access/apps",
      {
        name: `CRM ${row.id}`,
        type: "self_hosted",
        domain: hostname,
        session_duration: "8h",
        allowed_idps: [env.PIN_PROVIDER_ID],
        http_only_cookie_attribute: true,
        policies: [
          {
            name: "Solo el propietario",
            decision: "allow",
            include: [{ email: { email: row.owner_email } }],
          },
        ],
      },
      fetcher,
    );
    await checkpoint(env, row.id, {
      access_id: application.id || null,
      stage: "access_pending_validation",
    });
    if (
      !application.aud ||
      application.aud === "not-configured-closed" ||
      application.aud === env.ACCESS_AUD ||
      applications.some((app) => app.aud === application.aud)
    )
      throw Error("Access no confirmó un acceso independiente.");
    await checkpoint(env, row.id, {
      audience: application.aud,
      stage: "access_created",
    });
    await upload(env, row, application.aud, fetcher);
    await cf(
      env,
      "PUT",
      `/workers/scripts/${row.worker_name}/schedules`,
      [{ cron: "0 * * * *" }],
      fetcher,
    );
    await env.DB.prepare(
      "UPDATE instances SET status='active',stage='ready',activated_at=?,processing=0,lifecycle_secret=NULL WHERE id=?",
    )
      .bind(Date.now(), row.id)
      .run();
    return { configured: true, processed: 1 };
  } catch (error) {
    // Ambiguous outcomes stay stopped, with checkpoints for operator review.
    await checkpoint(env, row.id, {
      error: error.message,
      processing: 0,
      stage: "failed",
    });
    return { configured: true, processed: 1, failed: true };
  }
}
