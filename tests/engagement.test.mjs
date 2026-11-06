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
async function setup(){await DB.batch([DB.prepare('DELETE FROM engagement_bot_attempts'),DB.prepare('DELETE FROM engagement_leases'),DB.prepare('DELETE FROM engagement_config')]);return data(await request('','PUT',configured()));}
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
