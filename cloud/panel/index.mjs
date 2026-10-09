import { authenticate, configured } from "../auth.mjs";
import { provisionOne, resourceName } from "./provision.mjs";
const security = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: security });
const sha = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
function publicInstance(row, env) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerEmail: row.owner_email,
    crmName: row.crm_name,
    status: row.status,
    stage: row.stage,
    error: row.error,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    url:
      row.stage === "ready"
        ? `https://${row.worker_name}.${env.WORKERS_SUBDOMAIN}.workers.dev`
        : null,
  };
}
function text(value, max) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw Error("Completa los datos de la instancia.");
  return value.trim();
}
async function input(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw Error("Usa JSON.");
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 180000)
    throw Error("Solicitud demasiado grande.");
  const result = JSON.parse(body);
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw Error("Datos no válidos.");
  return result;
}
export async function handlePanel(request, env, options = {}) {
  const url = new URL(request.url),
    path = url.pathname;
  const life = path.match(/^\/lifecycle\/([a-f0-9]{32})$/);
  if (life && request.method === "GET") {
    const bearer = request.headers.get("Authorization") || "";
    if (!/^Bearer [a-f0-9]{64}$/.test(bearer))
      return json({ error: "No autorizado." }, 401);
    const row = await env.DB.prepare(
      "SELECT status,lifecycle_hash,session_after FROM instances WHERE id=?",
    )
      .bind(life[1])
      .first();
    if (!row || row.lifecycle_hash !== (await sha(bearer.slice(7))))
      return json({ error: "No autorizado." }, 401);
    return json({ status: row.status, sessionAfter: row.session_after });
  }
  if (url.origin !== env.PUBLIC_URL)
    return json({ error: "Dominio no reconocido." }, 404);
  if (path === "/healthz" && request.method === "GET")
    return json({ status: "ok", configured: configured(env) });
  if (!configured(env) || env.ACCESS_AUD === "not-configured-closed")
    return json(
      { error: "El panel permanece cerrado hasta configurar Access." },
      503,
    );
  let user;
  try {
    user = await authenticate(request, env, options);
  } catch {
    return json({ error: "Inicia sesión mediante Cloudflare Access." }, 401);
  }
  if (
    !["GET", "HEAD"].includes(request.method) &&
    (request.headers.get("Origin") !== url.origin ||
      request.headers.get("X-CSRF-Token") !== user.csrf)
  )
    return json({ error: "Origen o sesión no válidos." }, 403);
  if (path === "/api/session" && request.method === "GET")
    return json({
      ...user,
      mode: "retail",
      authProvider: "cloudflare-access",
      baseDomain: `${env.WORKERS_SUBDOMAIN}.workers.dev`,
      provisioningConfigured: Boolean(env.RETAIL_PROVISION_TOKEN),
    });
  if (path === "/api/logout" && request.method === "POST")
    return json({ ok: true, logoutUrl: url.origin + "/cdn-cgi/access/logout" });
  if (path === "/api/instances" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT * FROM instances ORDER BY created_at DESC,id",
    ).all();
    return json({
      instances: rows.results.map((row) => publicInstance(row, env)),
    });
  }
  if (path === "/api/instances" && request.method === "POST") {
    if (!env.RETAIL_PROVISION_TOKEN)
      return json(
        {
          error:
            "Conecta el secreto de publicación del panel en Cloudflare antes de crear CRMs.",
        },
        503,
      );
    try {
      const data = await input(request),
        name = text(data.name, 120),
        crmName = text(data.crmName || name, 80),
        business = text(data.business || name, 120),
        ownerEmail = text(data.ownerEmail, 254).toLowerCase(),
        slug = text(data.slug, 40);
      if (
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(ownerEmail) ||
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug) ||
        ["admin", "api", "www", "retail", "login"].includes(slug)
      )
        throw Error("Correo o subdominio no válidos.");
      const logo = data.logoDataUrl || "";
      if (typeof logo !== "string" || logo.length > 150000)
        throw Error("Logo no válido.");
      if (logo) {
        if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo))
          throw Error("Logo no válido.");
        const raw = atob(logo.split(",")[1]);
        if (!(
          (logo.startsWith("data:image/png") &&
            raw.startsWith("\x89PNG\r\n\x1a\n")) ||
          (logo.startsWith("data:image/jpeg") &&
            raw.startsWith("\xff\xd8\xff")) ||
          (logo.startsWith("data:image/webp") &&
            raw.startsWith("RIFF") &&
            raw.slice(8, 12) === "WEBP")
        ))
          throw Error("El formato del logo no coincide con su contenido.");
      }
      if (
        await env.DB.prepare("SELECT id FROM instances WHERE slug=?")
          .bind(slug)
          .first()
      )
        return json({ error: "El subdominio ya está registrado." }, 409);
      const id = crypto.randomUUID().replaceAll("-", ""),
        secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      await env.DB.prepare(
        "INSERT INTO instances(id,slug,name,owner_email,crm_name,business,logo,created_at,worker_name,lifecycle_hash,lifecycle_secret) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          id,
          slug,
          name,
          ownerEmail,
          crmName,
          business,
          logo,
          Date.now(),
          resourceName(id, slug),
          await sha(secret),
          secret,
        )
        .run();
      const row = await env.DB.prepare("SELECT * FROM instances WHERE id=?")
        .bind(id)
        .first();
      return json(
        {
          instance: publicInstance(row, env),
          authProvider: "cloudflare-access",
          queued: true,
        },
        201,
      );
    } catch (error) {
      return json(
        {
          error: error.message.startsWith("D1")
            ? "No se pudo crear la instancia."
            : error.message,
        },
        400,
      );
    }
  }
  const match = path.match(/^\/api\/instances\/([a-f0-9]{32})(\/invitation)?$/);
  if (match) {
    const row = await env.DB.prepare("SELECT * FROM instances WHERE id=?")
      .bind(match[1])
      .first();
    if (!row) return json({ error: "Instancia no encontrada." }, 404);
    if (match[2] && request.method === "POST") {
      if (row.stage !== "ready" || row.status !== "active")
        return json(
          {
            error:
              row.stage === "failed"
                ? "La publicación requiere revisar sus recursos en Cloudflare."
                : "El CRM todavía no está publicado o está suspendido.",
          },
          409,
        );
      return json({
        instance: publicInstance(row, env),
        activationUrl: publicInstance(row, env).url,
        authProvider: "cloudflare-access",
      });
    }
    if (!match[2] && request.method === "PATCH") {
      let data;
      try {
        data = await input(request);
      } catch {
        return json({ error: "Datos no válidos." }, 400);
      }
      if (
        Object.keys(data).length !== 1 ||
        !["active", "suspended"].includes(data.status) ||
        row.stage !== "ready"
      )
        return json({ error: "Primero debe completarse la publicación." }, 409);
      await env.DB.prepare(
        "UPDATE instances SET status=?,session_after=CASE WHEN ?='suspended' THEN ? ELSE session_after END WHERE id=?",
      )
        .bind(data.status, data.status, Math.floor(Date.now() / 1000), row.id)
        .run();
      row.status = data.status;
      return json({ instance: publicInstance(row, env) });
    }
  }
  if (
    [
      "/",
      "/login",
      "/retail-static/panel.js",
      "/retail-static/panel.css",
    ].includes(path) &&
    request.method === "GET"
  ) {
    const target = new URL(request.url);
    if (path === "/" || path === "/login") target.pathname = "/panel.html";
    const response = await env.ASSETS.fetch(new Request(target, request));
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(security))
      headers.set(name, value);
    headers.set(
      "Content-Type",
      response.headers.get("Content-Type") || "text/html; charset=utf-8",
    );
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }
  return json({ error: "Recurso no encontrado." }, 404);
}
export default {
  async fetch(request, env) {
    try {
      return await handlePanel(request, env);
    } catch {
      return json({ error: "No se pudo completar la operación." }, 503);
    }
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(provisionOne(env));
  },
};
