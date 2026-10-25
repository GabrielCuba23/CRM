(() => {
  if (globalThis.__nexoWhatsAppAdapter) return;
  let manualBinding = null;
  const phone = value => {
    const text = String(value || "").trim();
    if (!/^\+?[\d\s().-]+$/.test(text)) return "";
    const digits = text.replace(/\D/g, "");
    if (!text.startsWith("+") && digits.length < 10) return "";
    return /^\d{7,15}$/.test(digits) ? digits : "";
  };
  function main() { return document.querySelector("#main") || document.querySelector('[data-testid="conversation-panel-wrapper"]'); }
  function rawContext() {
    const root = main(), header = root?.querySelector("header");
    if (!header) return { name: "", phone: "", chatId: "", isGroup: false, phoneSource: "" };
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
      const match = /^(?:true|false)_([^_]+)_/.exec(node.getAttribute("data-id") || "");
      if (match) peers.add(match[1]);
    }
    const peer = peers.size === 1 ? [...peers][0] : "";
    const number = candidates.size === 1 ? [...candidates][0] : "";
    const groupDescription = header.textContent || "";
    const isGroup = /@g\.us$|@newsletter$|@broadcast$/.test(peer) || !!header.querySelector('[data-icon="default-group"], [data-testid="default-group"]') || /\b(participantes|participants|members)\b/i.test(groupDescription);
    return { name, phone: number, chatId: peer ? "wa:" + peer : number ? "phone:" + number : "", isGroup, phoneSource: number ? "visible" : "", ambiguous: peers.size > 1 || candidates.size > 1 };
  }
  function context() {
    const value = rawContext();
    if (manualBinding && (manualBinding.chatId !== value.chatId || value.isGroup || value.ambiguous)) manualBinding = null;
    if (!value.phone && manualBinding) return { ...value, phone: manualBinding.phone, phoneSource: "manual" };
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
    const value = rawContext();
    const number = phone(input?.phone);
    if (!number || !value.chatId || value.chatId !== input?.chatId || value.isGroup || value.ambiguous) throw Error("La conversación cambió o no se puede vincular de forma segura.");
    if (value.phone && value.phone !== number) throw Error("El teléfono indicado no coincide con el teléfono visible de WhatsApp.");
    // Only an opaque peer identity can be manually linked. Names alone are not unique.
    if (!value.phone && !value.chatId.startsWith("wa:")) throw Error("Carga un mensaje del chat para identificar la conversación antes de vincularla.");
    manualBinding = { chatId: value.chatId, phone: number };
    return context();
  }
  function visible(node) {
    if (!node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  }
  function capture() {
    const current = requireChat();
    const root = main(), entries = [], seen = new Set();
    let characters = 0;
    for (const node of root.querySelectorAll("[data-id]")) {
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
  let lastIdentity = "", timer;
  const update = () => {
    const next = context();
    const identity = JSON.stringify(next);
    if (identity !== lastIdentity) {
      lastIdentity = identity;
      chrome.runtime.sendMessage({ channel: "nexo", type: "wa.contextChanged", context: next }).catch(() => {});
    }
  };
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(update, 150); }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["title", "data-id"] });
  update();
})();
