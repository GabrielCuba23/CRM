import client from "../index.mjs";
import { assets } from "./generated-assets.mjs";
async function enabled(env, request) {
  try {
    const response = await env.CONTROL.fetch(
      new Request(`https://control.internal/lifecycle/${env.INSTANCE_ID}`, {
        headers: { Authorization: `Bearer ${env.LIFECYCLE_TOKEN}` },
      }),
    );
    if (!response.ok) return false;
    const state = await response.json();
    if (state.status !== "active") return false;
    if (state.sessionAfter && request) {
      const part =
        (request.headers.get("Cf-Access-Jwt-Assertion") || "").split(".")[1] ||
        "";
      const claims = JSON.parse(
        atob(part.replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (typeof claims.iat !== "number" || claims.iat <= state.sessionAfter)
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
function customerEnv(env) {
  return {
    ...env,
    ASSETS: {
      fetch: async (request) => {
        const entry = assets[new URL(request.url).pathname];
        return entry
          ? new Response(
              Uint8Array.from(atob(entry.body), (c) => c.charCodeAt(0)),
              { headers: { "Content-Type": entry.type } },
            )
          : new Response("No encontrado", { status: 404 });
      },
    },
  };
}
export default {
  async fetch(request, env, ctx) {
    if (!(await enabled(env, request)))
      return new Response(
        "Este CRM no está disponible o requiere volver a iniciar sesión. Contacta con tu proveedor.",
        {
          status: 403,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    return client.fetch(request, customerEnv(env), ctx);
  },
  async scheduled(event, env, ctx) {
    if (await enabled(env))
      return client.scheduled(event, customerEnv(env), ctx);
  },
};
