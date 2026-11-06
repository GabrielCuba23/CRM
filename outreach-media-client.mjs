export const OUTREACH_MEDIA_LIMITS = Object.freeze({ fileBytes: 20 * 1024 * 1024, chunkBytes: 512 * 1024 });
const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm"]);
const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const base = "/api/outreach/media";
function hex(value) { return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join(""); }
function encode(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function decode(value) {
  if (typeof value !== "string" || value.length > Math.ceil(OUTREACH_MEDIA_LIMITS.chunkBytes * 4 / 3) + 4)
    throw Error("El fragmento descargado no es válido.");
  let binary;
  try { binary = atob(value); } catch { throw Error("El fragmento descargado no es válido."); }
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function validMedia(value) {
  if (!value || !ID.test(value.id) || typeof value.name !== "string" || !value.name || !TYPES.has(value.type) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > OUTREACH_MEDIA_LIMITS.fileBytes || !HASH.test(value.sha256))
    throw Error("El CRM devolvió un archivo no válido.");
  return value;
}
// fetchAPI returns a standard Response. The caller supplies the existing native
// bearer transport or same-origin fetch plus CSRF; this helper stores no tokens.
export function createMediaClient(fetchAPI) {
  if (typeof fetchAPI !== "function") throw Error("Falta la conexión de archivos del CRM.");
  async function call(path, method = "GET", body) {
    const mutation = !["GET", "HEAD"].includes(method);
    const response = await fetchAPI(path, { method, ...(!mutation && body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }) });
    let value;
    try { value = await response.json(); } catch { throw Error("No se pudo leer la respuesta de archivos del CRM."); }
    if (!response.ok) throw Error(value?.error || "No se pudo completar la operación del archivo.");
    return value;
  }
  return Object.freeze({
    async listMedia() { return call(base); },
    async deleteMedia(id) {
      if (!ID.test(id)) throw Error("El archivo no es válido.");
      return call(base + "/" + id, "DELETE");
    },
    async uploadMedia(file, { onProgress, signal } = {}) {
      if (!file || typeof file.arrayBuffer !== "function" || typeof file.name !== "string" || !file.name || !TYPES.has(file.type))
        throw Error("Selecciona una foto PNG, JPG, GIF o WEBP, o un video MP4 o WEBM.");
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > OUTREACH_MEDIA_LIMITS.fileBytes)
        throw Error("Cada archivo debe ocupar entre 1 byte y 20 MiB.");
      const cancelled = () => { if (signal?.aborted) throw Error("Subida cancelada."); };
      cancelled();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== file.size) throw Error("El archivo cambió. Selecciónalo otra vez.");
      const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
      cancelled();
      const initial = await call(base, "POST", { name: file.name, type: file.type, size: file.size, sha256 });
      const media = validMedia(initial.media);
      if (initial.chunkSize !== OUTREACH_MEDIA_LIMITS.chunkBytes || initial.chunks !== Math.ceil(bytes.length / initial.chunkSize))
        throw Error("El CRM devolvió una subida no válida.");
      try {
        onProgress?.(0);
        for (let part = 0; part < initial.chunks; part++) {
          cancelled();
          const chunk = bytes.subarray(part * initial.chunkSize, (part + 1) * initial.chunkSize);
          await call(`${base}/${media.id}/chunks/${part}`, "PUT", { data: encode(chunk) });
          onProgress?.(Math.round((part + 1) / initial.chunks * 95));
        }
        cancelled();
        const result = await call(`${base}/${media.id}/complete`, "POST", {});
        const saved = validMedia(result.media);
        if (saved.sha256 !== sha256 || saved.size !== file.size || saved.type !== file.type)
          throw Error("No se pudo verificar el archivo guardado.");
        onProgress?.(100);
        return saved;
      } catch (error) {
        // Release an incomplete reservation when possible. A failed cleanup is
        // still listed as an upload for explicit deletion, never as ready media.
        await call(base + "/" + media.id, "DELETE").catch(() => {});
        throw error;
      }
    },
    async downloadMedia(id, { onProgress, signal } = {}) {
      if (!ID.test(id)) throw Error("El archivo no es válido.");
      const info = await call(base + "/" + id + "/metadata"), media = validMedia(info.media);
      if (info.chunkSize !== OUTREACH_MEDIA_LIMITS.chunkBytes || info.chunks !== Math.ceil(media.size / info.chunkSize))
        throw Error("El archivo guardado tiene fragmentos no válidos.");
      const bytes = new Uint8Array(media.size);
      for (let part = 0; part < info.chunks; part++) {
        if (signal?.aborted) throw Error("Descarga cancelada.");
        const result = await call(`${base}/${id}/chunks/${part}`);
        if (result.id !== id || result.part !== part) throw Error("El fragmento no corresponde al archivo solicitado.");
        const chunk = decode(result.data), offset = part * info.chunkSize;
        if (chunk.length !== Math.min(info.chunkSize, media.size - offset)) throw Error("El archivo descargado está incompleto.");
        bytes.set(chunk, offset);
        onProgress?.(Math.round((part + 1) / info.chunks * 100));
      }
      if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== media.sha256) throw Error("No se pudo comprobar el archivo descargado.");
      return new File([bytes], media.name, { type: media.type });
    },
  });
}
