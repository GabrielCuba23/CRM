// Private media uses the existing D1 binding: bounded chunks, no public bucket,
// no customer file data in the workspace JSON, and no additional paid service.
export const mediaLimits = Object.freeze({
  fileBytes: 20 * 1024 * 1024,
  totalBytes: 200 * 1024 * 1024,
  chunkBytes: 512 * 1024,
  files: 500,
});
const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm"]);
const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const PREFIX = "/api/outreach/media";
const utf8 = new TextDecoder("utf-8", { fatal: true });
class MediaError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
function descriptor(row) { return { id: row.id, name: row.name, type: row.type, size: row.size, sha256: row.sha256 }; }
function chunkCount(size) { return Math.ceil(size / mediaLimits.chunkBytes); }
function metadata(row) { return { media: descriptor(row), chunkSize: mediaLimits.chunkBytes, chunks: chunkCount(row.size) }; }
function hex(value) { return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join(""); }
function bytesOf(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new MediaError("El archivo guardado no está disponible.", 409);
}
function base64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function unbase64(value, expected) {
  if (typeof value !== "string" || value.length !== 4 * Math.ceil(expected / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new MediaError("El fragmento del archivo no es válido.");
  let binary;
  try { binary = atob(value); } catch { throw new MediaError("El fragmento del archivo no es válido."); }
  if (binary.length !== expected) throw new MediaError("El fragmento del archivo tiene un tamaño incorrecto.");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
async function input(request, limit = 8192) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
    throw new MediaError("Usa una solicitud JSON válida.");
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) throw new MediaError("La solicitud supera el tamaño permitido.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new MediaError("Completa los datos del archivo.");
  const chunks = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new MediaError("La solicitud supera el tamaño permitido.", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(utf8.decode(bytes)); } catch { throw new MediaError("Usa una solicitud JSON válida."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MediaError("Completa los datos del archivo.");
  return value;
}
function validMetadata(value) {
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(value.name))
    throw new MediaError("Indica un nombre de archivo válido, sin rutas.");
  if (!TYPES.has(value.type)) throw new MediaError("Usa una foto PNG, JPG, GIF o WEBP, o un video MP4 o WEBM.");
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > mediaLimits.fileBytes)
    throw new MediaError("Cada archivo debe ocupar entre 1 byte y 20 MiB.", 413);
  if (typeof value.sha256 !== "string" || !HASH.test(value.sha256)) throw new MediaError("El archivo necesita una huella SHA-256 válida.");
  return { name: value.name.trim(), type: value.type, size: value.size, sha256: value.sha256 };
}
function signature(bytes, type) {
  const starts = values => values.every((value, index) => bytes[index] === value);
  const ascii = (offset, text) => [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  if (type === "image/png") return starts([137, 80, 78, 71, 13, 10, 26, 10]);
  if (type === "image/jpeg") return starts([255, 216, 255]);
  if (type === "image/gif") return ascii(0, "GIF87a") || ascii(0, "GIF89a");
  if (type === "image/webp") return ascii(0, "RIFF") && ascii(8, "WEBP");
  if (type === "video/mp4") return bytes.length >= 12 && ascii(4, "ftyp");
  if (type === "video/webm") return starts([26, 69, 223, 163]);
  return false;
}
async function mediaRow(db, id, ready = false) {
  const row = await db.prepare("SELECT id,name,type,size,sha256,state,lease,validation_started FROM outreach_media WHERE id=?").bind(id).first();
  if (!row || ready && row.state !== "ready") throw new MediaError("El archivo no está disponible.", 404);
  return row;
}
async function readPart(db, row, part) {
  const result = await db.prepare("SELECT data FROM outreach_media_chunks WHERE media_id=? AND part=?").bind(row.id, part).first();
  if (!result) throw new MediaError("Faltan fragmentos del archivo. Vuelve a subirlo.", 409);
  const bytes = bytesOf(result.data);
  const expected = Math.min(mediaLimits.chunkBytes, row.size - part * mediaLimits.chunkBytes);
  if (bytes.length !== expected) throw new MediaError("El archivo guardado está incompleto.", 409);
  return bytes;
}
async function finish(db, id) {
  const before = await mediaRow(db, id);
  if (before.state === "ready") return json({ ...metadata(before), status: "ready" });
  const now = Math.floor(Date.now() / 1000), lease = crypto.randomUUID().replaceAll("-", "");
  const claimed = await db.prepare("UPDATE outreach_media SET state='validating',lease=?,validation_started=? WHERE id=? AND (state='uploading' OR (state='validating' AND validation_started<?)) RETURNING id,name,type,size,sha256,state,lease")
    .bind(lease, now, id, now - 120).first();
  if (!claimed) throw new MediaError("El archivo ya se está comprobando. Reintenta en un momento.", 409);
  try {
    const count = await db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(length(data)),0) AS bytes FROM outreach_media_chunks WHERE media_id=?").bind(id).first();
    if (count.count !== chunkCount(claimed.size) || count.bytes !== claimed.size)
      throw new MediaError("Faltan fragmentos del archivo. Completa la subida antes de guardarlo.", 409);
    // DigestStream hashes one D1 chunk at a time without retaining a video in
    // memory. A maximum-size upload uses fewer than 50 D1 queries per request.
    const digest = new crypto.DigestStream("SHA-256"), writer = digest.getWriter();
    let digestClosed = false;
    try {
      for (let part = 0; part < chunkCount(claimed.size); part++) {
        const bytes = await readPart(db, claimed, part);
        if (part === 0 && !signature(bytes, claimed.type))
          throw new MediaError("El contenido del archivo no coincide con su tipo de foto o video.");
        await writer.write(bytes);
      }
      await writer.close(); digestClosed = true;
      if (hex(await digest.digest) !== claimed.sha256) throw new MediaError("El archivo cambió o llegó incompleto. Vuelve a subirlo.");
    } finally {
      if (!digestClosed) { await writer.abort().catch(() => {}); await digest.digest.catch(() => {}); }
      writer.releaseLock();
    }
    const ready = await db.prepare("UPDATE outreach_media SET state='ready',lease=NULL,validation_started=NULL WHERE id=? AND state='validating' AND lease=? RETURNING id,name,type,size,sha256")
      .bind(id, lease).first();
    if (!ready) throw new MediaError("El archivo cambió durante la comprobación. Vuelve a intentarlo.", 409);
    return json({ ...metadata(ready), status: "ready" });
  } catch (error) {
    await db.prepare("UPDATE outreach_media SET state='uploading',lease=NULL,validation_started=NULL WHERE id=? AND state='validating' AND lease=?").bind(id, lease).run();
    throw error;
  }
}
function download(db, row, head) {
  let nextPart = 0;
  const stream = head ? null : new ReadableStream({
    async pull(controller) {
      try {
        if (nextPart >= chunkCount(row.size)) { controller.close(); return; }
        const bytes = await readPart(db, row, nextPart++);
        controller.enqueue(bytes);
      } catch (error) { controller.error(error); }
    },
  });
  const filename = encodeURIComponent(row.name).replace(/[!'()*]/g, character => "%" + character.charCodeAt(0).toString(16).toUpperCase());
  return new Response(stream, { headers: {
    "Content-Type": row.type, "Content-Length": String(row.size), "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}

// The caller must first enforce owner authentication and mutation CSRF/bearer
// validation. This module never creates a public or token-in-URL media route.
export async function handleOutreachMedia(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== PREFIX && !path.startsWith(PREFIX + "/")) return null;
  try {
    const db = env.DB, method = request.method;
    if (path === PREFIX) {
      if (method === "GET") {
        const rows = await db.prepare("SELECT id,name,type,size,sha256,state FROM outreach_media ORDER BY created DESC,id DESC LIMIT 500").all();
        const usage = await db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM outreach_media").first();
        return json({ media: rows.results.filter(row => row.state === "ready").map(descriptor), uploads: rows.results.filter(row => row.state !== "ready").map(row => ({ ...descriptor(row), status: row.state })), limits: mediaLimits, usedBytes: usage.bytes });
      }
      if (method === "POST") {
        const value = validMetadata(await input(request)), id = crypto.randomUUID().replaceAll("-", "");
        // The quota reservation and insert are one SQLite statement: two
        // concurrent uploads cannot both consume the same remaining space.
        const row = await db.prepare("INSERT INTO outreach_media(id,name,type,size,sha256,state,created) SELECT ?,?,?,?,?,'uploading',? WHERE (SELECT COALESCE(SUM(size),0) FROM outreach_media)+?<=? AND (SELECT COUNT(*) FROM outreach_media)<? RETURNING id,name,type,size,sha256")
          .bind(id, value.name, value.type, value.size, value.sha256, Math.floor(Date.now() / 1000), value.size, mediaLimits.totalBytes, mediaLimits.files).first();
        if (!row) throw new MediaError("La biblioteca alcanzó su límite. Elimina archivos que ya no utilices antes de subir otros.", 409);
        return json({ ...metadata(row), status: "uploading" }, 201);
      }
      return json({ error: "Método no permitido." }, 405);
    }
    const match = path.match(/^\/api\/outreach\/media\/([a-f0-9]{32})(?:\/(metadata|complete|chunks\/([0-9]{1,2})))?$/);
    if (!match || !ID.test(match[1])) throw new MediaError("Archivo o ruta no válidos.", 404);
    const [, id, action, rawPart] = match;
    if (!action && method === "DELETE") {
      await mediaRow(db, id);
      const workspace = await db.prepare("SELECT body FROM workspace WHERE id=1").first();
      let campaigns = [];
      try { const outreach = JSON.parse(workspace?.body || "{}").growth?.outreach || {}; campaigns = [...(outreach.campaigns || []), ...(outreach.templates || [])]; } catch {}
      const engagement=await db.prepare('SELECT body FROM engagement_config WHERE id=1').first();
      if(engagement){const bot=JSON.parse(engagement.body).bot||{};campaigns.push(...(bot.rules||[]),...(bot.flows||[]).flatMap(flow=>flow.nodes||[]));}
      if (campaigns.some(campaign => Array.isArray(campaign.media) && campaign.media.some(item => item.id === id)))
        throw new MediaError("Este archivo está usado en una campaña, plantilla o chatbot. Quítalo antes de eliminarlo.", 409);
      const unused="NOT EXISTS(SELECT 1 FROM workspace,json_tree(workspace.body,'$.growth.outreach') j WHERE j.key='id' AND j.value=? AND j.fullkey LIKE '%.media[%].id') AND NOT EXISTS(SELECT 1 FROM engagement_config,json_tree(engagement_config.body,'$.bot') j WHERE j.key='id' AND j.value=? AND j.fullkey LIKE '%.media[%].id')";
      const deleted=await db.batch([
        db.prepare("DELETE FROM outreach_media_chunks WHERE media_id=? AND "+unused).bind(id,id,id),
        db.prepare("DELETE FROM outreach_media WHERE id=? AND "+unused).bind(id,id,id),
      ]);
      if(deleted[1].meta.changes!==1)throw new MediaError('El archivo ahora está usado. Actualiza su biblioteca.',409);
      return json({ ok: true });
    }
    if (action === "complete" && method === "POST") { await input(request); return await finish(db, id); }
    if (action?.startsWith("chunks/")) {
      const row = await mediaRow(db, id, method === "GET"), part = Number(rawPart);
      if (part >= chunkCount(row.size) || String(part) !== rawPart) throw new MediaError("El número de fragmento no es válido.");
      if (method === "GET") return json({ id, part, data: base64(await readPart(db, row, part)) });
      if (method === "PUT") {
        if (row.state !== "uploading") throw new MediaError("Este archivo ya se guardó o se está comprobando.", 409);
        const value = await input(request, Math.ceil(mediaLimits.chunkBytes * 4 / 3) + 1024);
        const expected = Math.min(mediaLimits.chunkBytes, row.size - part * mediaLimits.chunkBytes);
        const bytes = unbase64(value.data, expected);
        const result = await db.prepare("INSERT INTO outreach_media_chunks(media_id,part,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM outreach_media WHERE id=? AND state='uploading') ON CONFLICT(media_id,part) DO UPDATE SET data=excluded.data WHERE EXISTS(SELECT 1 FROM outreach_media WHERE id=? AND state='uploading') RETURNING part")
          .bind(id, part, bytes.buffer, id, id).first();
        if (!result) throw new MediaError("El archivo cambió durante la subida. Vuelve a intentarlo.", 409);
        return json({ ok: true, id, part });
      }
      return json({ error: "Método no permitido." }, 405);
    }
    if (["GET", "HEAD"].includes(method) && (!action || action === "metadata")) {
      const row = await mediaRow(db, id, true);
      return action === "metadata" ? json(metadata(row)) : download(db, row, method === "HEAD");
    }
    return json({ error: "Método no permitido." }, 405);
  } catch (error) {
    if (error instanceof MediaError) return json({ error: error.message }, error.status);
    // Deployment/schema or storage failures must remain explicit rather than
    // pretending a partial upload is a saved, usable campaign attachment.
    return json({ error: "No se pudo guardar o leer el archivo. Reintenta y comprueba la conexión del CRM." }, 503);
  }
}
