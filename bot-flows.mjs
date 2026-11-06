// Pure conversation graph validation and evaluation. The caller owns leases,
// recipient identity, persistence and delivery; this module sends no messages.
export const BOT_FLOW_LIMITS = Object.freeze({ flows: 20, nodes: 50, options: 10, variables: 20, valueChars: 1000, replyChars: 8000, media: 10, mediaBytes: 20971520 });
const TYPES = new Set(['message', 'menu', 'question', 'end', 'handoff']);
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);
const VALIDATIONS = new Set(['text', 'number', 'email', 'phone']);
const RESERVED = new Set(['__proto__', 'prototype', 'constructor', 'password', 'contrasena', 'contraseña', 'token', 'secret']);
const RESTART = new Set(['0', 'menu', 'inicio']);
const CANCEL = new Set(['salir', 'cancelar']);
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw Error(message || 'El flujo de conversación no es válido.'); };
export const normalizeFlowText = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
function text(value, length, required = false) {
  if (typeof value !== 'string' || value.length > length || required && !value.trim()) fail();
  return value;
}
function identifier(value, label = 'identificador') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value) || RESERVED.has(value.toLowerCase())) fail('El ' + label + ' del flujo no es válido.');
  return value;
}
function variable(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value) || RESERVED.has(normalizeFlowText(value))) fail('Usa un nombre de variable válido, como nombre_cliente o correo.');
  return value;
}
function enabled(value = false) { if (typeof value !== 'boolean') fail(); return value; }
function files(value = []) {
  if (!Array.isArray(value) || value.length > BOT_FLOW_LIMITS.media) fail('La respuesta admite hasta diez archivos.');
  const seen = new Set(), result = value.map(item => {
    if (!object(item) || !/^[a-f0-9]{32}$/.test(item.id || '') || !MEDIA_TYPES.has(item.type) || !/^[a-f0-9]{64}$/.test(item.sha256 || '') || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > BOT_FLOW_LIMITS.mediaBytes || seen.has(item.id)) fail('Un archivo del flujo no es válido o está repetido.');
    seen.add(item.id);
    return { id: item.id, name: text(item.name, 200, true), type: item.type, size: item.size, sha256: item.sha256 };
  });
  if (result.reduce((sum, item) => sum + item.size, 0) > BOT_FLOW_LIMITS.mediaBytes) fail('Los archivos de una respuesta superan 20 MiB.');
  return result;
}
function keywords(value = []) {
  if (!Array.isArray(value) || value.length > 30) fail('El flujo admite hasta treinta frases de inicio.');
  const result = [], seen = new Set();
  for (const item of value) {
    const phrase = text(item, 100, true).trim(), normalized = normalizeFlowText(phrase);
    if (!seen.has(normalized)) { result.push(phrase); seen.add(normalized); }
  }
  return result;
}
function cleanNode(value) {
  if (!object(value) || !TYPES.has(value.type)) fail('El tipo de paso del flujo no es válido.');
  const result = { id: identifier(value.id, 'paso'), type: value.type, text: text(value.text ?? '', BOT_FLOW_LIMITS.replyChars), media: files(value.media) };
  if (value.type !== 'menu' && !result.text.trim() && !result.media.length) fail('Escribe el mensaje de cada paso o añade un archivo.');
  if (['message', 'question'].includes(value.type)) result.nextNodeId = identifier(value.nextNodeId, 'destino');
  if (value.type === 'question') {
    result.variable = variable(value.variable);
    result.validation = value.validation ?? 'text';
    if (!VALIDATIONS.has(result.validation)) fail('La validación de una pregunta no es válida.');
  }
  if (value.type === 'menu') {
    if (!Array.isArray(value.options) || !value.options.length || value.options.length > BOT_FLOW_LIMITS.options) fail('Añade entre una y diez opciones al menú.');
    const seenKeys = new Set(), seenLabels = new Set();
    result.options = value.options.map(item => {
      if (!object(item)) fail();
      const key = text(item.key, 20, true).trim(), normalizedKey = normalizeFlowText(key);
      const label = text(item.label, 160, true).trim(), normalizedLabel = normalizeFlowText(label);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(key) || RESTART.has(normalizedKey) || CANCEL.has(normalizedKey) || seenKeys.has(normalizedKey) || seenLabels.has(normalizedLabel)) fail('Las opciones del menú necesitan claves y nombres diferentes; 0 y menú se reservan para reiniciar.');
      seenKeys.add(normalizedKey); seenLabels.add(normalizedLabel);
      return { key, label, nextNodeId: identifier(item.nextNodeId, 'destino') };
    });
  }
  if (own(value, 'invalidText') && ['menu', 'question'].includes(value.type)) result.invalidText = text(value.invalidText, 1000);
  return result;
}
function nodeText(node, variables = {}) {
  const body = renderFlowText(node.text, variables);
  return node.type === 'menu' ? [body, ...node.options.map(item => item.key + '. ' + renderFlowText(item.label, variables))].filter(Boolean).join('\n') : body;
}
function invalidText(node) { return node.invalidText || (node.type === 'menu' ? 'Elige una opción de la lista.' : 'La respuesta no tiene el formato esperado. Inténtalo otra vez.'); }
function reply(parts, media) {
  const body = parts.filter(part => part !== '').join('\n\n');
  if (body.length > BOT_FLOW_LIMITS.replyChars) fail('La respuesta combinada del flujo supera 8000 caracteres. Divide los pasos.');
  const unique = new Map();
  for (const item of media) {
    if (unique.has(item.id) && JSON.stringify(unique.get(item.id)) !== JSON.stringify(item)) fail('Un archivo repetido tiene datos diferentes. Selecciónalo de nuevo.');
    unique.set(item.id, item);
  }
  return { text: body, media: files([...unique.values()]) };
}
export function cleanBotFlow(value) {
  if (!object(value) || !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > BOT_FLOW_LIMITS.nodes) fail('Un flujo necesita entre uno y cincuenta pasos.');
  const result = { id: identifier(value.id), name: text(value.name, 160, true), enabled: enabled(value.enabled), entryNodeId: identifier(value.entryNodeId, 'paso inicial'), triggerKeywords: keywords(value.triggerKeywords), nodes: value.nodes.map(cleanNode) };
  const map = new Map(result.nodes.map(item => [item.id, item]));
  if (map.size !== result.nodes.length) fail('Hay pasos repetidos en el flujo.');
  if (!map.has(result.entryNodeId)) fail('El paso inicial no existe.');
  for (const node of result.nodes) {
    for (const target of node.type === 'menu' ? node.options.map(item => item.nextNodeId) : node.nextNodeId ? [node.nextNodeId] : []) if (!map.has(target)) fail('Un paso apunta a un destino que no existe.');
    if (['menu', 'question'].includes(node.type)) reply([invalidText(node), nodeText(node)], node.media);
  }
  const variables = new Set(result.nodes.filter(item => item.type === 'question').map(item => item.variable.toLowerCase()));
  if (variables.size > BOT_FLOW_LIMITS.variables) fail('El flujo admite hasta veinte datos diferentes por conversación.');
  // Menus/questions break automatic chains, so user-selected loops are valid.
  // A message-only loop would never wait for an answer and is rejected.
  for (const first of result.nodes) {
    let current = first; const visited = new Set(), parts = [], media = [];
    for (;;) {
      if (visited.has(current.id)) fail('Hay un ciclo de mensajes automáticos sin una pregunta o menú.');
      visited.add(current.id); parts.push(nodeText(current)); media.push(...current.media);
      if (current.type !== 'message') break;
      current = map.get(current.nextNodeId);
    }
    reply(parts, media);
  }
  return result;
}
export function cleanBotFlows(value) {
  if (!Array.isArray(value) || value.length > BOT_FLOW_LIMITS.flows) fail('Puedes configurar hasta veinte flujos.');
  const result = value.map(cleanBotFlow);
  if (new Set(result.map(item => item.id)).size !== result.length) fail('Hay flujos repetidos.');
  return result;
}
function cleanVariables(value = {}) {
  if (!object(value) || Object.keys(value).length > BOT_FLOW_LIMITS.variables) fail('Los datos de la conversación no son válidos.');
  const result = {}, names = new Set();
  for (const [key, item] of Object.entries(value)) {
    const valid = variable(key);
    if (names.has(valid.toLowerCase())) fail('Una variable de la conversación está repetida.');
    names.add(valid.toLowerCase()); result[valid] = text(item, BOT_FLOW_LIMITS.valueChars);
  }
  return result;
}
export function renderFlowText(body, values = {}) {
  const lookup = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return String(body).replace(/\{([A-Za-z][A-Za-z0-9_]{0,39})\}/g, (placeholder, key) => lookup.has(key.toLowerCase()) ? String(lookup.get(key.toLowerCase())) : placeholder);
}
export function cleanFlowState(flowValue, value) {
  const flow = cleanBotFlow(flowValue);
  if (value === null || value === undefined) return null;
  if (!object(value) || value.flowId !== flow.id || !flow.nodes.some(node => node.id === value.nodeId)) fail('El paso guardado de esta conversación ya no existe. Reinicia el flujo.');
  const node = flow.nodes.find(item => item.id === value.nodeId), ended = enabled(value.ended, false);
  const result = { flowId: flow.id, nodeId: node.id, variables: cleanVariables(value.variables), waiting: value.waiting === undefined ? !ended && ['menu', 'question'].includes(node.type) : enabled(value.waiting), ended, handoff: enabled(value.handoff) };
  if (result.waiting && (result.ended || !['menu', 'question'].includes(node.type)) || result.handoff && !result.ended) fail('El estado de esta conversación no es válido.');
  return result;
}
function captureAnswer(kind, raw) {
  const value = raw.trim();
  if (!value || value.length > BOT_FLOW_LIMITS.valueChars) return null;
  if (kind === 'text') return value;
  if (kind === 'email') return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
  if (kind === 'number') return /^[-+]?\d+(?:[.,]\d+)?$/.test(value) && Number.isFinite(Number(value.replace(',', '.'))) ? value.replace(',', '.') : null;
  if (kind === 'phone') {
    if (!/^\+?[\d\s().-]+$/.test(value)) return null;
    let number = value.replace(/\D/g, '');
    if (value.startsWith('00')) number = number.slice(2);
    if (number.length === 9) number = '51' + number;
    return /^[1-9]\d{6,14}$/.test(number) ? number : null;
  }
  return null;
}
function stateAt(flow, node, variables) { return { flowId: flow.id, nodeId: node.id, variables: cleanVariables(variables), waiting: ['menu', 'question'].includes(node.type), ended: ['end', 'handoff'].includes(node.type), handoff: node.type === 'handoff' }; }
function resolve(flow, nodeId, variables, reason, accepted) {
  const map = new Map(flow.nodes.map(item => [item.id, item])), parts = [], media = [];
  let node = map.get(nodeId);
  for (let count = 0; count < BOT_FLOW_LIMITS.nodes; count++) {
    parts.push(nodeText(node, variables)); media.push(...node.media);
    if (node.type !== 'message') {
      const nextState = stateAt(flow, node, variables);
      return { reply: reply(parts, media), nextState, waiting: nextState.waiting, ended: nextState.ended, handoff: nextState.handoff, accepted, reason };
    }
    node = map.get(node.nextNodeId);
  }
  fail('El flujo tiene demasiados mensajes automáticos seguidos.');
}
export function advanceFlow(flowValue, stateValue, incomingText) {
  const flow = cleanBotFlow(flowValue), state = cleanFlowState(flow, stateValue);
  if (typeof incomingText !== 'string' || incomingText.length > BOT_FLOW_LIMITS.replyChars) fail('El texto recibido no es válido.');
  const command = normalizeFlowText(incomingText);
  if (state?.handoff && !RESTART.has(command)) return { reply: null, nextState: state, waiting: false, ended: true, handoff: true, accepted: false, reason: 'handoff' };
  if (CANCEL.has(command)) {
    const node = flow.nodes.find(item => item.id === (state?.nodeId || flow.entryNodeId));
    const nextState = { ...stateAt(flow, node, state?.variables || {}), waiting: false, ended: true, handoff: false };
    return { reply: { text: 'Conversación finalizada. Escribe menú para comenzar de nuevo.', media: [] }, nextState, waiting: false, ended: true, handoff: false, accepted: true, reason: 'cancelled' };
  }
  if (!state || state.ended || RESTART.has(command)) return resolve(flow, flow.entryNodeId, {}, RESTART.has(command) ? 'restart' : 'started', true);
  const node = flow.nodes.find(item => item.id === state.nodeId), variables = { ...state.variables };
  let nextNodeId;
  if (node.type === 'menu') {
    const choice = node.options.find(item => [item.key, item.label, item.key + '. ' + item.label].some(value => normalizeFlowText(value) === command));
    nextNodeId = choice?.nextNodeId;
  } else if (node.type === 'question') {
    const value = captureAnswer(node.validation, incomingText);
    if (value !== null) {
      const previous = Object.keys(variables).find(key => key.toLowerCase() === node.variable.toLowerCase());
      if (previous && previous !== node.variable) delete variables[previous];
      variables[node.variable] = value; nextNodeId = node.nextNodeId;
    }
  } else return resolve(flow, node.id, variables, 'advanced', true);
  if (!nextNodeId) {
    const nextState = stateAt(flow, node, variables);
    return { reply: reply([renderFlowText(invalidText(node), variables), nodeText(node, variables)], node.media), nextState, waiting: true, ended: false, handoff: false, accepted: false, reason: 'invalid' };
  }
  return resolve(flow, nextNodeId, variables, 'advanced', true);
}
export function selectBotFlow(bot, incomingText, { flowId, ruleId } = {}) {
  if (!bot?.enabled) return null;
  const flows = (bot.flows || []).filter(item => item.enabled), byId = id => flows.find(item => item.id === id) || null;
  if (flowId) return byId(flowId);
  if (ruleId) {
    const linked = byId((bot.rules || []).find(item => item.id === ruleId && item.enabled)?.flowId);
    if (linked) return linked;
  }
  const source = normalizeFlowText(incomingText);
  if (!source) return null;
  const triggered = flows.find(item => (item.triggerKeywords || []).some(phrase => source.includes(normalizeFlowText(phrase))));
  if (triggered) return triggered;
  const linked = (bot.rules || []).find(item => item.enabled && item.flowId && (item.match === 'fallback' || (item.keywords || []).some(phrase => item.match === 'exact' ? source === normalizeFlowText(phrase) : source.includes(normalizeFlowText(phrase)))));
  return byId(linked?.flowId) || byId(bot.defaultFlowId);
}
