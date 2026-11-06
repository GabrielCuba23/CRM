import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngagementRuntime,personalizeRuntimeReply} from '../extension/engagement-runtime.mjs';
function fixture({initialEpoch=0}={}){
 const localData={},sessionData={},calls=[],origin='https://crm.example';let auth={token:'synthetic'},epoch=initialEpoch,active=true,snapshot=[],context={chatId:'wa:fixture@lid',phone:'51912345678',name:'Ana'};
 const config={lines:[{id:'one',enabled:true,allowBackground:true}],bot:{enabled:true,rules:[{id:'hi',enabled:true,match:'contains',keywords:['hola'],text:'Hola {nombre}',media:[]}]}};
 const area=data=>({async get(key){return{[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}});
 const seen=new Set();let runtime;
 const dependencies={local:area(localData),session:area(sessionData),getOrigin:async()=>origin,getSession:async()=>auth,getTab:async()=>({id:1,windowId:1,url:'https://web.whatsapp.com/'}),activeTab:async()=>active,epoch:()=>epoch,mediaFiles:async()=>[],
  request:async(o,path,method,body)=>{calls.push({path,body});if(path==='/api/engagement')return structuredClone(config);if(path.endsWith('/lease'))return{leaseToken:'a'.repeat(64),expiresAt:Date.now()/1000+120,config};if(path.endsWith('/heartbeat'))return{expiresAt:Date.now()/1000+120,config};if(path.endsWith('/claim')){if(seen.has(body.incomingId))return{claimed:false};seen.add(body.incomingId);return{claimed:true,claimId:'claim',claimToken:'b'.repeat(64),rule:config.bot.rules[0]};}if(path.endsWith('/permit'))return{allowed:config.bot.enabled};return{ok:true};},
  sendContent:async(tab,o,action,input)=>{calls.push({action,input});if(action==='botSnapshot'){const messages=snapshot;snapshot=[];return{context:{...context},messages};}if(action==='campaignSend'){const grant=await runtime.permit({tab:{id:1}},input);return grant.allowed?{status:'sent_observed',evidence:'Synthetic'}:{status:'failed',error:'Denied'};}return{started:true};}
 };
 runtime=createEngagementRuntime(dependencies);
 return{get runtime(){return runtime;},restart:()=>{runtime=createEngagementRuntime(dependencies);},context:value=>{context={...value};},calls,config,sessionData,start:allowBackground=>runtime.start({origin,windowId:1,tabId:1,lineId:'one',allowBackground}),tick:()=>runtime.tick({tab:{id:1}},{runId:sessionData.engagementRuntime.runId}),incoming:id=>snapshot.push({id,phone:'51912345678',chatId:'wa:fixture@lid',body:'Hola'}),epoch:()=>epoch++,active:v=>active=v,auth:v=>auth=v,origin};
}
test('explicit activation reserves one line, duplicate incoming message is not sent twice',async()=>{
 const f=fixture();await f.start(false);f.incoming('incoming-one');await f.tick();f.incoming('incoming-one');await f.tick();assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,1);assert.equal(f.calls.find(c=>c.action==='campaignSend').input.text,'Hola Ana');assert.ok(f.calls.findIndex(c=>c.path?.endsWith('/claim'))<f.calls.findIndex(c=>c.action==='campaignSend'));
 await f.runtime.stop(f.origin);f.incoming('after-stop');await f.tick();assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,1);
});
test('background work needs explicit activation and foreground run halts when WhatsApp loses focus',async()=>{
 const f=fixture();await f.start(false);f.active(false);f.incoming('inactive');await f.tick();assert.equal(f.sessionData.engagementRuntime.active,false);assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,0);
 const b=fixture();await b.start(true);b.active(false);b.incoming('background');await b.tick();assert.equal(b.calls.filter(c=>c.action==='campaignSend').length,1);
});
test('logout epoch and vanished session revoke sending immediately',async()=>{
 for(const revoke of [f=>f.epoch(),f=>f.auth(null)]){const f=fixture();await f.start(true);revoke(f);f.incoming('revoked');await f.tick();assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,0);assert.equal(f.sessionData.engagementRuntime.active,false);}
});
test('five separate profiles have independent active runtimes with no credential in public status',async()=>{
 const profiles=Array.from({length:5},fixture);await Promise.all(profiles.map(f=>f.start(true)));const statuses=await Promise.all(profiles.map(f=>f.runtime.status(f.origin)));assert.equal(statuses.filter(x=>x.running).length,5);assert.ok(statuses.every(x=>!JSON.stringify(x).includes('synthetic')));
 assert.equal(personalizeRuntimeReply('{nombre} {negocio} {servicio} {contrasena}',{name:'Ana',business:'Nexo',service:'MAX'}),'Ana Nexo MAX {contrasena}');
});
test('recreated worker retains an armed runtime when the trusted authentication epoch is restored',async()=>{
 const f=fixture({initialEpoch:1});await f.start(true);f.restart();assert.equal((await f.runtime.status(f.origin)).running,true);
 f.incoming('after-restart');await f.tick();assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,1);
 f.epoch();f.restart();f.incoming('after-logout');await f.tick();assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,1);assert.equal(f.sessionData.engagementRuntime.active,false);
});
test('unidentified phone and group state are actionable diagnostics rather than silent active states',async()=>{
 const f=fixture();await f.start(true);f.context({chatId:'wa:fixture@lid',phone:'',name:'Ana'});await f.tick();let status=await f.runtime.status(f.origin);assert.equal(status.running,true);assert.equal(status.attention,'phone');assert.match(status.lastStatus,/vincula su ficha/);assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,0);
 f.context({chatId:'wa:group@g.us',phone:'',name:'Grupo',isGroup:true});await f.tick();status=await f.runtime.status(f.origin);assert.equal(status.attention,'group');assert.match(status.lastStatus,/no responde a grupos/);
 f.context({chatId:'wa:fixture@lid',phone:'51912345678',name:'Ana'});f.incoming('identified');await f.tick();status=await f.runtime.status(f.origin);assert.equal(status.attention,'');assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,1);
});
