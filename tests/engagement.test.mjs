import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {cleanEngagementConfig,emptyEngagement,matchBotRule,inBusinessHours} from '../engagement.mjs';
import {tokenHash} from '../cloud/native-auth.mjs';
const require=createRequire('/workspace/work/cloud-tools/package.json');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild');
const origin='https://engagement.test',email='owner@example.test',token='e'.repeat(64);
const source=await build({stdin:{contents:"import {handleRequest} from './cloud/index.mjs';export default {fetch(r,e){return handleRequest(r,e)}};",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'engagement-tests',modules:true,script:source.outputFiles[0].text,d1Databases:{DB:'engagement-tests'},bindings:{OWNER_EMAIL:email,AUTH_MODE:'password',AUTH_PASSWORD_PEPPER:'synthetic_pepper_123456789012345678901234567890'}}]}));
const DB=await mf.getD1Database('DB');await DB.exec((await readFile(new URL('../cloud/schema.sql',import.meta.url),'utf8')).replace(/\n/g,' '));
await DB.prepare('INSERT INTO auth_owner(id,email,password_hash,version,created) VALUES(1,?,?,1,?)').bind(email,'synthetic_unused_hash',1).run();
await DB.prepare("INSERT INTO auth_sessions(token_hash,email,csrf,kind,owner_version,expires,created) VALUES(?,?,?,'extension',1,?,?)").bind(await tokenHash(token),email,'synthetic_csrf',Math.floor(Date.now()/1000)+3600,1).run();
test.after(()=>mf.dispose());
const rule={id:'greeting',name:'Saludo',enabled:true,match:'contains',keywords:['hola'],text:'Hola {nombre}',media:[]};
function configured(){const value=emptyEngagement();value.lines=Array.from({length:5},(_,i)=>({id:'line'+i,name:'Línea '+i,phone:'5191234567'+i,enabled:true,allowBackground:true}));value.bot.enabled=true;value.bot.rules=[structuredClone(rule)];value.bot.cooldownSeconds=60;return value;}
async function request(path='',method='GET',body,auth=true){return mf.dispatchFetch(origin+'/api/engagement'+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token,'X-Nexo-Client':'extension'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function data(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
async function setup(){await DB.batch([DB.prepare('DELETE FROM engagement_bot_attempts'),DB.prepare('DELETE FROM engagement_conversations'),DB.prepare('DELETE FROM engagement_leases'),DB.prepare('DELETE FROM engagement_config')]);return data(await request('','PUT',configured()));}
async function lease(lineId='line0',installationId='a'.repeat(32)){const value=await data(await request('/lease','POST',{lineId,installationId}),201);return{lineId,installationId,leaseToken:value.leaseToken};}
async function claim(fields,incomingId='false_fixture@lid_new',phone='51998765432'){return data(await request('/bot/claim','POST',{...fields,incomingId,phone,incomingText:'Hola',ruleId:'greeting'}),201);}

test('configuration rejects sixth/duplicate line and matches normalized rules with Lima overnight schedule',()=>{
 const value=configured();assert.equal(cleanEngagementConfig(value).lines.length,5);assert.throws(()=>cleanEngagementConfig({...value,lines:[...value.lines,{...value.lines[0],id:'six'}]}));
 assert.throws(()=>cleanEngagementConfig({...value,lines:[value.lines[0],{...value.lines[0],id:'duplicate'}]}));
 assert.equal(matchBotRule(value.bot,'¡HÓLA amigo!').id,'greeting');value.bot.hours={enabled:true,start:'22:00',end:'06:00',days:[1]};
 assert.equal(inBusinessHours(value.bot,Date.parse('2026-11-10T04:00:00Z')),true);assert.equal(inBusinessHours(value.bot,Date.parse('2026-11-10T10:00:00Z')),true);assert.equal(inBusinessHours(value.bot,Date.parse('2026-11-10T12:00:00Z')),false);
});
test('private API keeps default bot disabled, rejects unauthenticated reads and stale configuration',async()=>{
 await setup();assert.equal((await request('','GET',undefined,false)).status,401);
 const old=await data(await request());await data(await request('','PUT',old));assert.equal((await request('','PUT',old)).status,409);
 await DB.prepare('DELETE FROM engagement_config').run();assert.equal((await data(await request())).bot.enabled,false);
});
test('five independent profiles acquire five lines; competing lease and wrong token are rejected',async()=>{
 await setup();const lines=await Promise.all(Array.from({length:5},(_,i)=>lease('line'+i,String(i+1).repeat(32))));assert.equal(lines.length,5);
 assert.equal((await request('/lease','POST',{lineId:'line0',installationId:'b'.repeat(32)})).status,409);
 const snapshot=await data(await request());assert.equal(snapshot.lines.filter(x=>x.online).length,5);assert.ok(!JSON.stringify(snapshot).includes(lines[0].leaseToken));
 assert.equal((await request('/lease/heartbeat','POST',{...lines[0],leaseToken:'f'.repeat(64)})).status,409);
 await data(await request('/lease/release','POST',lines[0]));assert.equal((await data(await request())).lines[0].online,false);
});
test('durable claims deduplicate concurrent attempts, enforce cooldown and never replay uncertain results',async()=>{
 await setup();const fields=await lease(),payload={...fields,incomingId:'false_fixture@lid_one',phone:'51998765432',incomingText:'hola',ruleId:'greeting'};
 const outcomes=await Promise.all([1,2].map(()=>request('/bot/claim','POST',payload)));const values=await Promise.all(outcomes.map(r=>r.json()));assert.equal(values.filter(x=>x.claimed).length,1);const granted=values.find(x=>x.claimed);
 assert.equal((await data(await request('/bot/permit','POST',{...fields,...granted}))).allowed,true);
 await data(await request('/bot/result','POST',{claimId:granted.claimId,claimToken:granted.claimToken,status:'uncertain',error:'Interrupción sintética'}));
 assert.equal((await data(await request('/bot/claim','POST',payload))).claimed,false);
 assert.equal((await data(await request('/bot/claim','POST',{...payload,incomingId:'false_fixture@lid_two'}))).claimed,false);
 assert.equal((await data(await request('/history'))).items[0].status,'uncertain');
});
test('stop all revokes every lease and invalidates a permit before clicking send',async()=>{
 await setup();const fields=await lease(),grant=await claim(fields);
 await data(await request('/stop','POST',{}));assert.equal((await data(await request())).bot.enabled,false);
 assert.equal((await data(await request('/bot/permit','POST',{...fields,...grant}))).allowed,false);
 assert.equal((await request('/lease/heartbeat','POST',fields)).status,409);
});
test('chatbot media references prevent library deletion until the rule is removed',async()=>{
 await setup();const id='c'.repeat(32),sha='d'.repeat(64),media={id,name:'Foto.png',type:'image/png',size:12,sha256:sha};
 await DB.prepare("INSERT INTO outreach_media(id,name,type,size,sha256,state,created) VALUES(?,?,?,?,?,'ready',1)").bind(id,media.name,media.type,media.size,sha).run();
 const state=await data(await request());state.bot.rules[0].media=[media];await data(await request('','PUT',state));
 const response=await mf.dispatchFetch(origin+'/api/outreach/media/'+id,{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Nexo-Client':'extension'},body:'{}'});assert.equal(response.status,409);
 assert.ok(await DB.prepare('SELECT id FROM outreach_media WHERE id=?').bind(id).first());
});

const chatA='wa:lid-opaque-individual-a',chatB='wa:lid-opaque-individual-b';
function menuFlow(){return{id:'sales',name:'Ventas',enabled:true,entryNodeId:'main',triggerKeywords:['comprar'],nodes:[{id:'main',type:'menu',text:'¿Qué necesitas?',media:[],options:[{key:'1',label:'Catálogo',nextNodeId:'catalog'},{key:'8',label:'Asesoría',nextNodeId:'name'}]},{id:'catalog',type:'end',text:'Tenemos Netflix y Max.',media:[]},{id:'name',type:'question',text:'¿Cómo te llamas?',media:[],variable:'nombre_cliente',validation:'text',nextNodeId:'email'},{id:'email',type:'question',text:'Gracias {nombre_cliente}. ¿Tu correo?',media:[],variable:'correo',validation:'email',nextNodeId:'done'},{id:'done',type:'handoff',text:'Gracias {nombre_cliente}, te contactaremos en {correo}.',media:[]}]};}
async function setupFlow(){const saved=await setup();saved.bot.flows=[menuFlow()];saved.bot.defaultFlowId='sales';return data(await request('','PUT',saved));}
async function step(fields,chatId,incomingId,incomingText){return data(await request('/bot/claim','POST',{...fields,chatId,incomingId,incomingText}),201);}
async function result(grant,status='sent_observed'){return data(await request('/bot/result','POST',{claimId:grant.claimId,claimToken:grant.claimToken,status,evidence:status==='sent_observed'?'observed synthetic outgoing id':''}));}
async function session(chatId){return(await data(await request('/conversations'))).items.find(item=>item.chatId===chatId);}

test('stable private chat IDs work without phone and keep different conversations isolated',async()=>{
 await setupFlow();const fields=await lease(),a=await step(fields,chatA,'opaque_one','Quiero comprar');
 assert.equal(a.rule.id,'flow:sales');assert.match(a.reply.text,/8\. Asesoría/);assert.equal((await session(chatA)).state,null);
 assert.equal((await data(await request('/bot/permit','POST',{...fields,...a,chatId:chatB}))).allowed,false);
 assert.equal((await data(await request('/bot/permit','POST',{...fields,claimId:a.claimId,claimToken:a.claimToken}))).allowed,false);
 assert.equal((await data(await request('/bot/permit','POST',{...fields,...a,chatId:chatA}))).allowed,true);
 await result(a);const b=await step(fields,chatB,'opaque_two','Hola');assert.ok(b.claimed);assert.notEqual(a.contactKey,b.contactKey);assert.equal((await session(chatB)).state,null);
 await result(b);assert.equal((await session(chatA)).state.nodeId,'main');assert.equal((await session(chatB)).state.nodeId,'main');
 assert.equal((await request('/bot/claim','POST',{...fields,chatId:'contact-name-only',incomingId:'bad',incomingText:'hola'})).status,400);
});
test('menu and question transitions persist only after observed send and ignore legacy cooldown in active flows',async()=>{
 await setupFlow();const fields=await lease(),first=await step(fields,chatA,'m1','comprar');await result(first);
 const choice=await step(fields,chatA,'m2','8');assert.equal(choice.reply.text,'¿Cómo te llamas?');assert.equal((await session(chatA)).state.nodeId,'main');await result(choice);
 const name=await step(fields,chatA,'m3','Antonella');assert.equal(name.reply.text,'Gracias Antonella. ¿Tu correo?');await result(name);
 const invalid=await step(fields,chatA,'m4','no-es-correo');assert.match(invalid.reply.text,/formato esperado/);await result(invalid);assert.equal((await session(chatA)).state.nodeId,'email');
 const email=await step(fields,chatA,'m5','antonella@example.test');assert.match(email.reply.text,/Antonella.*antonella@example.test/);await result(email);
 const saved=await session(chatA);assert.equal(saved.state.handoff,true);assert.deepEqual(saved.state.variables,{nombre_cliente:'Antonella',correo:'antonella@example.test'});
 const stopped=await data(await request('/bot/claim','POST',{...fields,chatId:chatA,incomingId:'m6',incomingText:'hola'}));assert.equal(stopped.reason,'handoff');
 const restart=await step(fields,chatA,'m7','menú');await result(restart);assert.equal((await session(chatA)).state.nodeId,'main');
});
test('failed sends retain old step, uncertain results block until explicit reset and dedupe survives reset',async()=>{
 await setupFlow();const fields=await lease(),first=await step(fields,chatA,'f1','comprar');await result(first);
 const failed=await step(fields,chatA,'f2','8');await result(failed,'failed');assert.equal((await session(chatA)).state.nodeId,'main');
 const uncertain=await step(fields,chatA,'f3','8');await result(uncertain,'uncertain');assert.equal((await session(chatA)).state.nodeId,'main');assert.equal((await session(chatA)).blocked,true);
 assert.equal((await data(await request('/bot/claim','POST',{...fields,chatId:chatA,incomingId:'f4',incomingText:'8'}))).reason,'conversation_blocked');
 await data(await request('/conversations/reset','POST',{lineId:'line0',chatId:chatA}));assert.equal((await session(chatA)).state,null);assert.equal((await session(chatA)).blocked,false);
 assert.equal((await data(await request('/bot/claim','POST',{...fields,chatId:chatA,incomingId:'f3',incomingText:'comprar'}))).reason,'duplicate');
});
test('concurrent incoming messages reserve a conversation once and abandoned attempts block without replay',async()=>{
 await setupFlow();const fields=await lease(),first=await step(fields,chatA,'c1','comprar');await result(first);
 const responses=await Promise.all(['c2','c3'].map(incomingId=>request('/bot/claim','POST',{...fields,chatId:chatA,incomingId,incomingText:'8'})));const grants=await Promise.all(responses.map(r=>r.json()));assert.equal(grants.filter(item=>item.claimed).length,1);
 const pending=grants.find(item=>item.claimed);await DB.prepare('UPDATE engagement_bot_attempts SET created=created-100 WHERE id=?').bind(pending.claimId).run();
 const blocked=await data(await request('/bot/claim','POST',{...fields,chatId:chatA,incomingId:'c4',incomingText:'8'}));assert.equal(blocked.reason,'conversation_blocked');
 assert.equal((await session(chatA)).state.nodeId,'main');assert.equal((await data(await request('/history'))).items.find(item=>item.id===pending.claimId).status,'uncertain');
 await data(await request('/conversations/reset','POST',{lineId:'line0',contactKey:pending.contactKey}));assert.equal((await session(chatA)).pending,false);
});
test('flow node media is validated and protected from deletion by both configuration checks',async()=>{
 const state=await setupFlow(),file={id:'f'.repeat(32),name:'Video.mp4',type:'video/mp4',size:10,sha256:'a'.repeat(64)};
 state.bot.flows[0].nodes[0].media=[file];assert.equal((await request('','PUT',state)).status,400);
 await DB.prepare("INSERT INTO outreach_media(id,name,type,size,sha256,state,created) VALUES(?,?,?,?,?,'ready',1)").bind(file.id,file.name,file.type,file.size,file.sha256).run();await data(await request('','PUT',state));
 const response=await mf.dispatchFetch(origin+'/api/outreach/media/'+file.id,{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Nexo-Client':'extension'},body:'{}'});assert.equal(response.status,409);
});

test('unmatched incoming messages allocate no conversations; expired flow data is cleared without removing uncertain blocks',async()=>{
 await setup();const fields=await lease();await data(await request('/bot/claim','POST',{...fields,chatId:chatA,incomingId:'unmatched',incomingText:'unrecognized'}));assert.equal((await data(await request('/conversations'))).items.length,0);
 const state=await data(await request());state.bot.flows=[menuFlow()];state.bot.defaultFlowId='sales';state.bot.conversationTtlMinutes=1;await data(await request('','PUT',state));
 const first=await step(fields,chatA,'ttl1','comprar');await result(first);const choice=await step(fields,chatA,'ttl2','8');await result(choice);const name=await step(fields,chatA,'ttl3','Antonella');await result(name);const uncertain=await step(fields,chatA,'ttl4','antonella@example.test');await result(uncertain,'uncertain');
 await DB.prepare('UPDATE engagement_conversations SET expires=0 WHERE chat_id=?').bind(chatA).run();const privateSession=await session(chatA);assert.equal(privateSession.state,null);assert.equal(privateSession.blocked,true);assert.equal((await data(await request('/bot/claim','POST',{...fields,chatId:chatA,incomingId:'ttl5',incomingText:'comprar'}))).reason,'conversation_blocked');
});

test('keyword-only flows restart after end and handoff without a default flow or menu trigger',async()=>{
 const state=await setupFlow();delete state.bot.defaultFlowId;await data(await request('','PUT',state));const fields=await lease();
 for(const [chatId,answers,restartText] of [[chatA,['1'],'menú'],[chatB,['8','Antonella','antonella@example.test'],'0']]){
  let count=0,grant=await step(fields,chatId,chatId+'_restart_'+count++,'comprar');await result(grant);
  for(const answer of answers){grant=await step(fields,chatId,chatId+'_restart_'+count++,answer);await result(grant);}
  assert.equal((await session(chatId)).state.ended,true);
  grant=await step(fields,chatId,chatId+'_restart_'+count++,restartText);assert.match(grant.reply.text,/8\. Asesoría/);await result(grant);assert.equal((await session(chatId)).state.nodeId,'main');
 }
 const unmatched=await data(await request('/bot/claim','POST',{...fields,chatId:'wa:unknown-single-peer',incomingId:'no_match_fixture',incomingText:'sin coincidencia'}));assert.equal(unmatched.reason,'no_match');
});
