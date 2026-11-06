const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire('/workspace/work/cloud-tools/package.json')('playwright');

// The actual content adapter runs against browser DOM/File/editor primitives.
// Chrome IPC and WhatsApp are synthetic. This never opens an external account
// and never contacts or sends a message to a real person.
const adapter = path.resolve(__dirname, '../extension/whatsapp.js');
const runId = 'a'.repeat(32), phone = '51912345678';
const html = `<!doctype html><meta charset="utf-8"><style>
body{font:14px Arial}#main{width:800px}header{height:50px}#history{min-height:200px}footer{display:flex}footer [contenteditable]{width:500px;min-height:40px}
</style><div id="app"><aside id="pane-side"><div aria-selected="true">Cliente sintético</div></aside>
<section id="main"><header><span title="+51 912 345 678">+51 912 345 678</span></header><section id="history">
<div class="message-in" data-id="false_51912345678@c.us_historical"><div data-pre-plain-text="[10:00] Persona: "><span class="selectable-text">Mensaje antiguo</span></div></div>
<div class="message-out" data-id="true_51912345678@c.us_historical-out"><div data-pre-plain-text="[10:01] Tú: "><span class="selectable-text">Respuesta antigua</span></div></div>
</section><input type="file" accept="image/*,video/mp4,video/webm" multiple>
<footer><div contenteditable="true" role="textbox"></div><button aria-label="Enviar">Enviar</button></footer></section></div>`;

async function main() {
  const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', args:['--no-sandbox'] });
  const page = await browser.newPage({ viewport:{width:1000,height:850} });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function fixture() {
    await page.goto('about:blank');
    await page.setContent(html);
    await page.evaluate(() => {
      window.__clicks=0;window.__permit=true;window.__permitCalls=[];window.__holdPermit=false;window.__afterClick='observed';window.__files=[];
      window.chrome={runtime:{async sendMessage(message){
        window.__permitCalls.push(message);
        if(window.__holdPermit)return new Promise(resolve=>window.__releasePermit=resolve);
        return{ok:true,result:{allowed:window.__permit}};
      }}};
      window.__append=(id,body,{outgoing=false,quoted=false}={})=>{
        const row=document.createElement('div');row.className=outgoing?'message-out':'message-in';row.dataset.id=id;
        row.innerHTML='<div data-pre-plain-text="[10:02] Persona: "><span class="selectable-text"></span></div>';
        row.querySelector('span').textContent=body;
        if(quoted){const wrapper=document.createElement('aside');wrapper.dataset.testid='quoted-message';wrapper.append(row);document.querySelector('#history').append(wrapper);}
        else document.querySelector('#history').append(row);
      };
      window.__setHidden=value=>{Object.defineProperty(document,'hidden',{configurable:true,value});Object.defineProperty(document,'visibilityState',{configurable:true,value:value?'hidden':'visible'});};
      function sent(scope){
        __clicks++;
        if(__afterClick==='switch'){document.querySelector('#main header span').title='+51 987 654 321';return;}
        const current=document.querySelector('#main header span').title.replace(/\D/g,'');
        __append('true_'+current+'@c.us_bot-out'+__clicks,scope.querySelector('[contenteditable]').innerText,{outgoing:true});
        if(scope.querySelector('img,video'))document.querySelector('#history').lastElementChild.append(document.createElement('img'));
        scope.querySelector('[contenteditable]').textContent='';
        if(scope.matches('[role=dialog]'))scope.remove();
      }
      document.querySelector('footer button').onclick=()=>sent(document.querySelector('footer'));
      document.querySelector('input[type=file]').onchange=event=>{
        __files=[...event.target.files].map(file=>({name:file.name,type:file.type,size:file.size}));
        const preview=document.createElement('section');preview.setAttribute('role','dialog');preview.dataset.testid='media-editor';
        preview.innerHTML='<img alt="Adjunto sintético"><div contenteditable="true" role="textbox"></div><button aria-label="Enviar">Enviar</button>';
        document.body.append(preview);preview.querySelector('button').onclick=()=>sent(preview);
      };
    });
    await page.addScriptTag({ path:adapter });
  }
  const arm=allowBackground=>page.evaluate(input=>__nexoWhatsAppAdapter.botStart(input),{runId,allowBackground});
  const snapshot=()=>page.evaluate(input=>__nexoWhatsAppAdapter.botSnapshot(input),{runId});
  const incoming=(suffix,body='hola')=>page.evaluate(({id,body})=>__append(id,body),{id:'false_'+phone+'@c.us_'+suffix,body});
  const stop=()=>page.evaluate(input=>__nexoWhatsAppAdapter.botStop(input),{runId});
  async function expectNoMessages() {
    try { const value=await snapshot();assert.deepEqual(value?.messages||[],[]); }
    catch(error) { assert.match(error.message,/deten|activa|inicia|visible|WhatsApp|sesión|ocult/i); }
  }
  const send=(incomingId,changes={})=>page.evaluate(input=>__nexoWhatsAppAdapter.campaignSend(input),{
    runId,mode:'bot',phone,text:'Respuesta sintética\n\nCon espacios exactos',files:[],automatic:true,
    incomingId,claimId:'synthetic-claim',claimToken:'b'.repeat(64),allowBackground:false,...changes,
  });
  try {
    await fixture();
    assert.equal(await page.evaluate(()=>typeof __nexoWhatsAppAdapter.botStart),'function','new chatbot adapter must be exposed');
    await arm(false);await expectNoMessages();
    await page.evaluate(()=>{const old=document.createElement('div');old.className='message-in';old.dataset.id='false_51912345678@c.us_loaded-older';old.innerHTML='<div data-pre-plain-text="[ayer] Persona: "><span class="selectable-text">Texto histórico cargado al desplazar</span></div>';document.querySelector('#history').prepend(old);});
    await expectNoMessages();
    await incoming('fresh','Hola de prueba');
    let current=await snapshot();
    assert.equal(current.messages.length,1);assert.equal(current.messages[0].id,'false_'+phone+'@c.us_fresh');
    assert.equal(current.messages[0].body,'Hola de prueba');assert.equal(current.messages[0].phone,phone);
    await expectNoMessages();
    await page.evaluate(()=>{__append('true_51912345678@c.us_outgoing','No responder',{outgoing:true});__append('false_51999999999@c.us_quoted','No responder cita',{quoted:true});});
    await expectNoMessages();
    console.log('PASS initial baseline, new incoming text, stable message identity, no duplicate/outgoing/quoted replies');

    await page.evaluate(()=>{
      const title=document.querySelector('#main header span');title.title='+51 987 654 321';title.textContent=title.title;
      document.querySelector('#history').replaceChildren();__append('false_51987654321@c.us_existing','Histórico de otro chat');
    });
    await page.waitForTimeout(300);await expectNoMessages();
    await page.evaluate(()=>__append('false_51987654321@c.us_new','Consulta nueva'));
    current=await snapshot();assert.equal(current.messages.length,1);assert.equal(current.messages[0].phone,'51987654321');
    await page.evaluate(()=>{
      document.querySelector('#main header').innerHTML='<span title="Grupo sintético">Grupo sintético</span><i data-icon="default-group"></i>';
      document.querySelector('#history').replaceChildren();__append('false_fixture@g.us_initial','Consulta en grupo');
    });
    await page.waitForTimeout(300);await expectNoMessages();
    await page.evaluate(()=>__append('false_fixture@g.us_new','Otra consulta de grupo'));await expectNoMessages();
    console.log('PASS changing chat baselines historical text and groups remain excluded');

    await fixture();await arm(false);await incoming('hidden-before');await page.evaluate(()=>__setHidden(true));await expectNoMessages();
    let result=await send('false_'+phone+'@c.us_hidden-before',{allowBackground:true});assert.equal(result.status,'failed');assert.equal(await page.evaluate(()=>__clicks),0,'request cannot upgrade a foreground-only arm');
    await fixture();await page.evaluate(()=>__setHidden(true));result=await send('false_'+phone+'@c.us_historical',{allowBackground:true});assert.equal(result.status,'failed');assert.equal(await page.evaluate(()=>__clicks),0,'unarmed background calls cannot send');
    await fixture();await arm(true);await page.evaluate(()=>__setHidden(true));await incoming('background','Consulta en segundo plano');current=await snapshot();assert.equal(current.messages.length,1);
    result=await send(current.messages[0].id,{allowBackground:true});assert.equal(result.status,'sent_observed');assert.equal(await page.evaluate(()=>__clicks),1);
    assert.equal(await page.evaluate(()=>__permitCalls.at(-1).type),'engagement.permit');
    console.log('PASS explicit background opt-in, no hidden foreground capture and no self-escalation from caller flags');

    await fixture();await arm(false);await incoming('refused');current=await snapshot();await page.evaluate(()=>__permit=false);
    result=await send(current.messages[0].id);assert.equal(result.status,'failed');assert.equal(await page.evaluate(()=>__clicks),0);
    await fixture();await arm(false);await incoming('stop-race');current=await snapshot();await page.evaluate(()=>__holdPermit=true);
    const pendingStop=send(current.messages[0].id);await page.waitForFunction(()=>typeof __releasePermit==='function');await stop();
    await page.evaluate(()=>__releasePermit({ok:true,result:{allowed:true}}));result=await pendingStop;assert.equal(result.status,'failed');assert.equal(await page.evaluate(()=>__clicks),0);
    await incoming('after-stop');await expectNoMessages();
    await fixture();await arm(false);await incoming('recipient-race');current=await snapshot();await page.evaluate(()=>__holdPermit=true);
    const pendingSwitch=send(current.messages[0].id);await page.waitForFunction(()=>typeof __releasePermit==='function');
    await page.evaluate(()=>{document.querySelector('#main header span').title='+51 987 654 321';__releasePermit({ok:true,result:{allowed:true}});});
    result=await pendingSwitch;assert.equal(result.status,'failed');assert.equal(await page.evaluate(()=>__clicks),0);
    console.log('PASS server permit refusal, immediate stop race and recipient switch prevent synthetic Send click');

    await fixture();await arm(false);await incoming('draft');current=await snapshot();await page.locator('footer [contenteditable]').fill('Borrador del propietario');
    result=await send(current.messages[0].id);assert.equal(result.status,'failed');assert.equal(await page.locator('footer [contenteditable]').innerText(),'Borrador del propietario');
    await fixture();await arm(false);await incoming('uncertain');current=await snapshot();await page.evaluate(()=>__afterClick='switch');
    result=await send(current.messages[0].id);assert.equal(result.status,'uncertain');assert.equal(await page.evaluate(()=>__clicks),1);
    await fixture();await arm(false);await incoming('media');current=await snapshot();
    result=await send(current.messages[0].id,{files:[{name:'foto.png',type:'image/png',data:Buffer.from('synthetic-image').toString('base64')},{name:'video.mp4',type:'video/mp4',data:Buffer.from('synthetic-video').toString('base64')}]});
    assert.equal(result.status,'sent_observed');assert.deepEqual(await page.evaluate(()=>__files.map(file=>file.type)),['image/png','video/mp4']);
    assert.deepEqual(errors,[]);
    console.log('PASS draft preservation, uncertain post-click result and actual File/DataTransfer chatbot media');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
