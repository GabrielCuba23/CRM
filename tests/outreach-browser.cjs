const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const requireTools = createRequire('/workspace/work/cloud-tools/package.json');
const { chromium } = requireTools('playwright');

// Real outreach UI, Excel reader/writer, campaign model and workspace commands.
// WhatsApp transport and media storage are synthetic boundaries. No external
// account, customer or message is contacted by this fixture.
const root = path.resolve(__dirname, '..');
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Campañas · prueba sintética</title></head><body><section id="fixture"></section><script src="/vendor/exceljs-4.4.0.min.js"></script><script type="module">
import {initializeOutreach} from '/outreach-ui.mjs';
import {emptyState} from '/cloud/state.mjs';
import {applyWorkspaceCommand} from '/companions/workspace.mjs';
import {emptyOutreach} from '/outreach.mjs';
window.__calls={start:[],select:[],send:[],stop:[],upload:[],export:[],commits:[]};
window.__waActive=true;window.__sendMode='sent_observed';window.__rejectSending=false;window.__files=new Map();
let state=JSON.parse(localStorage.getItem('fixture-state')||'null')||emptyState();
if(!state.clients.length){for(const service of ['MAX','PRIME'])state=applyWorkspaceCommand(state,'saveClient',{name:'Ana Ejemplo',phone:'987654321',service,marketingConsent:true});state=applyWorkspaceCommand(state,'saveClient',{name:'Bruno Ejemplo',phone:'912345678',service:'DISNEY'});}
window.__state=()=>structuredClone(state);
window.__commit=async(command,input)=>{const next=applyWorkspaceCommand(state,command,input);if(window.__rejectSending&&next.growth?.outreach.campaigns.some(c=>c.recipients.some(r=>r.status==='sending')))throw Error('Fallo sintético al guardar intento');state=next;localStorage.setItem('fixture-state',JSON.stringify(state));__calls.commits.push(structuredClone(state));return structuredClone(state);};
const transport={
 async getContext(){return{active:window.__waActive};},
 async startCampaign(input){__calls.start.push(input);return{runId:'fixture-run-'+__calls.start.length};},
 async stopCampaign(input){__calls.stop.push(input);return{stopped:true};},
 async selectRecipient(input){__calls.select.push(input);return{selected:true,phone:input.phone,tabId:17};},
 async sendCampaign(input){const current=state.growth.outreach.campaigns.find(c=>c.id===__calls.start.at(-1).campaignId),row=current.recipients.find(r=>r.phone===input.phone);if(row.status!=='sending'||row.attempts<1)throw Error('El intento no se guardó antes del envío');__calls.send.push({...input,persistedStatus:row.status,persistedAttempts:row.attempts});if(window.__sendMode==='hold')return await new Promise(resolve=>window.__releaseSend=resolve);return{status:window.__sendMode,evidence:'Mensaje sintético observado'};},
 async uploadMedia(file,{onProgress}={}){const bytes=new Uint8Array(await file.arrayBuffer()),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''),id=String(__calls.upload.length+1).padStart(32,'0'),media={id,name:file.name,type:file.type,size:file.size,sha256};__calls.upload.push(media);__files.set(id,{media,bytes});onProgress?.(100);return media;},
 async downloadMedia(id){const file=__files.get(id);return new File([file.bytes],file.media.name,{type:file.media.type});},
 async listMedia(){return{media:[...__files.values()].map(file=>file.media),uploads:[],usedBytes:[...__files.values()].reduce((sum,file)=>sum+file.media.size,0),limits:{totalBytes:209715200}};},
 async deleteMedia(id){__files.delete(id);return{ok:true};},
 async exportWhatsAppContacts(input){__calls.export.push(input);return{contacts:[{name:'Solo nombre',phone:'',source:'whatsapp',labels:[]},{name:'Carla Ejemplo',phone:'51988877766',source:'whatsapp',labels:['Grupo']}],incomplete:true,note:'Lectura sintética parcial: un número no es visible.'};}
};
window.__initialize=(native=true)=>{window.__ui?.destroy();document.querySelector('#fixture').replaceChildren();window.__ui=initializeOutreach({root:document.querySelector('#fixture'),getState:()=>state,commit:window.__commit,transport:native?transport:{uploadMedia:transport.uploadMedia,listMedia:transport.listMedia,downloadMedia:transport.downloadMedia},ExcelJS:window.ExcelJS});};
window.__hidden=hidden=>{Object.defineProperty(document,'hidden',{configurable:true,value:hidden});document.dispatchEvent(new Event('visibilitychange'));};
window.__fresh=()=>{localStorage.removeItem('fixture-state');state=emptyState();__calls.start=[];__calls.select=[];__calls.send=[];__calls.stop=[];__calls.upload=[];__calls.commits=[];__waActive=true;__sendMode='sent_observed';__rejectSending=false;__files.clear();__initialize();};
__initialize();window.__ready=true;
</script></body></html>`;

async function main() {
  const server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://fixture.test').pathname;
    if(pathname==='/'){response.setHeader('Content-Type','text/html;charset=utf-8');response.end(html);return;}
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
    response.setHeader('Content-Type',/\.(m?js)$/.test(file)?'text/javascript;charset=utf-8':file.endsWith('.css')?'text/css':'application/octet-stream');response.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:420,height:900},acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  const scratch=path.join(root,'work');fs.mkdirSync(scratch,{recursive:true});
  const goto=async()=>{await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready);};
  const click=label=>page.getByRole('button',{name:label,exact:true}).click();
  const contacts=()=>page.locator('#outreach-tab-contacts').click();
  const campaigns=()=>page.locator('#outreach-tab-campaigns').click();
  const waitCampaign=predicate=>page.waitForFunction(predicate);
  try {
    await goto();
    await contacts();
    assert.equal(await page.locator('.outreach-contact-row').count(),2,'one CRM contact with two services appears once');
    await page.locator('#outreach-import').click();
    await page.locator('dialog input[type=file]').setInputFiles({name:'contactos.csv',mimeType:'text/csv',buffer:Buffer.from('Alias,Numero,Oferta\n=FORMULA(),987654321,Video\nDuplicado,+51 987 654 321,No\nError,sin-numero,No\nCarla,988877766,Foto')});
    await page.locator('dialog [name=phone]').selectOption('1');await page.locator('dialog [name=name]').selectOption('0');
    await page.getByText('2 válidos · 1 duplicados · 1 errores',{exact:true}).waitFor();
    await click('Guardar contactos');
    await page.waitForFunction(()=>__state().growth?.outreach.contacts.length===2);
    assert.equal(await page.evaluate(()=>__state().growth.outreach.contacts[0].fields.Oferta),'Video');
    const csvDownload=page.waitForEvent('download');await page.locator('#outreach-export-csv').click();const csv=fs.readFileSync(await(await csvDownload).path(),'utf8');assert.match(csv,/'=FORMULA\(\)/,'CSV formulas escaped');
    const xlsxDownload=page.waitForEvent('download');await page.locator('#outreach-export-xlsx').click();const xlsx=fs.readFileSync(await(await xlsxDownload).path());assert.equal(xlsx.subarray(0,2).toString(),'PK');
    const importedWorkbook=await page.evaluate(async()=>{const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Lista');sheet.addRows([['Persona','WhatsApp','Cupón'],['Ximena',977888999,'FOTO'],['Ana',987654321,'VIDEO'],['Ana repetida','+51 987 654 321','VIDEO']]);return Array.from(await workbook.xlsx.writeBuffer());});
    await page.locator('#outreach-import').click();await page.locator('dialog input[type=file]').setInputFiles({name:'lista.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(importedWorkbook)});await page.getByText('2 válidos · 1 duplicados · 0 errores',{exact:true}).waitFor();await click('Guardar contactos');await page.waitForFunction(()=>__state().growth.outreach.contacts.some(row=>row.name==='Ximena'&&row.fields['Cupón']==='FOTO'));
    await page.getByText('Descargar contactos de WhatsApp',{exact:true}).click();await page.locator('#outreach-read-whatsapp').click();await click('Guardar contactos leídos');
    await page.waitForFunction(()=>__state().growth.outreach.contacts.some(row=>row.name==='Solo nombre'&&row.phone===''));
    assert.equal(await page.evaluate(()=>__calls.export[0].source),'visible');
    const noPhone=page.locator('.outreach-contact-row').filter({hasText:'Solo nombre'});await noPhone.getByRole('button',{name:'Editar'}).click();await page.locator('dialog [name=phone]').fill('911222333');await page.locator('dialog button[type=submit]').click();await page.waitForFunction(()=>__state().growth.outreach.contacts.some(row=>row.name==='Solo nombre'&&row.phone==='51911222333'));
    await page.locator('#outreach-tab-templates').click();await page.locator('#outreach-new-template').click();await page.locator('dialog [name=name]').fill('Oferta personalizada');await page.locator('dialog [name=body]').fill('Hola {nombre}: {Oferta} de {negocio}');await page.locator('dialog button[type=submit]').click();
    await click('Usar en campaña');await page.locator('#outreach-campaign-name').fill('Foto y video');await page.locator('[name=manual]').fill('987654321, Ana\n+51 987 654 321, Repetida\n912345678, Bruno');await click('Añadir lista');
    assert.equal(await page.locator('.outreach-recipient-list .outreach-contact-row').count(),2);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIOsAAAAASUVORK5CYII=','base64'),mp4=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
    await page.locator('#outreach-campaign-media').setInputFiles([{name:'foto.png',mimeType:'image/png',buffer:png},{name:'video.mp4',mimeType:'video/mp4',buffer:mp4}]);await page.getByText('Archivos guardados.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>__calls.upload.length),2);assert.equal(await page.locator('.outreach-media-row').count(),2);
    await page.getByRole('button',{name:'Vista previa',exact:true}).first().click();await page.locator('img.outreach-preview-media').waitFor();
    await page.locator('#outreach-timing-settings > summary').click();await page.locator('[name=delaySeconds]').fill('0');await page.locator('[name=batchPauseSeconds]').fill('0');
    await page.locator('#outreach-save-campaign').click();await page.waitForFunction(()=>__state().growth.outreach.campaigns.length===1);
    let stored=await page.evaluate(()=>__state().growth.outreach.campaigns[0]);assert.equal(stored.media.length,2);assert.ok(stored.media.every(file=>file.sha256.length===64&&!('data'in file)));assert.equal(await page.evaluate(()=>__calls.send.length),0,'saving never sends');
    await page.locator('#outreach-start-campaign').click();await waitCampaign(()=>__state().growth.outreach.campaigns[0].status==='completed');
    assert.equal(await page.evaluate(()=>__calls.send.length),2);assert.equal(await page.evaluate(()=>__calls.send[0].persistedStatus),'sending');assert.equal(await page.evaluate(()=>__calls.send[0].media.length),2);assert.match(await page.evaluate(()=>__calls.send[0].text),/^Hola Ana:/);
    await click('Ver informe');await page.locator('#outreach-report-csv').waitFor();const reportDownload=page.waitForEvent('download');await page.locator('#outreach-report-csv').click();assert.match(fs.readFileSync(await(await reportDownload).path(),'utf8'),/sent_observed/);
    const excelReportDownload=page.waitForEvent('download');await page.locator('#outreach-report-xlsx').click();const excelReportBytes=fs.readFileSync(await(await excelReportDownload).path());const reportStatuses=await page.evaluate(async bytes=>{const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(new Uint8Array(bytes).buffer);return workbook.worksheets[0].getRow(2).values;},[...excelReportBytes]);assert.ok(reportStatuses.includes('sent_observed'));
    await page.screenshot({path:path.join(scratch,'outreach-report.png'),fullPage:true});
    console.log('PASS imports, duplicate normalization, Excel/CSV export, name-only WhatsApp contacts, templates, photo/video private descriptors, persisted sends and report');

    // A new contact can open a prefilled one-person photo/video composer.
    await page.evaluate(()=>__ui.openComposer({recipients:[{name:'Nueva persona',phone:'966555444'}],body:'Entrega {nombre}',name:'Mensaje individual'}));
    assert.equal(await page.locator('.outreach-recipient-list .outreach-contact-row').count(),1);assert.equal(await page.locator('#outreach-campaign-name').inputValue(),'Mensaje individual');
    await page.evaluate(()=>__fresh());
    await page.evaluate(()=>{__sendMode='uncertain';__ui.openComposer({recipients:[{name:'Uno',phone:'966555444'},{name:'Dos',phone:'955666777'}],body:'Aviso {nombre}',name:'Resultado incierto'});});
    await page.locator('#outreach-start-campaign').click();await waitCampaign(()=>__state().growth.outreach.campaigns[0].status==='paused'&&__calls.stop.length>0);
    assert.equal(await page.evaluate(()=>__calls.send.length),1);stored=await page.evaluate(()=>__state().growth.outreach.campaigns[0]);assert.equal(stored.recipients[0].status,'uncertain');assert.equal(stored.recipients[1].status,'pending');
    await page.reload();await page.waitForFunction(()=>__ready);assert.equal(await page.evaluate(()=>__calls.send.length),0,'loading a paused campaign never sends');
    await page.locator('#outreach-tab-reports').click();await click('Revisé WhatsApp: ya fue enviado');await waitCampaign(()=>__state().growth.outreach.campaigns[0].recipients[0].status==='sent_manual');
    console.log('PASS individual composer, uncertain pause, no send on reload, explicit manual review');

    // A failed durable write must prevent the transport send entirely.
    await page.evaluate(()=>{__fresh();__rejectSending=true;__ui.openComposer({recipients:[{name:'Fallo',phone:'966555444'}],body:'Prueba sin envío',name:'Persistencia rechazada'});});
    await page.locator('#outreach-start-campaign').click();await waitCampaign(()=>__state().growth.outreach.campaigns[0].status==='paused');assert.equal(await page.evaluate(()=>__calls.send.length),0);
    console.log('PASS rejected persistence prevents send');

    // In-flight attempts persist across a reload and are never replayed.
    await page.evaluate(()=>{__fresh();__sendMode='hold';__ui.openComposer({recipients:[{name:'Interrumpido',phone:'966555444'}],body:'No repetir',name:'Interrumpida'});});
    await page.locator('#outreach-start-campaign').click();await waitCampaign(()=>__state().growth.outreach.campaigns[0].recipients[0].status==='sending'&&__calls.send.length===1);
    await page.reload();await page.waitForFunction(()=>__ready);assert.equal(await page.evaluate(()=>__calls.send.length),0);await click('Recuperar campaña interrumpida');await waitCampaign(()=>__state().growth.outreach.campaigns[0].recipients[0].status==='uncertain');
    console.log('PASS interrupted attempts recover to uncertain without automatic replay');

    // Side panel persists on other tabs, while the active queue pauses.
    await page.evaluate(()=>{__fresh();__ui.openComposer({recipients:[{name:'Primero',phone:'966555444'},{name:'Segundo',phone:'955666777'}],body:'Pausa',name:'Cambiar pestaña'});});
    await page.locator('#outreach-start-campaign').click();await waitCampaign(()=>__calls.send.length===1);await page.evaluate(()=>__waActive=false);await waitCampaign(()=>__state().growth.outreach.campaigns[0].status==='paused');assert.equal(await page.evaluate(()=>__calls.send.length),1);
    await page.evaluate(()=>{__fresh();__ui.openComposer({recipients:[{name:'Primero',phone:'966555444'},{name:'Segundo',phone:'955666777'}],body:'Oculta',name:'Visibilidad'});});
    await page.locator('#outreach-start-campaign').click();await waitCampaign(()=>__calls.send.length===1);await page.evaluate(()=>__hidden(true));await waitCampaign(()=>__state().growth.outreach.campaigns[0].status==='paused');assert.equal(await page.evaluate(()=>__calls.send.length),1);await page.evaluate(()=>__hidden(false));
    console.log('PASS switching away from WhatsApp or hiding the panel pauses the queue');

    await page.evaluate(()=>{__fresh();__ui.openComposer({recipients:[{name:'Programado',phone:'966555444'}],body:'Horario',name:'Programada'});});await page.locator('#outreach-timing-settings > summary').click();await page.locator('[name=scheduledAt]').evaluate(input=>{const future=new Date(Date.now()+120000);input.value=new Date(future.getTime()-future.getTimezoneOffset()*60000).toISOString().slice(0,16);input.dispatchEvent(new Event('change'));});await page.locator('#outreach-start-campaign').click();await waitCampaign(()=>__state().growth.outreach.campaigns[0].status==='scheduled');assert.equal(await page.evaluate(()=>__calls.send.length),0);await page.locator('#outreach-pause-campaign').click();await waitCampaign(()=>__state().growth.outreach.campaigns[0].status==='paused');assert.equal(await page.evaluate(()=>__calls.send.length),0);console.log('PASS future schedule is persisted, waits and can be paused without sending');

    await page.evaluate(()=>{__fresh();__initialize(false);__ui.openComposer({recipients:[{name:'Web',phone:'966555444'}],body:'Solo configurar',name:'Web'});});assert.equal(await page.locator('#outreach-start-campaign').isEnabled(),false);await page.getByText('Puedes configurar y guardar aquí.',{exact:false}).waitFor();
    assert.deepEqual(errors,[]);console.log('PASS web config has no native delivery and browser has no uncaught errors');
    await page.evaluate(()=>{__fresh();__ui.openComposer({recipients:[{name:'Ana',phone:'912345678'}],body:'Hola {nombre}, mensaje inicial',name:'Mi borrador'});});
    await page.locator('#outreach-create-template-inline').click();
    await page.locator('dialog [name=name]').fill('Plantilla desde mi campaña');
    await page.locator('dialog [name=body]').fill('Hola {nombre}, mensaje reutilizable');
    await page.locator('dialog button[type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#outreach-campaign-name').inputValue(),'Mi borrador');
    assert.equal(await page.locator('#outreach-campaign-body').inputValue(),'Hola {nombre}, mensaje reutilizable');
    assert.equal(await page.locator('.outreach-recipient-list .outreach-contact-row').count(),1);
    assert.equal(await page.evaluate(()=>__state().growth.outreach.templates.length),1);
    assert.equal(await page.evaluate(()=>__calls.send.length),0);
    assert.equal(await page.locator('[name=template]').inputValue(),await page.evaluate(()=>__state().growth.outreach.templates[0].id));
    await page.locator('#outreach-timing-settings > summary').click();await page.locator('[name=delaySeconds]').fill('8');
    console.log('PASS template creation beside campaign selector preserves draft and recipient, applies saved template and exposes sending rules');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
