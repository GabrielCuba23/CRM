(() => {
  // A content-script world owns only this shell. The CRM itself stays inside a
  // separate extension-origin iframe; WhatsApp never receives its data or APIs.
  if (globalThis.__nexoDockController) {
    globalThis.__nexoDockController.ensureMounted();
    return;
  }
  if (!globalThis.chrome?.runtime?.id || window !== window.top || location.origin !== "https://web.whatsapp.com") return;

  const HOST_ID = "nexo-whatsapp-dock";
  const STYLE_ID = "nexo-whatsapp-dock-layout";
  const PUSH_CLASS = "nexo-dock-push";
  const OPEN_CLASS = "nexo-dock-open";
  const ANCHOR_CLASS = "nexo-dock-anchor";
  const extensionId = chrome.runtime.id;
  const extensionOrigin = chrome.runtime.getURL("");
  const host = document.createElement("nexo-whatsapp-dock");
  host.id = HOST_ID;
  host.dataset.nexoOwned = "true";
  // Shadow DOM is style isolation, not an authentication boundary. Authentication
  // is enforced by the iframe origin, the extension router and Cloudflare Access.
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483000!important;pointer-events:none!important;display:block!important;direction:ltr!important;color-scheme:light!important;--nexo-green:#008069;--nexo-line:#d5e1dc;font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
    *,*::before,*::after{box-sizing:border-box}
    [hidden]{display:none!important}
    .panel{position:absolute;top:0;right:0;bottom:0;width:var(--nexo-width,390px);max-width:calc(100vw - 12px);display:flex;flex-direction:column;pointer-events:auto;background:#f3f7f5;border-left:1px solid var(--nexo-line);box-shadow:-6px 0 24px #153c2e18;overflow:hidden}
    .header{min-height:54px;flex:0 0 auto;display:flex;align-items:center;gap:9px;padding:8px 10px 8px 14px;background:#f0f4f2;border-bottom:1px solid var(--nexo-line);color:#173a2e}
    .brand{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
    .mark{width:27px;height:27px;flex:0 0 27px;display:grid;place-items:center;border-radius:8px;background:var(--nexo-green);color:white;font-size:17px;font-weight:750}
    .brand-copy{min-width:0;display:flex;flex-direction:column;gap:1px}
    .brand strong{font-size:14px;line-height:1.2;font-weight:700;letter-spacing:.1px}
    .brand small{font-size:11px;line-height:1.3;color:#5e756b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    button:focus-visible{outline:3px solid #1cb08f;outline-offset:2px}
    .icon-button{width:34px;height:34px;border-radius:50%;color:#4e6a5e;flex-shrink:0;font:24px/1 system-ui,sans-serif}
    .icon-button:hover{background:#dce9e2;color:#173a2e}
    .config{font-size:21px}
    iframe{display:block;flex:1 1 auto;min-height:0;width:100%;border:0;background:#f3f7f5}
    .launcher{position:absolute;right:0;top:88px;gap:7px;min-width:88px;min-height:40px;padding:8px 12px 8px 13px;border:1px solid #ffffff38;border-right:0;border-radius:12px 0 0 12px;background:var(--nexo-green);color:white;box-shadow:0 3px 12px #073e2a24;pointer-events:auto;font:600 13px/1.2 system-ui,sans-serif}
    .launcher:hover{background:#006c59}
    .launcher-symbol{font-size:18px;font-weight:500}
    .announcement{position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    @media(prefers-reduced-motion:no-preference){.icon-button,.launcher{transition:background .12s ease}}
    @media(max-width:600px){.header{min-height:50px;padding-left:10px}.panel{box-shadow:-8px 0 28px #153c2e2b}.launcher{top:76px}}
    @media(forced-colors:active){.panel,.header,.launcher,.icon-button{border:1px solid CanvasText}.launcher,.mark{background:ButtonFace;color:ButtonText}}
  `;

  const panel = document.createElement("section");
  panel.id = "nexo-dock-panel";
  panel.className = "panel";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Nexo CRM dentro de WhatsApp Web");
  const header = document.createElement("header");
  header.className = "header";
  const brand = document.createElement("div");
  brand.className = "brand";
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.textContent = "N";
  mark.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "brand-copy";
  const name = document.createElement("strong");
  name.textContent = "Nexo CRM";
  const status = document.createElement("small");
  status.textContent = "Tu negocio, junto al chat";
  copy.append(name, status);
  brand.append(mark, copy);

  const configuration = document.createElement("button");
  configuration.type = "button";
  configuration.className = "icon-button config";
  configuration.dataset.nexoAction = "configure";
  configuration.title = "Configurar conexión del CRM";
  configuration.setAttribute("aria-label", "Configurar conexión del CRM");
  configuration.textContent = "⚙";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button";
  close.dataset.nexoAction = "close";
  close.title = "Cerrar Nexo CRM";
  close.setAttribute("aria-label", "Cerrar Nexo CRM");
  close.textContent = "×";
  header.append(brand, configuration, close);

  const frame = document.createElement("iframe");
  frame.id = "nexo-crm-frame";
  frame.title = "Nexo CRM: clientes, ventas y renovaciones";
  frame.src = chrome.runtime.getURL("app/index.html?embedded=1");
  frame.setAttribute("allow", "clipboard-write");
  frame.setAttribute("referrerpolicy", "no-referrer");
  // Keep the same iframe on collapse/reopen so unsaved forms and session state
  // survive. No window.postMessage bridge is exposed to the host page.
  panel.append(header, frame);

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "launcher";
  launcher.dataset.nexoAction = "open";
  launcher.title = "Abrir Nexo CRM";
  launcher.setAttribute("aria-label", "Abrir Nexo CRM");
  launcher.setAttribute("aria-controls", panel.id);
  const launcherMark = document.createElement("span");
  launcherMark.className = "launcher-symbol";
  launcherMark.setAttribute("aria-hidden", "true");
  launcherMark.textContent = "‹";
  launcher.append(launcherMark, document.createTextNode("Nexo"));
  const announcement = document.createElement("span");
  announcement.className = "announcement";
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  shadow.append(style, panel, launcher, announcement);

  const layoutStyle = document.createElement("style");
  layoutStyle.id = STYLE_ID;
  // These outside-shadow rules are scoped to the exact WhatsApp app root
  // and exists only while our own root class is set. Closing restores layout.
  layoutStyle.textContent = `
    html.${PUSH_CLASS} #app{
      width:calc(100% - var(--nexo-dock-width))!important;
      max-width:calc(100% - var(--nexo-dock-width))!important;
      min-width:0!important;
    }
    html.${PUSH_CLASS} #app.${ANCHOR_CLASS}{position:relative!important}
  `;

  let opened = true;
  let scheduled = false;
  let oldStatus = "";
  let anchoredRoot = null;
  function width() {
    return Math.max(0, Math.min(innerWidth - 12, Math.max(360, Math.min(420, Math.round(innerWidth * .30)))));
  }
  function updateLayout() {
    if (!document.documentElement) return;
    const size = width();
    const app = document.querySelector("#app");
    const push = opened && innerWidth >= 1100 && !!app;
    // Preserve WhatsApp's own vertical sizing and any native positioned root.
    // Replacing a definite viewport height with 100% under an auto-height body
    // collapses absolute/flex conversation layouts. A static root needs only a
    // containing block so its absolute children follow the reserved width.
    if (anchoredRoot) anchoredRoot.classList.remove(ANCHOR_CLASS);
    // A SPA can replace the root with a clone containing our previous marker.
    // Remove that marker too before inspecting the native positioning rule.
    app?.classList.remove(ANCHOR_CLASS);
    anchoredRoot = null;
    if (push && getComputedStyle(app).position === "static") {
      app.classList.add(ANCHOR_CLASS);
      anchoredRoot = app;
    }
    host.style.setProperty("--nexo-width", size + "px");
    host.dataset.state = opened ? "open" : "closed";
    host.dataset.layout = push ? "push" : "overlay";
    panel.hidden = !opened;
    launcher.hidden = opened;
    launcher.setAttribute("aria-expanded", String(opened));
    document.documentElement.classList.toggle(OPEN_CLASS, opened);
    document.documentElement.classList.toggle(PUSH_CLASS, push);
    if (push) document.documentElement.style.setProperty("--nexo-dock-width", size + "px");
    else document.documentElement.style.removeProperty("--nexo-dock-width");
    const active = !!document.querySelector("#main");
    const loggedIn = active || !!document.querySelector("#pane-side, #side, [data-testid='chat-list']");
    const nextStatus = active ? "Cliente y conversación, en un lugar" : loggedIn ? "Selecciona una conversación" : "Inicia sesión en WhatsApp Web";
    if (nextStatus !== oldStatus) { status.textContent = nextStatus; oldStatus = nextStatus; }
  }
  function setOpen(value, { focus = false } = {}) {
    opened = !!value;
    updateLayout();
    announcement.textContent = opened ? "Nexo CRM abierto junto a WhatsApp." : "Nexo CRM cerrado. Puedes volver a abrirlo con el botón Nexo.";
    if (focus) (opened ? close : launcher).focus({ preventScroll: true });
    return state();
  }
  function state() {
    return { open: opened, mounted: host.isConnected, layout: host.dataset.layout || "overlay", width: width() };
  }
  function ensureMounted() {
    if (!document.body) return;
    if (!host.isConnected) {
      const previous = document.getElementById(HOST_ID);
      if (previous && previous !== host && previous.dataset.nexoOwned === "true") previous.remove();
      document.body.append(host);
    }
    const styleParent = document.head || document.documentElement;
    if (!layoutStyle.isConnected) {
      const previous = document.getElementById(STYLE_ID);
      if (previous && previous !== layoutStyle) previous.remove();
      styleParent.append(layoutStyle);
    }
    updateLayout();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; ensureMounted(); });
  }
  close.addEventListener("click", () => setOpen(false, { focus: true }));
  launcher.addEventListener("click", () => setOpen(true, { focus: true }));
  configuration.addEventListener("click", async () => {
    try {
      const result = await chrome.runtime.sendMessage({ channel: "nexo", type: "configuration.open" });
      if (result?.ok === false) throw Error(result.error || "No se pudo abrir la configuración.");
    } catch { announcement.textContent = "Abre las opciones de Nexo CRM desde el menú de extensiones de Chrome."; }
  });
  shadow.addEventListener("keydown", event => {
    if (event.key === "Escape" && opened) { event.preventDefault(); setOpen(false, { focus: true }); }
  });
  window.addEventListener("resize", schedule, { passive: true });
  window.visualViewport?.addEventListener("resize", schedule, { passive: true });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.channel !== "nexo.dock") return false;
    if (sender.id !== extensionId || sender.tab || (sender.url && !sender.url.startsWith(extensionOrigin))) {
      sendResponse({ ok: false, error: "Origen de extensión no autorizado." });
      return false;
    }
    const action = message.action || "toggle";
    if (!["open", "close", "toggle", "state"].includes(action)) {
      sendResponse({ ok: false, error: "Acción de panel no válida." });
      return false;
    }
    ensureMounted();
    const result = action === "state" ? state() : setOpen(action === "toggle" ? !opened : action === "open", { focus: false });
    sendResponse({ ok: true, result });
    return false;
  });

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Preserve one controller across injections and SPA root replacements.
  globalThis.__nexoDockController = Object.freeze({ ensureMounted, open: () => setOpen(true), close: () => setOpen(false), state });
  ensureMounted();
})();
