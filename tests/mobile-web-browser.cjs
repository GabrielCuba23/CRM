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
const OPTIONAL_VIEWS = ['security','automation','integrations','settings','marketing','social'];
const PROFILE_MENU_ONLY = process.env.PROFILE_MENU_ONLY === '1';

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
    let workspaceFailures = 0, workspaceWrites = 0;
    await context.route(ORIGIN+'/**', async route => {
      const request = route.request();
      if (new URL(request.url()).pathname === '/api/workspace' && request.method() === 'PUT') {
        workspaceWrites++;
        if (workspaceFailures > 0) {
          workspaceFailures--;
          return route.fulfill({status:503, json:{error:'Fallo sintético de guardado; inténtalo otra vez.'}});
        }
      }
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

    const workspace = () => DB.prepare('SELECT revision,body FROM workspace WHERE id=1').first();
    const menuInput = name => page.locator(`#profile-menu-form [name=${name}]`);
    const navLink = name => page.locator(`nav [data-view=${name}]`);
    const allEnabled = Object.fromEntries(OPTIONAL_VIEWS.map(name => [name,true]));
    async function menuState(expected) {
      for (const name of OPTIONAL_VIEWS) {
        assert.equal(await menuInput(name).isChecked(), expected[name], `${name} checkbox must match the saved menu preference.`);
        assert.equal(await navLink(name).getAttribute('aria-disabled') === 'true', !expected[name], `${name} navigation must match the saved menu preference.`);
        assert.equal(await navLink(name).isVisible(), true, `${name} must remain visible in the menu.`);
      }
      assert.notEqual(await navLink('profile').getAttribute('aria-disabled'), 'true', 'Profile must always remain accessible.');
    }
    async function saveMenu(status = 200) {
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace' && response.request().method() === 'PUT' && response.status() === status),
        page.locator('#profile-menu-save').click(),
      ]);
      await page.waitForFunction(() => !document.querySelector('#profile-menu-save').disabled);
      if (status === 200) await page.waitForFunction(() => /guardad/i.test(document.querySelector('#profile-menu-status').textContent));
    }
    async function blockedRoute(name) {
      await page.evaluate(value => { location.hash = value; }, name);
      await page.waitForFunction(() => location.hash === '#profile' && !document.querySelector('#profile').hidden);
      assert.equal(await page.locator('#'+(name === 'templates' ? 'automation' : name)).isVisible(), false, `${name} must not open while disabled.`);
    }

    // The same authenticated standalone app must expose an always-accessible
    // Profile while advanced sections start disabled for existing workspaces.
    const initialWorkspace = await workspace();
    for (const width of [360,390,1440]) {
      await page.setViewportSize({width,height:900});
      await view('profile');
      await menuState(Object.fromEntries(OPTIONAL_VIEWS.map(name => [name,false])));
      assert.equal((await page.locator('#profile-email').innerText()).includes(OWNER), true);
      assert.equal(await page.locator('#profile #password-form').isVisible(), true, 'Password changes must remain available with Security disabled.');
      if (width < 500) await touchTargets('nav a, #open-profile, #profile-menu-form label, #profile-menu-save', 'Profile and menu');
      const enabledAppearance = await navLink('home').evaluate(node => ({color:getComputedStyle(node).color,opacity:Number(getComputedStyle(node).opacity)}));
      for (const name of OPTIONAL_VIEWS) {
        const disabledAppearance = await navLink(name).evaluate(node => ({color:getComputedStyle(node).color,opacity:Number(getComputedStyle(node).opacity)}));
        assert(disabledAppearance.opacity < enabledAppearance.opacity || disabledAppearance.color !== enabledAppearance.color, `${name} must look disabled at ${width}px.`);
        // Force the real click because Playwright respects aria-disabled and
        // otherwise refuses to exercise the app's disabled-link handler.
        await navLink(name).click({force:true});
        await page.locator('#profile').waitFor({state:'visible'});
        assert.equal(new URL(page.url()).hash, '#profile');
        await blockedRoute(name);
      }
      await blockedRoute('templates');
      await page.screenshot({path:path.join(output, `profile-default-${width}.png`),fullPage:true});
    }
    assert.deepEqual(await workspace(), initialWorkspace, 'Viewing Profile and blocked sections must not write to D1.');
    assert.equal(workspaceWrites, 0);

    await page.setViewportSize({width:360,height:844});
    await page.locator('#open-profile').click();
    await page.locator('#profile').waitFor({state:'visible'});
    for (const name of OPTIONAL_VIEWS) await menuInput(name).check();
    assert.deepEqual(await workspace(), initialWorkspace, 'Checking a section must not persist before Save.');
    for (const name of OPTIONAL_VIEWS) assert.equal(await navLink(name).getAttribute('aria-disabled'), 'true');
    workspaceFailures = 1;
    await saveMenu(503);
    assert.match(await page.locator('#profile-menu-status').innerText(), /Fallo sintético|No se pudo|No se pudieron/i);
    for (const name of OPTIONAL_VIEWS) {
      assert.equal(await menuInput(name).isChecked(), true, 'Failed saves must preserve the selected draft.');
      assert.equal(await navLink(name).getAttribute('aria-disabled'), 'true', 'Failed saves must not enable navigation.');
    }
    assert.deepEqual(await workspace(), initialWorkspace, 'A failed preference save must not change D1.');

    await saveMenu();
    await menuState(allEnabled);
    const enabledWorkspace = await workspace();
    assert.equal(enabledWorkspace.revision, initialWorkspace.revision+1);
    const savedState = JSON.parse(enabledWorkspace.body);
    assert.deepEqual(savedState.settings.menuSections, allEnabled);
    for (const key of ['clients','accounts','combos','ledger','templates','automation']) assert.deepEqual(savedState[key], state[key], `Menu preferences must preserve ${key}.`);
    for (const [key,value] of Object.entries(state.settings)) assert.deepEqual(savedState.settings[key], value, `Menu preferences must preserve settings.${key}.`);
    await page.reload();
    await page.locator('#profile-menu-save').waitFor({state:'visible'});
    await menuState(allEnabled);
    assert.deepEqual(await workspace(), enabledWorkspace, 'Reloading saved preferences must not write to D1.');

    await menuInput('automation').uncheck();
    await saveMenu();
    const selectivelyEnabled = {...allEnabled,automation:false};
    await menuState(selectivelyEnabled);
    const disabledWorkspace = await workspace();
    assert.equal(disabledWorkspace.revision, enabledWorkspace.revision+1);
    assert.deepEqual(JSON.parse(disabledWorkspace.body).settings.menuSections, selectivelyEnabled);
    await view('customers');
    await navLink('automation').click({force:true});
    await page.locator('#profile').waitFor({state:'visible'});
    await blockedRoute('automation');
    await blockedRoute('templates');
    assert.equal(await page.locator('#profile #password-form').isVisible(), true);
    await page.reload();
    await page.locator('#profile-menu-save').waitFor({state:'visible'});
    await menuState(selectivelyEnabled);
    assert.deepEqual(await workspace(), disabledWorkspace);
    await page.screenshot({path:path.join(output,'profile-saved-mobile.png'),fullPage:true});
    assert.deepEqual(foreignRequests,[], 'Menu preferences must not visit external services.');
    assert.deepEqual(errors,[]);
    if (PROFILE_MENU_ONLY) {
      assert.equal(workspaceWrites, 3, 'Only two successful preference writes and the explicit failed attempt are expected.');
      console.log(`PASS: Profile menu defaults at 360/390/1440px, password access, blocked navigation, failed-save draft/error, real Worker/D1 save/reload and selective disabling. Screenshots: ${output}`);
      return;
    }

    // Restore all sections explicitly before retaining the full mobile layout
    // coverage. All subsequent service-message interactions must be read-only.
    await menuInput('automation').check();
    await saveMenu();
    await menuState(allEnabled);
    const messageWorkspace = await workspace();
    const writesBeforeMessages = workspaceWrites;

    for (const width of [360,390]) {
      await page.setViewportSize({width,height:844});
      for (const name of ['home','profile','accounts','free','renewals','finance','customers','messages','combos',...OPTIONAL_VIEWS]) await view(name);
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
    assert.deepEqual(await workspace(), messageWorkspace, 'Preparing messages must not change any workspace data or mark messages sent.');
    assert.equal(workspaceWrites, writesBeforeMessages, 'Preparing messages must not attempt any workspace writes.');
    assert.deepEqual(foreignRequests,[], 'This test must not visit WhatsApp or any real external service.');
    assert.deepEqual(errors,[]);
    console.log(`PASS: standalone Worker/D1 Profile preferences at 360/390/1440px, blocked navigation and save failure, mobile CRM views, four WhatsApp editor actions, edited URL text, username-only fallback, touch targets and desktop table. Screenshots: ${output}`);
  } finally {
    await context.close();
    await browser.close();
    await mf.dispose();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
