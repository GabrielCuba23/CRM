import { processReports, reportStatus } from "./reports.mjs";
import {
  generateTasks,
  claimTasks,
  acknowledgeTask,
  integrationAuthenticated,
  processRuleTasks,
  ownerTaskStatus,
} from "./tasks.mjs";
import { authenticate, configured } from "./auth.mjs";
import { emptyState, cleanState } from "./state.mjs";
import { normalizePhone, formatDate, todayLima } from "../crm.mjs";

const publicAssets = new Set(["/styles.css", "/icons.svg"]);
const privateAssets = new Set([
  "/messaging.mjs",
  "/reports.mjs",
  "/report-config.mjs",
  "/app.js",
  "/crm.mjs",
  "/automation.mjs",
  "/bulk.mjs",
  "/lifecycle.mjs",
  "/procurement.mjs",
  "/procurement-ui.mjs",
  "/growth.mjs",
  "/growth-ui.mjs",
  "/vendor/exceljs-4.4.0.min.js",
  "/login.js",
  "/sw.js",
  "/manifest.webmanifest",
  "/app-icon.svg",
  "/app-icon-192.png",
  "/app-icon-512.png",
]);
const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...securityHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
function headers(response) {
  return new Response(response.body, {
    status: response.status,
    headers: { ...Object.fromEntries(response.headers), ...securityHeaders },
  });
}
async function workspace(db) {
  const row = await db
    .prepare("SELECT body,revision FROM workspace WHERE id=1")
    .first();
  return row
    ? { state: JSON.parse(row.body), revision: row.revision }
    : { state: emptyState(), revision: 0 };
}
async function body(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw Error("Usa JSON.");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 1100000)
    throw Error("La solicitud supera el tamaño permitido.");
  return JSON.parse(raw);
}

export async function handleRequest(request, env, options = {}) {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/healthz")
    return json({ status: "ok", configured: configured(env) });
  if (publicAssets.has(path) && request.method === "GET")
    return headers(await env.ASSETS.fetch(request));
  if (!configured(env))
    return json(
      {
        error:
          "El administrador debe conectar Cloudflare Access antes de usar este sitio.",
      },
      503,
    );
  if (path.startsWith("/api/integration/")) {
    if (!(await integrationAuthenticated(request, env)))
      return json(
        { error: "Integración desconectada o credencial no válida." },
        401,
      );
    if (request.method !== "POST") return json({ error: "Usa POST." }, 405);
    let input;
    try {
      input = await body(request);
    } catch {
      return json({ error: "Usa una solicitud JSON válida." }, 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      return json({ error: "Usa un objeto JSON." }, 400);
    if (path === "/api/integration/claim") {
      const limit = input.limit === undefined ? 10 : input.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 10)
        return json({ error: "El lote debe ser de 1 a 10 tareas." }, 400);
      return json({ tasks: await claimTasks(env, { limit }) });
    }
    if (path === "/api/integration/ack") {
      try {
        return (await acknowledgeTask(env, input))
          ? json({ ok: true })
          : json({ error: "Tarea o confirmación no válidas." }, 409);
      } catch {
        return json({ error: "Confirmación no válida." }, 400);
      }
    }
    return json({ error: "Recurso no encontrado." }, 404);
  }
  let user;
  try {
    user = await authenticate(request, env, options);
  } catch {
    return json(
      {
        error:
          "Acceso exclusivo del administrador. Inicia sesión mediante Cloudflare Access.",
      },
      401,
    );
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    if (
      request.headers.get("Origin") !== url.origin ||
      request.headers.get("X-CSRF-Token") !== user.csrf
    )
      return json({ error: "Origen o sesión no válidos." }, 403);
  }
  if (path === "/api/session" && request.method === "GET")
    return json({ ...user, mode: "server", authProvider: "cloudflare-access" });
  if (path === "/api/workspace" && request.method === "GET")
    return json(await workspace(env.DB));
  if (path === "/api/workspace" && request.method === "PUT") {
    let input, state;
    try {
      input = await body(request);
      if (!Number.isSafeInteger(input.revision) || input.revision < 0)
        throw Error("Revisión no válida.");
      state = cleanState(input.state);
    } catch (error) {
      return json({ error: error.message }, 400);
    }
    const sql =
      "INSERT INTO workspace(id,revision,body) SELECT 1,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM workspace WHERE id=1) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body WHERE workspace.revision=? RETURNING revision";
    const row = await env.DB.prepare(sql)
      .bind(
        input.revision + 1,
        JSON.stringify(state),
        input.revision,
        input.revision,
      )
      .first();
    return row
      ? json({ revision: row.revision })
      : json(
          {
            error:
              "Los datos cambiaron en otra sesión. Recarga antes de guardar.",
          },
          409,
        );
  }
  if (path === "/api/automation-status" && request.method === "GET") {
    const reminders = await env.DB.prepare(
        "SELECT * FROM reminders ORDER BY attempted DESC LIMIT 100",
      ).all(),
      worker = await env.DB.prepare(
        "SELECT checked,status FROM worker_health WHERE id=1",
      ).first();
    return json({
      configured: Boolean(
        env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID,
      ),
      worker,
      intervalSeconds: 3600,
      reminders: reminders.results,
    });
  }
  if (path === "/api/message-tasks" && request.method === "GET")
    return json(await ownerTaskStatus(env));
  if (path === "/api/message-tasks/refresh" && request.method === "POST") {
    await generateTasks(env);
    return json(await ownerTaskStatus(env));
  }
  if (path === "/api/logout" && request.method === "POST")
    return json({ ok: true, logoutUrl: url.origin + "/cdn-cgi/access/logout" });
  if (path === "/api/password")
    return json(
      {
        error:
          "El acceso se administra mediante Cloudflare Access; no se guardan contraseñas en el CRM.",
      },
      409,
    );
  if (
    (path === "/" || path === "/index.html" || path === "/login") &&
    ["GET", "HEAD"].includes(request.method)
  ) {
    const asset = await env.ASSETS.fetch(
      new Request(url.origin + "/index.html"),
    );
    const html = (await asset.text()).replace(
      "<head>",
      '<head><meta name="crm-backend" content="required">',
    );
    return new Response(html, {
      headers: {
        ...securityHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }
  if (path === "/api/report-status" && request.method === "GET") {
    const recent = await env.DB.prepare(
      "SELECT kind,day,state FROM email_reports ORDER BY attempted DESC LIMIT 20",
    ).all();
    return json({ ...reportStatus(env), recent: recent.results });
  }
  if (privateAssets.has(path) && ["GET", "HEAD"].includes(request.method))
    return headers(await env.ASSETS.fetch(request));
  return json({ error: "Recurso no encontrado." }, 404);
}

export function payload(client, automation, settings) {
  const values = {
    nombre: client.name,
    telefono: client.phone,
    usuario_whatsapp: client.whatsappUsername || "No indicado",
    correo: client.email || "No indicado",
    servicio: client.service || "Tu servicio",
    perfil: client.profile || "No indicado",
    vence: formatDate(client.expires),
    pin: client.pin || "Sin PIN",
    negocio: settings.business || "Nuestro equipo",
    pago: settings.payments || "Consulta los medios de pago",
  };
  const parameters = automation.parameters.map((key) => ({
    type: "text",
    text: values[key],
  }));
  const template = {
    name: automation.templateName,
    language: { code: automation.language },
  };
  if (parameters.length) template.components = [{ type: "body", parameters }];
  return {
    messaging_product: "whatsapp",
    to: normalizePhone(client.phone),
    type: "template",
    template,
  };
}
export async function sendMeta(message, env, fetcher = fetch) {
  const version = env.WHATSAPP_API_VERSION || "v23.0";
  if (
    !/^v\d+\.\d+$/.test(version) ||
    !/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID || "")
  )
    return { state: "rejected", error: "configuration" };
  try {
    const response = await fetcher(
      `https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!response.ok)
      return {
        state: response.status === 429 ? "rate_limited" : "rejected",
        error: `HTTP_${response.status}`,
      };
    const data = await response.json(),
      id = data.messages?.[0]?.id;
    return id
      ? { state: "accepted", provider_id: id, error: null }
      : { state: "uncertain", error: "unknown" };
  } catch {
    return { state: "uncertain", error: "unknown" };
  }
}
export async function processDue(
  env,
  { now = new Date(), sender = sendMeta, limit = 10 } = {},
) {
  const db = env.DB,
    { state, revision } = await workspace(db),
    automation = state.automation || emptyState().automation,
    timestamp = Math.floor(now.getTime() / 1000);
  const status = !automation.enabled
    ? "disabled"
    : !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID
      ? "missing_configuration"
      : "running";
  await db
    .prepare("INSERT OR REPLACE INTO worker_health VALUES(1,?,?)")
    .bind(timestamp, status)
    .run();
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "America/Lima",
    }).format(now),
  );
  if (status !== "running" || hour < automation.hour) return 0;
  const date = todayLima(now),
    target = new Date(Date.parse(date + "T12:00:00Z") + 3 * 86400000)
      .toISOString()
      .slice(0, 10);
  const previous = await db
      .prepare(
        "SELECT client_id,state,attempted FROM reminders WHERE expires=?",
      )
      .bind(target)
      .all(),
    sent = new Map(previous.results.map((r) => [r.client_id, r]));
  const candidates = state.clients
    .filter(
      (c) => !c.archived && c.expires === target && c.reminderConsent === true,
    )
    .filter((c) => {
      const r = sent.get(c.id);
      return (
        !r || (r.state === "rate_limited" && timestamp - r.attempted >= 900)
      );
    })
    .slice(0, limit);
  let accepted = 0;
  for (const client of candidates) {
    // A single atomic SQL claim prevents concurrent cron invocations from sending twice.
    const claim = await db
      .prepare(
        "INSERT INTO reminders(client_id,expires,state,attempted) SELECT ?,?,'processing',? WHERE (SELECT revision FROM workspace WHERE id=1)=? ON CONFLICT(client_id,expires) DO UPDATE SET state='processing',attempted=excluded.attempted WHERE reminders.state='rate_limited' AND reminders.attempted<=? RETURNING client_id",
      )
      .bind(client.id, target, timestamp, revision, timestamp - 900)
      .first();
    if (!claim) continue;
    let result, message;
    try {
      message = payload(client, automation, state.settings);
    } catch {
      result = { state: "rejected", error: "invalid_phone" };
    }
    if (!result)
      try {
        result = await sender(message, env);
      } catch {
        result = { state: "uncertain", error: "unknown" };
      }
    await db
      .prepare(
        "UPDATE reminders SET state=?,provider_id=?,error=? WHERE client_id=? AND expires=?",
      )
      .bind(
        result.state,
        result.provider_id || null,
        result.error || null,
        client.id,
        target,
      )
      .run();
    if (result.state === "accepted") accepted++;
  }
  return accepted;
}
export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch {
      return json(
        {
          error:
            "No se pudo completar la operación del servidor. Intenta nuevamente.",
        },
        503,
      );
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const now = new Date(event.scheduledTime);
        await processReports(env, { now }).catch(() =>
          console.error("No se pudo revisar los reportes de correo."),
        );
        await processDue(env, { now, limit: 5 });
        await processRuleTasks(env, {
          now,
          sender: sendMeta,
          makeMeta: payload,
        });
      })(),
    );
  },
};
