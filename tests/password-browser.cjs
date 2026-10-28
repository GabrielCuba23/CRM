const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { chromium } = require('playwright');
const tooling = createRequire('/tmp/crm-cloud-tools/package.json');
const { Miniflare, convertV4MiniflareOptions } = tooling('miniflare');

// The HTTP auth handler, D1 database, packaged web/extension UI and extension
// background are real. Only Chrome extension APIs and the WhatsApp DOM are
// fixtures; this does not install MV3 or access the owner's account.
let CRM;
const EXT = 'https://extension.test/';
const EXT_ID = 'a'.repeat(32);
const EXT_ORIGIN = `chrome-extension://${EXT_ID}/`;
const OWNER = 'owner@example.test';
const PASSWORD = 'Browser fixture only! 3829';
const SETUP = 'setup_browser_fixture_' + 'x'.repeat(40);
const WA = `<!doctype html><meta charset="utf-8"><title>WhatsApp · fixture</title>
<style>html,body{height:100%;margin:0;font:14px Arial}#app{height:100%;display:flex;background:#efeae2}.list{width:250px;background:white;padding:20px}#main{flex:1;display:flex;flex-direction:column}header{height:70px;background:#f0f2f5;padding:15px;box-sizing:border-box}.history{flex:1;padding:25px}footer{height:75px;display:flex;padding:12px;background:#f0f2f5;box-sizing:border-box}footer [contenteditable]{flex:1;background:white;padding:10px}</style>
<div id="app"><aside class="list" id="pane-side"><b>WhatsApp · datos ficticios</b><div aria-selected="true">Cliente de prueba</div></aside><section id="main"><header><span title="+51 999 999 999">+51 999 999 999</span></header><div class="history"><div class="message-in" data-id="false_browser-fixture@lid_1"><div data-pre-plain-text="[10:30] Cliente: "><span class="selectable-text">Mensaje de ejemplo.</span></div></div></div><footer><div role="textbox" contenteditable="true"></div></footer></section></div>`;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.mjs':'text/javascript', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, '..');
  // Intercept the exact distributed default host locally so a genuinely empty
  // extension configuration exercises installation without a domain form.
  CRM = (await import(path.join(root, 'extension/policy.mjs'))).DEFAULT_ORIGIN;
  const scratch = path.join(root, 'work');
  fs.mkdirSync(scratch, { recursive:true });
  const output = fs.mkdtempSync(path.join(scratch, 'password-browser-'));
  const unpacked = path.join(output, 'extension');
  execFileSync('python3', ['extension/build.py', '--output-dir', unpacked, '--zip', path.join(output, 'extension.zip')], { cwd:root });
  const { handleRequest } = await import(path.join(root, 'cloud/index.mjs'));
  const { emptyState } = await import(path.join(root, 'cloud/state.mjs'));
  const mf = new Miniflare(convertV4MiniflareOptions({ workers:[{ name:'password-browser', modules:true, script:'export default { fetch(){return new Response("fixture")}}', d1Databases:{DB:'password-browser'} }] }));
  const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
  const browserContext = await browser.newContext({ viewport:{width:1440,height:850}, serviceWorkers:'block' });
  browserContext.setDefaultTimeout(12000);
  const DB = await mf.getD1Database('DB');
  await DB.exec(fs.readFileSync(path.join(root, 'cloud/schema.sql'), 'utf8').replace(/\n/g, ' '));
  await DB.prepare('INSERT INTO auth_setup(token_hash,email,expires,used_at) VALUES(?,?,?,NULL)').bind(createHash('sha256').update(SETUP).digest('hex'), OWNER, Math.floor(Date.now()/1000)+3600).run();
  const state = emptyState();
  state.clients = [{ id:'fixture-max', name:'Cliente de prueba', phone:'51999999999', email:'cliente@example.test', service:'MAX', profile:'Perfil de prueba', expires:'2099-11-20', notes:'Datos ficticios', accountId:'', pin:'', price:1200, whatsappUsername:'', archived:false, serviceHistory:[], reminderConsent:false, marketingConsent:false }];
  await DB.prepare('INSERT INTO workspace(id,revision,body) VALUES(1,1,?)').bind(JSON.stringify(state)).run();
  const env = {
    DB, OWNER_EMAIL:OWNER, AUTH_MODE:'password', AUTH_PASSWORD_PEPPER:'synthetic-browser-pepper-not-a-production-secret-73923',
    ASSETS:{ async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root+path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return new Response('Not found', {status:404});
      return new Response(fs.readFileSync(filename), {headers:{'Content-Type':MIME[path.extname(filename)]||'application/octet-stream'}});
    } },
  };
  let apiLoginCalls = 0, setupCalls = 0, directCalls = 0, writes = 0, createdTabs = 0, bridgeCalls = 0;
  const issuedTokens = [], broadcasts = [], clipboard = [], errors = [];
  const pages = new Map(), backgroundListeners = [], storageListeners = [];
  const local = {}, session = {};
  let nextTabId = 1, whatsapp, clipboardReady = false;
  const tab = page => ({id:pages.get(page),url:page.url(),status:'complete'});
  const pageFor = id => [...pages].find(([,value])=>value===id)?.[0];
  const api = async (url, init={}) => {
    const request = new Request(url, init);
    const pathname = new URL(url).pathname;
    if (pathname==='/api/login') apiLoginCalls++;
    if (pathname==='/api/setup') setupCalls++;
    if (pathname==='/api/workspace' && request.method==='PUT') writes++;
    const result = await handleRequest(request, env);
    if (pathname==='/api/login' && init.headers && new Headers(init.headers).get('X-Nexo-Client')==='extension' && result.ok) {
      const json = await result.clone().json();
      if (json.token) issuedTokens.push(json.token);
    }
    return result;
  };
  const nativeFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input==='string' ? input : input.url;
    if (new URL(url).origin!==CRM) return nativeFetch(input, init);
    directCalls++;
    assert.equal(init.credentials, 'omit', 'The extension must not send site cookies.');
    assert.equal(init.redirect, 'error', 'Credentials must never follow another origin.');
    return api(url, init);
  };
  const storage = (values, area) => ({
    async get(keys) {
      if (keys===null || keys===undefined) return {...values};
      if (typeof keys==='string') return {[keys]:values[keys]};
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(key=>[key,values[key]]));
      return Object.fromEntries(Object.keys(keys).map(key=>[key,values[key]===undefined?keys[key]:values[key]]));
    },
    async set(update) { const changes={}; for (const [key,value] of Object.entries(update)) {changes[key]={oldValue:values[key],newValue:value};values[key]=value;} for (const listener of storageListeners) listener(changes,area); },
    async remove(keys) { for (const key of Array.isArray(keys)?keys:[keys]) delete values[key]; },
    async setAccessLevel() {},
  });
  async function dispatch(message, sender) {
    for (const listener of backgroundListeners) {
      const reply = await new Promise(resolve => { if (listener(message,sender,resolve)!==true) resolve(undefined); });
      if (reply!==undefined) return reply;
    }
    throw Error('No packaged background listener handled fixture message.');
  }
  async function until(predicate, message) {
    const deadline=Date.now()+20000;
    while (Date.now()<deadline) { if (await predicate()) return; await pause(60); }
    throw Error(message);
  }
  try {
    global.chrome={
      runtime:{id:EXT_ID,getURL:suffix=>EXT_ORIGIN+suffix,onMessage:{addListener:listener=>backgroundListeners.push(listener)},onInstalled:{addListener(){}},async openOptionsPage(){},async getContexts(){return clipboardReady?[{}]:[];},async sendMessage(message){
        broadcasts.push(structuredClone(message));
        if (message.channel==='nexo.clipboard.offscreen') {clipboard.push(message.text);return {ok:true};}
        for (const page of pages.keys()) for (const frame of page.frames()) if (frame.url().startsWith(EXT)) await frame.evaluate(({message,id})=>{for(const listener of globalThis.__chromeListeners||[]) listener(message,{id},()=>{});},{message,id:EXT_ID});
      }},
      storage:{local:storage(local,'local'),session:storage(session,'session'),onChanged:{addListener:listener=>storageListeners.push(listener)}},
      permissions:{async contains({origins}){return origins.every(origin=>origin===CRM+'/*');}},
      offscreen:{async createDocument(){clipboardReady=true;}},
      action:{onClicked:{addListener(){}}},
      tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}},onActivated:{addListener(){}},async get(id){const page=pageFor(id);if(!page)throw Error('Closed fixture tab');return tab(page);},async query(query){if(query.active)return whatsapp?[tab(whatsapp)]:[];return [...pages].filter(([page])=>!query.url||page.url().startsWith(query.url.replace(/\*$/,''))).map(([page])=>tab(page));},async create({url}){createdTabs++;const page=await browserContext.newPage();pages.set(page,nextTabId++);await page.goto(url);return tab(page);},async update(id,input){const page=pageFor(id);if(input.url)await page.goto(input.url);return tab(page);},async sendMessage(id,message){
        if(message.channel==='nexo.crm.bridge')bridgeCalls++;
        return pageFor(id).evaluate(({message,id})=>new Promise(resolve=>{let asyncReply=false;let sent=false;const done=value=>{if(!sent){sent=true;resolve(value);}};for(const listener of globalThis.__chromeListeners||[])if(listener(message,{id,url:chrome.runtime.getURL('background.mjs')},done)===true)asyncReply=true;if(!asyncReply&&!sent)resolve(undefined);}),{message,id:EXT_ID});
      }},
      scripting:{async executeScript({target,files}){for(const name of files)await pageFor(target.tabId).evaluate(fs.readFileSync(path.join(unpacked,name),'utf8'));}},
    };
    await import(path.join(root,'extension/background.mjs'));
    browserContext.on('page', page=>{page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());});
    await browserContext.exposeBinding('nexoToBackground',async({page,frame},message)=>{
      const embedded=frame.url().startsWith(EXT)&&frame!==page.mainFrame();
      const sender={id:EXT_ID,frameId:embedded?1:0,url:frame.url()};
      if(frame.url().startsWith(EXT)){const parsed=new URL(frame.url());sender.url=EXT_ORIGIN+parsed.pathname.slice(1)+parsed.search;if(embedded)sender.tab=tab(page);}else sender.tab=tab(page);
      return dispatch(message,sender);
    });
    await browserContext.addInitScript(({id,fixtureExtension})=>{
      globalThis.__chromeListeners=[];
      globalThis.chrome={permissions:{request:async()=>true},runtime:{id,getURL:suffix=>fixtureExtension+suffix,sendMessage:message=>globalThis.nexoToBackground(message),onMessage:{addListener:listener=>globalThis.__chromeListeners.push(listener),removeListener:listener=>{globalThis.__chromeListeners=globalThis.__chromeListeners.filter(item=>item!==listener);}}},storage:{onChanged:{addListener(){}}}};
      const nativeSetInterval=window.setInterval.bind(window);
      window.setInterval=(callback,delay,...args)=>{if(delay===20000)window.__nexoWorkspacePoll=callback;return nativeSetInterval(callback,delay,...args);};
    },{id:EXT_ID,fixtureExtension:EXT});
    await browserContext.route(CRM+'/**',async route=>{
      const request=route.request();
      const headers=await request.allHeaders();
      const result=await api(request.url(),{method:request.method(),headers,body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer()});
      await route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:Buffer.from(await result.arrayBuffer())});
    });
    await browserContext.route(EXT+'**',route=>{
      const filename=path.resolve(unpacked,'.'+new URL(route.request().url()).pathname);
      if(!filename.startsWith(unpacked+path.sep)||!fs.existsSync(filename))return route.fulfill({status:404});
      return route.fulfill({contentType:MIME[path.extname(filename)]||'application/octet-stream',body:fs.readFileSync(filename)});
    });
    await browserContext.route('https://web.whatsapp.com/**',route=>route.fulfill({contentType:'text/html',body:WA}));

    // A private one-use setup link creates the owner's password, then cookie
    // login works normally. Setup secrets leave the address bar immediately.
    const web=await browserContext.newPage();pages.set(web,nextTabId++);
    await web.goto(CRM+'/login#setup='+SETUP);
    await web.locator('#login-submit').waitFor({state:'visible'});
    await until(()=>web.evaluate(()=>!location.hash),'Setup fragment was left in the address bar.');
    await web.locator('[name=email]').fill(OWNER);
    await web.locator('[name=password]').fill(PASSWORD);
    await web.locator('[name=confirmation]').fill('Does not match password');
    await web.locator('#login-submit').click();
    await web.locator('#login-error').filter({hasText:/coincid/i}).waitFor({state:'visible'});
    assert.equal(setupCalls,0,'Mismatched passwords must not be sent.');
    await web.locator('[name=confirmation]').fill(PASSWORD);
    await web.locator('#login-submit').click();
    await until(()=>Promise.resolve(web.url()===CRM+'/'),'Setup did not enter the web CRM.');
    await web.locator('#logout').waitFor({state:'visible'});
    assert.equal(setupCalls,1);
    const webCookies=await browserContext.cookies(CRM);
    const cookie=webCookies.find(value=>value.name==='__Host-nexo_session');
    assert(cookie&&cookie.httpOnly&&cookie.secure&&cookie.sameSite==='Strict','Web session cookie must be private, HTTPS-only and same-site.');
    assert.equal((await DB.prepare('SELECT count(*) AS n FROM auth_owner').first()).n,1);
    const invite=await DB.prepare('SELECT used_at FROM auth_setup WHERE token_hash=?').bind(createHash('sha256').update(SETUP).digest('hex')).first();
    assert(invite.used_at,'The setup invite must be consumed.');
    await web.locator('#logout').click();
    await web.locator('#login-form').waitFor({state:'visible'});
    await web.locator('[name=email]').fill(OWNER);
    await web.locator('[name=password]').fill('Incorrect fixture password');
    await web.locator('#login-submit').click();
    await web.locator('#login-error').filter({hasText:/correo|contraseña|credencial/i}).waitFor({state:'visible'});
    await web.locator('[name=password]').fill(PASSWORD);
    await web.locator('#login-submit').click();
    await web.locator('#logout').waitFor({state:'visible'});
    assert.equal(await web.locator('#password-form').evaluate(node=>node.hidden),false);
    // Close the web app completely. Every following operation must work without
    // a CRM tab or injected bridge, using only the extension's private token.
    pages.delete(web);await web.close();
    assert.equal(pages.size,0);
    if(process.env.PASSWORD_WEB_ONLY==='1'){console.log('Real Worker/D1 web password flow passed: one-use invite, cleared fragment, private cookie, bad/good login, logout and full CRM load.');return;}

    whatsapp=await browserContext.newPage();pages.set(whatsapp,nextTabId++);
    await whatsapp.goto('https://web.whatsapp.com/');
    await whatsapp.evaluate(fs.readFileSync(path.join(unpacked,'whatsapp.js'),'utf8'));
    await whatsapp.evaluate(fs.readFileSync(path.join(unpacked,'dock.js'),'utf8'));
    const iframe=whatsapp.locator('#nexo-whatsapp-dock iframe#nexo-crm-frame');
    await iframe.waitFor({state:'visible'});
    const embedded=await iframe.contentFrame();
    await embedded.locator('#nexo-login-form').waitFor({state:'visible',timeout:25000});
    assert.equal(local.crmOrigin,CRM,'A fresh installation must use its exact pre-granted default CRM.');
    assert.equal(await embedded.locator('#nexo-login-form [type=url]').count(),0);
    const frame=await(await iframe.elementHandle()).contentFrame();
    assert.equal(createdTabs,0,'The password flow must not open a CRM or verification tab.');
    assert.equal(bridgeCalls,0,'The direct password flow must not inject the old CRM bridge.');
    await embedded.locator('#nexo-login-form [name=email]').fill(OWNER);
    await embedded.locator('#nexo-login-form [name=password]').fill('Incorrect fixture password');
    await embedded.locator('#nexo-login-submit').click();
    await until(async()=>/correo|contraseña|credencial/i.test(await embedded.locator('#status').innerText()),'Inline bad password did not show a useful error.');
    assert.equal(await embedded.locator('#companion-workspace').count(),0);
    await embedded.locator('#nexo-login-form [name=password]').fill(PASSWORD);
    await embedded.locator('#nexo-login-submit').click();
    await embedded.locator('#companion-workspace').waitFor({state:'visible',timeout:25000});
    await embedded.locator('#compact-chat-name').filter({hasText:'Cliente de prueba'}).waitFor({state:'visible'});
    assert.equal(createdTabs,0);
    assert.equal(bridgeCalls,0);
    assert(directCalls>0);
    assert(issuedTokens.length>0);
    const entry=session['nativeSession:'+CRM];
    assert(entry&&entry.token===issuedTokens.at(-1));
    assert(!JSON.stringify(local).includes(PASSWORD));
    assert(!JSON.stringify(local).includes(entry.token));
    assert(!JSON.stringify(session).includes(PASSWORD));
    assert(!JSON.stringify(broadcasts).includes(PASSWORD));
    for(const token of issuedTokens)assert(!JSON.stringify(broadcasts).includes(token),'No session token may enter a runtime identity broadcast.');
    await embedded.locator('#compact-edit-contact').click();
    await embedded.locator('#compact-contact-form [name=name]').fill('Cliente actualizado desde WhatsApp');
    await embedded.locator('#compact-contact-form button[type=submit]').click();
    await embedded.locator('#compact-chat-name').filter({hasText:'Cliente actualizado desde WhatsApp'}).waitFor({state:'visible'});
    const saved=await DB.prepare('SELECT revision,body FROM workspace WHERE id=1').first();
    assert.equal(saved.revision,2);
    assert.equal(JSON.parse(saved.body).clients[0].name,'Cliente actualizado desde WhatsApp');
    assert.equal(writes,1);
    assert.equal(createdTabs,0);
    assert.equal(bridgeCalls,0);
    const contentSender={id:EXT_ID,frameId:0,url:'https://web.whatsapp.com/',tab:tab(whatsapp)};
    const denied=await dispatch({channel:'nexo',type:'crm.login',expectedOrigin:CRM,input:{email:OWNER,password:PASSWORD}},contentSender);
    assert.equal(denied.ok,false,'A WhatsApp content script cannot submit privileged login credentials.');
    const ownSender={id:EXT_ID,frameId:1,url:EXT_ORIGIN+'app/index.html?embedded=1',tab:tab(whatsapp)};
    const wrongOrigin=await dispatch({channel:'nexo',type:'crm.request',expectedOrigin:'https://different-crm.test',path:'/api/workspace',method:'GET'},ownSender);
    assert.equal(wrongOrigin.ok,false);

    // Expired/revoked bearer sessions return to the login form in the same dock.
    await DB.prepare("DELETE FROM auth_sessions WHERE kind='extension'").run();
    await embedded.locator('#compact-refresh').click();
    await embedded.locator('#nexo-login-form').waitFor({state:'visible',timeout:25000});
    assert.equal(createdTabs,0);
    assert.equal(bridgeCalls,0);
    assert.equal(whatsapp.url(),'https://web.whatsapp.com/');
    await embedded.locator('#nexo-login-form [name=email]').fill(OWNER);
    await embedded.locator('#nexo-login-form [name=password]').fill(PASSWORD);
    await embedded.locator('#nexo-login-submit').click();
    await embedded.locator('#companion-workspace').waitFor({state:'visible',timeout:25000});
    const afterLogin=session['nativeSession:'+CRM];
    assert(afterLogin&&afterLogin.token);
    const response=await dispatch({channel:'nexo',type:'crm.request',expectedOrigin:CRM,path:'/api/logout',method:'POST',body:'{}'},ownSender);
    assert.equal(response.ok,true);
    assert.equal(response.result.status,200);
    assert(!session['nativeSession:'+CRM],'Explicit logout must remove the trusted token.');
    assert.equal((await DB.prepare("SELECT count(*) AS n FROM auth_sessions WHERE kind='extension'").first()).n,0);
    await embedded.locator('#nexo-login-form').waitFor({state:'visible',timeout:25000});
    // The old options flow let an unrelated required domain field block the
    // sign-in button. The normal form must now work with advanced address empty.
    const options=await browserContext.newPage();pages.set(options,nextTabId++);
    await options.goto(EXT+'options.html');
    await options.locator('#login-form').waitFor({state:'visible'});
    assert.equal(await options.locator('#advanced').evaluate(node=>node.open),false);
    assert.equal(await options.locator('#login-form [name=origin]').count(),0);
    await options.locator('#origin').evaluate(node=>{node.value='';});
    await options.locator('#login-form [name=email]').fill(OWNER);
    await options.locator('#login-form [name=password]').fill(PASSWORD);
    await options.locator('#login-submit').click();
    await until(async()=>/Sesión iniciada/i.test(await options.locator('#status').innerText()),'The separate advanced domain field blocked normal email/password login.');
    assert.equal(await options.locator('#login-form [name=password]').inputValue(),'');
    await embedded.locator('#companion-workspace').waitFor({state:'visible',timeout:25000});
    await embedded.locator('#compact-chat-name').filter({hasText:'Cliente actualizado desde WhatsApp'}).waitFor({state:'visible'});
    assert.equal(createdTabs,0);
    assert.equal(bridgeCalls,0);
    assert.equal(writes,1);
    assert(!JSON.stringify(local).includes(PASSWORD));
    assert(!JSON.stringify(session).includes(PASSWORD));
    assert(!JSON.stringify(broadcasts).includes(PASSWORD));
    for(const token of issuedTokens){assert(!JSON.stringify(local).includes(token));assert(!JSON.stringify(broadcasts).includes(token));}
    pages.delete(options);await options.close();
    const lastLogout=await dispatch({channel:'nexo',type:'crm.request',expectedOrigin:CRM,path:'/api/logout',method:'POST',body:'{}'},ownSender);
    assert.equal(lastLogout.ok,true);
    assert.equal(lastLogout.result.status,200);
    assert(!session['nativeSession:'+CRM]);
    const safeErrors=errors.filter(message=>!/No se pudo verificar la sesión privada|Tu sesión caducó|Sesión no válida|401|Service Worker/i.test(message));
    assert.deepEqual(safeErrors,[]);
    console.log('Password browser integration passed: private one-use web setup, fragment clearing, cookie login/logout, fresh-install inline WhatsApp email/password login without a domain form, real D1 write, no CRM tab/bridge, token privacy/origin isolation, expiry/relogin/revocation, and options login unaffected by an empty advanced domain.');
    console.log('The HTTP handler/authentication/D1 and packaged UI/router are real; Chrome APIs and the WhatsApp DOM are fixtures. No production accounts or MV3 install policy were changed.');
  } finally {
    global.fetch=nativeFetch;
    delete global.chrome;
    await browser.close();
    await mf.dispose();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
