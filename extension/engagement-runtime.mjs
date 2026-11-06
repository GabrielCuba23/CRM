// Rules-based chatbot coordinator. All browser and authenticated HTTP boundaries
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
  let lifecycle = Promise.resolve(), processing = null, generation = 0;
  const revoked = new Set();
  const now = () => (deps.now?.() ?? Date.now());
  const uid = () => (deps.randomId?.() || crypto.randomUUID().replaceAll('-', ''));
  const selectionKey = origin => 'engagementLine:' + origin;
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
      lastStatus: run?.lastStatus || '', lastError: run?.lastError || '', attention:run?.attention || '', tabId: run?.tabId, expiresAt:run?.expiresAt};
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
    if (requireActive && !run.allowBackground && !await activeTab(tab)) throw Error('Vuelve a WhatsApp o activa expresamente el trabajo en segundo plano.');
    if (!run.allowBackground && deps.panelActive && !await deps.panelActive(run)) throw Error('La barra se cerró. Activa el chatbot otra vez o autoriza segundo plano.');
    return {run:live,tab};
  }
  async function stopInternal(run, reason = 'Chatbot detenido.') {
    generation++;
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
      return {...publicState(current,selectedLineId),installationId:await installation()};
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
      if(!line?.enabled||!config.bot?.enabled||!config.bot.rules?.some(rule=>rule.enabled))throw Error('Activa la línea y al menos una regla del chatbot en la configuración.');
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
    async stop(origin) {generation++;const run=await runValue();if(run?.origin!==origin)return {running:false};return stopInternal(run);},
    async invalidate() {
      generation++;const run=await runValue();if(run?.runId)revoked.add(run.runId);
      if(run?.active)await stopInternal(run,'La sesión cambió. Activa el chatbot de nuevo después de ingresar.');
    },
    async resumeDocument(sender) {
      const run=await runValue();if(!run?.active||sender.tab?.id!==run.tabId)return;
      try {await valid(run,{requireActive:false});await sendContent(run.tabId,run.origin,'botEnsure',{runId:run.runId,allowBackground:run.allowBackground});}catch(error){await halt(run,error);}
    },
    async tick(sender,input={}) {
      const original=await runValue();
      if(!original?.active||sender.tab?.id!==original.tabId||input.runId!==original.runId)return {running:false};
      if(processing)return {running:true,busy:true};
      processing=(async()=>{
        let run=original;
        try {
          await valid(run);
          let config=run.config;
          if(now()-(run.lastHeartbeat||0)>=25000||run.expiresAt*1000-now()<60000){config=await heartbeat(run);run=(await runValue())||run;}
          const snapshot=await sendContent(run.tabId,run.origin,'botSnapshot',{runId:run.runId});
          const context=snapshot.context;
          if(!context?.chatId||!context.phone||context.isGroup||context.ambiguous){
            const attention=context?.isGroup?'group':context?.ambiguous?'changing':context?.chatId&&!context.phone?'phone':'chat';
            const descriptions={group:'El chatbot no responde a grupos. Abre una conversación individual.',changing:'WhatsApp está cambiando de conversación. Esperando que termine.',phone:'WhatsApp oculta el teléfono de este chat. En Chat actual, vincula su ficha o abre la información del contacto.',chat:'Abre una conversación individual para que el chatbot pueda responder.'};
            await patch(run,{attention,lastStatus:descriptions[attention],lastError:''});
            return {running:true,attention};
          }
          if(run.attention)await patch(run,{attention:'',lastStatus:'Esperando mensajes nuevos en el chat abierto.',lastError:''});
          for(const incoming of (snapshot.messages||[]).slice(-10)){
            if(incoming.phone!==context.phone||incoming.chatId!==context.chatId||typeof incoming.body!=='string'||!incoming.body.trim())continue;
            const rule=selectRuntimeRule(config.bot,incoming.body);if(!rule){await patch(run,{lastStatus:'El texto nuevo no coincide con ninguna regla habilitada.',lastError:''});continue;}
            const grant=await api(run.origin,'/bot/claim',{...leaseBody(run),phone:context.phone,incomingId:incoming.id,incomingText:incoming.body,ruleId:rule.id});
            if(!grant.claimed){
              const reasons={outside_hours:'El mensaje llegó fuera del horario configurado.',disabled:'Las respuestas automáticas están desactivadas en el CRM.',rule_changed:'Las reglas cambiaron. Actualizando la configuración del chatbot.',cooldown_or_changed:'Pausa mínima por contacto activa o configuración modificada. Esperando otro mensaje nuevo.',cooldown:'Pausa mínima por contacto activa. Esperando otro mensaje nuevo.',history_limit:'El historial de respuestas alcanzó su límite. No se enviarán nuevas respuestas.',duplicate:'Este mensaje ya tiene un intento registrado; no se repetirá.'};
              await patch(run,{lastStatus:reasons[grant.reason]||'No se autorizó otra respuesta para este mensaje.',lastError:''});continue;
            }
            let result;
            try {
              await valid(run);
              const files=await mediaFiles(run.origin,grant.rule.media||[]);
              let values={...context};
              if(/\{(nombre|name|negocio|servicio|servicios|vence|perfil|precio)\}/i.test(grant.rule.text)){
                const workspace=await request(run.origin,'/api/workspace','GET');
                const state=workspace.state||workspace.data||workspace;
                const clients=(state.clients||[]).filter(row=>!row.archived&&row.phone===context.phone),first=clients[0];
                values={...values,name:first?.name||context.name,business:state.settings?.businessName||state.settings?.business||state.settings?.crmName||'',service:first?.service||'',services:[...new Set(clients.map(row=>row.service))].join(', '),expires:first?.expires||'',profile:first?.profile||'',price:first&&!first.pricePending&&Number.isSafeInteger(first.price)?(first.price/100).toFixed(2):''};
              }
              await valid(run);
              await patch(run,{attention:'',pendingClaim:{claimId:grant.claimId,claimToken:grant.claimToken,phone:context.phone,incomingId:incoming.id,chatId:context.chatId},lastStatus:'Preparando respuesta a '+(context.name||context.phone)+'.',lastError:''});
              result=await sendContent(run.tabId,run.origin,'campaignSend',{runId:run.runId,mode:'bot',claimId:grant.claimId,claimToken:grant.claimToken,incomingId:incoming.id,chatId:context.chatId,allowBackground:run.allowBackground,phone:context.phone,text:personalizeRuntimeReply(grant.rule.text,values),files,automatic:true});
              if(!['sent_observed','failed','uncertain'].includes(result?.status))result={status:'uncertain',error:'No se pudo verificar el resultado de la respuesta.'};
            }catch(error){result={status:'uncertain',error:error.message};}
            await api(run.origin,'/bot/result',{claimId:grant.claimId,claimToken:grant.claimToken,status:result.status,evidence:String(result.evidence||'').slice(0,1000),error:String(result.error||'').slice(0,1000)});
            await patch(run,{pendingClaim:null,lastStatus:result.status==='sent_observed'?'Respuesta observada en WhatsApp.':'La respuesta requiere revisión.',lastError:result.error||''});
            if(result.status==='uncertain'){await halt(run,Error('Resultado incierto. Revisa la conversación antes de activar el chatbot otra vez.'));break;}
          }
          return {running:!revoked.has(run.runId)};
        }catch(error){await halt(run,error);return {running:false,error:error.message};}
      })();
      try{return await processing;}finally{processing=null;}
    },
    async permit(sender,input={}) {
      const run=await runValue(),mark=generation,authEpoch=epoch();
      try {
        if(!run?.active||sender.tab?.id!==run.tabId||input.runId!==run.runId||input.claimId!==run.pendingClaim?.claimId||input.claimToken!==run.pendingClaim?.claimToken||input.phone!==run.pendingClaim?.phone) return {allowed:false};
        await valid(run);
        const permit=await api(run.origin,'/bot/permit',{...leaseBody(run),claimId:input.claimId,claimToken:input.claimToken});
        await valid(run);
        return {allowed:permit.allowed===true&&mark===generation&&authEpoch===epoch()&&!revoked.has(run.runId)};
      }catch{return {allowed:false};}
    },
  });
}
