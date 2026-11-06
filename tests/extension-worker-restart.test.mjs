import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import * as policy from '../extension/policy.mjs';

// Restart the actual MV3 module with the same browser-owned session store.
// Chrome boundaries and HTTP are synthetic; no real account/message is used.
const source=await readFile(new URL('../extension/background.mjs',import.meta.url),'utf8');
const id='a'.repeat(32),origin='https://crm.example',ext=`chrome-extension://${id}/`;
const panelInstance='b'.repeat(32),panelUrl=ext+'app/index.html?panel=1&panelInstance='+panelInstance;
const phone='51912345678',token='c'.repeat(64),native={id,url:ext+'app/index.html?panel=1'};
async function fixture(){
 const local={crmOrigin:origin},session={},calls=[];let listener,holdLogout,logoutStarted;
 const config={revision:1,lines:[{id:'one',name:'Línea sintética',phone,enabled:true,allowBackground:true}],bot:{enabled:true,rules:[{id:'hi',name:'Hola',enabled:true,match:'contains',keywords:['hola'],text:'Hola',media:[]}]}};
 const tab={id:11,windowId:1,active:true,url:policy.WA_ORIGIN+'/',status:'complete'};
 const area=values=>({async get(key){return{[key]:structuredClone(values[key])};},async set(value){Object.assign(values,structuredClone(value));},async remove(key){delete values[key];},async setAccessLevel(){}});
 const chrome={runtime:{id,getURL:path=>ext+path,onMessage:{addListener(fn){listener=fn;}},onInstalled:{addListener(){}},async getContexts(){return[{contextType:'SIDE_PANEL',contextId:'panel',documentId:'doc',documentUrl:panelUrl,windowId:-1,tabId:-1}];},async sendMessage(){}},storage:{local:area(local),session:area(session)},permissions:{async contains(){return true;}},windows:{async get(){return{id:1,focused:true};}},
  tabs:{onUpdated:{addListener(){}},onActivated:{addListener(){}},onRemoved:{addListener(){}},async get(){return{...tab};},async query(){return[{...tab}];},async sendMessage(tabId,message){calls.push(message);if(message.action==='context')return{ok:true,result:{name:'Persona',phone,chatId:'wa:fixture@lid',phoneSource:'visible'}};return{ok:true,result:{started:true}};}},action:{onClicked:{addListener(){}}},sidePanel:{async setPanelBehavior(){}},scripting:{async executeScript(){}}};
 const fetch=async(url,input)=>{const path=new URL(url).pathname;
  if(path==='/api/auth/status')return Response.json({authProvider:'password',configured:true});
  if(path==='/api/login')return Response.json({token,email:'owner@example.test',csrf:'fixture',mode:'server',authProvider:'password',expiresAt:Date.now()/1000+3600});
  if(path==='/api/logout'){logoutStarted?.();await holdLogout;return Response.json({ok:true});}
  if(path==='/api/engagement')return Response.json(config);
  if(path==='/api/engagement/lease')return Response.json({leaseToken:'d'.repeat(64),expiresAt:Date.now()/1000+120,config});
  return Response.json({ok:true});
 };
 const restart=()=>vm.runInNewContext(source.replace(/^import[^\n]+\n/,''),{chrome,fetch,...policy,URL,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,crypto:webcrypto,atob,btoa});
 restart();
 const invoke=(message,sender=native)=>new Promise(resolve=>listener({channel:'nexo',expectedOrigin:origin,panelContextId:'panel',panelWindowId:1,panelInstance,...message},sender,resolve));
 const login=()=>invoke({type:'crm.login',input:{email:'owner@example.test',password:'Synthetic only 123!'}});
 const content={id,url:tab.url,frameId:0,tab};
 return{invoke,login,restart,session,calls,content,holdLogout:()=>{let release;holdLogout=new Promise(r=>release=r);const entered=new Promise(r=>logoutStarted=r);return{entered,release};}};
}
test('MV3 worker recreation preserves campaign session generation and exact send permit',async()=>{
 const f=await fixture();assert.equal((await f.login()).ok,true);assert.equal(f.session.authenticationEpoch,1);
 const run=(await f.invoke({type:'campaign.start',input:{campaignId:'campaign'}})).result;
 assert.equal((await f.invoke({type:'campaign.select',input:{runId:run.runId,phone}})).ok,true);
 f.restart();const permit=await f.invoke({type:'campaign.permit',input:{runId:run.runId,phone}},f.content);
 assert.equal(permit.result.allowed,true,'normal Chrome worker shutdown cannot invalidate a live browser session');
});
test('logout persists immediate revocation even if the worker restarts before HTTP logout finishes',async()=>{
 const f=await fixture();await f.login();const run=(await f.invoke({type:'campaign.start',input:{campaignId:'campaign'}})).result;await f.invoke({type:'campaign.select',input:{runId:run.runId,phone}});
 const gate=f.holdLogout(),pending=f.invoke({type:'crm.request',path:'/api/logout',method:'POST',body:'{}'});await gate.entered;
 assert.equal(f.session.authenticationEpoch,2);f.restart();assert.equal((await f.invoke({type:'campaign.permit',input:{runId:run.runId,phone}},f.content)).result.allowed,false);gate.release();await pending;
});
test('MV3 worker recreation keeps an explicitly armed chatbot active without replaying messages',async()=>{
 const f=await fixture();await f.login();const started=await f.invoke({type:'engagement.start',input:{lineId:'one',allowBackground:true}});assert.equal(started.ok,true,started.error);assert.equal(started.result.running,true);
 const runId=f.session.engagementRuntime.runId;f.restart();const status=await f.invoke({type:'engagement.status'});assert.equal(status.ok,true,status.error);assert.equal(status.result.running,true);assert.equal(f.session.engagementRuntime.runId,runId);assert.equal(f.calls.filter(x=>x.action==='campaignSend').length,0);
});
