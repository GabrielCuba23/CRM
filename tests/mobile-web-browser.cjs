const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const toolPackages = [process.env.CRM_CLOUD_TOOLS, '/tmp/crm-cloud-tools/package.json', path.resolve(root, '../cloud-tools/package.json')].filter(Boolean);
const tooling = toolPackages.find(filename => fs.existsSync(filename));
if (!tooling) throw Error('Install Miniflare in /tmp/crm-cloud-tools or set CRM_CLOUD_TOOLS to its package.json.');
const { Miniflare, convertV4MiniflareOptions } = createRequire(tooling)('miniflare');
const ORIGIN = 'https://mobile-crm.example.test';
const OWNER = 'owner@example.test';
const PASSWORD = 'Mobile fixture only! 7294';
const SETUP = 'setup_mobile_fixture_' + 'z'.repeat(40);
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.mjs':'text/javascript', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };

// Real Worker authentication, D1 persistence and the unmodified standalone web
// app. All contacts and account credentials are synthetic. No extension APIs or
// WhatsApp pages are installed and no external message URL is followed.
(async () => {
  const { handleRequest } = await import(path.join(root, 'cloud/index.mjs'));
  const { emptyState } = await import(path.join(root, 'cloud/state.mjs'));
  const mf = new Miniflare(convertV4MiniflareOptions({ workers:[{
    name:'mobile-web-browser', modules:true,
    script:'export default { fetch(){ return new Response("fixture"); } }',
    d1Databases:{ DB:'mobile-web-browser' },
  }] }));
  const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
  const context = await browser.newContext({ viewport:{width:360,height:800}, isMobile:true, hasTouch:true, serviceWorkers:'block' });
  context.setDefaultTimeout(12000);
  await context.grantPermissions(['clipboard-read','clipboard-write'], {origin:ORIGIN});
  const errors = [], foreignRequests = [];
  fs.mkdirSync(path.join(root, 'work'), {recursive:true});
  const output = fs.mkdtempSync(path.join(root, 'work', 'mobile-web-browser-'));
  try {
    const DB = await mf.getD1Database('DB');
    await DB.exec(fs.readFileSync(path.join(root, 'cloud/schema.sql'), 'utf8').replace(/\n/g, ' '));
    await DB.prepare('INSERT INTO auth_setup(token_hash,email,expires,used_at) VALUES(?,?,?,NULL)')
      .bind(createHash('sha256').update(SETUP).digest('hex'), OWNER, Math.floor(Date.now()/1000)+3600).run();
    const state = emptyState();
    state.settings.payments = 'Yape de prueba: 999 999 999';
    state.accounts = [{ id:'mobile-account', service:'PlataformaSintéticaConUnNombreLargoSinEspaciosParaVerificarElAncho', email:'cuenta.sintetica@example.test', password:'Synthetic-account-only! 8372', provider:'ProveedorSintéticoConUnNombreLargoSinEspaciosParaVerificarElAncho', expires:'2099-12-31', capacity:4 }];
    state.clients = [
      { id:'mobile-phone', name:'ClienteConUnNombreLargoSinEspaciosParaProbarLaFichaEnUnTeléfono', phone:'51999999999', whatsappUsername:'', email:'cliente.sintetico@example.test', service:state.accounts[0].service, profile:'Perfil 1', expires:'2099-11-20', notes:'Datos ficticios para prueba de móvil', accountId:'mobile-account', pin:'1234', price:2500, archived:false, serviceHistory:[], reminderConsent:false, marketingConsent:false },
      { id:'mobile-username', name:'Contacto solo por usuario', phone:'', whatsappUsername:'@cliente.sintetico', email:'', service:'MAX', profile:'Perfil sintético 2', expires:'2099-11-21', notes:'Usuario ficticio', accountId:'', pin:'', price:1800, archived:false, serviceHistory:[], reminderConsent:false, marketingConsent:false },
    ];
    await DB.prepare('INSERT INTO workspace(id,revision,body) VALUES(1,1,?)').bind(JSON.stringify(state)).run();
    const env = {
      DB, OWNER_EMAIL:OWNER, AUTH_MODE:'password', AUTH_PASSWORD_PEPPER:'synthetic-mobile-pepper-not-production-secret-7294',
      ASSETS:{ async fetch(request) {
        const filename = path.resolve(root, '.' + new URL(request.url).pathname);
        if (!filename.startsWith(root+path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return new Response('Not found', {status:404});
        return new Response(fs.readFileSync(filename), {headers:{'Content-Type':MIME[path.extname(filename)] || 'application/octet-stream'}});
      } },
    };
    await context.route('**/*', route => {
      foreignRequests.push(route.request().url());
      return route.fulfill({status:200, contentType:'text/html', body:'<!doctype html><title>Blocked external fixture</title>'});
    });
    await context.route(ORIGIN+'/**', async route => {
      const request = route.request();
      const response = await handleRequest(new Request(request.url(), {
        method:request.method(), headers:await request.allHeaders(),
        body:['GET','HEAD'].includes(request.method()) ? undefined : request.postDataBuffer(),
      }), env);
      await route.fulfill({ status:response.status, headers:Object.fromEntries(response.headers), body:Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN+'/login#setup='+SETUP);
    await page.locator('[name=email]').fill(OWNER);
    await page.locator('[name=password]').fill(PASSWORD);
    await page.locator('[name=confirmation]').fill(PASSWORD);
    await page.locator('#login-submit').click();
    await page.locator('#logout').waitFor({state:'visible'});
    assert.equal(await page.evaluate(() => !!globalThis.NexoCompanion), false, 'Phone use must work without the extension.');

    async function fits(label, selector = 'html') {
      const dimensions = await page.locator(selector).evaluate(node => ({ width:node.clientWidth, scroll:node.scrollWidth }));
      if (dimensions.scroll > dimensions.width+1) {
        await page.screenshot({path:path.join(output,'overflow.png'),fullPage:true});
        console.error('Overflow candidates:',await page.evaluate(() => [...document.querySelectorAll('body *')].filter(node=>!node.closest('nav, .table-scroll') && node.getClientRects().length && node.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(node).position!=='fixed').slice(0,16).map(node=>({tag:node.tagName,id:node.id,class:node.className?.baseVal ?? node.className,width:node.getBoundingClientRect().width,right:node.getBoundingClientRect().right}))));
      }
      assert(dimensions.scroll <= dimensions.width+1, `${label} overflowed: ${JSON.stringify(dimensions)}`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), `${label} overflowed the viewport.`);
    }
    async function touchTargets(selector, label) {
      const small = await page.locator(selector).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({text:node.textContent.trim(), height:node.getBoundingClientRect().height, width:node.getBoundingClientRect().width})).filter(rect => rect.height < 43.5 || rect.width < 43.5));
      assert.deepEqual(small, [], `${label} has targets smaller than 44px.`);
    }
    async function view(name) {
      await page.locator(`nav [data-view=${name}]`).click();
      await page.locator('#'+name).waitFor({state:'visible'});
      await fits(name);
    }

    for (const width of [360,390]) {
      await page.setViewportSize({width,height:844});
      for (const name of ['home','accounts','free','renewals','finance','customers','messages','combos','security','automation','integrations','settings','marketing','social']) await view(name);
      await touchTargets('nav a', 'Navigation');
      await view('customers');
      const cards = page.locator('#mobile-client-list .mobile-client-card');
      assert.equal(await cards.count(),2, JSON.stringify({errors, total:await page.locator('#total').innerText(), status:await page.locator('#status').innerText(), empty:await page.locator('#empty').innerText()}));
      assert.equal(await page.locator('.desktop-client-table').isVisible(),false);
      await touchTargets('#mobile-client-list button', 'Customer card');
      await page.screenshot({path:path.join(output, `customers-${width}.png`),fullPage:true});

      const card = cards.filter({hasText:state.clients[0].name});
      for (const action of ['renewal','cancellation','delivery','collection']) {
        await card.locator(`[data-action=${action}]`).click();
        await page.locator('#message-dialog').waitFor({state:'visible'});
        await fits(`${action} editor at ${width}`, '#message-dialog');
        await touchTargets('#message-dialog button, #message-dialog a.button', 'Message editor');
        const original = await page.locator('#message-text').inputValue();
        assert(original.trim(), `${action} must prepare a message.`);
        const edited = `${original}\nTexto editado de prueba & ✅`;
        await page.locator('#message-text').fill(edited);
        const url = new URL(await page.locator('#open-whatsapp').getAttribute('href'));
        assert.equal(url.hostname,'wa.me');
        assert.equal(url.pathname,'/51999999999');
        assert.equal(url.searchParams.get('text'),edited);
        assert.notEqual(await page.locator('#open-whatsapp').getAttribute('aria-disabled'),'true');
        if (action === 'delivery') {
          assert(original.includes(state.accounts[0].password), 'Delivery should include the assigned account credential.');
          assert(original.includes(state.accounts[0].email), 'Delivery should use the assigned account access email.');
          assert(!original.includes(state.clients[0].email), 'The contact email must not replace the account access email.');
        }
        if (action === 'collection') assert(original.includes(state.settings.payments), 'Collection should include the configured payment methods.');
        await page.screenshot({path:path.join(output, `${action}-${width}.png`)});
        await page.locator('#message-dialog .close').click();
      }

      // Username-only contacts retain all four service actions and an editable
      // message without inventing a telephone destination.
      await cards.filter({hasText:'Contacto solo por usuario'}).locator('[data-action=collection]').click();
      await fits(`Username-only editor at ${width}`, '#message-dialog');
      const share = new URL(await page.locator('#open-whatsapp').getAttribute('href'));
      assert.equal(share.hostname,'wa.me');
      assert.equal(share.pathname,'/');
      assert.equal(share.searchParams.get('text'),await page.locator('#message-text').inputValue());
      assert.equal(await page.locator('#copy-whatsapp-username').isVisible(),true);
      assert.equal(await page.locator('#message-username-note').isVisible(),true);
      assert((await page.locator('#message-dialog').innerText()).includes('@cliente.sintetico'));
      await page.locator('#copy-whatsapp-username').click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '@cliente.sintetico');
      await page.screenshot({path:path.join(output,`username-${width}.png`)});
      await page.locator('#message-dialog .close').click();

      await page.locator('#add-customer').click();
      await fits(`Customer form at ${width}`, '#client-dialog');
      assert.equal(await page.locator('#client-form [name=whatsappUsername]').isVisible(),true);
      await touchTargets('#client-dialog button', 'Customer form');
      await page.screenshot({path:path.join(output, `client-form-${width}.png`)});
      await page.locator('#client-dialog .close').first().click();
    }
    await page.setViewportSize({width:1440,height:900});
    await view('customers');
    assert.equal(await page.locator('.desktop-client-table').isVisible(),true);
    assert.equal(await page.locator('#mobile-client-list').isVisible(),false);
    assert.equal(await page.locator('#clients tr').count(),2);
    await page.screenshot({path:path.join(output,'customers-desktop.png'),fullPage:true});
    assert.equal((await DB.prepare('SELECT revision FROM workspace WHERE id=1').first()).revision,1, 'Preparing messages must not change the workspace or mark messages sent.');
    assert.deepEqual(foreignRequests,[], 'This test must not visit WhatsApp or any real external service.');
    assert.deepEqual(errors,[]);
    console.log(`PASS: standalone Worker/D1 mobile CRM, 360/390px views, four WhatsApp editor actions, edited URL text, username-only fallback, touch targets and desktop table. Screenshots: ${output}`);
  } finally {
    await context.close();
    await browser.close();
    await mf.dispose();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
