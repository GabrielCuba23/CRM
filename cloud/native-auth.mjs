// Native owner authentication is enabled explicitly per Worker. Access remains
// the default for existing instances and for the administration panel.
const encoder = new TextEncoder();
const SESSION_SECONDS = 8 * 60 * 60;
// The deployed Workers runtime enforces a 100,000-iteration PBKDF2 ceiling.
// A separately bound secret pepper protects hashes if only D1 is disclosed.
const PASSWORD_ITERATIONS = 100000;
const MAX_AUTH_BODY = 8192;
const COOKIE = "__Host-nexo_session";
const TOKEN = /^[a-f0-9]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

class AuthFailure extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...extra },
  });
}
function seconds(options) { return Math.floor(options.now ?? Date.now() / 1000); }
function ownerEmail(env) { return String(env.OWNER_EMAIL || "").trim().toLowerCase(); }
export function nativeConfigured(env) {
  return Boolean(env.DB && EMAIL.test(ownerEmail(env)) && typeof env.AUTH_PASSWORD_PEPPER === "string" && env.AUTH_PASSWORD_PEPPER.length >= 32);
}
function hex(bytes) { return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join(""); }
function unhex(text) {
  if (!/^(?:[a-f0-9]{2})+$/.test(text)) throw Error("Invalid stored digest.");
  return Uint8Array.from(text.match(/../g), item => parseInt(item, 16));
}
function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export async function tokenHash(value) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
function equal(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  // Cloudflare's native timingSafeEqual is documented on the Web Crypto API.
  // The fixed-length fallback permits running the same module in Node tests.
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(a, b);
  let mismatch = 0;
  for (let index = 0; index < a.byteLength; index++) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}
async function derive(password, salt, env) {
  const pepper = await crypto.subtle.importKey("raw", encoder.encode(env.AUTH_PASSWORD_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const material = await crypto.subtle.sign("HMAC", pepper, encoder.encode(password));
  const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS }, key, 256));
}
async function hashPassword(password, env) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${hex(salt)}$${hex(await derive(password, salt, env))}`;
}
async function verifyPassword(password, stored, env) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || parts[1] !== String(PASSWORD_ITERATIONS) || !/^[a-f0-9]{32}$/.test(parts[2]) || !TOKEN.test(parts[3])) return false;
  return equal(await derive(password, unhex(parts[2]), env), unhex(parts[3]));
}
function validPassword(value, creating = false) {
  return typeof value === "string" && value.length <= 1024 && value.length >= (creating ? 12 : 1);
}
async function inputBody(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new AuthFailure("Usa una solicitud JSON válida.");
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > MAX_AUTH_BODY) throw new AuthFailure("La solicitud supera el tamaño permitido.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthFailure("Completa los datos de acceso.");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_AUTH_BODY) { await reader.cancel(); throw new AuthFailure("La solicitud supera el tamaño permitido.", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new AuthFailure("Usa una solicitud JSON válida."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthFailure("Completa los datos de acceso.");
  return value;
}
function sameOrigin(request) { return request.headers.get("Origin") === new URL(request.url).origin; }
function validLoginOrigin(request, extension) {
  if (!extension) return sameOrigin(request);
  const origin = request.headers.get("Origin");
  return request.headers.get("X-Nexo-Client") === "extension" && (!origin || EXTENSION_ORIGIN.test(origin) || origin === new URL(request.url).origin);
}
async function rateLimit(request, env, now, operation) {
  const start = Math.floor(now / 900) * 900;
  // Hash IPs before storage. The global bucket bounds both KDF cost and the
  // number of per-IP rows attackers can create in each fixed window.
  const address = (request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 128);
  const bucket = `${operation}:ip:${await tokenHash(address)}`;
  await env.DB.prepare("DELETE FROM auth_attempts WHERE window_started<?").bind(start).run();
  const increment = "INSERT INTO auth_attempts(bucket,window_started,attempts) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET window_started=excluded.window_started,attempts=CASE WHEN auth_attempts.window_started=excluded.window_started THEN MIN(auth_attempts.attempts+1,501) ELSE 1 END RETURNING attempts";
  const global = await env.DB.prepare(increment).bind(`${operation}:global`, start).first();
  if (global.attempts > 200) throw new AuthFailure("Demasiados intentos. Inténtalo de nuevo en unos minutos.", 429);
  const local = await env.DB.prepare(increment).bind(bucket, start).first();
  if (local.attempts > 10) throw new AuthFailure("Demasiados intentos. Inténtalo de nuevo en unos minutos.", 429);
}
function sessionCookie(token, maxAge = SESSION_SECONDS) { return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`; }
function readCookie(request) {
  const values = (request.headers.get("Cookie") || "").split(";").map(item => item.trim()).filter(item => item.startsWith(COOKIE + "="));
  return values.length === 1 ? values[0].slice(COOKIE.length + 1) : "";
}
export function publicNativeSession(user) {
  return { email: user.email, csrf: user.csrf, mode: "server", authProvider: "password", expiresAt: user.expires };
}
async function newSession(owner, kind, env, now) {
  const token = randomToken(), csrf = randomToken(), digest = await tokenHash(token);
  await env.DB.prepare("DELETE FROM auth_sessions WHERE expires<=?").bind(now).run();
  // A concurrent password change increments the owner version; old password
  // verification can never mint a usable session after that revocation.
  const row = await env.DB.prepare("INSERT INTO auth_sessions(token_hash,email,csrf,kind,owner_version,expires,created) SELECT ?,?,?,?,?,?,? FROM auth_owner WHERE id=1 AND version=? AND password_hash=? AND email=? RETURNING token_hash")
    .bind(digest, owner.email, csrf, kind, owner.version, now + SESSION_SECONDS, now, owner.version, owner.password_hash, ownerEmail(env)).first();
  if (!row) throw new AuthFailure("Correo o contraseña incorrectos.", 401);
  return { token, email: owner.email, csrf, expires: now + SESSION_SECONDS };
}
function sessionResponse(session, extension) {
  return json({ ...publicNativeSession(session), ...(extension ? { token: session.token } : {}) }, 200, extension ? {} : { "Set-Cookie": sessionCookie(session.token) });
}
export async function authenticateNative(request, env, options = {}) {
  if (!nativeConfigured(env)) throw new AuthFailure("El acceso todavía no está configurado.", 503);
  const authorization = request.headers.get("Authorization");
  // An invalid bearer must never fall through to an unrelated valid cookie.
  const kind = authorization !== null ? "extension" : "web";
  const token = authorization !== null ? /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1] || "" : readCookie(request);
  if (!TOKEN.test(token)) throw new AuthFailure("Inicia sesión con tu correo y contraseña.", 401);
  const digest = await tokenHash(token);
  const row = await env.DB.prepare("SELECT s.email,s.csrf,s.kind,s.expires,s.token_hash FROM auth_sessions s JOIN auth_owner o ON o.id=1 AND o.email=s.email AND o.version=s.owner_version WHERE s.token_hash=? AND s.kind=? AND s.expires>? AND o.email=?")
    .bind(digest, kind, seconds(options), ownerEmail(env)).first();
  if (!row) throw new AuthFailure("Tu sesión caducó. Inicia sesión nuevamente.", 401);
  return row;
}
export function nativeMutationAllowed(request, user) {
  if (user.kind === "extension") return true;
  return sameOrigin(request) && typeof user.csrf === "string" && equal(encoder.encode(request.headers.get("X-CSRF-Token") || ""), encoder.encode(user.csrf));
}
export async function nativeLogout(request, env, user) {
  await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(user.token_hash).run();
  return json({ ok: true, logoutUrl: "/login" }, 200, user.kind === "web" ? { "Set-Cookie": sessionCookie("", 0) } : {});
}
export async function nativePassword(request, env, user, options = {}) {
  try {
    const data = await inputBody(request);
    if (!validPassword(data.current) || !validPassword(data.next, true)) throw new AuthFailure("La nueva contraseña debe tener al menos 12 caracteres.");
    const now = seconds(options);
    await rateLimit(request, env, now, "password");
    const owner = await env.DB.prepare("SELECT * FROM auth_owner WHERE id=1 AND email=?").bind(ownerEmail(env)).first();
    if (!owner || !(await verifyPassword(data.current, owner.password_hash, env))) throw new AuthFailure("La contraseña actual no es correcta.", 403);
    const nextHash = await hashPassword(data.next, env);
    const changed = await env.DB.prepare("UPDATE auth_owner SET password_hash=?,version=version+1 WHERE id=1 AND version=? AND password_hash=? RETURNING version").bind(nextHash, owner.version, owner.password_hash).first();
    if (!changed) throw new AuthFailure("La contraseña cambió en otra sesión. Vuelve a iniciar sesión.", 409);
    await env.DB.prepare("DELETE FROM auth_sessions WHERE owner_version<>?").bind(changed.version).run();
    return json({ ok: true, logoutUrl: "/login" }, 200, user.kind === "web" ? { "Set-Cookie": sessionCookie("", 0) } : {});
  } catch (error) { return authError(error); }
}
function authError(error) {
  return error instanceof AuthFailure ? json({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "900" } : {}) : json({ error: "No se pudo completar el acceso. Inténtalo de nuevo." }, 503);
}
export async function nativePublicRequest(request, env, options = {}) {
  const path = new URL(request.url).pathname;
  if (!["/api/auth/status", "/api/login", "/api/setup"].includes(path)) return null;
  if (!nativeConfigured(env)) return json({ error: "El acceso todavía no está configurado." }, 503);
  try {
    if (path === "/api/auth/status") {
      if (request.method !== "GET") return json({ error: "Usa GET." }, 405);
      const owner = await env.DB.prepare("SELECT id FROM auth_owner WHERE id=1 AND email=?").bind(ownerEmail(env)).first();
      return json({ authProvider: "password", configured: Boolean(owner) });
    }
    if (request.method !== "POST") return json({ error: "Usa POST." }, 405);
    const data = await inputBody(request), now = seconds(options);
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (path === "/api/setup") {
      if (!sameOrigin(request)) throw new AuthFailure("Origen no válido.", 403);
      await rateLimit(request, env, now, "setup");
      if (!validPassword(data.password, true)) throw new AuthFailure("La contraseña debe tener al menos 12 caracteres.");
      const existing = await env.DB.prepare("SELECT id FROM auth_owner WHERE id=1").first();
      if (existing) throw new AuthFailure("Esta cuenta ya tiene contraseña. Inicia sesión.", 409);
      if (email !== ownerEmail(env) || typeof data.token !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(data.token)) throw new AuthFailure("El enlace de creación de contraseña no es válido o caducó.", 403);
      const digest = await tokenHash(data.token);
      const invite = await env.DB.prepare("SELECT token_hash FROM auth_setup WHERE token_hash=? AND email=? AND expires>? AND used_at IS NULL").bind(digest, email, now).first();
      if (!invite) throw new AuthFailure("El enlace de creación de contraseña no es válido o caducó.", 403);
      const passwordHash = await hashPassword(data.password, env);
      const owner = await env.DB.prepare("INSERT INTO auth_owner(id,email,password_hash,version,created) SELECT 1,?,?,1,? FROM auth_setup WHERE token_hash=? AND email=? AND expires>? AND used_at IS NULL AND NOT EXISTS(SELECT 1 FROM auth_owner WHERE id=1) ON CONFLICT(id) DO NOTHING RETURNING *")
        .bind(email, passwordHash, now, digest, email, now).first();
      if (!owner) throw new AuthFailure("El enlace ya se utilizó. Inicia sesión con tu contraseña.", 409);
      await env.DB.prepare("UPDATE auth_setup SET used_at=? WHERE token_hash=? AND used_at IS NULL").bind(now, digest).run();
      return sessionResponse(await newSession(owner, "web", env, now), false);
    }
    const extension = data.client === "extension";
    if (!validLoginOrigin(request, extension)) throw new AuthFailure("Origen no válido.", 403);
    if (!validPassword(data.password) || !EMAIL.test(email) || email.length > 254 || data.client !== undefined && !extension) throw new AuthFailure("Completa tu correo y contraseña.");
    await rateLimit(request, env, now, "login");
    const owner = await env.DB.prepare("SELECT * FROM auth_owner WHERE id=1 AND email=?").bind(ownerEmail(env)).first();
    const matches = owner ? await verifyPassword(data.password, owner.password_hash, env) : false;
    if (!matches || email !== ownerEmail(env)) throw new AuthFailure("Correo o contraseña incorrectos.", 401);
    return sessionResponse(await newSession(owner, extension ? "extension" : "web", env, now), extension);
  } catch (error) { return authError(error); }
}
