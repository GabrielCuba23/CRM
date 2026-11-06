import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import * as policy from '../extension/policy.mjs';

// Browser-owned metadata, Chrome IPC and HTTP are synthetic. This fixture runs
// the actual background router and never connects to WhatsApp or a real CRM.
const id='a'.repeat(32),origin='https://crm.example',ext=`chrome-extension://${id}/`;
const panelInstance='0123456789abcdef0123456789abcdef',panelUrl=ext+'app/index.html?panel=1&panelInstance='+panelInstance;
const native={id,url:ext+'app/index.html?panel=1'},phone='51912345678';
async function fixture(){
  const local={crmOrigin:origin},session={['nativeSession:'+origin]:{origin,token:'synthetic_session_'+'x'.repeat(32),expiresAt:Date.now()/1000+3600}};
  const calls=[],tabs=new Map([[11,{id:11,windowId:1,active:true,url:policy.WA_ORIGIN+'/',status:'complete'}],[12,{id:12,windowId:1,active:false,url:'https://example.test/'}]]);
  let contexts=[{contextId:'panel',contextType:'SIDE_PANEL',documentUrl:panelUrl,documentId:'doc',windowId:-1,tabId:-1}],listener,beforeStorage,beforeContext,beforeFetch;
  const peer={name:'Persona sintética',phone,phoneSource:'visible',chatId:'wa:synthetic@lid'};
  const area=values=>({async get(key){await beforeStorage?.(key);return{[key]:structuredClone(values[key])};},async set(update){Object.assign(values,structuredClone(update));},async remove(key){delete values[key];},async setAccessLevel(){}});
  const chrome={runtime:{id,getURL:path=>ext+path,onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}},async getContexts(filter={}){return contexts.filter(c=>(!filter.contextIds||filter.contextIds.includes(c.contextId))&&(!filter.contextTypes||filter.contextTypes.includes(c.contextType)));},async sendMessage(){},async openOptionsPage(){}},
    storage:{local:area(local),session:area(session)},permissions:{async contains(){return true;}},windows:{async get(windowId){return{id:windowId,focused:true};}},
    tabs:{onUpdated:{addListener(){}},onActivated:{addListener(){}},onRemoved:{addListener(){}},async get(tabId){return{...tabs.get(tabId)};},async query(query){return[...tabs.values()].filter(t=>(!query.active||t.active)&&(query.windowId===undefined||t.windowId===query.windowId)&&(!query.url||t.url.startsWith(query.url.replace('*',''))));},async update(tabId,update){Object.assign(tabs.get(tabId),update);calls.push({type:'navigate',tabId,update});return{...tabs.get(tabId)};},async sendMessage(tabId,message){calls.push({type:'adapter',tabId,message:structuredClone(message)});if(message.action==='context'){await beforeContext?.();return{ok:true,result:{...peer}};}if(message.action==='campaignSend')return{ok:true,result:{status:'sent_observed',evidence:'Synthetic observation'}};if(message.action==='exportContacts')return{ok:true,result:{contacts:[{name:'Synthetic',phone}],incomplete:0}};return{ok:true,result:{ready:true}};}},
    action:{onClicked:{addListener(){}}},sidePanel:{async setPanelBehavior(){}},scripting:{async executeScript(){}}};
  const fetch=async(url,input)=>{calls.push({type:'fetch',url,input});const custom=await beforeFetch?.(url,input);if(custom)return custom;if(new URL(url).pathname==='/api/auth/status')return Response.json({authProvider:'password',configured:true});return Response.json({ok:true});};
  const source=await readFile(new URL('../extension/background.mjs',import.meta.url),'utf8');
  vm.runInNewContext(source.replace(/^import[^\n]+\n/,''),{chrome,fetch,...policy,URL,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,crypto:webcrypto,atob,btoa});
  const invoke=(message,sender=native)=>new Promise(resolve=>{listener({channel:'nexo',expectedOrigin:origin,panelContextId:'panel',panelWindowId:1,panelInstance,...message},sender,resolve);});
  const content=()=>({id,url:policy.WA_ORIGIN+'/',frameId:0,tab:{...tabs.get(11)}});
  const start=async(campaignId='campaign')=>{const r=await invoke({type:'campaign.start',input:{campaignId}});assert.equal(r.ok,true,r.error);return r.result.runId;};
  const select=runId=>invoke({type:'campaign.select',input:{runId,phone}});
  const permit=runId=>invoke({type:'campaign.permit',input:{runId,phone}},content());
  return{invoke,start,select,permit,content,calls,session,local,tabs,peer,contexts:value=>{contexts=value;},beforeStorage:value=>{beforeStorage=value;},beforeContext:value=>{beforeContext=value;},beforeFetch:value=>{beforeFetch=value;}};
}

test('campaign lifecycle serializes simultaneous starts and reuses only one exact campaign permit',async()=>{
 const f=await fixture();const results=await Promise.all(['one','two'].map(campaignId=>f.invoke({type:'campaign.start',input:{campaignId}})));
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>!r.ok).length,1);
 const run=f.session['outreachRun:1'];assert.equal(run.runId,results.find(r=>r.ok).result.runId);
 const same=await Promise.all([1,2].map(()=>f.invoke({type:'campaign.start',input:{campaignId:run.campaignId}})));assert.ok(same.every(r=>r.result.runId===run.runId));
 assert.equal(f.calls.filter(c=>c.type==='adapter'||c.type==='navigate').length,0,'start must never navigate or send');
});

test('campaign permit requires exact active WhatsApp, phone, live owning panel and session',async()=>{
 const f=await fixture(),runId=await f.start();assert.equal((await f.permit(runId)).result.allowed,false,'unselected run denied');assert.equal((await f.select(runId)).ok,true);assert.equal((await f.permit(runId)).result.allowed,true);
 assert.equal((await f.invoke({type:'campaign.permit',input:{runId,phone:'51911111111'}},f.content())).result.allowed,false);
 f.tabs.get(11).active=false;assert.equal((await f.permit(runId)).result.allowed,false);f.tabs.get(11).active=true;
 f.contexts([]);assert.equal((await f.permit(runId)).result.allowed,false);
});

test('another legitimate native panel cannot take or stop the owning panel run',async()=>{
 const f=await fixture(),runId=await f.start();f.contexts([{contextId:'panel',contextType:'SIDE_PANEL',documentUrl:panelUrl,windowId:-1},{contextId:'other-panel',contextType:'SIDE_PANEL',documentUrl:panelUrl,windowId:-1}]);
 for(const type of ['campaign.select','campaign.send','campaign.stop'])assert.equal((await f.invoke({type,panelContextId:'other-panel',input:{runId,phone,text:'Synthetic',media:[]}})).ok,false,type);
 assert.equal(f.session['outreachRun:1'].runId,runId);assert.equal((await f.select(runId)).ok,true);
});

test('stop remains available after session expiry and cannot be undone by in-flight recipient selection',async()=>{
 const f=await fixture(),runId=await f.start();let release,entered;const blocked=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);let held=false;
 f.beforeContext(async()=>{if(!held){held=true;entered();await gate;}});const pending=f.select(runId);await blocked;
 delete f.session['nativeSession:'+origin];assert.equal((await f.invoke({type:'campaign.stop',input:{runId}})).ok,true);release();assert.equal((await pending).ok,false);assert.equal(f.session['outreachRun:1'],undefined);
 assert.equal((await f.permit(runId)).result.allowed,false);
});

test('beginning logout invalidates campaign permit before network logout completes',async()=>{
 const f=await fixture(),runId=await f.start();assert.equal((await f.select(runId)).ok,true);let release,entered;const blocked=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 f.beforeFetch(async(url)=>{if(new URL(url).pathname==='/api/logout'){entered();await gate;}return undefined;});const pending=f.invoke({type:'crm.request',path:'/api/logout',method:'POST',body:'{}'});await blocked;
 assert.ok(f.session['nativeSession:'+origin],'network logout still pending');assert.equal((await f.permit(runId)).result.allowed,false);release();assert.equal((await pending).ok,true);
});

test('changing configured CRM invalidates an already selected campaign permit',async()=>{
 const f=await fixture(),runId=await f.start();await f.select(runId);f.local.crmOrigin='https://other-crm.example';assert.equal((await f.permit(runId)).result.allowed,false);
 assert.equal((await f.invoke({type:'campaign.send',input:{runId,phone,text:'Synthetic',media:[]}})).ok,false);
});

test('group or ambiguous context cannot be selected even with a matching phone',async()=>{
 for(const flag of ['isGroup','ambiguous']){const f=await fixture(),runId=await f.start();f.peer[flag]=true;assert.equal((await f.select(runId)).ok,false,flag);assert.equal(f.session['outreachRun:1'].phone,undefined);}
});

test('media passes only after authenticated metadata, exact chunks and SHA-256 verification',async()=>{
 const f=await fixture(),runId=await f.start();await f.select(runId);const bytes=Uint8Array.from([0,0,0,24,102,116,121,112,105,115,111,109]),media={id:'b'.repeat(32),name:'synthetic.mp4',type:'video/mp4',size:bytes.length,sha256:Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex')};
 f.beforeFetch(async(url,input)=>{assert.match(input.headers.Authorization,/^Bearer synthetic_session_/);const pathname=new URL(url).pathname;if(pathname.endsWith('/metadata'))return Response.json({media,chunkSize:524288,chunks:1});if(pathname.endsWith('/chunks/0'))return Response.json({part:0,data:Buffer.from(bytes).toString('base64')});});
 const sent=await f.invoke({type:'campaign.send',input:{runId,phone,text:'Synthetic video',media:[media]}});assert.equal(sent.ok,true,sent.error);assert.equal(sent.result.status,'sent_observed');const delivery=f.calls.find(c=>c.type==='adapter'&&c.message.action==='campaignSend');assert.equal(delivery.message.input.files[0].data,Buffer.from(bytes).toString('base64'));assert.equal(delivery.message.input.automatic,true);
 f.beforeFetch(async(url)=>new URL(url).pathname.endsWith('/metadata')?Response.json({media:{...media,sha256:'f'.repeat(64)},chunkSize:524288,chunks:1}):undefined);
 const before=f.calls.filter(c=>c.type==='adapter'&&c.message.action==='campaignSend').length;assert.equal((await f.invoke({type:'campaign.send',input:{runId,phone,text:'Changed',media:[media]}})).ok,false);assert.equal(f.calls.filter(c=>c.type==='adapter'&&c.message.action==='campaignSend').length,before);
});

test('media routes are narrow, bounded and method specific',()=>{
 const base='/api/outreach/media/'+ 'a'.repeat(32);
 for(const [path,method]of[['/api/outreach/media','GET'],['/api/outreach/media','POST'],[base+'/metadata','GET'],[base+'/chunks/0','GET'],[base+'/chunks/39','PUT'],[base+'/complete','POST'],[base,'DELETE']])assert.equal(policy.allowedApi(path,method).method,method);
 for(const [path,method]of[[base+'/chunks/0','DELETE'],[base+'/metadata','PUT'],[base+'/complete','GET'],[base+'/../../workspace','GET'],[base+'?token=abc','GET']])assert.throws(()=>policy.allowedApi(path,method));
 assert.throws(()=>policy.allowedApi(base+'/chunks/0','PUT','a'.repeat(1100001)));
});
