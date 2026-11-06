// Authenticated coordination for five independently linked WhatsApp profiles.
// The Worker never connects to WhatsApp or emits an external message itself.
import { cleanEngagementConfig, emptyEngagement, inBusinessHours, matchBotRule, normalizeEngagementPhone } from '../engagement.mjs';

const PREFIX = '/api/engagement', LEASE_SECONDS = 120, CLAIM_SECONDS = 90;
const TOKEN = /^[a-f0-9]{64}$/, INSTALLATION = /^[a-f0-9]{32}$/;
const states = new Set(['sent_observed', 'failed', 'uncertain']);
class EngagementError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const now = () => Math.floor(Date.now() / 1000);
const token = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const id = () => crypto.randomUUID().replaceAll('-', '');
async function hash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join(''); }
function text(value, maximum, required = true) { if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new EngagementError('Los datos de la operación no son válidos.'); return value; }
async function input(request, limit = 8192) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new EngagementError('Usa una solicitud JSON válida.');
  const reader = request.body?.getReader(); if (!reader) throw new EngagementError('Completa los datos de la operación.');
  const chunks = []; let length = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); throw new EngagementError('La solicitud supera el límite permitido.', 413); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new EngagementError('Usa una solicitud JSON válida.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EngagementError('Usa un objeto JSON.');
  return value;
}
async function config(db) {
  await db.prepare('INSERT OR IGNORE INTO engagement_config(id,revision,body) VALUES(1,0,?)').bind(JSON.stringify(emptyEngagement())).run();
  const row = await db.prepare('SELECT revision,body FROM engagement_config WHERE id=1').first();
  return cleanEngagementConfig({ ...JSON.parse(row.body), revision: row.revision });
}
async function publicConfig(db, value) {
  const result = value || await config(db), current = now();
  const leases = (await db.prepare('SELECT line_id,phone,expires FROM engagement_leases WHERE expires>?').bind(current).all()).results;
  return { ...result, lines: result.lines.map(line => { const lease = leases.find(item => item.line_id === line.id && item.phone === line.phone && line.enabled); return { ...line, online: Boolean(lease), leaseExpiresAt: lease?.expires || 0 }; }), serverTime: current };
}
async function validMedia(db, value) {
  const files = value.bot.rules.flatMap(rule => rule.media), ids = [...new Set(files.map(file => file.id))];
  if (!ids.length) return;
  const rows=[];
  for(let start=0;start<ids.length;start+=80){const group=ids.slice(start,start+80);rows.push(...(await db.prepare('SELECT id,type,size,sha256,state FROM outreach_media WHERE id IN (' + group.map(() => '?').join(',') + ')').bind(...group).all()).results);}
  if (files.some(file => !rows.some(row => row.id === file.id && row.state === 'ready' && row.type === file.type && row.size === file.size && row.sha256 === file.sha256))) throw new EngagementError('Algún adjunto no existe o cambió. Selecciónalo de nuevo.');
}
function leaseFields(value) {
  const lineId = text(value.lineId, 100), installationId = text(value.installationId, 32);
  if (!INSTALLATION.test(installationId) || !TOKEN.test(value.leaseToken || '')) throw new EngagementError('La sesión de esta línea no es válida.', 409);
  return { lineId, installationId, leaseToken: value.leaseToken };
}
async function lease(db, value, latestConfig) {
  const fields = leaseFields(value), state = latestConfig || await config(db);
  const line = state.lines.find(item => item.id === fields.lineId && item.enabled);
  const row = await db.prepare('SELECT * FROM engagement_leases WHERE line_id=? AND installation_id=? AND token_hash=? AND expires>?').bind(fields.lineId, fields.installationId, await hash(fields.leaseToken), now()).first();
  if (!line || !row || row.phone !== line.phone) throw new EngagementError('La línea se desconectó, cambió o está ocupada en otro navegador.', 409);
  return { fields, row, state, line };
}
const historyItem = (row, current) => ({ id: row.id, lineId: row.line_id, phone: row.phone, incomingId: row.incoming_id, ruleId: row.rule_id, ruleName: row.rule_name, status: row.status === 'pending' && row.created + CLAIM_SECONDS <= current ? 'uncertain' : row.status, createdAt: row.created, updatedAt: row.updated, evidence: row.evidence, error: row.status === 'pending' && row.created + CLAIM_SECONDS <= current ? 'Operación interrumpida. Revisa WhatsApp antes de continuar.' : row.error });

export async function handleEngagement(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== PREFIX && !path.startsWith(PREFIX + '/')) return null;
  const db = env.DB;
  try {
    if (path === PREFIX && request.method === 'GET') return json(await publicConfig(db));
    if (path === PREFIX && request.method === 'PUT') {
      const value = cleanEngagementConfig(await input(request, 710000));
      await config(db); await validMedia(db, value);
      const revision = value.revision; value.revision++;
      const encoded=JSON.stringify(value);
      const saved = await db.prepare("UPDATE engagement_config SET revision=revision+1,body=? WHERE id=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM json_each(?,'$.bot.rules') r,json_each(r.value,'$.media') m WHERE NOT EXISTS(SELECT 1 FROM outreach_media a WHERE a.id=json_extract(m.value,'$.id') AND a.state='ready' AND a.type=json_extract(m.value,'$.type') AND a.size=json_extract(m.value,'$.size') AND a.sha256=json_extract(m.value,'$.sha256')))").bind(encoded, revision,encoded).run();
      if (saved.meta.changes !== 1) throw new EngagementError('Otra sesión cambió las líneas o el chatbot. Actualiza antes de guardar.', 409);
      return json(await publicConfig(db, value));
    }
    if (path === PREFIX + '/stop' && request.method === 'POST') {
      await input(request); await config(db);
      await db.batch([
        db.prepare("UPDATE engagement_config SET revision=revision+1,body=json_set(body,'$.bot.enabled',json('false')) WHERE id=1"),
        db.prepare('DELETE FROM engagement_leases'),
      ]);
      return json(await publicConfig(db));
    }
    if (path === PREFIX + '/lease' && request.method === 'POST') {
      const value = await input(request), state = await config(db), lineId = text(value.lineId, 100), installationId = text(value.installationId, 32);
      if (!INSTALLATION.test(installationId)) throw new EngagementError('El navegador no tiene una identificación válida.');
      const line = state.lines.find(item => item.id === lineId && item.enabled);
      if (!line) throw new EngagementError('Activa o selecciona una línea existente.', 409);
      const leaseToken = token(), expiresAt = now() + LEASE_SECONDS;
      const result = await db.prepare('INSERT INTO engagement_leases(line_id,installation_id,token_hash,phone,expires,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(line_id) DO UPDATE SET installation_id=excluded.installation_id,token_hash=excluded.token_hash,phone=excluded.phone,expires=excluded.expires,updated=excluded.updated WHERE engagement_leases.expires<=?').bind(lineId, installationId, await hash(leaseToken), line.phone, expiresAt, now(), now()).run();
      if (result.meta.changes !== 1) throw new EngagementError('Esta línea ya está conectada en otro navegador. Detenla allí o espera a que caduque.', 409);
      return json({ leaseToken, expiresAt, config: await publicConfig(db, state) }, 201);
    }
    if (path === PREFIX + '/lease/heartbeat' && request.method === 'POST') {
      const value = await input(request), current = await lease(db, value), expiresAt = now() + LEASE_SECONDS;
      const saved = await db.prepare('UPDATE engagement_leases SET expires=?,updated=? WHERE line_id=? AND installation_id=? AND token_hash=? AND expires>?').bind(expiresAt, now(), current.fields.lineId, current.fields.installationId, await hash(current.fields.leaseToken), now()).run();
      if (saved.meta.changes !== 1) throw new EngagementError('La línea ya está desconectada.', 409);
      return json({ expiresAt, config: await publicConfig(db, current.state) });
    }
    if (path === PREFIX + '/lease/release' && request.method === 'POST') {
      const value = leaseFields(await input(request));
      await db.prepare('DELETE FROM engagement_leases WHERE line_id=? AND installation_id=? AND token_hash=?').bind(value.lineId, value.installationId, await hash(value.leaseToken)).run();
      return json({ released: true });
    }
    if (path === PREFIX + '/bot/claim' && request.method === 'POST') {
      const value = await input(request, 20000), current = await lease(db, value), timestamp = now();
      const phone = normalizeEngagementPhone(text(value.phone, 30)), incomingId = text(value.incomingId, 300), ruleId = text(value.ruleId, 100), message = text(value.incomingText, 8000);
      if (!current.state.bot.enabled) return json({ claimed: false, reason: 'disabled' });
      if (!inBusinessHours(current.state.bot)) return json({ claimed: false, reason: 'outside_hours' });
      const rule = matchBotRule(current.state.bot, message);
      if (!rule || rule.id !== ruleId) return json({ claimed: false, reason: 'rule_changed' });
      const key = await hash(current.fields.lineId + '\0' + incomingId), claimId = id(), claimToken = token();
      const result = await db.prepare(`INSERT INTO engagement_bot_attempts(id,dedupe_key,line_id,phone,incoming_id,rule_id,rule_name,rule_body,config_revision,token_hash,status,created,updated) SELECT ?,?,?,?,?,?,?,?,?,?,'pending',?,? WHERE (SELECT revision FROM engagement_config WHERE id=1)=? AND EXISTS(SELECT 1 FROM engagement_leases WHERE line_id=? AND installation_id=? AND token_hash=? AND expires>?) AND NOT EXISTS(SELECT 1 FROM engagement_bot_attempts WHERE line_id=? AND phone=? AND created>?) AND (SELECT COUNT(*) FROM engagement_bot_attempts)<10000 ON CONFLICT(dedupe_key) DO NOTHING`).bind(claimId, key, current.fields.lineId, phone, incomingId, rule.id, rule.name, JSON.stringify(rule), current.state.revision, await hash(claimToken), timestamp, timestamp, current.state.revision, current.fields.lineId, current.fields.installationId, await hash(current.fields.leaseToken), timestamp, current.fields.lineId, phone, timestamp - current.state.bot.cooldownSeconds).run();
      if (result.meta.changes !== 1) {
        const duplicate = await db.prepare('SELECT id FROM engagement_bot_attempts WHERE dedupe_key=?').bind(key).first();
        return json({ claimed: false, reason: duplicate ? 'duplicate' : 'cooldown_or_changed' });
      }
      return json({ claimed: true, claimId, claimToken, rule, configRevision: current.state.revision, expiresAt: timestamp + CLAIM_SECONDS }, 201);
    }
    if (path === PREFIX + '/bot/permit' && request.method === 'POST') {
      const value = await input(request); let current;
      try { current = await lease(db, value); } catch (error) { if (error.status === 409) return json({ allowed: false }); throw error; }
      if (!TOKEN.test(value.claimToken || '')) return json({ allowed: false });
      const claim = await db.prepare("SELECT * FROM engagement_bot_attempts WHERE id=? AND token_hash=? AND line_id=? AND status='pending' AND created>? AND EXISTS(SELECT 1 FROM engagement_config WHERE revision=engagement_bot_attempts.config_revision AND json_extract(body,'$.bot.enabled')=1) AND EXISTS(SELECT 1 FROM engagement_leases WHERE line_id=engagement_bot_attempts.line_id AND installation_id=? AND token_hash=? AND expires>?)").bind(text(value.claimId, 32), await hash(value.claimToken), current.fields.lineId, now() - CLAIM_SECONDS,current.fields.installationId,await hash(current.fields.leaseToken),now()).first();
      const rule = claim && current.state.bot.rules.find(item => item.id === claim.rule_id && item.enabled);
      const allowed = Boolean(claim && current.state.bot.enabled && current.state.revision === claim.config_revision && rule && JSON.stringify(rule) === claim.rule_body && inBusinessHours(current.state.bot));
      return json({ allowed });
    }
    if (path === PREFIX + '/bot/result' && request.method === 'POST') {
      const value = await input(request), claimId = text(value.claimId, 32);
      if (!TOKEN.test(value.claimToken || '') || !states.has(value.status)) throw new EngagementError('El resultado del chatbot no es válido.');
      const tokenHash = await hash(value.claimToken), evidence = text(value.evidence ?? '', 1000, false), error = text(value.error ?? '', 1000, false);
      const result = await db.prepare("UPDATE engagement_bot_attempts SET status=?,updated=?,evidence=?,error=? WHERE id=? AND token_hash=? AND status='pending'").bind(value.status, now(), evidence, error, claimId, tokenHash).run();
      if (result.meta.changes !== 1) {
        const previous = await db.prepare('SELECT status FROM engagement_bot_attempts WHERE id=? AND token_hash=?').bind(claimId, tokenHash).first();
        if (!previous || previous.status !== value.status) throw new EngagementError('Este resultado ya se guardó o la confirmación no es válida.', 409);
      }
      return json({ ok: true });
    }
    if (path === PREFIX + '/history' && request.method === 'GET') {
      const items = (await db.prepare('SELECT id,line_id,phone,incoming_id,rule_id,rule_name,status,created,updated,evidence,error FROM engagement_bot_attempts ORDER BY created DESC,id DESC LIMIT 100').all()).results;
      return json({ items: items.map(item => historyItem(item, now())) });
    }
    return json({ error: 'Recurso u operación no permitidos.' }, 405);
  } catch (error) {
    return json({ error: error instanceof EngagementError ? error.message : error.name === 'Error' && !/D1_|SQLITE|syntax|database|table|constraint/i.test(error.message) ? error.message : 'No se pudo completar la operación de líneas o chatbot.' }, error.status || (/D1_|SQLITE|syntax|database|table|constraint/i.test(error.message) ? 500 : 400));
  }
}
