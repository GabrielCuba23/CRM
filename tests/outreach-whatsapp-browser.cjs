const assert = require('node:assert/strict');
const path = require('node:path');
const {createRequire} = require('node:module');
const {chromium} = createRequire('/workspace/work/cloud-tools/package.json')('playwright');
// Actual content adapter against synthetic DOM only. No WhatsApp account or
// customer is contacted; browser file inputs and contenteditables are real.
const adapter = path.resolve(__dirname, '../extension/whatsapp.js');
const runId = 'a'.repeat(32), phone = '51912345678';
const html = `<!doctype html><meta charset="utf-8"><div id="app">
<aside id="pane-side"><button>Archivados</button><div role="listitem" data-id="51999888777@c.us"><span title="Ana de prueba">Ana de prueba</span></div><div role="listitem"><span title="Sin teléfono">Sin teléfono</span></div><div role="listitem" hidden><span title="+51 911 222 333">Oculta</span></div></aside>
<main id="main"><header><span title="+51 912 345 678">+51 912 345 678</span></header><section id="history"><div data-id="false_51912345678@c.us_initial">Entrada sintética</div></section>
<input id="media" type="file" accept="image/*,video/mp4,video/webm" multiple>
<footer><div contenteditable="true" role="textbox"></div><button aria-label="Enviar">Enviar</button></footer></main></div>`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 async function fixture(){
  await page.goto('about:blank');await page.setContent(html);
  await page.evaluate(()=>{
   window.__permit=true;window.__clicks=0;window.__afterClick='observed';window.__filePackets=[];
   window.chrome={runtime:{sendMessage:async()=>({ok:true,result:{allowed:window.__permit}})}};
   function sent(scope){
    __clicks++;
    if(__afterClick==='switch'){document.querySelector('#main header span').title='+51 987 654 321';return;}
    const bubble=document.createElement('div');bubble.dataset.id='true_51912345678@c.us_out'+__clicks;
    bubble.textContent=scope.querySelector('[contenteditable]')?.innerText||'';
    if(scope.querySelector('img,video'))bubble.append(document.createElement('img'));
    document.querySelector('#history').append(bubble);
    scope.querySelector('[contenteditable]').textContent='';
    if(scope.matches('[role=dialog]'))scope.remove();
   }
   document.querySelector('footer button').onclick=()=>sent(document.querySelector('footer'));
   document.querySelector('input[type=file]').onchange=event=>{
    __filePackets=[...event.target.files].map(file=>({name:file.name,type:file.type,size:file.size}));
    const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.dataset.testid='media-editor';
    dialog.innerHTML='<img alt="Vista sintética"><div contenteditable="true" role="textbox"></div><button aria-label="Enviar">Enviar</button>';
    document.body.append(dialog);dialog.querySelector('button').onclick=()=>sent(dialog);
   };
  });
  await page.addScriptTag({path:adapter});
 }
 const send=(changes={})=>page.evaluate(input=>__nexoWhatsAppAdapter.campaignSend(input),{runId,phone,text:'Hola de prueba\n\nTexto exacto',files:[],automatic:true,...changes});
 try{
  await fixture();let result=await send();assert.equal(result.status,'sent_observed');assert.equal(await page.evaluate(()=>__clicks),1);
  await fixture();result=await send({automatic:false});assert.equal(result.status,'prepared');assert.equal(await page.evaluate(()=>__clicks),0);
  assert.match(await page.locator('footer [contenteditable]').innerText(),/Texto exacto/);
  await fixture();await page.evaluate(()=>__permit=false);result=await send();assert.equal(result.status,'failed');assert.equal(await page.evaluate(()=>__clicks),0);
  await fixture();await page.locator('footer [contenteditable]').fill('Borrador que se conserva');result=await send();assert.equal(result.status,'failed');assert.equal(await page.locator('footer [contenteditable]').innerText(),'Borrador que se conserva');
  await fixture();result=await send({phone:'51987654321'});assert.equal(result.status,'failed');assert.equal(await page.evaluate(()=>__clicks),0);
  await fixture();await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));result=await send();assert.equal(result.status,'failed');assert.equal(await page.evaluate(()=>__clicks),0);
  await fixture();await page.evaluate(()=>__afterClick='switch');result=await send();assert.equal(result.status,'uncertain');assert.equal(await page.evaluate(()=>__clicks),1);
  console.log('PASS exact-recipient text draft, explicit preparation, permit refusal, draft preservation, hidden tab and uncertain outcome');
  await fixture();result=await send({files:[{name:'foto.png',type:'image/png',data:Buffer.from('synthetic-image').toString('base64')},{name:'video.mp4',type:'video/mp4',data:Buffer.from('synthetic-video').toString('base64')}]});
  assert.equal(result.status,'sent_observed');assert.deepEqual(await page.evaluate(()=>__filePackets.map(x=>x.type)),['image/png','video/mp4']);assert.equal(await page.evaluate(()=>__clicks),1);
  await fixture();await page.evaluate(()=>__permit=false);result=await send({files:[{name:'foto.png',type:'image/png',data:'eA=='}]});assert.equal(result.status,'failed');assert.equal(await page.evaluate(()=>__clicks),0);
  console.log('PASS actual browser File/DataTransfer photo+video, exact caption and permit recheck before synthetic send');
  await fixture();result=await page.evaluate(()=>__nexoWhatsAppAdapter.exportContacts({source:'visible',scan:false}));
  assert.equal(result.contacts.length,2);assert.equal(result.contacts[0].phone,'51999888777');assert.equal(result.contacts[1].phone,'');assert.equal(result.incomplete,1);
  assert.ok(result.contacts.every(x=>x.name!=='Oculta'));
  await assert.rejects(page.evaluate(()=>__nexoWhatsAppAdapter.exportContacts({source:'archived'})),/Archivados/);
  await assert.rejects(page.evaluate(()=>__nexoWhatsAppAdapter.exportContacts({source:'group'})),/grupo/);
  await page.evaluate(()=>{const header=document.createElement('header');header.innerHTML='<h1>Archivados</h1>';document.querySelector('#pane-side').prepend(header);});
  result=await page.evaluate(()=>__nexoWhatsAppAdapter.exportContacts({source:'archived'}));assert.equal(result.contacts.length,2);assert.ok(result.contacts.every(row=>row.labels.includes('Archivado')));
  await fixture();await page.evaluate(()=>{
   document.querySelector('#main header').innerHTML='<span title="Grupo sintético">Grupo sintético</span><i data-icon="default-group"></i>';
   document.querySelector('#history [data-id]').dataset.id='false_fixture@g.us_initial';
   const drawer=document.createElement('section');drawer.dataset.testid='contact-info-drawer';drawer.innerHTML='<h2 dir="auto">Otra persona</h2><div role="listitem"><span title="+51 999 888 777">+51 999 888 777</span></div>';document.querySelector('#app').append(drawer);
  });
  await assert.rejects(page.evaluate(()=>__nexoWhatsAppAdapter.exportContacts({source:'group'})),/este grupo/);
  await page.evaluate(()=>{const drawer=document.querySelector('[data-testid=contact-info-drawer]');drawer.querySelector('h2').textContent='Grupo sintético';drawer.insertAdjacentHTML('beforeend','<h3>1 participantes</h3>');});
  result=await page.evaluate(()=>__nexoWhatsAppAdapter.exportContacts({source:'group'}));assert.equal(result.contacts[0].phone,'51999888777');assert.ok(result.contacts[0].labels.includes('Grupo'));
  assert.deepEqual(errors,[]);console.log('PASS visible-only contact export, incomplete names retained, unopened archived/group sources rejected');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
