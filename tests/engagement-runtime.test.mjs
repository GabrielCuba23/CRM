import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngagementRuntime,personalizeRuntimeReply} from '../extension/engagement-runtime.mjs';
function fixture({initialEpoch=0}={}){
 const localData={},sessionData={},calls=[],origin='https://crm.example';let auth={token:'synthetic'},epoch=initialEpoch,active=true,snapshot=[],context={chatId:'wa:fixture@lid',phone:'51912345678',name:'Ana'},serverReply=null,nextClaimGate=null;
 const config={lines:[{id:'one',enabled:true,allowBackground:true}],bot:{enabled:true,rules:[{id:'hi',enabled:true,match:'contains',keywords:['hola'],text:'Hola {nombre}',media:[]}]}};
 const area=data=>({async get(key){return{[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}});
 const seen=new Set();let runtime;
 const dependencies={local:area(localData),session:area(sessionData),getOrigin:async()=>origin,getSession:async()=>auth,getTab:async()=>({id:1,windowId:1,url:'https://web.whatsapp.com/'}),activeTab:async()=>active,epoch:()=>epoch,mediaFiles:async()=>[],
  request:async(o,path,method,body)=>{calls.push({path,body});if(path==='/api/engagement')return structuredClone(config);if(path.endsWith('/lease'))return{leaseToken:'a'.repeat(64),expiresAt:Date.now()/1000+120,config};if(path.endsWith('/heartbeat'))return{expiresAt:Date.now()/1000+120,config};if(path.endsWith('/claim')){if(seen.has(body.incomingId))return{claimed:false};seen.add(body.incomingId);const gate=nextClaimGate;nextClaimGate=null;if(gate){gate.enter();await gate.wait;}return{claimed:true,claimId:'claim',claimToken:'b'.repeat(64),rule:config.bot.rules[0],...(serverReply?{reply:structuredClone(serverReply)}:{})};}if(path.endsWith('/permit'))return{allowed:config.bot.enabled};return{ok:true};},
  sendContent:async(tab,o,action,input)=>{calls.push({action,input});if(action==='botSnapshot'){const messages=snapshot;snapshot=[];return{context:{...context},messages};}if(action==='campaignSend'){const grant=await runtime.permit({tab:{id:1}},input);return grant.allowed?{status:'sent_observed',evidence:'Synthetic'}:{status:'failed',error:'Denied'};}return{started:true};}
 };
 runtime=createEngagementRuntime(dependencies);
 return{get runtime(){return runtime;},restart:()=>{runtime=createEngagementRuntime(dependencies);},context:value=>{context={...value};},reply:value=>{serverReply=value;},holdNextClaim:()=>{let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),wait=new Promise(resolve=>{release=resolve;});nextClaimGate={enter,wait};return{entered,release};},calls,config,sessionData,start:allowBackground=>runtime.start({origin,windowId:1,tabId:1,lineId:'one',allowBackground}),tick:()=>runtime.tick({tab:{id:1}},{runId:sessionData.engagementRuntime.runId}),incoming:(id,fields={})=>snapshot.push({id,phone:context.phone||'',chatId:context.chatId,body:'Hola',...fields}),epoch:()=>epoch++,active:v=>active=v,auth:v=>auth=v,origin};
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
test('a stable opaque chat identity can reply without a public phone number',async()=>{
 const f=fixture();await f.start(true);f.context({chatId:'wa:opaque-contact-729@lid',phone:'',name:'Ana'});f.incoming('private-contact');await f.tick();
 const status=await f.runtime.status(f.origin),claim=f.calls.find(c=>c.path?.endsWith('/claim')),send=f.calls.find(c=>c.action==='campaignSend');
 assert.equal(status.running,true);assert.equal(status.attention,'');assert.equal(claim.body.phone,'');assert.equal(claim.body.chatId,'wa:opaque-contact-729@lid');assert.equal(send.input.phone,'');assert.equal(send.input.chatId,'wa:opaque-contact-729@lid');assert.equal(send.input.text,'Hola Ana');assert.equal(f.calls.find(c=>c.path?.endsWith('/result')).body.status,'sent_observed');
});
test('missing identity, a changing chat and a group cannot authorize a reply',async()=>{
 const f=fixture();await f.start(true);
 for(const [context,attention] of [[{phone:'',name:'Ana'},'chat'],[{chatId:'wa:fixture@lid',phone:'',name:'Ana',ambiguous:true},'changing'],[{chatId:'wa:group@g.us',phone:'',name:'Grupo',isGroup:true},'group']]){
  f.context(context);f.incoming('blocked-'+attention);await f.tick();const status=await f.runtime.status(f.origin);assert.equal(status.running,true);assert.equal(status.attention,attention);
 }
 assert.equal(f.calls.filter(c=>c.path?.endsWith('/claim')).length,0);assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,0);
 f.context({chatId:'wa:fixture@lid',phone:'',name:'Ana'});f.incoming('identified');await f.tick();assert.equal((await f.runtime.status(f.origin)).attention,'');assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,1);
});
test('flow continuation reaches the server without a local matching rule and uses its compiled reply',async()=>{
 const f=fixture();f.config.bot.rules=[];f.config.bot.flows=[{id:'sales',enabled:true}];f.reply({text:'8. Netflix\n¿Qué plan necesitas?',media:[]});await f.start(true);
 f.incoming('choice-eight',{body:'8'});await f.tick();f.reply({text:'Indica el correo para tu plan elegido.',media:[]});f.incoming('plan-choice',{body:'Premium'});await f.tick();
 const claims=f.calls.filter(c=>c.path?.endsWith('/claim')),sends=f.calls.filter(c=>c.action==='campaignSend');assert.equal(claims.length,2);assert.deepEqual(claims.map(c=>c.body.incomingText),['8','Premium']);assert.ok(claims.every(c=>!Object.hasOwn(c.body,'ruleId')));assert.deepEqual(sends.map(c=>c.input.text),['8. Netflix\n¿Qué plan necesitas?','Indica el correo para tu plan elegido.']);
});
test('the server reply takes precedence over a locally matching static rule',async()=>{
 const f=fixture();f.reply({text:'Respuesta del paso actual.',media:[]});await f.start(true);f.incoming('flow-over-rule');await f.tick();
 assert.equal(f.calls.find(c=>c.path?.endsWith('/claim')).body.ruleId,'hi');assert.equal(f.calls.find(c=>c.action==='campaignSend').input.text,'Respuesta del paso actual.');
});
test('changing background permission preserves the armed run and immediately permits an inactive tab',async()=>{
 const f=fixture();await f.start(false);const original=structuredClone(f.sessionData.engagementRuntime);
 const enabled=await f.runtime.setBackground({origin:f.origin,allowBackground:true});assert.equal(enabled.running,true);assert.equal(enabled.allowBackground,true);assert.equal(f.sessionData.engagementRuntime.runId,original.runId);assert.equal(f.sessionData.engagementRuntime.leaseToken,original.leaseToken);assert.equal(f.calls.filter(c=>c.action==='botStart').length,1);assert.equal(f.calls.filter(c=>c.path?.endsWith('/lease')).length,1);assert.deepEqual(f.calls.find(c=>c.action==='botSetBackground').input,{runId:original.runId,allowBackground:true});
 f.active(false);f.incoming('background-after-toggle');await f.tick();assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,1);
 f.active(true);const disabled=await f.runtime.setBackground({origin:f.origin,allowBackground:false});assert.equal(disabled.running,true);assert.equal(disabled.allowBackground,false);assert.equal(f.sessionData.engagementRuntime.runId,original.runId);assert.equal(f.calls.filter(c=>c.action==='botSetBackground').length,2);assert.equal(f.calls.filter(c=>c.action==='botStop').length,0);
 f.active(false);f.incoming('inactive-after-disable');await f.tick();assert.equal(f.sessionData.engagementRuntime.active,false);assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,1);
});
test('a tick arriving during an in-flight reply is drained and delivers its new message',async t=>{
 const f=fixture();await f.start(true);const gate=f.holdNextClaim();t.after(()=>gate.release());f.incoming('first-in-flight');const first=f.tick();await gate.entered;
 f.incoming('queued-next');const queued=await f.tick();assert.equal(queued.busy,true);assert.equal(f.calls.filter(c=>c.path?.endsWith('/claim')).length,1);gate.release();await first;
 assert.deepEqual(f.calls.filter(c=>c.path?.endsWith('/claim')).map(c=>c.body.incomingId),['first-in-flight','queued-next']);assert.equal(f.calls.filter(c=>c.action==='campaignSend').length,2);assert.equal(f.calls.filter(c=>c.path?.endsWith('/result')).length,2);assert.equal((await f.runtime.status(f.origin)).running,true);
});
test('enabling background during an in-flight claim applies to that reply without pausing the armed run',async t=>{
 const f=fixture();f.config.lines[0].allowBackground=false;await f.start(false);const originalRunId=f.sessionData.engagementRuntime.runId,gate=f.holdNextClaim();t.after(()=>gate.release());
 f.incoming('pending-background-toggle');const pending=f.tick();await gate.entered;
 f.config.lines[0].allowBackground=true;await f.runtime.setBackground({origin:f.origin,allowBackground:true});f.active(false);gate.release();await pending;
 const sends=f.calls.filter(c=>c.action==='campaignSend'),results=f.calls.filter(c=>c.path?.endsWith('/result')),status=await f.runtime.status(f.origin);
 assert.equal(sends.length,1);assert.equal(sends[0].input.allowBackground,true);assert.equal(results.length,1);assert.equal(results[0].body.status,'sent_observed');assert.equal(status.running,true);assert.equal(status.allowBackground,true);assert.equal(status.lastError,'');assert.equal(f.sessionData.engagementRuntime.runId,originalRunId);assert.equal(f.calls.filter(c=>c.action==='botStop').length,0);
});
