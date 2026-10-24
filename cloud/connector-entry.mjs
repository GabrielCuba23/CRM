// Build template. connector_build.py replaces the two module specifiers.
import worker from "__NEXO_WORKER_ENTRY__";
export * from "__NEXO_WORKER_ENTRY__";
import { assets } from "__NEXO_ASSETS_ENTRY__";

function withAssets(env) {
  return {
    ...env,
    ASSETS: {
      async fetch(request) {
        if (!["GET", "HEAD"].includes(request.method))
          return new Response("Método no permitido.", {
            status: 405,
            headers: { Allow: "GET, HEAD" },
          });
        const asset = assets[new URL(request.url).pathname];
        if (!asset)
          return new Response("No encontrado.", {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          });
        return new Response(
          request.method === "HEAD"
            ? null
            : Uint8Array.from(atob(asset.body), (character) =>
                character.charCodeAt(0),
              ),
          {
            headers: {
              "Content-Type": asset.type,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      },
    },
  };
}

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, withAssets(env), ctx);
  },
  scheduled(event, env, ctx) {
    return worker.scheduled(event, withAssets(env), ctx);
  },
};
