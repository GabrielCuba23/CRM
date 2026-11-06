const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {createRequire}=require('node:module');
const {chromium}=createRequire('/workspace/work/cloud-tools/package.json')('playwright');
const root=path.resolve(__dirname,'..');
// Real shared UI and configuration validator; synthetic private API/native
// runtime only. No WhatsApp account or real message is accessed.
const html=`<!doctype html><meta charset="utf-8"><button id="compact-tab-chat" onclick="window.__chatClicked=true">Chat actual</button><section id="fixture"></section><script type="module">
import {initializeEngagement} from '/engagement-ui.mjs';import {emptyEngagement,cleanEngagementConfig} from '/engagement.mjs';
window.__config=emptyEngagement();window.__runtime={running:false,selectedLineId:'',lastStatus:''};window.__calls=[];
window.__ui=initializeEngagement({root:document.querySelector('#fixture'),transport:{
 async fetch(path,options={}){__calls.push({path,method:options.method||'GET'});if(path==='/api/engagement'&&options.method==='PUT'){const next=cleanEngagementConfig(JSON.parse(options.body));if(next.revision!==__config.revision)return Response.json({error:'Conflicto'},{status:409});next.revision++;__config=next;}return Response.json(path.endsWith('/history')?{items:[]}:structuredClone(__config));},
 async getEngagementRuntime(){return structuredClone(__runtime);},async selectEngagementLine({lineId}){__runtime={running:false,selectedLineId:lineId};return structuredClone(__runtime);},async startChatbot(){__runtime={...__runtime,running:true,lastStatus:'Esperando mensajes nuevos en el chat abierto.'};return structuredClone(__runtime);},async stopChatbot(){__runtime={...__runtime,running:false,lastError:'',lastStatus:'Chatbot detenido.'};return structuredClone(__runtime);}
}});window.__ready=true;</script>`;
(async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://fixture').pathname;if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:420,height:900}});page.on('dialog',d=>d.accept());const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready);await page.locator('#engagement-new-line').waitFor();
  assert.equal(await page.locator('#engagement-selected-line').count(),0,'empty line registry must not show a dead selector');assert.equal(await page.locator('#engagement-start,#engagement-stop').count(),0);await page.locator('#engagement-configure').waitFor();await page.locator('#engagement-first-response').waitFor();
  await page.screenshot({path:path.join(root,'work/chatbot-empty-setup.png'),fullPage:true});
  await page.locator('#engagement-new-line').click();await page.locator('.engagement-dialog [name=name]').fill('Mi WhatsApp');await page.locator('.engagement-dialog [name=phone]').fill('977777777');await page.locator('.engagement-dialog button[type=submit]').click();await page.locator('.engagement-dialog').waitFor({state:'hidden'});
  const lineId=await page.evaluate(()=>__config.lines[0].id);assert.equal(await page.locator('#engagement-selected-line').inputValue(),lineId,'sole line is selected in the picker without autoarming');assert.equal(await page.evaluate(()=>__runtime.selectedLineId),'');await page.locator('#engagement-use-line').click();await page.waitForFunction(()=>!!__runtime.selectedLineId);
  await page.getByRole('button',{name:'Crear respuesta',exact:true}).click();await page.locator('.engagement-dialog [name=name]').fill('Saludo');await page.locator('.engagement-dialog [name=keywords]').fill('hola');await page.locator('.engagement-dialog [name=text]').fill('Hola {nombre}');await page.locator('.engagement-dialog button[type=submit]').click();await page.locator('.engagement-dialog').waitFor({state:'hidden'});
  await page.locator('#engagement-tab-line').click();await page.getByRole('button',{name:'Activar respuestas',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#engagement-start')?.disabled===false);assert.equal(await page.evaluate(()=>__runtime.running),false,'configuration never starts the bot');
  await page.locator('#engagement-start').click();await page.locator('#engagement-stop').waitFor();assert.equal(await page.locator('#engagement-start').count(),0);console.log('PASS empty setup has direct configuration actions, sole-line selection, explicit enable and explicit start');
  await page.evaluate(()=>{__runtime={...__runtime,running:false,lastStatus:'Chatbot pausado.',lastError:'La sesión del chatbot terminó.'};});await page.clock.fastForward(5100);await page.getByText('La sesión del chatbot terminó.',{exact:true}).waitFor();assert.equal(await page.locator('#engagement-stop').count(),0);assert.equal(await page.locator('#engagement-start').isEnabled(),true);
  await page.evaluate(()=>{__runtime={...__runtime,running:true,lastError:'',attention:'phone',lastStatus:'WhatsApp oculta el teléfono.'};});await page.clock.fastForward(5100);await page.locator('#engagement-identify-contact').click();assert.equal(await page.evaluate(()=>__chatClicked),true);console.log('PASS runtime pause is refreshed and missing-phone state links to Chat actual');
  await page.locator('#engagement-configure').click();await page.locator('#engagement-cooldown').fill('17');const calls=await page.evaluate(()=>__calls.length);await page.clock.fastForward(11000);assert.equal(await page.evaluate(()=>__calls.length),calls,'polling must not replace edited configuration');assert.equal(await page.locator('#engagement-cooldown').inputValue(),'17');
  await page.evaluate(()=>__ui.destroy());await page.clock.fastForward(11000);assert.equal(await page.evaluate(()=>__calls.length),calls);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);console.log('PASS dirty forms survive polling, destroy clears polling and420px layout remains bounded');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
