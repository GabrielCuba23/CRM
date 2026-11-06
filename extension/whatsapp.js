(() => {
  if (globalThis.__nexoWhatsAppAdapter) return;
  // Bindings are local to this WhatsApp document and the exact peer that was
  // confirmed. A draft telephone field in the CRM never changes this context.
  const manualBindings = new Map();
  const sessionNonce = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
  let bindingScope = "";
  const observedPhones = new Map();
  const observedDrawers = new WeakMap();
  const plainContactPanes = new Set();
  let selectedPhone = null;
  let nativeHeader = null, nativeGeneration = 0, navigationRevision = 0, openIntent = null, openIntentRevision = 0;
  let initialNativeGeneration = 0;
  let requestContextUpdate = () => {};
  let lastObserved = null, identityTransition = null;
  const transitionDelay = 250;
  const phone = value => {
    const text = String(value || "").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").trim();
    if (!/^\+?[\d\s().-]+$/.test(text)) return "";
    let digits = text.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (!text.startsWith("+") && !text.startsWith("00") && digits.length < 10) return "";
    if (!/^[1-9]\d{7,14}$/.test(digits)) return "";
    return digits.startsWith("51") && !/^519\d{8}$/.test(digits) ? "" : digits;
  };
  function main() { return document.querySelector("#main") || document.querySelector('[data-testid="conversation-panel-wrapper"]'); }
  const contactDrawerSelector = [
    '[data-testid="contact-info-drawer"]',
    '[data-testid="drawer-right"][aria-label="Contact info"]',
    '[data-testid="drawer-right"][aria-label="Información del contacto"]',
    '[role="dialog"][aria-label="Contact info"]',
    '[role="dialog"][aria-label="Contact information"]',
    '[role="dialog"][aria-label="Información del contacto"]',
    '[role="dialog"][aria-label="Información de contacto"]',
    '[role="complementary"][aria-label="Contact info"]',
    '[role="complementary"][aria-label="Información del contacto"]',
  ].join(",");
  const contactNameSelectors = [
    '[data-testid="contact-info-name"]',
    '[data-testid="contact-info-drawer-contact-name"]',
    '[data-testid="contact-info-drawer-contact-title"]',
    'h1[dir="auto"]', 'h2[dir="auto"]', 'span[title][dir="auto"]',
  ];
  const contactPhoneSelector = [
    '[data-testid="contact-info-phone"]',
    '[data-testid="contact-info-drawer-phone"]',
    '[data-testid="contact-phone-number"]',
    '[aria-label="Phone number"]', '[aria-label="Número de teléfono"]',
    'a[href^="tel:"]',
  ].join(",");
  const contactName = value => String(value || "").normalize("NFC").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const nativeChatListSelector = '#pane-side, [data-testid="chat-list"], [aria-label="Chat list"], [aria-label="Lista de chats"]';
  const nativeSelectedSelector = '#pane-side [aria-selected="true"], [data-testid="chat-list"] [aria-selected="true"], [aria-label="Chat list"] [aria-selected="true"], [aria-label="Lista de chats"] [aria-selected="true"]';
  const excludedContactRegion = 'footer, [role="log"], [data-id], [data-pre-plain-text], .copyable-text, .message-in, .message-out, [data-testid="quoted-message"], .quoted-mention, iframe, nexo-whatsapp-dock, #nexo-whatsapp-dock, nexo-crm-dock, #nexo-crm-dock';
  const nativeInfoTitles = new Set(['info. del contacto', 'info del contacto', 'información del contacto', 'información de contacto', 'contact info', 'contact information']);
  function outsideContactRegion(node) {
    return Boolean(node?.closest?.(excludedContactRegion + ', ' + nativeChatListSelector));
  }
  function boundedElements(root, limit = 220) {
    if (!document.createTreeWalker) return [];
    const walker = document.createTreeWalker(root, 1, {
      acceptNode: item => outsideContactRegion(item) ? 2 : 1,
    });
    const result = [];
    for (let item = walker.nextNode(); item && result.length < limit; item = walker.nextNode()) result.push(item);
    return result;
  }
  function smallText(node) {
    // Do not inspect a wrapper's aggregate conversation text. Heading/profile
    // candidates contain their own short, visible text only.
    if (node.childElementCount > 3 || outsideContactRegion(node)) return '';
    let value = '';
    // Plain text or one shallow formatting layer is enough for native headings
    // and profile labels. Do not aggregate a distant wrapper's hidden messages.
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) value += child.textContent || '';
      else if (child.nodeType === 1 && !child.childElementCount && !outsideContactRegion(child) && visible(child)) value += child.textContent || '';
      else return '';
      if (value.length > 180) return '';
    }
    return value.length <= 180 ? contactName(value) : '';
  }
  function structuralContactPanels(name) {
    const app = document.querySelector('#app');
    if (!app || !document.createTreeWalker || !name) return [];
    const descriptors = new Map();
    // Prune chat lists and message bubbles before reading text. Production
    // WhatsApp renders this pane with ordinary spans, without test IDs or ARIA.
    for (const heading of boundedElements(app, 2200)) {
      if (!nativeInfoTitles.has(smallText(heading).toLocaleLowerCase('es')) || !visible(heading)) continue;
      for (let pane = heading.parentElement, depth = 0; pane && pane !== app && depth < 6; pane = pane.parentElement, depth++) {
        if (pane === main() || outsideContactRegion(pane) || !visible(pane)) continue;
        const elements = boundedElements(pane);
        const identity = elements.find(item => item !== heading && !item.contains?.(heading) && !item.closest?.('header') && visible(item) && smallText(item) === contactName(name));
        if (!identity) continue;
        let phoneNodes = [];
        // The smallest profile block holding name and phone wins. Later note,
        // media and message sections cannot supply a telephone accidentally.
        for (let block = identity.parentElement, hops = 0; block && pane.contains(block) && hops < 4; block = block.parentElement, hops++) {
          const fields = boundedElements(block, 100);
          phoneNodes = fields.filter(item => visible(item) && phone(smallText(item)));
          if (phoneNodes.length || block === pane) break;
        }
        if (!phoneNodes.length) continue;
        descriptors.set(pane, { element: pane, identity, phoneNodes, anchored: true });
        plainContactPanes.add(pane);
        for (const remembered of plainContactPanes) if (!remembered.isConnected) plainContactPanes.delete(remembered);
        if (plainContactPanes.size > 8) plainContactPanes.delete(plainContactPanes.values().next().value);
        break;
      }
    }
    return [...descriptors.values()];
  }
  function observeNativeHeader(header, name, peer, headerPhone) {
    const selected = document.querySelector(nativeSelectedSelector);
    const stable = Boolean(nativeHeader && nativeHeader.element === header && nativeHeader.name === name && nativeHeader.peer === peer && nativeHeader.phone === headerPhone && nativeHeader.selected === selected && nativeHeader.navigationRevision === navigationRevision);
    if (!stable)
      nativeGeneration++;
    if (!initialNativeGeneration && !navigationRevision) initialNativeGeneration = nativeGeneration;
    nativeHeader = { element: header, name, peer, phone: headerPhone, selected, navigationRevision };
    return stable;
  }
  function drawerPhone(name, knownHeader) {
    const candidates = new Set();
    if (!name || !document.querySelectorAll) return { phone: "", ambiguous: false };
    // Read only an explicitly visible native contact-info surface. Never scan
    // messages, the document's generic phone-like text, extension shadow roots
    // or CRM iframes. The exact contact heading ties it to the current header.
    const drawers = new Map([...document.querySelectorAll(contactDrawerSelector)].map(element => [element, { element }]));
    for (const descriptor of structuralContactPanels(name)) drawers.set(descriptor.element, descriptor);
    for (const descriptor of drawers.values()) {
      const drawer = descriptor.element;
      if (drawer.closest?.("nexo-whatsapp-dock, nexo-crm-dock, #nexo-crm-dock, iframe")) continue;
      const previous = observedDrawers.get(drawer);
      if (!visible(drawer)) {
        observedDrawers.set(drawer, { ...previous, visible: false });
        continue;
      }
      let identity = descriptor.identity;
      for (const selector of contactNameSelectors) {
        if (identity) break;
        identity = drawer.querySelector(selector);
      }
      const drawerName = identity && visible(identity) ? contactName(identity.getAttribute("title") || identity.textContent) : "";
      const drawerNumbers = new Set();
      for (const node of descriptor.phoneNodes || drawer.querySelectorAll(contactPhoneSelector)) {
        if (!visible(node)) continue;
        const href = node.getAttribute("href") || "";
        const found = phone(href.startsWith("tel:") ? href.slice(4) : node.getAttribute("title") || node.textContent);
        if (found) drawerNumbers.add(found);
      }
      const numbers = [...drawerNumbers].sort().join(",");
      const singlePhone = drawerNumbers.size === 1 ? [...drawerNumbers][0] : "";
      const matching = drawerName && drawerName === contactName(name);
      const currentIntent = openIntent?.header === nativeHeader.element && openIntent.navigationRevision === navigationRevision && openIntent.generation === nativeGeneration;
      const reopened = previous?.visible === false && currentIntent && previous.openIntentRevision !== openIntent.revision;
      // A displayed alias is not unique. Keep an observed drawer bound to its
      // native conversation generation; an unchanged old drawer cannot lend its
      // phone to a new peer with the same name. A changed phone or a fresh native
      // drawer appearance is needed after navigation, even for equal aliases.
      const stableInitialPane = descriptor.anchored && previous?.initialGeneration === nativeGeneration && nativeGeneration === initialNativeGeneration && !navigationRevision;
      const fresh = (!previous && knownHeader) || reopened || stableInitialPane || (previous?.singlePhone && singlePhone && previous.singlePhone !== singlePhone);
      const authorized = Boolean(matching && knownHeader && (previous?.generation === nativeGeneration && previous.authorized || fresh));
      observedDrawers.set(drawer, { generation: nativeGeneration, initialGeneration: previous?.initialGeneration || (descriptor.anchored && nativeGeneration === initialNativeGeneration && !navigationRevision ? nativeGeneration : 0), authorized, visible: true, numbers, singlePhone: authorized && singlePhone ? singlePhone : previous?.singlePhone || singlePhone, openIntentRevision: authorized && currentIntent ? openIntent.revision : previous?.openIntentRevision });
      if (authorized) for (const number of drawerNumbers) candidates.add(number);
    }
    return { phone: candidates.size === 1 ? [...candidates][0] : "", ambiguous: candidates.size > 1 };
  }
  function rawContext() {
    const root = main(), header = root?.querySelector("header");
    if (!header) {
      if (nativeHeader) nativeGeneration++;
      nativeHeader = null;
      return { name: "", phone: "", chatId: "", isGroup: false, phoneSource: "" };
    }
    const title = header.querySelector('[data-testid="conversation-info-header-chat-title"]') || header.querySelector('span[title]') || header.querySelector('[dir="auto"]');
    const name = String(title?.getAttribute("title") || title?.textContent || "").trim().slice(0, 160);
    const candidates = new Set();
    for (const node of header.querySelectorAll("[title], [dir=auto]")) {
      const found = phone(node.getAttribute("title") || node.textContent);
      if (found) candidates.add(found);
    }
    // data-id's peer component is an opaque conversation identity, NOT a phone number.
    const peers = new Set();
    for (const node of root.querySelectorAll("[data-id]")) {
      // Quoted message IDs belong to the quoted sender, not necessarily this
      // conversation. They must not poison the identity of the open chat.
      if (node.closest?.('[data-testid="quoted-message"], .quoted-mention')) continue;
      const match = /^(?:true|false)_([^_]+)_/.exec(node.getAttribute("data-id") || "");
      if (match && match[1].length <= 280) peers.add(match[1]);
    }
    const peer = peers.size === 1 ? [...peers][0] : "";
    const knownHeader = observeNativeHeader(header, name, peer, candidates.size === 1 ? [...candidates][0] : "");
    const groupDescription = header.textContent || "";
    const isGroup = /@g\.us$|@newsletter$|@broadcast$/.test(peer) || !!header.querySelector('[data-icon="default-group"], [data-testid="default-group"]') || /\b(participantes|participants|members)\b/i.test(groupDescription);
    const revealed = !isGroup && peers.size <= 1 && candidates.size === 0 ? drawerPhone(name, knownHeader) : { phone: "", ambiguous: false };
    const number = candidates.size === 1 ? [...candidates][0] : revealed.phone;
    return { name, phone: number, chatId: peer ? "wa:" + peer : number ? "phone:" + number : name && !isGroup ? "session:" + sessionNonce + ":" + nativeGeneration : "", isGroup, phoneSource: number ? "visible" : "", ambiguous: peers.size > 1 || candidates.size > 1 || revealed.ambiguous };
  }
  function identifiedContext() {
    const value = rawContext();
    // React may update the header before replacing the previous chat's message
    // nodes. Do not combine that new name with the old peer's cached telephone.
    const samePeer = value.chatId.startsWith("wa:") && value.chatId === lastObserved?.chatId;
    const sameNumberTitle = value.phone && phone(value.name) === value.phone && phone(lastObserved?.name) === value.phone;
    if (samePeer && value.name && lastObserved.name && value.name !== lastObserved.name && !sameNumberTitle) {
      manualBindings.delete(value.chatId);
      identityTransition = { chatId: value.chatId, name: value.name, until: Date.now() + transitionDelay };
    } else if (identityTransition && (identityTransition.chatId !== value.chatId || identityTransition.name !== value.name)) {
      identityTransition = null;
    }
    lastObserved = value;
    if (identityTransition && Date.now() < identityTransition.until)
      return { ...value, phone: "", phoneSource: "", chatId: "", ambiguous: true };
    identityTransition = null;
    return value;
  }
  function context() {
    const value = identifiedContext();
    if (selectedPhone && (selectedPhone.name !== value.name || selectedPhone.generation !== nativeGeneration || selectedPhone.selected !== nativeHeader?.selected)) selectedPhone = null;
    if (value.isGroup || value.ambiguous) return value;
    if (!value.chatId || value.chatId.startsWith("session:")) {
      if (selectedPhone && nativeHeader?.selected) return { ...value, phone: selectedPhone.phone, chatId: 'phone:' + selectedPhone.phone, phoneSource: 'visible' };
      if (!value.chatId) return value;
    }
    if (value.phone && value.phoneSource === 'visible' && nativeHeader?.selected) selectedPhone = { name: value.name, phone: value.phone, generation: nativeGeneration, selected: nativeHeader.selected };
    const binding = manualBindings.get(value.chatId);
    const observed = observedPhones.get(value.chatId);
    if (observed && (observed.name !== value.name || observed.generation !== nativeGeneration || value.phone && value.phone !== observed.phone)) observedPhones.delete(value.chatId);
    if (value.phone && value.phoneSource === 'visible' && value.chatId.startsWith('wa:')) {
      observedPhones.set(value.chatId, { name: value.name, phone: value.phone, generation: nativeGeneration });
      if (observedPhones.size > 100) observedPhones.delete(observedPhones.keys().next().value);
    }
    if (binding && (binding.name !== value.name || value.phone && value.phone !== binding.phone)) {
      manualBindings.delete(value.chatId);
    } else if (!value.phone && binding) {
      return { ...value, phone: binding.phone, phoneSource: "manual" };
    }
    const retained = observedPhones.get(value.chatId);
    if (!value.phone && retained) return { ...value, phone: retained.phone, phoneSource: 'visible' };
    return value;
  }
  function requireChat(expectedPhone) {
    const value = context();
    if (value.isGroup || value.ambiguous) throw Error("Selecciona una conversación individual sin identidad ambigua.");
    if (!value.chatId) throw Error("Todavía no se puede identificar este chat. Abre su información de contacto o carga un mensaje.");
    if (!value.phone) throw Error("WhatsApp no muestra el teléfono. Vincula expresamente este chat con el teléfono del cliente.");
    if (expectedPhone && value.phone !== expectedPhone) throw Error("El teléfono del cliente no coincide con la conversación abierta. Selecciona su chat antes de preparar el mensaje.");
    return value;
  }
  function bind(input) {
    const value = identifiedContext();
    const number = phone(input?.phone);
    if (!number || !value.chatId || value.chatId !== input?.chatId || input?.name !== undefined && value.name !== input.name || value.isGroup || value.ambiguous) throw Error("La conversación cambió o no se puede vincular de forma segura.");
    if (value.phone && value.phone !== number) throw Error("El teléfono indicado no coincide con el teléfono visible de WhatsApp.");
    // A session anchor represents this exact native header generation, never a
    // reusable alias. Only exact wa: peers are eligible for background persistence.
    if (!value.phone && !/^(wa:|session:)/.test(value.chatId)) throw Error("Selecciona otra vez la conversación antes de vincularla.");
    manualBindings.delete(value.chatId);
    manualBindings.set(value.chatId, { phone: number, name: value.name });
    // This is a bounded, ephemeral cache, never an exported customer database.
    if (manualBindings.size > 100) manualBindings.delete(manualBindings.keys().next().value);
    return context();
  }
  function unbind(input) {
    const value = identifiedContext();
    if (!value.chatId || value.chatId !== input?.chatId || input?.name !== undefined && value.name !== input.name || value.isGroup || value.ambiguous)
      throw Error("El chat cambió. Revisa el contacto antes de desvincularlo.");
    manualBindings.delete(value.chatId);
    return context();
  }
  function setScope(scope) {
    if (typeof scope !== "string" || !/^https:\/\//.test(scope)) throw Error("El CRM conectado no es válido.");
    if (scope !== bindingScope) { manualBindings.clear(); bindingScope = scope; }
  }
  function visible(node) {
    if (node.hidden || node.getAttribute?.("aria-hidden") === "true" || node.closest?.('[hidden], [aria-hidden="true"]')) return false;
    if (node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return false;
    const style = globalThis.getComputedStyle?.(node);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0")) return false;
    if (!node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  }
  function capture() {
    const current = requireChat();
    const root = main(), entries = [], seen = new Set();
    let characters = 0;
    for (const node of root.querySelectorAll("[data-id]")) {
      if (node.closest?.('[data-testid="quoted-message"], .quoted-mention')) continue;
      const id = node.getAttribute("data-id") || "";
      const peer = /^(?:true|false)_([^_]+)_/.exec(id)?.[1];
      if (!peer || "wa:" + peer !== current.chatId || seen.has(id) || !visible(node)) continue;
      const container = node.matches?.(".message-in,.message-out") ? node : node.querySelector(".message-in,.message-out") || node.closest(".message-in,.message-out");
      if (!container) continue;
      const direction = container.classList.contains("message-out") ? "sent" : container.classList.contains("message-in") ? "received" : "";
      if (!direction) continue;
      const parts = [...container.querySelectorAll('[data-pre-plain-text] .selectable-text, [data-testid="msg-text"], .copyable-text .selectable-text')].filter(part => !part.closest('[data-testid="quoted-message"], .quoted-mention'));
      const texts = [...new Set(parts.map(part => (part.innerText || part.textContent || "").trim()).filter(Boolean))];
      const body = texts.join("\n").slice(0, 8000);
      if (!body) continue;
      characters += body.length;
      if (entries.length >= 100 || characters > 100000) break;
      seen.add(id);
      entries.push({ id, direction, body, phone: current.phone, chatId: current.chatId });
    }
    const after = requireChat();
    if (after.chatId !== current.chatId || after.phone !== current.phone) throw Error("El chat cambió durante la lectura. Repite la captura.");
    return entries;
  }
  function prepare(input) {
    const expectedPhone = phone(input?.phone), text = input?.text;
    if (!expectedPhone || typeof text !== "string" || !text.trim() || text.length > 8000) throw Error("Mensaje o teléfono no válido.");
    const current = requireChat(expectedPhone);
    const composer = main()?.querySelector('footer [contenteditable="true"][role="textbox"]') || main()?.querySelector('[data-testid="conversation-compose-box-input"][contenteditable="true"]');
    if (!composer) return { prepared: false, clipboard: true, reason: "WhatsApp cambió su editor. El mensaje se copiará para que lo pegues tú." };
    const oldText = (composer.innerText || composer.textContent || "").trim();
    if (oldText && !editorMatches(composer, text)) return { prepared: false, clipboard: true, reason: "Ya hay un borrador en WhatsApp. Se conserva; el mensaje nuevo se copiará al portapapeles." };
    if (oldText) return { prepared: true, requiresConfirmation: true, chatId: current.chatId };
    composer.focus();
    const beforeInsert = requireChat(expectedPhone);
    if (beforeInsert.chatId !== current.chatId) throw Error("La conversación cambió. Revisa el destinatario.");
    // insertText updates WhatsApp's normal editor; no send button is clicked.
    const inserted = document.execCommand?.("insertText", false, text) === true;
    if (!inserted || !editorMatches(composer, text)) return { prepared: false, clipboard: true, reason: "No se pudo verificar el borrador. Revisa el editor antes de pegar el mensaje manualmente." };
    return { prepared: true, requiresConfirmation: true, chatId: current.chatId };
  }
  function editorMatches(composer, expected) {
    const normalized = value => String(value || "").replace(/\r\n?/g, "\n").trim();
    if (normalized(composer.innerText || composer.textContent) === normalized(expected)) return true;
    if (!composer.childNodes) return false;
    // Chromium represents inserted line breaks with block elements. innerText
    // can report an extra newline for an empty <div><br></div>, even though the
    // editor's block structure preserves the requested blank line. Read that
    // structure exactly rather than dropping or collapsing message content.
    const plain = element => {
      if (element.nodeType === 3) return element.textContent || "";
      if (element.nodeName === "BR") return "\n";
      let result = "";
      for (const [index, child] of [...element.childNodes].entries()) {
        const block = /^(DIV|P|LI)$/.test(child.nodeName || "");
        if (block && index > 0) result += "\n";
        const placeholder = block && child.childNodes.length === 1 && child.firstChild.nodeName === "BR";
        if (!placeholder) result += plain(child);
      }
      return result;
    };
    return normalized(plain(composer)) === normalized(expected);
  }
  const cancelledCampaigns = new Set();
  let botArm = null, botTimer;
  const botNodes = () => [...(main()?.querySelectorAll('[data-id]') || [])].filter(item => !item.closest('[data-testid="quoted-message"], .quoted-mention'));
  function baselineBot(current) {
    botArm.chatId = current.chatId;
    botArm.name = current.name;
    botArm.seen = new Set(botNodes().map(item => item.getAttribute('data-id')));
    botArm.tail = botNodes().at(-1)?.getAttribute('data-id') || '';
    botArm.eligible.clear();
  }
  function botStart(input = {}) {
    if (!/^[a-f0-9]{32}$/.test(input.runId || '')) throw Error('La activación del chatbot no es válida.');
    if (botArm && botArm.runId !== input.runId) throw Error('Detén el chatbot anterior antes de activarlo.');
    if (botArm?.runId === input.runId) return { started: true };
    botArm = { runId: input.runId, allowBackground: input.allowBackground === true, eligible: new Map() };
    cancelledCampaigns.delete(input.runId);
    baselineBot(context());
    clearInterval(botTimer);
    if (chrome.runtime.id) botTimer = setInterval(wakeBot, 20000);
    return { started: true };
  }
  function botEnsure(input) { return botArm?.runId === input?.runId ? { started: true } : botStart(input); }
  function botSetBackground(input = {}) {
    if (!botArm || botArm.runId !== input.runId || typeof input.allowBackground !== 'boolean')
      throw Error('Activa el chatbot antes de cambiar su trabajo en segundo plano.');
    // Only the authenticated background router may invoke this action. Keep
    // the baseline and eligible incoming messages while changing this grant.
    botArm.allowBackground = input.allowBackground;
    return { updated: true, allowBackground: botArm.allowBackground };
  }
  function botStop(input = {}) {
    if (botArm && (!input.runId || input.runId === botArm.runId)) {
      cancelledCampaigns.add(botArm.runId); botArm = null; clearInterval(botTimer);
    }
    return { stopped: true };
  }
  function botSnapshot(input = {}) {
    if (!botArm || botArm.runId !== input.runId) throw Error('El chatbot está detenido.');
    const current = context();
    if (current.chatId !== botArm.chatId || current.name !== botArm.name || !/^wa:[^\s]+$/.test(current.chatId || '') || current.isGroup || current.ambiguous) {
      baselineBot(current); return { context: current, messages: [] };
    }
    if (!botArm.allowBackground && document.hidden) { baselineBot(current); return { context: current, messages: [] }; }
    const nodes = botNodes(), oldTail = nodes.findIndex(item => item.getAttribute('data-id') === botArm.tail);
    // Loading older rows above the previous tail is never a new inquiry.
    if (botArm.tail && oldTail < 0) { baselineBot(current); return { context: current, messages: [] }; }
    const messages = [];
    for (const [index, item] of nodes.entries()) {
      const id = item.getAttribute('data-id') || '';
      if (botArm.seen.has(id)) continue;
      botArm.seen.add(id);
      if (index <= oldTail || !id.startsWith('false_') || !item.matches('.message-in') && !item.querySelector('.message-in')) continue;
      const peer = /^(?:true|false)_([^_]+)_/.exec(id)?.[1];
      if (!peer || 'wa:' + peer !== current.chatId) continue;
      const body = [...item.querySelectorAll('[data-pre-plain-text] .selectable-text,[data-testid="msg-text"],.copyable-text .selectable-text')].filter(part => !part.closest('[data-testid="quoted-message"],.quoted-mention')).map(part => part.innerText || part.textContent || '').join('\n').trim().slice(0,8000);
      if (!body) continue;
      const message = { id, body, phone: current.phone, chatId: current.chatId, name: current.name };
      messages.push(message); botArm.eligible.set(id, message);
    }
    botArm.tail = nodes.at(-1)?.getAttribute('data-id') || botArm.tail;
    if (botArm.seen.size > 3000) baselineBot(current);
    while (botArm.eligible.size > 50) botArm.eligible.delete(botArm.eligible.keys().next().value);
    return { context: current, messages: messages.slice(-10) };
  }
  function wakeBot() {
    if (!botArm || !chrome.runtime.id) return;
    chrome.runtime.sendMessage({ channel: 'nexo', type: 'engagement.tick', input: { runId: botArm.runId } }).catch(() => {});
  }
  function campaignCheck() {
    const editor = document.querySelector("#main footer [contenteditable='true']");
    if ((editor?.innerText || editor?.textContent || "").trim()) throw Error("WhatsApp ya tiene un borrador. Envíalo o guárdalo antes de iniciar la campaña.");
    if (document.querySelector("[data-testid='media-editor'],[data-testid='media-caption-input-container']")) throw Error("Cierra el adjunto que ya está abierto en WhatsApp.");
    return { ready: true };
  }
  function campaignReveal() {
    const header = document.querySelector("#main header");
    const target = header?.querySelector("[title]") || header;
    if (!target) throw Error("Abre la información del contacto para verificar su número.");
    if (typeof PointerEvent === "function") target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    target.click(); return { opened: true };
  }
  function campaignGuard(input) {
    if (cancelledCampaigns.has(input.runId)) throw Error("La campaña fue detenida.");
    const botMessage = input.mode === 'bot' && botArm?.runId === input.runId ? botArm.eligible.get(input.incomingId) : null;
    if (input.mode === 'bot' && (!botMessage || !/^wa:[^\s]+$/.test(botMessage.chatId || '') || input.chatId !== botMessage.chatId))
      throw Error('El chatbot no tiene un mensaje nuevo con una identidad estable para responder.');
    const background = botMessage && botArm.allowBackground && input.allowBackground === true;
    if (!background && (document.hidden || document.visibilityState === "hidden")) throw Error("WhatsApp dejó de estar visible. La campaña está pausada.");
    const current = context();
    if (!current.chatId || current.isGroup || current.ambiguous)
      throw Error("La conversación no coincide con el destinatario seleccionado.");
    if (botMessage) {
      if (current.chatId !== botMessage.chatId || current.name !== botMessage.name) throw Error('La conversación del chatbot cambió.');
      const known = [botMessage.phone, input.phone, current.phone].filter(Boolean);
      if (known.some(number => !phone(number) || phone(number) !== number) || new Set(known).size > 1)
        throw Error('El teléfono visible no coincide con la conversación del chatbot.');
    } else {
      const expectedPhone = phone(input.phone);
      if (!expectedPhone || expectedPhone !== input.phone || current.phone !== expectedPhone)
        throw Error("La conversación no coincide con el número seleccionado.");
    }
    return current;
  }
  function prepareBot(input) {
    campaignGuard(input);
    const composer = main()?.querySelector('footer [contenteditable="true"][role="textbox"]') || main()?.querySelector('[data-testid="conversation-compose-box-input"][contenteditable="true"]');
    if (!composer) throw Error('WhatsApp cambió su editor. No se puede preparar la respuesta del chatbot.');
    if ((composer.innerText || composer.textContent || '').trim()) throw Error('WhatsApp ya tiene un borrador. Se conserva sin reemplazarlo.');
    composer.focus();
    campaignGuard(input);
    if (!composer.isConnected || document.activeElement !== composer || (composer.innerText || composer.textContent || '').trim())
      throw Error('El editor de WhatsApp cambió durante la preparación. No se envió la respuesta.');
    if (!document.execCommand('insertText', false, input.text) || !editorMatches(composer, input.text))
      throw Error('No se pudo verificar el borrador del chatbot.');
    campaignGuard(input);
    return { prepared: true };
  }
  const waitCampaign = ms => new Promise(resolve => setTimeout(resolve, ms));
  function sendButton(scope) {
    return [...scope.querySelectorAll("button,[role='button']")].find(item =>
      /^(enviar|send)( mensaje| message)?$/i.test(item.getAttribute("aria-label") || item.getAttribute("title") || "") || item.querySelector("[data-icon='send']"));
  }
  async function campaignSend(input) {
    let clicked = false;
    try {
      if (!input || !/^[a-f0-9]{32}$/.test(input.runId || "") || !Array.isArray(input.files) || input.files.length > 10 || typeof input.text !== "string" || input.text.length > 8000) throw Error("El mensaje de campaña no es válido.");
      campaignGuard(input); campaignCheck();
      const root = document.querySelector("#main");
      const before = new Set([...root.querySelectorAll("[data-id]")].map(x => x.getAttribute("data-id")));
      let scope = root.querySelector("footer");
      if (input.files.length) {
        let fileInput = [...document.querySelectorAll("input[type=file]")].find(el => /image|video/i.test(el.accept));
        if (!fileInput) {
          const attach = root.querySelector("[aria-label='Adjuntar'],[aria-label='Attach'],[title='Adjuntar'],[data-icon='plus-rounded']");
          (attach?.closest("button,[role=button]") || attach)?.click();
          await waitCampaign(200);
          fileInput = [...document.querySelectorAll("input[type=file]")].find(el => /image|video/i.test(el.accept));
        }
        if (!fileInput) throw Error("WhatsApp cambió su selector de archivos. Abre Adjuntar → Fotos y videos y vuelve a intentar.");
        const transfer = new DataTransfer(); let total = 0;
        for (const file of input.files) {
          if (!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/.test(file.type || "") || typeof file.data !== "string") throw Error("El archivo adjunto no es válido.");
          const binary = atob(file.data); total += binary.length;
          if (total > 20971520) throw Error("Los adjuntos superan 20 MB.");
          transfer.items.add(new File([Uint8Array.from(binary, c => c.charCodeAt(0))], String(file.name).slice(0, 200), { type: file.type }));
        }
        campaignGuard(input);
        fileInput.files = transfer.files; fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        const limit = Date.now() + 20000;
        while (Date.now() < limit) {
          campaignGuard(input);
          scope = document.querySelector("[data-testid='media-editor'],[role='dialog']");
          if (!scope) {
            const caption = document.querySelector("[data-testid='media-caption-input-container']");
            scope = caption?.parentElement?.parentElement;
          }
          if (scope?.querySelector("img,video") && sendButton(scope)) break;
          await waitCampaign(150);
        }
        if (!scope?.querySelector("img,video") || !sendButton(scope)) throw Error("No se pudo verificar la vista previa del adjunto. Revísalo en WhatsApp.");
        if (input.text) {
          const caption = scope.querySelector("[contenteditable='true']");
          if (!caption || (caption.innerText || "").trim()) throw Error("No se pudo preparar el pie del archivo sin sobrescribir otro texto.");
          caption.focus(); if (!document.execCommand("insertText", false, input.text) || !editorMatches(caption, input.text)) throw Error("No se pudo verificar el pie del archivo.");
        }
      } else {
        const prepared = input.mode === 'bot' ? prepareBot(input) : prepare({ phone: input.phone, text: input.text });
        if (!prepared.prepared) throw Error(prepared.reason || "No se pudo preparar el mensaje.");
      }
      campaignGuard(input);
      if (input.automatic !== true) return { status: "prepared", evidence: "Borrador y archivos preparados; envío pendiente de tu confirmación." };
      const button = scope && sendButton(scope);
      if (!button) throw Error("No se encontró un botón de envío verificable.");
      const editor = scope.querySelector("[contenteditable='true']");
      const mediaState = () => [...scope.querySelectorAll('img,video')].map(node => ({ node,
        source: node.getAttribute('src') || '', poster: node.getAttribute('poster') || '',
        children: [...node.querySelectorAll('source')].map(item => [item.getAttribute('src') || '', item.getAttribute('type') || '']),
      }));
      const preparedMedia = input.files.length ? mediaState() : [];
      const verifyPrepared = () => {
        if (!root.isConnected || document.querySelector('#main') !== root || !scope.isConnected || !button.isConnected || !scope.contains(button) || sendButton(scope) !== button || button.disabled || button.getAttribute('aria-disabled') === 'true')
          throw Error('El editor o el botón de WhatsApp cambió. No se envió la respuesta.');
        const currentEditor = scope.querySelector("[contenteditable='true']");
        if (currentEditor !== editor || editor && (!editor.isConnected || !editorMatches(editor, input.text)) || !editor && input.text)
          throw Error('El borrador cambió mientras se autorizaba el envío. Se conserva sin enviarlo.');
        if (!input.files.length) {
          if (document.querySelector("[data-testid='media-editor'],[data-testid='media-caption-input-container']"))
            throw Error('Se abrió un adjunto mientras se autorizaba el envío. Se conserva sin enviarlo.');
        } else {
          const currentMedia = mediaState();
          if (!preparedMedia.length || currentMedia.length !== preparedMedia.length || currentMedia.some((item, index) => {
            const expected = preparedMedia[index];
            return item.node !== expected.node || item.source !== expected.source || item.poster !== expected.poster || JSON.stringify(item.children) !== JSON.stringify(expected.children);
          })) throw Error('El adjunto cambió mientras se autorizaba el envío. Se conserva sin enviarlo.');
        }
      };
      verifyPrepared();
      const permit = await chrome.runtime.sendMessage({ channel: "nexo", type: input.mode === 'bot' ? 'engagement.permit' : "campaign.permit", input: { runId: input.runId, phone: input.phone, ...(input.mode === 'bot' ? { chatId: input.chatId, claimId: input.claimId, claimToken: input.claimToken } : {}) } });
      if (!permit?.ok || permit.result?.allowed !== true) throw Error("La campaña está pausada, la barra se cerró o terminó la sesión.");
      campaignGuard(input); verifyPrepared(); clicked = true; button.click();
      const until = Date.now() + 15000;
      const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
      while (Date.now() < until) {
        campaignGuard(input);
        const outgoing = [...document.querySelectorAll("#main [data-id]")].find(el => {
          const id = el.getAttribute("data-id") || "";
          return !before.has(id) && (id.startsWith("true_") || el.matches(".message-out") || el.querySelector(".message-out")) &&
            (!input.text || normalize(el.innerText).includes(normalize(input.text))) && (!input.files.length || el.querySelector("img,video"));
        });
        if (outgoing) return { status: "sent_observed", evidence: "Mensaje saliente observado: " + outgoing.getAttribute("data-id"), sentAt: new Date().toISOString() };
        await waitCampaign(150);
      }
      return { status: "uncertain", error: "Se pulsó Enviar, pero no se pudo comprobar el resultado. Revisa la conversación antes de reintentar." };
    } catch (error) { return { status: clicked ? "uncertain" : "failed", error: error.message }; }
  }
  async function exportContacts(input = {}) {
    const visible = el => el.getClientRects().length && !el.closest("[hidden],[aria-hidden='true'],nexo-whatsapp-dock");
    let list;
    if (input.source === "group") {
      const current = context();
      if (!current.isGroup) throw Error("Abre un grupo y su lista de participantes en WhatsApp.");
      list = document.querySelector("[data-testid='group-info-drawer'],[data-testid='contact-info-drawer'],[data-testid='drawer-right'],#app [role='dialog']");
      const identity = list && [...list.querySelectorAll('h1,h2,[dir=auto],[title]')].some(node => visible(node) && (node.getAttribute('title') || node.textContent || '').trim() === current.name);
      const participants = list && (/\b(participantes|participants|members)\b/i.test(list.innerText || '') || list.querySelector('[data-testid*=participant]'));
      if (!list || !identity || !participants) throw Error("Abre la información de este grupo y sus participantes.");
    } else {
      list = document.querySelector("#pane-side,#side,[data-testid='chat-list']");
      if (!list) throw Error("Abre tu lista de chats en WhatsApp.");
      if (input.source === "archived") {
        // The normal list already contains an Archivados shortcut. Require an
        // actual archived view, never label the ordinary list by that shortcut.
        const archived = document.querySelector("[data-testid='archived-chats'],[data-testid='archived-chats-drawer']");
        const heading = [...document.querySelectorAll('#app header h1,#app header h2,#app header [dir=auto],[data-testid=archived-chats-header]')].find(node => visible(node) && !node.closest('#main') && /^(archivados|archivadas|archived|archived chats)$/i.test((node.innerText || node.textContent || '').trim()));
        if (!archived && !heading) throw Error("Abre Archivados antes de exportar esa lista.");
        if (archived) list = archived;
      }
    }
    const result = new Map(), began = Date.now(); let incomplete = 0, previous = -1;
    let scanProfiles = Boolean(input.scan && input.source !== "group");
    try { campaignCheck(); } catch { scanProfiles = false; }
    const collect = async () => {
      for (const row of list.querySelectorAll("[role='listitem'],[role='row'],[data-testid*='participant'],[data-testid='cell-frame-container']")) {
        if (!visible(row)) continue;
        const title = [...row.querySelectorAll("span[title]")].find(visible);
        const name = (title?.getAttribute("title") || row.querySelector("[dir='auto']")?.textContent || "").trim().slice(0, 160);
        if (!name) continue;
        const source = [name, ...[...row.querySelectorAll("[title],[aria-label]")].map(n => n.getAttribute("title") || n.getAttribute("aria-label"))].filter(Boolean);
        const number = source.find(value => /^\+?[\d\s().-]{7,25}$/.test(value.trim()));
        const peer = (row.getAttribute("data-id") || "").match(/(\d{7,15})@(c\.us|s\.whatsapp\.net)/);
        let phoneValue = number ? number.replace(/\D/g, "") : peer ? peer[1] : "";
        if (!phoneValue && scanProfiles && Date.now() - began < 30000 && row.isConnected) {
          const before = context(), selected = row.getAttribute("aria-selected") === "true" || Boolean(row.querySelector("[aria-selected='true']"));
          if (typeof PointerEvent === "function") row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          row.click();
          const deadline = Date.now() + 1500;
          let opened = false;
          while (Date.now() < deadline) {
            if (document.hidden) throw Error("Vuelve a WhatsApp para terminar la lectura de contactos.");
            const current = context();
            if (current.name === name && current.chatId && !current.isGroup && !current.ambiguous && (current.chatId !== before.chatId || selected)) {
              if (current.phone) { phoneValue = current.phone; break; }
              if (!opened) { campaignReveal(); opened = true; }
            }
            await waitCampaign(100);
          }
        }
        const key = phoneValue || row.getAttribute("data-id") || name;
        if (!result.has(key)) result.set(key, { name, phone: phoneValue, source: "whatsapp", labels: input.source === "group" ? ["Grupo"] : input.source === "archived" ? ["Archivado"] : [] });
        if (result.size >= 500) return;
      }
    };
    for (;;) {
      if (document.hidden) throw Error("Vuelve a WhatsApp para leer sus contactos.");
      await collect();
      if (!input.scan || result.size >= 500 || Date.now() - began > 30000) break;
      const scroller = [list, ...list.querySelectorAll("div")].find(el => visible(el) && el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 100);
      if (!scroller || scroller.scrollTop === previous) break;
      previous = scroller.scrollTop; scroller.scrollTop += Math.max(200, scroller.clientHeight - 40);
      await waitCampaign(250);
    }
    incomplete = [...result.values()].filter(row => !row.phone).length;
    return { contacts: [...result.values()], incomplete, note: "Lista cargada de WhatsApp; no incluye números que WhatsApp no muestra ni contactos de otras cuentas." };
  }
  globalThis.__nexoWhatsAppAdapter = { context, bind, unbind, setScope, capture, prepare, phone, campaignCheck, campaignSend, exportContacts, botStart, botEnsure, botSetBackground, botStop, botSnapshot };
  const invalidateNativeNavigation = () => { navigationRevision++; openIntent = null; requestContextUpdate(); };
  document.addEventListener?.("pointerdown", event => {
    const target = event.target;
    if (target?.closest?.(nativeChatListSelector)) { invalidateNativeNavigation(); return; }
    if (target?.closest?.("nexo-whatsapp-dock, #nexo-whatsapp-dock")) return;
    const conversation = main(), header = conversation?.querySelector("header");
    if (header && target?.closest?.("header") === header) {
      rawContext();
      openIntent = { header, navigationRevision, generation: nativeGeneration, revision: ++openIntentRevision };
    }
    else if (!conversation?.contains?.(target) && !target?.closest?.(contactDrawerSelector) && ![...plainContactPanes].some(pane => pane.isConnected && pane.contains(target))) invalidateNativeNavigation();
  }, true);
  document.addEventListener?.("keydown", event => {
    if ((["Enter", "ArrowUp", "ArrowDown"].includes(event.key) && event.target?.closest?.(nativeChatListSelector)) || ((event.ctrlKey || event.metaKey) && event.altKey)) invalidateNativeNavigation();
  }, true);
  globalThis.addEventListener?.("popstate", invalidateNativeNavigation);
  globalThis.addEventListener?.("hashchange", invalidateNativeNavigation);
  if (!globalThis.chrome?.runtime?.id) return;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.channel !== "nexo.whatsapp") return false;
    if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && !sender.url.startsWith(chrome.runtime.getURL("")))) {
      sendResponse({ ok: false, error: "Origen de extensión no autorizado." }); return false;
    }
    try {
      setScope(message.scope);
      const actions = { context, capture, prepare, bind, unbind, botStart, botEnsure, botSetBackground, botStop, botSnapshot };
      if (message.action === "campaignCancel") {
        if (cancelledCampaigns.size > 100) cancelledCampaigns.clear();
        if (typeof message.input?.runId === "string") cancelledCampaigns.add(message.input.runId);
        sendResponse({ ok: true, result: { stopped: true } }); return false;
      }
      if (["campaignSend", "exportContacts"].includes(message.action)) {
        if (document.hidden && !(message.action === 'campaignSend' && message.input?.mode === 'bot')) throw Error("Vuelve a la pestaña de WhatsApp.");
        Promise.resolve(message.action === "campaignSend" ? campaignSend(message.input) : exportContacts(message.input))
          .then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message }));
        return true;
      }
      actions.campaignCheck = campaignCheck;
      actions.campaignReveal = campaignReveal;
      if (!Object.hasOwn(actions, message.action)) throw Error("Operación no permitida.");
      // A native browser panel can stay visible while this WhatsApp tab is
      // hidden. Check again in the document at the instant of the operation.
      if (message.requireVisible === true && (document.hidden || document.visibilityState === "hidden"))
        throw Error("Vuelve a la pestaña de WhatsApp para trabajar con esta conversación.");
      sendResponse({ ok: true, result: actions[message.action](message.input) });
    } catch (error) { sendResponse({ ok: false, error: error.message }); }
    return false;
  });
  let lastIdentity = "", timer, settleTimer;
  const update = () => {
    const next = context();
    const identity = JSON.stringify(next);
    if (identity !== lastIdentity) {
      lastIdentity = identity;
      chrome.runtime.sendMessage({ channel: "nexo", type: "wa.contextChanged", context: next }).catch(() => {});
    }
    wakeBot();
    // A quiet DOM still needs one update when the transition quarantine ends.
    if (identityTransition && !settleTimer) settleTimer = setTimeout(() => {
      settleTimer = undefined;
      update();
    }, Math.max(1, identityTransition.until - Date.now()));
  };
  // Leading changes receive a bounded update even when new messages keep
  // arriving. A trailing debounce could leave another customer's ficha visible
  // indefinitely while mutations continuously postponed its timer.
  requestContextUpdate = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = undefined; update(); }, 40);
  };
  new MutationObserver(requestContextUpdate).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["title", "data-id", "aria-selected", "hidden", "aria-hidden"] });
  update();
  chrome.runtime.sendMessage({channel:'nexo',type:'engagement.documentReady'}).catch(() => {});
})();
