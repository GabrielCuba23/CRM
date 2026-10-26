(() => {
  if (globalThis.__nexoWhatsAppAdapter) return;
  // Bindings are local to this WhatsApp document and the exact peer that was
  // confirmed. A draft telephone field in the CRM never changes this context.
  const manualBindings = new Map();
  const observedDrawers = new WeakMap();
  let nativeHeader = null, nativeGeneration = 0, navigationRevision = 0, openIntent = null, openIntentRevision = 0;
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
  function observeNativeHeader(header, name, peer, headerPhone) {
    const selected = document.querySelector(nativeSelectedSelector);
    const stable = Boolean(nativeHeader && nativeHeader.element === header && nativeHeader.name === name && nativeHeader.peer === peer && nativeHeader.phone === headerPhone && nativeHeader.selected === selected && nativeHeader.navigationRevision === navigationRevision);
    if (!stable)
      nativeGeneration++;
    nativeHeader = { element: header, name, peer, phone: headerPhone, selected, navigationRevision };
    return stable;
  }
  function drawerPhone(name, knownHeader) {
    const candidates = new Set();
    if (!name || !document.querySelectorAll) return { phone: "", ambiguous: false };
    // Read only an explicitly visible native contact-info surface. Never scan
    // messages, the document's generic phone-like text, extension shadow roots
    // or CRM iframes. The exact contact heading ties it to the current header.
    for (const drawer of document.querySelectorAll(contactDrawerSelector)) {
      if (drawer.closest?.("nexo-whatsapp-dock, nexo-crm-dock, #nexo-crm-dock, iframe")) continue;
      const previous = observedDrawers.get(drawer);
      if (!visible(drawer)) {
        observedDrawers.set(drawer, { ...previous, visible: false });
        continue;
      }
      let identity;
      for (const selector of contactNameSelectors) {
        identity = drawer.querySelector(selector);
        if (identity) break;
      }
      const drawerName = identity && visible(identity) ? contactName(identity.getAttribute("title") || identity.textContent) : "";
      const drawerNumbers = new Set();
      for (const node of drawer.querySelectorAll(contactPhoneSelector)) {
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
      const fresh = (!previous && knownHeader) || reopened || (previous?.singlePhone && singlePhone && previous.singlePhone !== singlePhone);
      const authorized = Boolean(matching && knownHeader && (previous?.generation === nativeGeneration && previous.authorized || fresh));
      observedDrawers.set(drawer, { generation: nativeGeneration, authorized, visible: true, numbers, singlePhone: authorized && singlePhone ? singlePhone : previous?.singlePhone || singlePhone, openIntentRevision: authorized && currentIntent ? openIntent.revision : previous?.openIntentRevision });
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
    return { name, phone: number, chatId: peer ? "wa:" + peer : number ? "phone:" + number : "", isGroup, phoneSource: number ? "visible" : "", ambiguous: peers.size > 1 || candidates.size > 1 || revealed.ambiguous };
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
    if (value.isGroup || value.ambiguous || !value.chatId) return value;
    const binding = manualBindings.get(value.chatId);
    if (binding && (binding.name !== value.name || value.phone && value.phone !== binding.phone)) {
      manualBindings.delete(value.chatId);
    } else if (!value.phone && binding) {
      return { ...value, phone: binding.phone, phoneSource: "manual" };
    }
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
    if (!number || !value.chatId || value.chatId !== input?.chatId || value.isGroup || value.ambiguous) throw Error("La conversación cambió o no se puede vincular de forma segura.");
    if (value.phone && value.phone !== number) throw Error("El teléfono indicado no coincide con el teléfono visible de WhatsApp.");
    // Only an opaque peer identity can be manually linked. Names alone are not unique.
    if (!value.phone && !value.chatId.startsWith("wa:")) throw Error("Carga un mensaje del chat para identificar la conversación antes de vincularla.");
    manualBindings.delete(value.chatId);
    manualBindings.set(value.chatId, { phone: number, name: value.name });
    // This is a bounded, ephemeral cache, never an exported customer database.
    if (manualBindings.size > 100) manualBindings.delete(manualBindings.keys().next().value);
    return context();
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
  globalThis.__nexoWhatsAppAdapter = { context, bind, capture, prepare, phone };
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
    else if (!conversation?.contains?.(target) && !target?.closest?.(contactDrawerSelector)) invalidateNativeNavigation();
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
      const actions = { context, capture, prepare, bind };
      if (!Object.hasOwn(actions, message.action)) throw Error("Operación no permitida.");
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
})();
