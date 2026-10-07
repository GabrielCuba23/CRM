// App installation only. Never cache contact data, credentials, HTML or API responses.
let branding = null;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  if (
    event.data?.type === "brand" &&
    typeof event.data.name === "string" &&
    event.data.name.length <= 80
  )
    branding = {
      name: event.data.name,
      logo:
        typeof event.data.logo === "string" &&
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
          event.data.logo,
        ) &&
        event.data.logo.length <= 150000
          ? event.data.logo
          : "",
    };
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.endsWith("/manifest.webmanifest") ||
    !branding
  )
    return;
  event.respondWith(
    (async () => {
      const response = await fetch(event.request);
      if (!response.ok) return response;
      const manifest = await response.json();
      manifest.name = branding.name;
      manifest.short_name = branding.name.slice(0, 20);
      if (branding.logo)
        manifest.icons = [{ src: branding.logo, sizes: "any", purpose: "any" }];
      return new Response(JSON.stringify(manifest), {
        headers: {
          "Content-Type": "application/manifest+json",
          "Cache-Control": "no-store",
        },
      });
    })(),
  );
});
