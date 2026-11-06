import { normalizeRecipientPhone, personalizeMessage } from './outreach.mjs';

const uid = () => crypto.randomUUID();
const clone = value => structuredClone(value);
const node = (tag, text = '', className = '') => {
  const item = document.createElement(tag);
  if (text !== '') item.textContent = text;
  if (className) item.className = className;
  return item;
};
const labels = {
  pending: 'Intento registrado', claimed: 'Intento registrado', sending: 'En proceso', sent_observed: 'Salida observada',
  sent_manual: 'Confirmado por ti', uncertain: 'Revisar resultado', failed: 'Falló',
  skipped: 'Omitido', prepared: 'Preparado', cancelled: 'Detenido',
};

// The shared server configuration contains no WhatsApp session or API secrets.
// Native runtime operations remain in the authenticated browser extension.
export function initializeEngagement({ root, transport = {}, getState = () => ({}), notify }) {
  if (!root) throw Error('Falta el espacio de Chatbot.');
  root.classList.add('engagement-workspace');
  const css = node('link');
  css.rel = 'stylesheet';
  css.href = new URL('./engagement-ui.css', import.meta.url).href;
  document.head.append(css);

  let config = null, runtime = null, history = [], view = 'line';
  let busy = 0, dirty = false, destroyed = false, loadInFlight = null, dialogCount = 0;
  const objectURLs = new Set();
  const heading = node('div', '', 'engagement-heading');
  heading.append(node('h2', 'Chatbot y líneas'), node('p', 'Respuestas por reglas, sin suscripción.', 'engagement-muted'));
  const notice = node('p', '', 'engagement-notice');
  notice.id = 'engagement-notice'; notice.hidden = true;
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const navigation = node('nav', '', 'engagement-tabs');
  navigation.setAttribute('aria-label', 'Chatbot y líneas');
  const content = node('div'); content.id = 'engagement-content';
  root.append(heading, navigation, notice, content);

  function status(text, error = false) {
    if (destroyed) return;
    notice.textContent = text; notice.hidden = !text;
    notice.classList.toggle('is-error', error);
    if (text) notify?.(text);
  }
  function report(error) { status(error?.message || 'No se pudo completar la operación.', true); }
  function button(text, action, className = 'engagement-secondary', id) {
    const item = node('button', text, className); item.type = 'button';
    if (id) item.id = id;
    item.addEventListener('click', async () => {
      if (item.dataset.working) return;
      item.dataset.working = '1'; const wasDisabled = item.disabled; item.disabled = true; busy++;
      try { await action(item); } catch (error) { report(error); }
      finally { busy--; delete item.dataset.working; if (item.isConnected) item.disabled = wasDisabled; }
    });
    return item;
  }
  function field(parent, label, name, { tag = 'input', value = '', type = 'text', ...attributes } = {}) {
    const wrap = node('label'); wrap.append(node('span', label));
    const input = node(tag); input.name = name;
    if (tag === 'input') input.type = type;
    for (const [key, value] of Object.entries(attributes)) input[key] = value;
    input.value = value; wrap.append(input); parent.append(wrap);
    return input;
  }
  function check(parent, label, name, checked = false) {
    const input = field(parent, label, name, { type: 'checkbox' }); input.value = 'on'; input.checked = checked;
    input.parentElement.classList.add('engagement-check'); return input;
  }
  function option(select, value, text) { const item = node('option', text); item.value = value; select.append(item); }
  function card(title) { const item = node('section', '', 'engagement-card'); if (title) item.append(node('h3', title)); return item; }
  function empty(text) { return node('p', text, 'engagement-empty'); }
  function actions(...items) { const item = node('div', '', 'engagement-actions'); item.append(...items); return item; }
  function selectedLine() { return config?.lines.find(line => line.id === runtime?.selectedLineId); }
  function activeRules() { return config?.bot.rules.filter(rule => rule.enabled) || []; }
  function requireClean() { if (dirty) throw Error('Guarda la configuración antes de realizar esta acción.'); }
  async function call(path, options = {}) {
    const response = await (transport.fetch || fetch)(path, {
      ...options, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    let value;
    try { value = await response.json(); } catch { throw Error('No se pudo leer la respuesta del CRM.'); }
    if (!response.ok) throw Error(value?.error || 'No se pudo guardar. Actualiza e inténtalo de nuevo.');
    return value;
  }
  function validSnapshot(value) {
    if (!value || !Number.isInteger(value.revision) || !Array.isArray(value.lines) || !value.bot || !Array.isArray(value.bot.rules))
      throw Error('El servidor no devolvió la configuración de Chatbot.');
    return value;
  }
  async function refresh({ force = false } = {}) {
    if (destroyed || (!force && (dirty || dialogCount || busy))) return;
    if (loadInFlight) return loadInFlight;
    loadInFlight = (async () => {
      const next = validSnapshot(await call('/api/engagement'));
      let nextRuntime = null;
      if (transport.getEngagementRuntime) nextRuntime = await transport.getEngagementRuntime();
      if (destroyed || (!force && (dirty || dialogCount))) return;
      config = next; runtime = nextRuntime;
      if (view === 'history') await readHistory();
      render();
    })().catch(report).finally(() => { loadInFlight = null; });
    return loadInFlight;
  }
  async function save(change) {
    if (!config) throw Error('Carga la configuración antes de guardar.');
    const next = clone(config); change(next);
    const result = await call('/api/engagement', { method: 'PUT', body: JSON.stringify({ revision: next.revision, lines: next.lines, bot: next.bot }) });
    // Some backend transports return {ok,revision}; always read the authoritative
    // snapshot rather than constructing lease/online status from a local write.
    config = validSnapshot(result?.lines && result?.bot ? result : await call('/api/engagement'));
    dirty = false;
  }
  async function readHistory() {
    const result = await call('/api/engagement/history');
    if (!Array.isArray(result.items)) throw Error('No se pudo leer la actividad del chatbot.');
    history = result.items;
  }
  function dialog(title, saveAction) {
    const item = node('dialog', '', 'engagement-dialog'), form = node('form');
    const header = node('div', '', 'engagement-heading'); header.append(node('h3', title), button('×', () => item.close(), 'engagement-text'));
    const body = node('div'), error = node('p', '', 'engagement-error');
    const submit = node('button', 'Guardar', 'engagement-primary'); submit.type = 'submit';
    form.append(header, body, error, actions(button('Cancelar', () => item.close()), submit)); item.append(form);
    dialogCount++; document.body.append(item);
    item.addEventListener('close', () => { dialogCount--; item.remove(); }, { once: true });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submit.disabled) return; submit.disabled = true; busy++;
      try { await saveAction(form); item.close(); render(); }
      catch (cause) { error.textContent = cause.message; }
      finally { busy--; submit.disabled = false; }
    });
    return { item, form, body, error, submit };
  }
  for (const [key, text] of [['line', 'Mi línea'], ['rules', 'Reglas'], ['history', 'Actividad']]) {
    navigation.append(button(text, async () => {
      if (dirty && !confirm('¿Descartar los cambios sin guardar?')) return;
      dirty = false; view = key;
      if (view === 'history' && config) await readHistory();
      render();
    }, 'engagement-tab', 'engagement-tab-' + key));
  }
  function render() {
    if (destroyed) return;
    for (const item of navigation.children) {
      const active = item.id === 'engagement-tab-' + view;
      item.classList.toggle('active', active); item.setAttribute('aria-current', active ? 'page' : 'false');
    }
    content.replaceChildren();
    if (!config) {
      content.append(empty('Carga la configuración para ver tus líneas y respuestas.'), button('Actualizar', () => refresh({ force: true }), 'engagement-secondary', 'engagement-refresh'));
      return;
    }
    if (view === 'line') renderLine();
    else if (view === 'rules') renderRules();
    else renderHistory();
  }
  function renderLine() {
    const toolbar = actions(button('Actualizar', () => refresh({ force: true }), 'engagement-text', 'engagement-refresh'));
    content.append(toolbar);
    const current = selectedLine(), mine = card('Esta instalación');
    if (!transport.getEngagementRuntime) {
      mine.append(node('p', 'Puedes configurar aquí las líneas y las reglas. Inicia el chatbot desde la extensión de Chrome con WhatsApp abierto.', 'engagement-muted'));
    } else {
      const selector = field(mine, 'Línea de este perfil de Chrome', 'selectedLineId', { tag: 'select' }); selector.id = 'engagement-selected-line';
      option(selector, '', 'Selecciona tu línea');
      for (const line of config.lines) option(selector, line.id, `${line.name} · +${line.phone}`);
      selector.value = runtime?.selectedLineId || ''; selector.disabled = runtime?.running === true;
      const use = button('Usar esta línea', async () => {
        requireClean(); if (!selector.value) throw Error('Elige una línea registrada.');
        runtime = await transport.selectEngagementLine({ lineId: selector.value });
        if (!runtime?.selectedLineId) runtime = await transport.getEngagementRuntime();
        status('Línea seleccionada en este perfil. El chatbot continúa detenido.'); render();
      }, 'engagement-secondary', 'engagement-use-line'); use.disabled = runtime?.running === true || !config.lines.length;
      mine.append(actions(use));
      const running = runtime?.running === true;
      const badge = node('p', running ? 'Chatbot activado en este perfil' : 'Chatbot detenido en este perfil', 'engagement-runtime-state');
      badge.id = 'engagement-runtime-state'; badge.classList.toggle('is-running', running); mine.append(badge);
      if (runtime?.lastError) mine.append(node('p', runtime.lastError, 'engagement-error'));
      else if (runtime?.lastStatus) mine.append(node('p', runtime.lastStatus, 'engagement-muted'));
      const background = check(mine, 'Permitir trabajar en segundo plano en este perfil', 'allowBackground', runtime?.allowBackground === true);
      background.id = 'engagement-background'; background.disabled = !current?.allowBackground || running;
      if (!current?.allowBackground) mine.append(node('p', 'Para usar segundo plano, habilítalo primero al editar esta línea.', 'engagement-muted'));
      const start = button('Iniciar chatbot', async () => {
        requireClean(); if (!current || !current.enabled) throw Error('Selecciona una línea habilitada.');
        if (!config.bot.enabled || !activeRules().length) throw Error('Activa el chatbot y guarda al menos una regla habilitada en Reglas.');
        const message = `¿Activar las respuestas de ${current.name} (+${current.phone}) en este perfil? Comprueba que es el número de su WhatsApp. Solo se responderán textos nuevos del chat individual abierto.` + (background.checked ? ' Autorizas que esa pestaña de WhatsApp trabaje también en segundo plano.' : ' Mantén WhatsApp y la barra abiertos.');
        if (!confirm(message)) return;
        runtime = await transport.startChatbot({ lineId: current.id, allowBackground: background.checked });
        if (runtime?.running === undefined) runtime = await transport.getEngagementRuntime();
        if (runtime?.running !== true) throw Error(runtime?.lastError || 'No se confirmó la activación. Revisa WhatsApp.');
        status('Chatbot activado. Los mensajes anteriores no se responderán.');
        config = validSnapshot(await call('/api/engagement')); render();
      }, 'engagement-primary', 'engagement-start');
      start.disabled = running || !current?.enabled || !config.bot.enabled || !activeRules().length;
      const stop = button('Detener chatbot', async () => {
        runtime = await transport.stopChatbot();
        if (runtime?.running === undefined) runtime = await transport.getEngagementRuntime();
        status('Chatbot detenido en este perfil.'); await refresh({ force: true });
      }, 'engagement-danger', 'engagement-stop'); stop.disabled = !running;
      mine.append(actions(start, stop));
      if (!config.bot.enabled || !activeRules().length) mine.append(node('p', 'Primero crea una respuesta y activa el chatbot en Reglas.', 'engagement-muted'));
    }
    mine.append(node('p', 'Responde textos nuevos del chat individual abierto después de activarlo. No revisa otros chats, grupos ni el historial anterior.', 'engagement-scope'));
    content.append(mine);
    const lines = card(`Tus líneas · ${config.lines.length}/5`);
    const add = button('+ Añadir línea', () => editLine(), 'engagement-primary', 'engagement-new-line'); add.disabled = config.lines.length >= 5;
    lines.append(actions(add));
    if (!config.lines.length) lines.append(empty('Añade el nombre y número de tu primera línea.'));
    for (const line of config.lines) {
      const row = node('article', '', 'engagement-line'); row.dataset.lineId = line.id;
      const info = node('div'); info.append(node('strong', line.name), node('small', '+' + line.phone));
      const online = line.online === true && Number(line.leaseExpiresAt) > Date.now() / 1000;
      const badge = node('span', !line.enabled ? 'Deshabilitada' : online ? 'Sesión activa' : 'Sin sesión activa', 'engagement-pill' + (online ? ' is-online' : ''));
      info.append(badge); row.append(info, button('Editar', () => editLine(line), 'engagement-text')); lines.append(row);
    }
    const profiles = node('details'); profiles.append(node('summary', 'Usar cinco números simultáneos'));
    profiles.append(node('p', 'Usa un perfil de Chrome distinto por número. En cada perfil instala Nexo, abre su WhatsApp Web, vincula ese número como lo haces normalmente y selecciona su línea. Todos usan el mismo correo del CRM.', 'engagement-muted'));
    profiles.append(node('p', 'Cinco pestañas del mismo perfil comparten la misma sesión de WhatsApp. Para atender en paralelo, autoriza segundo plano en cada línea y en cada perfil. Chrome debe seguir abierto.', 'engagement-muted'));
    lines.append(profiles); content.append(lines);
    const stopAll = button('Detener todas las líneas', async () => {
      requireClean(); if (!confirm('¿Detener todas las líneas y desactivar el chatbot del negocio?')) return;
      await call('/api/engagement/stop', { method: 'POST', body: '{}' });
      if (transport.stopChatbot) await transport.stopChatbot().catch(() => {});
      status('Todas las líneas detenidas. El chatbot quedó desactivado.'); await refresh({ force: true });
    }, 'engagement-danger', 'engagement-stop-all');
    content.append(actions(stopAll));
  }
  function editLine(line) {
    requireClean();
    const { item, body } = dialog(line ? 'Editar línea' : 'Añadir línea', async form => {
      const values = Object.fromEntries(new FormData(form));
      const value = { id: line?.id || uid(), name: values.name.trim(), phone: normalizeRecipientPhone(values.phone, '51'), enabled: values.enabled === 'on', allowBackground: values.allowBackground === 'on' };
      if (!value.name) throw Error('Escribe un nombre para la línea.');
      await save(next => {
        if (next.lines.some(other => other.phone === value.phone && other.id !== value.id)) throw Error('Ese número ya tiene una línea.');
        if (line) next.lines = next.lines.map(other => other.id === line.id ? value : other);
        else { if (next.lines.length >= 5) throw Error('Puedes registrar hasta cinco líneas.'); next.lines.push(value); }
      });
      status('Línea guardada. Se activará cuando inicies el chatbot en su perfil de Chrome.');
    });
    field(body, 'Nombre de la línea', 'name', { value: line?.name || '', required: true, maxLength: 160, placeholder: 'Ventas, Soporte…' });
    field(body, 'Número de WhatsApp de esta línea', 'phone', { value: line?.phone || '', type: 'tel', required: true, placeholder: '+51 987 654 321' });
    check(body, 'Habilitar esta línea', 'enabled', line?.enabled ?? true);
    check(body, 'Permitir segundo plano', 'allowBackground', line?.allowBackground === true);
    body.append(node('p', 'Registrar el número no conecta una cuenta de WhatsApp. Debe corresponder a la sesión vinculada en ese perfil de Chrome.', 'engagement-muted'));
    if (line) body.append(button('Eliminar línea', async () => {
      if (!confirm(`¿Eliminar ${line.name} y detener su sesión?`)) return;
      await save(next => { next.lines = next.lines.filter(other => other.id !== line.id); }); item.close();
      if (runtime?.selectedLineId === line.id && transport.stopChatbot) await transport.stopChatbot().catch(() => {});
      status('Línea eliminada.'); await refresh({ force: true });
    }, 'engagement-danger', 'engagement-delete-line'));
    item.showModal();
  }
  function renderRules() {
    const form = node('form'); form.id = 'engagement-config-form';
    const general = card('Configuración del chatbot');
    check(general, 'Activar respuestas automáticas', 'enabled', config.bot.enabled);
    const cooldown = field(general, 'Pausa mínima entre respuestas al mismo contacto (segundos)', 'cooldownSeconds', { type: 'number', min: 0, max: 86400, step: 1, required: true, value: String(config.bot.cooldownSeconds) });
    cooldown.id = 'engagement-cooldown';
    const hours = node('details'); hours.append(node('summary', 'Horario de atención'));
    const useHours = check(hours, 'Responder solo dentro del horario', 'hoursEnabled', config.bot.hours.enabled);
    const times = node('div', '', 'engagement-grid');
    const start = field(times, 'Desde', 'start', { type: 'time', value: config.bot.hours.start, required: true });
    const end = field(times, 'Hasta', 'end', { type: 'time', value: config.bot.hours.end, required: true });
    const days = node('div', '', 'engagement-days');
    for (const [value, label] of [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']]) check(days, label, 'day-' + value, config.bot.hours.days.includes(value));
    hours.append(times, days, node('p', 'Zona horaria: Lima, Perú (America/Lima).', 'engagement-muted')); general.append(hours);
    const submit = node('button', 'Guardar configuración', 'engagement-primary'); submit.type = 'submit'; submit.id = 'engagement-save-config';
    general.append(actions(submit), node('p', 'Guardar reglas o activar esta opción no inicia envíos. En Mi línea debes pulsar Iniciar chatbot en cada perfil.', 'engagement-muted'));
    form.append(general);
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('change', () => { dirty = true; });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submit.disabled) return; submit.disabled = true; busy++;
      try {
        const values = Object.fromEntries(new FormData(form));
        await save(next => { next.bot = { ...next.bot, enabled: values.enabled === 'on', cooldownSeconds: Number(cooldown.value), timezone: 'America/Lima', hours: { enabled: useHours.checked, start: start.value, end: end.value, days: [1, 2, 3, 4, 5, 6, 7].filter(day => values['day-' + day] === 'on') } }; });
        status('Configuración guardada. Inicia o vuelve a iniciar cada línea para aplicar sus respuestas.'); render();
      } catch (error) { report(error); }
      finally { busy--; submit.disabled = false; }
    });
    content.append(form);
    const rules = card(`Respuestas · ${config.bot.rules.length}/50`);
    rules.append(node('p', 'Se utiliza la primera regla habilitada que coincida. Coloca la respuesta general al final.', 'engagement-muted'));
    const add = button('+ Nueva regla', () => editRule(), 'engagement-primary', 'engagement-new-rule'); add.disabled = config.bot.rules.length >= 50;
    rules.append(actions(add));
    if (!config.bot.rules.length) rules.append(empty('Crea tu primera respuesta. Ejemplo: si escriben “precio”, responde con tu catálogo.'));
    for (const [index, rule] of config.bot.rules.entries()) {
      const row = node('article', '', 'engagement-rule'); row.dataset.ruleId = rule.id;
      const title = node('div', '', 'engagement-heading'); title.append(node('strong', rule.name), node('span', rule.enabled ? 'Habilitada' : 'Desactivada', 'engagement-pill'));
      row.append(title, node('p', rule.match === 'fallback' ? 'Respuesta general' : (rule.match === 'exact' ? 'Texto exacto: ' : 'Contiene: ') + rule.keywords.join(' · '), 'engagement-muted'));
      row.append(node('p', rule.text || 'Solo archivos adjuntos', 'engagement-message'));
      if (rule.media?.length) row.append(node('small', rule.media.length + ' archivos adjuntos', 'engagement-muted'));
      const up = button('Subir', () => moveRule(index, -1), 'engagement-text'); up.disabled = index === 0;
      const down = button('Bajar', () => moveRule(index, 1), 'engagement-text'); down.disabled = index === config.bot.rules.length - 1;
      row.append(actions(button('Editar', () => editRule(rule), 'engagement-secondary'), up, down, button('Eliminar', async () => {
        requireClean(); if (!confirm('¿Eliminar esta respuesta automática?')) return;
        await save(next => { next.bot.rules = next.bot.rules.filter(value => value.id !== rule.id); }); status('Regla eliminada.'); render();
      }, 'engagement-danger'))); rules.append(row);
    }
    content.append(rules);
  }
  async function moveRule(index, offset) {
    requireClean(); await save(next => { const item = next.bot.rules.splice(index, 1)[0]; next.bot.rules.splice(index + offset, 0, item); }); render();
  }
  function editRule(rule) {
    requireClean(); let media = clone(rule?.media || []);
    const { item, body, submit } = dialog(rule ? 'Editar respuesta' : 'Nueva respuesta', async form => {
      const values = Object.fromEntries(new FormData(form));
      const value = { id: rule?.id || uid(), name: values.name.trim(), enabled: values.enabled === 'on', match: values.match, keywords: values.match === 'fallback' ? [] : [...new Set(values.keywords.split(/[\n,]+/).map(value => value.trim()).filter(Boolean))], text: values.text, media };
      if (!value.name || !value.text.trim() && !value.media.length) throw Error('Escribe el nombre y una respuesta o adjunta un archivo.');
      if (value.match !== 'fallback' && !value.keywords.length) throw Error('Escribe al menos una palabra o frase.');
      await save(next => {
        if (rule) next.bot.rules = next.bot.rules.map(other => other.id === rule.id ? value : other);
        else { if (next.bot.rules.length >= 50) throw Error('Puedes registrar hasta 50 respuestas.'); next.bot.rules.push(value); }
      }); status('Respuesta guardada. No se enviaron mensajes.');
    });
    field(body, 'Nombre de la respuesta', 'name', { required: true, maxLength: 160, value: rule?.name || '', placeholder: 'Precios, saludo, horarios…' });
    check(body, 'Habilitar esta respuesta', 'enabled', rule?.enabled ?? true);
    const match = field(body, 'Cuándo responder', 'match', { tag: 'select' });
    for (const [key, label] of [['exact', 'El texto coincide exactamente'], ['contains', 'El texto contiene una frase'], ['fallback', 'Respuesta general si ninguna regla anterior coincide']]) option(match, key, label);
    match.value = rule?.match || 'contains';
    const keywords = field(body, 'Palabras o frases, una por línea', 'keywords', { tag: 'textarea', rows: 3, value: (rule?.keywords || []).join('\n'), placeholder: 'precio\ncatálogo' });
    const updateKeywords = () => { keywords.parentElement.hidden = match.value === 'fallback'; };
    match.addEventListener('change', updateKeywords); updateKeywords();
    const text = field(body, 'Respuesta', 'text', { tag: 'textarea', rows: 5, maxLength: 8000, value: rule?.text || '', placeholder: 'Hola {nombre}, estos son nuestros precios…' });
    body.append(node('p', 'Variables: {nombre}, {telefono}, {negocio}, {servicio}, {vence}. No se entregan contraseñas automáticamente.', 'engagement-muted'));
    const attachments = card('Foto o video (opcional)'), mediaRows = node('div');
    function renderMedia() {
      mediaRows.replaceChildren();
      for (const attachment of media) {
        const row = node('div', '', 'engagement-media-row'); row.append(node('span', `${attachment.name} · ${(attachment.size / 1024 / 1024).toFixed(1)} MiB`), button('Quitar', () => { media = media.filter(value => value.id !== attachment.id); renderMedia(); }, 'engagement-text')); mediaRows.append(row);
      }
    }
    function addMedia(files) {
      const values = [...media]; for (const file of files) if (!values.some(item => item.id === file.id)) values.push(file);
      if (values.length > 10 || values.reduce((sum, value) => sum + value.size, 0) > 20 * 1024 * 1024) throw Error('Los adjuntos admiten 10 archivos y 20 MiB en total.');
      media = values; renderMedia();
    }
    if (transport.uploadMedia) {
      const file = field(attachments, 'Subir foto o video', 'file', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm' });
      const progress = node('p', '', 'engagement-muted'); progress.setAttribute('aria-live', 'polite'); attachments.append(progress);
      file.addEventListener('change', async () => {
        if (!file.files.length) return; submit.disabled = true; busy++;
        try {
          const selected = [...file.files];
          if (media.length + selected.length > 10 || media.reduce((sum, item) => sum + item.size, 0) + selected.reduce((sum, item) => sum + item.size, 0) > 20 * 1024 * 1024) throw Error('Los adjuntos admiten 10 archivos y 20 MiB en total.');
          for (const upload of selected) { progress.textContent = 'Guardando ' + upload.name; addMedia([await transport.uploadMedia(upload, { onProgress: percent => { progress.textContent = `Guardando ${upload.name}: ${percent}%`; } })]); }
          progress.textContent = 'Archivos privados guardados.';
        } catch (error) { progress.textContent = error.message; }
        finally { busy--; submit.disabled = false; file.value = ''; }
      });
    }
    if (transport.listMedia) {
      const library = node('div');
      attachments.append(button('Elegir de la biblioteca', async () => {
        const result = await transport.listMedia(); library.replaceChildren();
        for (const file of result.media || []) {
          const row = node('div', '', 'engagement-media-row'); row.append(node('span', file.name), button('Añadir', () => addMedia([file]), 'engagement-text')); library.append(row);
        }
        if (!(result.media || []).length) library.append(node('p', 'Todavía no tienes archivos guardados.', 'engagement-muted'));
      })); attachments.append(library);
    }
    attachments.append(mediaRows, node('p', 'Los archivos se guardan en la biblioteca privada del CRM. Máximo 10 adjuntos y 20 MiB por respuesta.', 'engagement-muted')); renderMedia(); body.append(attachments);
    const preview = node('details'); preview.append(node('summary', 'Vista previa del texto'));
    const output = node('p', '', 'engagement-message');
    const updatePreview = () => {
      const sample = (getState().clients || []).find(client => client.phone) || { name: 'Cliente de ejemplo', phone: '51987654321', service: 'Netflix', expires: '2026-12-01' };
      output.textContent = personalizeMessage(text.value, { name: sample.name, phone: sample.phone, fields: { servicio: sample.service || '', vence: sample.expires || '' } }, { business: getState().settings?.businessName || getState().settings?.business || getState().settings?.crmName || 'Tu negocio' });
    };
    preview.append(output); body.append(preview); text.addEventListener('input', updatePreview); updatePreview(); item.showModal();
  }
  function renderHistory() {
    content.append(node('p', 'Se muestran los últimos intentos registrados. Una salida observada no confirma entrega ni lectura.', 'engagement-muted'), actions(button('Actualizar actividad', async () => { await readHistory(); render(); }, 'engagement-secondary', 'engagement-refresh-history')));
    if (!history.length) content.append(empty('Todavía no hay respuestas automáticas registradas.'));
    for (const row of history) {
      const item = card(); item.classList.add('engagement-history-item');
      const line = config.lines.find(line => line.id === row.lineId);
      item.append(node('strong', line?.name || row.lineName || 'Línea'), node('span', labels[row.status] || row.status || 'Registrado', 'engagement-pill'));
      if (row.phone) item.append(node('p', '+' + row.phone, 'engagement-muted'));
      if (row.ruleName || row.ruleId) item.append(node('p', row.ruleName || config.bot.rules.find(rule => rule.id === row.ruleId)?.name || 'Respuesta anterior', 'engagement-muted'));
      const stamp = row.updatedAt || row.createdAt || row.sentAt;
      if (stamp) {
        const milliseconds = typeof stamp === 'number' ? stamp < 1e12 ? stamp * 1000 : stamp : Date.parse(stamp);
        if (Number.isFinite(milliseconds)) item.append(node('small', new Date(milliseconds).toLocaleString('es-PE', { timeZone: 'America/Lima' }), 'engagement-muted'));
      }
      if (row.error) item.append(node('p', row.error, 'engagement-error'));
      if (row.evidence) item.append(node('p', typeof row.evidence === 'string' ? row.evidence : 'Resultado registrado', 'engagement-muted'));
      if (row.status === 'uncertain' || row.status === 'sending' || row.status === 'claimed') item.append(node('p', 'Revisa esta conversación en WhatsApp. Este intento no se repite automáticamente.', 'engagement-muted'));
      content.append(item);
    }
  }
  function destroy() {
    if (destroyed) return; destroyed = true;
    for (const url of objectURLs) URL.revokeObjectURL(url);
    css.remove();
  }
  window.addEventListener('pagehide', destroy, { once: true });
  render(); void refresh();
  return { refresh, isBusy: () => busy > 0 || dirty || dialogCount > 0, destroy };
}
