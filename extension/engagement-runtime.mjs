// Chatbot rule/flow coordinator. All browser and authenticated HTTP boundaries
// are supplied by the extension background; no credentials leave this module.
const RUNTIME_KEY = 'engagementRuntime';
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const HEX = /^[a-f0-9]{32}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
export function selectRuntimeRule(bot, text) {
  if (!bot?.enabled || !normalized(text)) return null;
  let fallback = null;
  for (const rule of bot.rules || []) {
    if (rule.enabled !== true) continue;
    if (rule.match === 'fallback') { fallback ||= rule; continue; }
    const source = normalized(text);
    if ((rule.keywords || []).some(keyword => {
      const key = normalized(keyword);
      return key && (rule.match === 'exact' ? source === key : rule.match === 'contains' && source.includes(key));
    })) return rule;
  }
  return fallback;
}
export function personalizeRuntimeReply(text, values = {}) {
  const fields = {nombre: String(values.name || ''), name: String(values.name || ''), telefono: String(values.phone || ''), phone: String(values.phone || ''), negocio:values.business||'',servicio:values.service||'',servicios:values.services||'',vence:values.expires||'',perfil:values.profile||'',precio:values.price||''};
  return String(text || '').replace(/\{([^{}]+)\}/g, (original, key) => Object.hasOwn(fields, normalized(key)) ? fields[normalized(key)] : original).slice(0, 8000);
}
export function createEngagementRuntime(deps) {
  const {local, session, request, getSession, getOrigin, getTab, activeTab, sendContent, mediaFiles, epoch} = deps;
  let lifecycle = Promise.resolve(), processing = null, queuedTick = null, generation = 0;
  const revoked = new Set();
  const now = () => (deps.now?.() ?? Date.now());
  const uid = () => (deps.randomId?.() || crypto.randomUUID().replaceAll('-', ''));
  const selectionKey = origin => 'engagementLine:' + origin;
  const backgroundKey = (origin,lineId) => 'engagementBackground:' + origin + ':' + lineId;
  const runValue = async () => (await session.get(RUNTIME_KEY))[RUNTIME_KEY];
  async function installation() {
    const values = await local.get('engagementInstallationId');
    if (HEX.test(values.engagementInstallationId || '')) return values.engagementInstallationId;
    const value = uid();
    await local.set({engagementInstallationId:value});
    return value;
  }
  const serial = action => { const pending = lifecycle.then(action); lifecycle = pending.catch(() => {}); return pending; };
  async function api(origin, path, body) { return request(origin, '/api/engagement' + path, body === undefined ? 'GET' : 'POST', body); }
  function publicState(run, selectedLineId = '') {
    return {selectedLineId, running: run?.active === true, lineId: run?.lineId || '', allowBackground: run?.allowBackground === true,
      lastStatus: run?.lastStatus || '', lastError: run?.lastError || '', attention:run?.attention || '', flow:run?.flow || null, tabId: run?.tabId, expiresAt:run?.expiresAt};
  }
  async function patch(run, fields) {
    const current = await runValue();
    if (current?.runId === run.runId && !revoked.has(run.runId)) await session.set({[RUNTIME_KEY]:{...current,...fields}});
  }
  async function valid(run, {requireActive = true} = {}) {
    if (!run?.active || revoked.has(run.runId) || run.authEpoch !== epoch() || (await getOrigin()) !== run.origin) throw Error('El chatbot está detenido o cambió el CRM.');
    const credentials = await getSession(run.origin);
    if (!credentials || credentials.token !== run.sessionToken) throw Error('La sesión del chatbot terminó. Inicia sesión y actívalo de nuevo.');
    const live = await runValue();
    if (!live?.active || live.runId !== run.runId || revoked.has(run.runId)) throw Error('El chatbot fue detenido.');
    const tab = await getTab(run.tabId);
    if (!tab || new URL(tab.url).origin !== 'https://web.whatsapp.com' || tab.windowId !== run.windowId)
      throw Error('La pestaña de WhatsApp del chatbot se cerró o cambió.');
    if (requireActive && !live.allowBackground && !await activeTab(tab)) throw Error('Vuelve a WhatsApp o activa expresamente el trabajo en segundo plano.');
    if (!live.allowBackground && deps.panelActive && !await deps.panelActive(live)) throw Error('La barra se cerró. Activa el chatbot otra vez o autoriza segundo plano.');
    return {run:live,tab};
  }
  async function stopInternal(run, reason = 'Chatbot detenido.') {
    generation++;
    queuedTick=null;
    if (!run) return {running:false,lastStatus:reason};
    revoked.add(run.runId);
    await session.set({[RUNTIME_KEY]:{...run,active:false,lastStatus:reason,lastError:''}});
    await sendContent(run.tabId,run.origin,'botStop',{runId:run.runId}).catch(() => {});
    await api(run.origin,'/lease/release',{lineId:run.lineId,installationId:run.installationId,leaseToken:run.leaseToken}).catch(() => {});
    return publicState({...run,active:false,lastStatus:reason},run.lineId);
  }
  async function halt(run, error) {
    await stopInternal(run,'Chatbot pausado.');
    const current = await runValue();
    if (current?.runId === run.runId) await session.set({[RUNTIME_KEY]:{...current,lastError:error.message || String(error)}});
  }
  function leaseBody(run) {return {lineId:run.lineId,installationId:run.installationId,leaseToken:run.leaseToken};}
  async function heartbeat(run) {
    const response = await api(run.origin,'/lease/heartbeat',leaseBody(run));
    const config = response.config;
    const line = config?.lines?.find(item => item.id === run.lineId);
    if (!line?.enabled || !config.bot?.enabled || run.allowBackground && !line.allowBackground)
      throw Error('La línea o el chatbot se desactivaron en el CRM.');
    if (!Number.isFinite(response.expiresAt) || response.expiresAt * 1000 <= now()) throw Error('La reserva de esta línea caducó.');
    await patch(run,{expiresAt:response.expiresAt,config,lastHeartbeat:now()});
    return config;
  }
  return Object.freeze({
    async status(origin) {
      const run = await runValue(), values = await local.get(selectionKey(origin));
      const selectedLineId = values[selectionKey(origin)] || '';
      let current = run?.origin === origin ? run : null;
      if (current?.active) try {await valid(current,{requireActive:false});} catch (error) {await halt(current,error);current=await runValue();}
      const preference=selectedLineId?(await local.get(backgroundKey(origin,selectedLineId)))[backgroundKey(origin,selectedLineId)]===true:false;
      return {...publicState(current,selectedLineId),...(!current?.active?{allowBackground:preference}:{}),installationId:await installation()};
    },
    select(origin, lineId) {return serial(async()=>{
      if (lineId !== '' && !ID.test(lineId)) throw Error('Selecciona una línea válida.');
      const run=await runValue();if(run?.active)await stopInternal(run,'La selección de línea cambió.');
      await local.set({[selectionKey(origin)]:lineId});
      return {selectedLineId:lineId,installationId:await installation(),running:false};
    });},
    start({origin,windowId,tabId,lineId,panelContextId,allowBackground=false}) {const requestedGeneration=generation;return serial(async()=>{
      if(requestedGeneration!==generation)throw Error('La activación del chatbot fue cancelada.');
      const previous=await runValue();if(previous?.active)throw Error('Detén el chatbot actual antes de iniciar otra línea en este perfil.');
      if(!ID.test(lineId||''))throw Error('Selecciona una línea.');
      const mark=++generation, authEpoch=epoch(),credentials=await getSession(origin);
      if(!credentials)throw Error('Inicia sesión antes de activar el chatbot.');
      const tab=await getTab(tabId);if(!tab||tab.windowId!==windowId||!await activeTab(tab))throw Error('Abre WhatsApp en esta ventana para activar su chatbot.');
      const config=await api(origin,''),line=config.lines?.find(item=>item.id===lineId);
      if(!line?.enabled||!config.bot?.enabled||!(config.bot.rules?.some(rule=>rule.enabled)||config.bot.flows?.some(flow=>flow.enabled)))throw Error('Activa la línea y al menos una respuesta o flujo del chatbot en la configuración.');
      if(allowBackground&&!line.allowBackground)throw Error('Esta línea todavía no permite trabajar en segundo plano.');
      const installationId=await installation(),lease=await api(origin,'/lease',{lineId,installationId});
      if(!TOKEN.test(lease.leaseToken||'')||!Number.isFinite(lease.expiresAt)||lease.expiresAt*1000<=now())throw Error('No se pudo reservar esta línea.');
      const run={active:true,origin,windowId,tabId,lineId,panelContextId,installationId,leaseToken:lease.leaseToken,expiresAt:lease.expiresAt,runId:uid(),sessionToken:credentials.token,authEpoch,allowBackground:allowBackground===true,config:lease.config||config,lastHeartbeat:now(),lastStatus:'Esperando mensajes nuevos en el chat abierto.',lastError:'',startedAt:now()};
      try {
        if(mark!==generation||authEpoch!==epoch()||(await getSession(origin))?.token!==credentials.token)throw Error('La sesión cambió durante la activación.');
        await session.set({[RUNTIME_KEY]:run});
        await sendContent(tabId,origin,'botStart',{runId:run.runId,allowBackground:run.allowBackground});
        if(mark!==generation||authEpoch!==epoch())throw Error('El chatbot fue detenido durante la activación.');
        await local.set({[selectionKey(origin)]:lineId});
        return {...publicState(run,lineId),installationId};
      }catch(error){await stopInternal(run);throw error;}
    });},
    setBackground({origin,allowBackground}) {return serial(async()=>{
      if(typeof allowBackground!=='boolean')throw Error('El permiso de segundo plano no es válido.');
      const state=await local.get(selectionKey(origin)),selectedLineId=state[selectionKey(origin)];
      if(!selectedLineId)throw Error('Selecciona la línea de este perfil.');
      const config=await api(origin,''),line=config.lines?.find(item=>item.id===selectedLineId);
      if(!line?.enabled||allowBackground&&!line.allowBackground)throw Error('Guarda primero el permiso de esta línea.');
      const run=await runValue();
      if(run?.active&&run.origin===origin){
        await valid(run,{requireActive:false});
        await sendContent(run.tabId,origin,'botSetBackground',{runId:run.runId,allowBackground});
        await valid(run,{requireActive:false});
        await patch(run,{allowBackground,config,lastStatus:allowBackground?'Segundo plano activado para este perfil.':'Segundo plano desactivado.',lastError:''});
      }
      await local.set({[backgroundKey(origin,selectedLineId)]:allowBackground});
      return this.status(origin);
    });},
    async stop(origin) {generation++;const run=await runValue();if(run?.origin!==origin)return {running:false};return stopInternal(run);},
    async invalidate() {
      generation++;const run=await runValue();if(run?.runId)revoked.add(run.runId);
      if(run?.active)await stopInternal(run,'La sesión cambió. Activa el chatbot de nuevo después de ingresar.');
    },
    async resumeDocument(sender) {
      const run=await runValue();if(!run?.active||sender.tab?.id!==run.tabId)return;
      try {await valid(run,{requireActive:false});await sendContent(run.tabId,run.origin,'botEnsure',{runId:run.runId,allowBackground:run.allowBackground});}catch(error){await halt(run,error);}
    },
    async tick(sender,input={},drain=0) {
      const original=await runValue();
      if(!original?.active||sender.tab?.id!==original.tabId||input.runId!==original.runId)return {running:false};
      if(processing){queuedTick={sender,input};return {running:true,busy:true};}
      processing=(async()=>{
        let run=original;
        try {
          ({run}=await valid(run));
          let config=run.config;
          if(now()-(run.lastHeartbeat||0)>=25000||run.expiresAt*1000-now()<60000){config=await heartbeat(run);run=(await runValue())||run;}
          const snapshot=await sendContent(run.tabId,run.origin,'botSnapshot',{runId:run.runId});
          const context=snapshot.context;
          if(!/^wa:[^\s]+$/.test(context?.chatId||'')||context.isGroup||context.ambiguous){
            const attention=context?.isGroup?'group':context?.ambiguous?'changing':'chat';
            const descriptions={group:'El chatbot no responde a grupos. Abre una conversación individual.',changing:'WhatsApp está cambiando de conversación. Esperando que termine.',chat:'Abre una conversación individual para que el chatbot pueda responder.'};
            await patch(run,{attention,lastStatus:descriptions[attention],lastError:''});
            return {running:true,attention};
          }
          if(run.attention)await patch(run,{attention:'',lastStatus:'Esperando mensajes nuevos en el chat abierto.',lastError:''});
          for(const incoming of (snapshot.messages||[]).slice(-10)){
            if(incoming.chatId!==context.chatId||incoming.phone&&context.phone&&incoming.phone!==context.phone||typeof incoming.body!=='string'||!incoming.body.trim())continue;
            const rule=selectRuntimeRule(config.bot,incoming.body);
            const grant=await api(run.origin,'/bot/claim',{...leaseBody(run),phone:context.phone||'',chatId:context.chatId,incomingId:incoming.id,incomingText:incoming.body,...(rule?{ruleId:rule.id}:{})});
            if(!grant.claimed){
              const reasons={conversation_limit:'La memoria de conversaciones alcanzó su límite.',handoff:'La conversación está en atención personal. Escribe menú para volver al flujo.',outside_hours:'El mensaje llegó fuera del horario configurado.',disabled:'Las respuestas automáticas están desactivadas en el CRM.',rule_changed:'Las reglas cambiaron. Actualizando la configuración del chatbot.',cooldown_or_changed:'Pausa mínima por contacto activa o configuración modificada. Esperando otro mensaje nuevo.',cooldown:'Pausa mínima por contacto activa. Esperando otro mensaje nuevo.',history_limit:'El historial de respuestas alcanzó su límite. No se enviarán nuevas respuestas.',duplicate:'Este mensaje ya tiene un intento registrado; no se repetirá.',no_match:'El texto nuevo no coincide con una respuesta ni un flujo habilitado.',blocked:'Esta conversación requiere revisión antes de continuar.',busy:'Esta conversación tiene una respuesta en proceso.',conversation_blocked:'Esta conversación requiere revisión antes de continuar.',conversation_busy:'Esta conversación tiene una respuesta en proceso.'};
              await patch(run,{lastStatus:reasons[grant.reason]||'No se autorizó otra respuesta para este mensaje.',lastError:''});continue;
            }
            let result;
            try {
              ({run}=await valid(run));
              const reply=grant.reply||grant.rule;
              if(!reply||typeof reply.text!=='string'||!reply.text.trim()&&!reply.media?.length)throw Error('El servidor no devolvió una respuesta válida.');
              const files=await mediaFiles(run.origin,reply.media||[]);
              let values={...context};
              if(/\{(nombre|name|negocio|servicio|servicios|vence|perfil|precio)\}/i.test(reply.text)){
                const workspace=await request(run.origin,'/api/workspace','GET');
                const state=workspace.state||workspace.data||workspace;
                const clients=context.phone?(state.clients||[]).filter(row=>!row.archived&&row.phone===context.phone):[],first=clients[0];
                values={...values,name:first?.name||context.name,business:state.settings?.businessName||state.settings?.business||state.settings?.crmName||'',service:first?.service||'',services:[...new Set(clients.map(row=>row.service))].join(', '),expires:first?.expires||'',profile:first?.profile||'',price:first&&!first.pricePending&&Number.isSafeInteger(first.price)?(first.price/100).toFixed(2):''};
              }
              ({run}=await valid(run));
              await patch(run,{attention:'',pendingClaim:{claimId:grant.claimId,claimToken:grant.claimToken,phone:context.phone,incomingId:incoming.id,chatId:context.chatId},lastStatus:'Preparando respuesta a '+(context.name||context.phone)+'.',lastError:''});
              result=await sendContent(run.tabId,run.origin,'campaignSend',{runId:run.runId,mode:'bot',claimId:grant.claimId,claimToken:grant.claimToken,incomingId:incoming.id,chatId:context.chatId,allowBackground:run.allowBackground,phone:context.phone||'',text:personalizeRuntimeReply(reply.text,values),files,automatic:true});
              if(!['sent_observed','failed','uncertain'].includes(result?.status))result={status:'uncertain',error:'No se pudo verificar el resultado de la respuesta.'};
            }catch(error){result={status:'uncertain',error:error.message};}
            await api(run.origin,'/bot/result',{claimId:grant.claimId,claimToken:grant.claimToken,status:result.status,evidence:String(result.evidence||'').slice(0,1000),error:String(result.error||'').slice(0,1000)});
            await patch(run,{pendingClaim:null,flow:(grant.flow||grant.flowId)?{id:grant.flowId||grant.flow?.id,nodeId:grant.flow?.nodeId||grant.nodeId||'',waiting:grant.flow?.waiting||'',ended:grant.flow?.ended===true}:null,lastStatus:result.status==='sent_observed'?'Respuesta observada en WhatsApp.':'La respuesta requiere revisión.',lastError:result.error||''});
            if(result.status==='uncertain'){await halt(run,Error('Resultado incierto. Revisa la conversación antes de activar el chatbot otra vez.'));break;}
          }
          return {running:!revoked.has(run.runId)};
        }catch(error){await halt(run,error);return {running:false,error:error.message};}
      })();
      try{return await processing;}finally{processing=null;if(queuedTick&&drain<3){const next=queuedTick;queuedTick=null;await this.tick(next.sender,next.input,drain+1);}}
    },
    async permit(sender,input={}) {
      let run=await runValue();const mark=generation,authEpoch=epoch();
      try {
        if(!run?.active||sender.tab?.id!==run.tabId||input.runId!==run.runId||input.claimId!==run.pendingClaim?.claimId||input.claimToken!==run.pendingClaim?.claimToken||input.chatId!==run.pendingClaim?.chatId||(input.phone||'')!==(run.pendingClaim?.phone||'')) return {allowed:false};
        ({run}=await valid(run));
        const permit=await api(run.origin,'/bot/permit',{...leaseBody(run),chatId:input.chatId,phone:input.phone||'',claimId:input.claimId,claimToken:input.claimToken});
        ({run}=await valid(run));
        return {allowed:permit.allowed===true&&mark===generation&&authEpoch===epoch()&&!revoked.has(run.runId)};
      }catch{return {allowed:false};}
    },
  });
}
