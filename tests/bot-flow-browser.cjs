const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {createRequire}=require('node:module');
const {chromium}=createRequire('/workspace/work/cloud-tools/package.json')('playwright');
const root=path.resolve(__dirname,'..');
// Real editor, config validator and flow engine with a synthetic private API.
// No WhatsApp session, message, line lease or external service is accessed.
const html=`<!doctype html><meta charset="utf-8"><section id="fixture"></section><script type="module">
import {initializeEngagement} from '/engagement-ui.mjs';import {emptyEngagement,cleanEngagementConfig} from '/engagement.mjs';
window.__config=emptyEngagement();__config.lines=[{id:'line-1',name:'Ventas',phone:'51977777777',enabled:true,allowBackground:false}];__config.bot.enabled=true;
window.__runtime={running:true,selectedLineId:'line-1',allowBackground:false,lastStatus:'Esperando mensajes nuevos; el teléfono del chat está oculto.',attention:'phone'};
window.__calls=[];window.__conversationReset=false;window.__failBackground=false;
window.__ui=initializeEngagement({root:document.querySelector('#fixture'),transport:{
 async fetch(path,options={}){__calls.push({path,method:options.method||'GET'});
 if(path==='/api/engagement/history')return Response.json({items:[]});
 if(path==='/api/engagement/conversations')return Response.json({items:__conversationReset?[]:[{lineId:'line-1',contactKey:'chat:opaque-contact@lid',chatId:'opaque-contact@lid',phone:'',state:{flowId:__config.bot.defaultFlowId,nodeId:'soporte-detalle',variables:{servicio:'Netflix'},waiting:true,ended:false,handoff:false},revision:2,blocked:true,pending:false}]});
 if(path==='/api/engagement/conversations/reset'){__conversationReset=true;return Response.json({ok:true});}
 if(path==='/api/engagement'&&options.method==='PUT'){const next=cleanEngagementConfig(JSON.parse(options.body));if(next.revision!==__config.revision)return Response.json({error:'Conflicto'},{status:409});next.revision++;__config=next;}
 return Response.json(structuredClone(__config));},
 async getEngagementRuntime(){return structuredClone(__runtime);},
 async setChatbotBackground({allowBackground}){__calls.push({native:'background',allowBackground});if(__failBackground)throw Error('No se pudo guardar segundo plano.');__runtime.allowBackground=allowBackground;return structuredClone(__runtime);},
 async startChatbot(){__calls.push({native:'start'});__runtime.running=true;return structuredClone(__runtime);},
 async stopChatbot(){__calls.push({native:'stop'});__runtime.running=false;return structuredClone(__runtime);}
}});window.__ready=true;</script>`;
(async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://fixture').pathname;if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:420,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 try{
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready);await page.locator('#engagement-background').waitFor();
  assert.equal(await page.locator('#engagement-background').isEnabled(),true,'background permission can change while running even if the line was not enabled for background');
  await page.locator('#engagement-background').check();await page.waitForFunction(()=>__config.lines[0].allowBackground&&__runtime.allowBackground);
  assert.equal(await page.locator('#engagement-background').isChecked(),true);assert.equal(await page.locator('#engagement-background').isEnabled(),true);
  assert.deepEqual(await page.evaluate(()=>__calls.filter(call=>call.native).map(call=>call.native)),['background'],'background changes do not stop or re-arm the running bot');
  console.log('PASS active bot can enable background directly while its open contact has a hidden phone');
  await page.evaluate(()=>__failBackground=true);await page.locator('#engagement-background').uncheck();await page.getByText('No se pudo guardar segundo plano.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>__config.lines[0].allowBackground),true,'failed runtime update rolls back the line allowance');assert.equal(await page.locator('#engagement-background').isChecked(),true);await page.evaluate(()=>__failBackground=false);
  console.log('PASS failed background update restores its saved setting and shows a useful error');
  await page.locator('#engagement-tab-flows').click();await page.locator('#bot-flow-new').waitFor();await page.locator('#bot-flow-example').click();
  assert.equal(await page.locator('#bot-flow-options .bot-flow-option').count(),8);assert.equal(await page.locator('#bot-flow-enabled').isChecked(),false,'example remains a disabled draft');
  assert.equal(await page.evaluate(()=>__config.bot.flows?.length||0),0,'an example does not save itself');
  await page.locator('#bot-flow-name').fill('Atención de ventas');await page.locator('#bot-flow-enabled').check();await page.locator('#bot-flow-default').check();
  await page.locator('#bot-flow-options .bot-flow-option').nth(7).locator('[name=optionLabel]').fill('Necesito soporte');
  await page.locator('#bot-flow-preview-start').click();await page.getByText('8. Necesito soporte',{exact:false}).waitFor();
  async function answer(text){await page.locator('#bot-flow-preview-answer').fill(text);await page.locator('#bot-flow-preview-send').click();}
  await answer('8');await page.getByText('¿Sobre qué servicio necesitas ayuda?',{exact:true}).waitFor();
  await answer('Netflix');await page.getByText('Gracias. Describe qué ocurre con Netflix.',{exact:true}).waitFor();
  await answer('No puedo ingresar');await page.getByText('Tu consulta es sobre Netflix:',{exact:false}).waitFor();assert.match(await page.locator('.bot-flow-transcript').innerText(),/No puedo ingresar/);
  assert.equal(await page.locator('#bot-flow-preview-answer').count(),0,'the preview stops at the final response');
  assert.equal(await page.evaluate(()=>__calls.filter(call=>call.native==='start').length),0,'the simulator never starts or sends WhatsApp messages');
  console.log('PASS numbered menu 1–8 branches into sequential questions and remembers answers in the local preview');
  await page.locator('#bot-flow-save').click();await page.locator('#bot-flow-new').waitFor();
  const saved=await page.evaluate(()=>structuredClone(__config.bot));assert.equal(saved.flows.length,1);assert.equal(saved.flows[0].name,'Atención de ventas');assert.equal(saved.flows[0].enabled,true);assert.equal(saved.defaultFlowId,saved.flows[0].id);assert.equal(saved.flows[0].nodes[0].options.length,8);assert.equal(saved.flows[0].nodes[0].options[7].label,'Necesito soporte');assert.equal(saved.rules.length,0);
  await page.locator('#engagement-tab-line').click();await page.evaluate(()=>__runtime.running=false);await page.locator('#engagement-refresh').click();assert.equal(await page.locator('#engagement-start').isEnabled(),true,'an enabled flow supports activation without a legacy rule');
  console.log('PASS flows save through the shared CAS config and count as ready responses without legacy rules');
  await page.locator('#engagement-tab-history').click();await page.getByText('Conversaciones por pasos',{exact:true}).waitFor();await page.getByText('Requiere revisar el último envío en WhatsApp.',{exact:true}).waitFor();await page.getByRole('button',{name:'Reiniciar conversación',exact:true}).click();await page.waitForFunction(()=>__conversationReset);
  assert.equal(await page.getByText('Conversaciones por pasos',{exact:true}).count(),0);console.log('PASS activity exposes the current conversation and resets a blocked flow without sending');
  await page.locator('#engagement-tab-flows').click();await page.getByRole('button',{name:'Editar',exact:true}).click();await page.locator('#bot-flow-name').fill('Borrador que sigue abierto');const callCount=await page.evaluate(()=>__calls.length);await page.clock.fastForward(11000);assert.equal(await page.evaluate(()=>__calls.length),callCount);assert.equal(await page.locator('#bot-flow-name').inputValue(),'Borrador que sigue abierto');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.evaluate(()=>__ui.destroy());console.log('PASS flow drafts survive polling, editor fits a 420px sidebar, and no browser exceptions occur');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
