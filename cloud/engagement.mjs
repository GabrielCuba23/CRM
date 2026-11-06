// Authenticated coordination for five independently linked WhatsApp profiles.
// The Worker never connects to WhatsApp or emits an external message itself.
import { cleanEngagementConfig, emptyEngagement, inBusinessHours, matchBotRule, normalizeEngagementPhone } from '../engagement.mjs';
import {advanceFlow,selectBotFlow} from '../bot-flows.mjs';

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
  const files = [...value.bot.rules.flatMap(rule => rule.media),...(value.bot.flows||[]).flatMap(flow=>flow.nodes.flatMap(node=>node.media||[]))], ids = [...new Set(files.map(file => file.id))];
  if(ids.length>500)throw new EngagementError('La configuración usa demasiados archivos distintos.');
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
const historyItem = (row, current) => ({ id: row.id, lineId: row.line_id, contactKey:row.contact_key||'',chatId:row.chat_id||'',phone: row.phone, incomingId: row.incoming_id, ruleId: row.rule_id, ruleName: row.rule_name, status: row.status === 'pending' && row.created + CLAIM_SECONDS <= current ? 'uncertain' : row.status, createdAt: row.created, updatedAt: row.updated, evidence: row.evidence, error: row.status === 'pending' && row.created + CLAIM_SECONDS <= current ? 'Operación interrumpida. Revisa WhatsApp antes de continuar.' : row.error });
async function identity(value) {
  const chatId=value.chatId===undefined||value.chatId===''?'':text(value.chatId,300);
  if(chatId&&(!/^wa:[^\s]{1,297}$/.test(chatId)||/@(?:g\.us|newsletter|broadcast)$/.test(chatId)))throw new EngagementError('Selecciona una conversación individual identificada.');
  const phone=value.phone===undefined||value.phone===''?'':normalizeEngagementPhone(text(value.phone,30));
  if(!chatId&&!phone)throw new EngagementError('Falta la identidad del chat. Abre una conversación individual.');
  return{chatId,phone,contactKey:chatId?'chat:'+await hash(chatId):'phone:'+phone};
}
function ttl(config){return(config.bot.conversationTtlMinutes??30)*60;}
function conversationItem(row){let state=null;try{state=JSON.parse(row?.state_json||'null');}catch{}return{lineId:row.line_id,contactKey:row.contact_key,chatId:row.chat_id,phone:row.phone,state,revision:row.revision,expiresAt:row.expires,blocked:row.blocked===1,pending:Boolean(row.pending_claim)};}
async function expireConversations(db,timestamp){
  await db.batch([
    db.prepare("UPDATE engagement_bot_attempts SET status='uncertain',updated=?,error='Operación interrumpida. Revisa WhatsApp y reinicia el flujo.' WHERE status='pending' AND created<=? AND EXISTS(SELECT 1 FROM engagement_conversations WHERE pending_claim=engagement_bot_attempts.id)").bind(timestamp,timestamp-CLAIM_SECONDS),
    db.prepare("UPDATE engagement_conversations SET blocked=1,pending_claim='',revision=revision+1,updated=? WHERE pending_claim<>'' AND NOT EXISTS(SELECT 1 FROM engagement_bot_attempts WHERE id=engagement_conversations.pending_claim AND status='pending')").bind(timestamp),
    db.prepare("UPDATE engagement_conversations SET state_json='null',revision=revision+1 WHERE expires<=? AND blocked=1 AND state_json<>'null'").bind(timestamp),
    db.prepare("DELETE FROM engagement_conversations WHERE expires<=? AND blocked=0 AND pending_claim=''").bind(timestamp),
  ]);
}
async function conversation(db,lineId,person,config,timestamp,create=false){
  await expireConversations(db,timestamp);
  if(create)await db.prepare("INSERT INTO engagement_conversations(line_id,contact_key,chat_id,phone,state_json,revision,expires,updated,blocked,pending_claim) SELECT ?,?,?,?,'null',0,?,?,0,'' WHERE (SELECT COUNT(*) FROM engagement_conversations)<5000 ON CONFLICT(line_id,contact_key) DO NOTHING").bind(lineId,person.contactKey,person.chatId,person.phone,timestamp+ttl(config),timestamp).run();
  return db.prepare('SELECT * FROM engagement_conversations WHERE line_id=? AND contact_key=?').bind(lineId,person.contactKey).first();
}


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
      const saved = await db.prepare("UPDATE engagement_config SET revision=revision+1,body=? WHERE id=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM json_tree(?,'$.bot') t,json_each(CASE WHEN t.key='media' AND t.type='array' THEN t.value ELSE '[]' END) m WHERE NOT EXISTS(SELECT 1 FROM outreach_media a WHERE a.id=json_extract(m.value,'$.id') AND a.state='ready' AND a.type=json_extract(m.value,'$.type') AND a.size=json_extract(m.value,'$.size') AND a.sha256=json_extract(m.value,'$.sha256')))").bind(encoded, revision,encoded).run();
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
    if(path===PREFIX+'/conversations'&&request.method==='GET'){
      await expireConversations(db,now());
      const rows=(await db.prepare('SELECT * FROM engagement_conversations ORDER BY updated DESC LIMIT 100').all()).results;
      return json({items:rows.map(conversationItem),serverTime:now()});
    }
    if(path===PREFIX+'/conversations/reset'&&request.method==='POST'){
      const value=await input(request),lineId=text(value.lineId,100),state=await config(db);
      if(!state.lines.some(line=>line.id===lineId))throw new EngagementError('La línea ya no existe.',409);
      const contactKey=value.contactKey?text(value.contactKey,100):(await identity(value)).contactKey;
      if(!/^(?:chat:[a-f0-9]{64}|phone:[1-9]\d{6,14})$/.test(contactKey))throw new EngagementError('La conversación no es válida.');
      const timestamp=now();await db.batch([
        db.prepare("UPDATE engagement_bot_attempts SET status='failed',updated=?,error='Flujo reiniciado manualmente.' WHERE id IN (SELECT pending_claim FROM engagement_conversations WHERE line_id=? AND contact_key=?) AND status='pending'").bind(timestamp,lineId,contactKey),
        db.prepare("UPDATE engagement_conversations SET state_json='null',blocked=0,pending_claim='',revision=revision+1,updated=?,expires=? WHERE line_id=? AND contact_key=?").bind(timestamp,timestamp+ttl(state),lineId,contactKey),
      ]);return json({ok:true,reset:true});
    }
    if (path === PREFIX + '/bot/claim' && request.method === 'POST') {
      const value = await input(request, 22000), current = await lease(db, value), timestamp = now();
      const person=await identity(value),{phone,chatId,contactKey}=person,incomingId=text(value.incomingId,300),message=text(value.incomingText,8000);
      if(!current.state.bot.enabled)return json({claimed:false,reason:'disabled'});
      if(!inBusinessHours(current.state.bot))return json({claimed:false,reason:'outside_hours'});
      let row=await conversation(db,current.fields.lineId,person,current.state,timestamp);
      if(row?.blocked)return json({claimed:false,reason:'conversation_blocked'});
      if(row?.pending_claim)return json({claimed:false,reason:'conversation_busy'});
      let previous=null;try{previous=JSON.parse(row?.state_json||'null');}catch{}
      const restarting=/^(0|menu|menú|inicio)$/i.test(message.trim());
      if(previous?.handoff&&!restarting)return json({claimed:false,reason:'handoff'});
      const flow=selectBotFlow(current.state.bot,message,{flowId:previous&&(!previous.ended||restarting)?previous.flowId:undefined,ruleId:value.ruleId});
      let rule,nextState=null,activeFlow=false;
      if(flow){
        const step=advanceFlow(flow,previous?.flowId===flow.id?previous:null,message);
        rule={id:'flow:'+flow.id,name:flow.name,text:step.reply.text,media:step.reply.media};nextState=step.nextState;activeFlow=Boolean(previous?.flowId===flow.id&&!previous.ended)||restarting;
      }else{
        rule=matchBotRule(current.state.bot,message);
        if(!rule)return json({claimed:false,reason:'no_match'});
        if(value.ruleId&&rule.id!==value.ruleId)return json({claimed:false,reason:'rule_changed'});
      }
      if(!row)row=await conversation(db,current.fields.lineId,person,current.state,timestamp,true);
      if(!row)return json({claimed:false,reason:'conversation_limit'});
      const encodedRule=JSON.stringify(rule),transition=JSON.stringify({baseRevision:row.revision,nextState,flowId:flow?.id||''});
      const key=await hash(current.fields.lineId+'\0'+incomingId),claimId=id(),claimToken=token();
      const result=await db.batch([
        db.prepare("INSERT INTO engagement_bot_attempts(id,dedupe_key,line_id,phone,chat_id,contact_key,incoming_id,rule_id,rule_name,rule_body,config_revision,token_hash,status,created,updated,next_state) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,? WHERE (SELECT revision FROM engagement_config WHERE id=1)=? AND EXISTS(SELECT 1 FROM engagement_leases WHERE line_id=? AND installation_id=? AND token_hash=? AND expires>?) AND EXISTS(SELECT 1 FROM engagement_conversations WHERE line_id=? AND contact_key=? AND revision=? AND blocked=0 AND pending_claim='') AND (?=1 OR NOT EXISTS(SELECT 1 FROM engagement_bot_attempts WHERE line_id=? AND (contact_key=? OR (contact_key='' AND phone<>'' AND phone=?)) AND created>?)) AND (SELECT COUNT(*) FROM engagement_bot_attempts)<10000 ON CONFLICT(dedupe_key) DO NOTHING").bind(claimId,key,current.fields.lineId,phone,chatId,contactKey,incomingId,rule.id,rule.name,encodedRule,current.state.revision,await hash(claimToken),timestamp,timestamp,transition,current.state.revision,current.fields.lineId,current.fields.installationId,await hash(current.fields.leaseToken),timestamp,current.fields.lineId,contactKey,row.revision,activeFlow?1:0,current.fields.lineId,contactKey,phone,timestamp-current.state.bot.cooldownSeconds),
        db.prepare("UPDATE engagement_conversations SET pending_claim=?,updated=?,expires=? WHERE line_id=? AND contact_key=? AND revision=? AND blocked=0 AND pending_claim='' AND EXISTS(SELECT 1 FROM engagement_bot_attempts WHERE id=? AND status='pending')").bind(claimId,timestamp,timestamp+ttl(current.state),current.fields.lineId,contactKey,row.revision,claimId),
      ]);
      if(result[0].meta.changes!==1||result[1].meta.changes!==1){const duplicate=await db.prepare('SELECT id FROM engagement_bot_attempts WHERE dedupe_key=?').bind(key).first();return json({claimed:false,reason:duplicate?'duplicate':'cooldown_or_changed'});}
      return json({claimed:true,claimId,claimToken,rule,reply:{text:rule.text,media:rule.media},flowId:flow?.id||'',chatId,contactKey,configRevision:current.state.revision,expiresAt:timestamp+CLAIM_SECONDS},201);
    }
    if (path === PREFIX + '/bot/permit' && request.method === 'POST') {
      const value=await input(request);let current;
      try{current=await lease(db,value);}catch(error){if(error.status===409)return json({allowed:false});throw error;}
      if(!TOKEN.test(value.claimToken||''))return json({allowed:false});
      const claim=await db.prepare("SELECT * FROM engagement_bot_attempts WHERE id=? AND token_hash=? AND line_id=? AND status='pending' AND created>? AND EXISTS(SELECT 1 FROM engagement_config WHERE revision=engagement_bot_attempts.config_revision AND json_extract(body,'$.bot.enabled')=1) AND EXISTS(SELECT 1 FROM engagement_leases WHERE line_id=engagement_bot_attempts.line_id AND installation_id=? AND token_hash=? AND expires>?) AND EXISTS(SELECT 1 FROM engagement_conversations WHERE line_id=engagement_bot_attempts.line_id AND contact_key=engagement_bot_attempts.contact_key AND pending_claim=engagement_bot_attempts.id AND blocked=0 AND revision=json_extract(engagement_bot_attempts.next_state,'$.baseRevision'))").bind(text(value.claimId,32),await hash(value.claimToken),current.fields.lineId,now()-CLAIM_SECONDS,current.fields.installationId,await hash(current.fields.leaseToken),now()).first();
      const exactIdentity=Boolean(claim&&(claim.chat_id?claim.chat_id===value.chatId:!value.chatId));
      const allowed=Boolean(claim&&exactIdentity&&current.state.bot.enabled&&current.state.revision===claim.config_revision&&inBusinessHours(current.state.bot));
      return json({allowed});
    }
    if (path === PREFIX + '/bot/result' && request.method === 'POST') {
      const value=await input(request),claimId=text(value.claimId,32);
      if(!TOKEN.test(value.claimToken||'')||!states.has(value.status))throw new EngagementError('El resultado del chatbot no es válido.');
      const tokenHash=await hash(value.claimToken),claim=await db.prepare('SELECT * FROM engagement_bot_attempts WHERE id=? AND token_hash=?').bind(claimId,tokenHash).first();
      if(!claim)throw new EngagementError('La confirmación del intento no es válida.',409);
      if(claim.status!=='pending'){if(claim.status===value.status)return json({ok:true});throw new EngagementError('Este resultado ya se guardó.',409);}
      const transition=JSON.parse(claim.next_state||'{}'),timestamp=now(),evidence=text(value.evidence??'',1000,false),error=text(value.error??'',1000,false);
      const result=await db.batch([
        db.prepare("UPDATE engagement_bot_attempts SET status=?,updated=?,evidence=?,error=? WHERE id=? AND token_hash=? AND status='pending' AND EXISTS(SELECT 1 FROM engagement_conversations WHERE line_id=engagement_bot_attempts.line_id AND contact_key=engagement_bot_attempts.contact_key AND pending_claim=engagement_bot_attempts.id AND revision=?)").bind(value.status,timestamp,evidence,error,claimId,tokenHash,transition.baseRevision??0),
        db.prepare("UPDATE engagement_conversations SET state_json=CASE WHEN ?='sent_observed' THEN ? ELSE state_json END,blocked=CASE WHEN ?='uncertain' THEN 1 ELSE blocked END,pending_claim='',revision=revision+1,updated=? WHERE line_id=? AND contact_key=? AND pending_claim=? AND revision=? AND EXISTS(SELECT 1 FROM engagement_bot_attempts WHERE id=? AND status=?)").bind(value.status,JSON.stringify(transition.nextState??null),value.status,timestamp,claim.line_id,claim.contact_key,claimId,transition.baseRevision??0,claimId,value.status),
      ]);
      if(result[0].meta.changes!==1||result[1].meta.changes!==1)throw new EngagementError('El flujo cambió durante el intento. Actualiza su estado.',409);
      return json({ok:true});
    }
    if (path === PREFIX + '/history' && request.method === 'GET') {
      const items = (await db.prepare('SELECT id,line_id,phone,chat_id,contact_key,incoming_id,rule_id,rule_name,status,created,updated,evidence,error FROM engagement_bot_attempts ORDER BY created DESC,id DESC LIMIT 100').all()).results;
      return json({ items: items.map(item => historyItem(item, now())) });
    }
    return json({ error: 'Recurso u operación no permitidos.' }, 405);
  } catch (error) {
    return json({ error: error instanceof EngagementError ? error.message : error.name === 'Error' && !/D1_|SQLITE|syntax|database|table|constraint/i.test(error.message) ? error.message : 'No se pudo completar la operación de líneas o chatbot.' }, error.status || (/D1_|SQLITE|syntax|database|table|constraint/i.test(error.message) ? 500 : 400));
  }
}
