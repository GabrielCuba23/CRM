const keyCache = new Map();
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error("JWT no válido.");
  const text = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(text + "=".repeat((4 - (text.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
}
export async function csrfToken(jwt) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("nexo-csrf:" + jwt),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function configured(env) {
  return Boolean(
    env.ACCESS_AUD &&
    /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || "") &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL || ""),
  );
}
export async function authenticate(
  request,
  env,
  { fetcher = fetch, now = Date.now() / 1000 } = {},
) {
  if (!configured(env))
    throw Error("Configura Cloudflare Access y el correo del administrador.");
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  if (jwt.length > 20000) throw Error("JWT no válido.");
  const parts = jwt.split(".");
  if (parts.length !== 3) throw Error("Inicia sesión.");
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))),
    claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if (
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}` ||
    !Array.isArray(claims.aud) ||
    !claims.aud.includes(env.ACCESS_AUD) ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    typeof claims.email !== "string" ||
    claims.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase() ||
    (claims.nbf !== undefined &&
      (typeof claims.nbf !== "number" || claims.nbf > now + 30))
  )
    throw Error("Acceso no autorizado.");
  let entry = keyCache.get(env.ACCESS_TEAM_DOMAIN);
  if (
    !entry ||
    entry.until < now ||
    !entry.keys.some((k) => k.kid === header.kid)
  ) {
    const response = await fetcher(
      `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,
    );
    if (!response.ok) throw Error("No se pudo verificar el acceso.");
    const data = await response.json();
    if (!Array.isArray(data.keys)) throw Error("Certificados no válidos.");
    entry = {
      keys: data.keys.filter((k) => k.kty === "RSA" && k.use === "sig"),
      until: now + 3600,
    };
    keyCache.set(env.ACCESS_TEAM_DOMAIN, entry);
  }
  const jwk = entry.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw Error("Certificado no válido.");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decode(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]),
  );
  if (!valid) throw Error("Firma no válida.");
  return { email: claims.email, csrf: await csrfToken(jwt) };
}
