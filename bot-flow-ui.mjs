import {cleanBotFlow,advanceFlow} from './bot-flows.mjs';

const copy=value=>structuredClone(value);
const uid=()=>crypto.randomUUID();
const el=(tag,text='',cls='')=>{const item=document.createElement(tag);if(text!=='')item.textContent=text;if(cls)item.className=cls;return item;};
const types={menu:'Menú numerado',question:'Pregunta',message:'Mensaje y continuar',end:'Respuesta final',handoff:'Derivar a una persona'};
const emptyNode=(type='end')=>({id:'paso-'+uid().slice(0,8),type,text:'',media:[],nextNodeId:'',variable:'',validation:'text',options:[],invalidText:''});

export function exampleSalesFlow(){
  const menu={...emptyNode('menu'),id:'menu',text:'Hola {nombre}. ¿En qué podemos ayudarte?\nResponde con el número de una opción.',options:[]};
  const names=['Precios','Disponibilidad','Renovar un servicio','Medios de pago','Cómo ingresar','Condiciones del servicio','Hablar con una persona','Soporte'];
  const nodes=[menu];
  for(let i=1;i<=6;i++){
    const answer={...emptyNode('end'),id:'respuesta-'+i,text:'Escribe aquí la respuesta que quieres dar sobre '+names[i-1].toLocaleLowerCase('es')+'.\n\nEscribe menú para volver a las opciones.'};
    nodes.push(answer);menu.options.push({key:String(i),label:names[i-1],nextNodeId:answer.id});
  }
  const human={...emptyNode('handoff'),id:'asesor',text:'Voy a dejar esta conversación para atención personal. Escribe aquí tus indicaciones para contactar a un asesor.'};
  const service={...emptyNode('question'),id:'soporte-servicio',text:'¿Sobre qué servicio necesitas ayuda?',variable:'servicio',nextNodeId:'soporte-detalle'};
  const issue={...emptyNode('question'),id:'soporte-detalle',text:'Gracias. Describe qué ocurre con {servicio}.',variable:'problema',nextNodeId:'soporte-resumen'};
  const summary={...emptyNode('end'),id:'soporte-resumen',text:'Tu consulta es sobre {servicio}:\n{problema}\n\nEdita este paso con tu respuesta final o las indicaciones que debe recibir tu cliente.'};
  menu.options.push({key:'7',label:names[6],nextNodeId:human.id},{key:'8',label:names[7],nextNodeId:service.id});
  nodes.push(human,service,issue,summary);
  return{id:uid(),name:'Menú de atención 1–8',enabled:false,entryNodeId:'menu',triggerKeywords:['menú','hola','quiero comprar'],nodes};
}

function newFlow(){
  const end={...emptyNode('end'),text:'Escribe aquí la respuesta final.'};
  const menu={...emptyNode('menu'),text:'¿Qué necesitas? Responde con el número de una opción.',options:[{key:'1',label:'Mi primera opción',nextNodeId:end.id}]};
  return{id:uid(),name:'Mi flujo',enabled:false,entryNodeId:menu.id,triggerKeywords:[],nodes:[menu,end]};
}

// This editor changes configuration only. The local simulator never calls the
// WhatsApp bridge, reserves a line, or starts a chatbot.
export function initializeBotFlowEditor({root,getConfig,save,transport={},notify}){
  if(!root||typeof getConfig!=='function'||typeof save!=='function')throw Error('Falta la conexión de flujos.');
  root.classList.add('bot-flow-workspace');
  const css=el('link');css.rel='stylesheet';css.href=new URL('./bot-flow-ui.css',import.meta.url).href;document.head.append(css);
  let draft=null,editingId='',selectedNodeId='',defaultFlow=false,busy=0,destroyed=false,preview=null,previewState=null,previewRows=[];
  const status=el('p','','engagement-notice');status.hidden=true;status.id='bot-flow-status';status.setAttribute('role','status');
  const content=el('div');root.append(status,content);
  const config=()=>getConfig();
  const flows=()=>config()?.bot.flows||[];
  function say(text,error=false){status.textContent=text;status.hidden=!text;status.classList.toggle('is-error',error);notify?.(text,error);}
  const report=error=>say(error?.message||'No se pudo completar la configuración del flujo.',true);
  function button(text,action,cls='engagement-secondary',id){
    const b=el('button',text,cls);b.type='button';if(id)b.id=id;
    b.addEventListener('click',async()=>{if(b.dataset.working)return;b.dataset.working='1';b.disabled=true;busy++;try{await action();}catch(error){report(error);}finally{busy--;delete b.dataset.working;if(b.isConnected)b.disabled=false;}});
    return b;
  }
  function field(parent,label,name,{tag='input',type='text',value='',...attrs}={}){
    const wrap=el('label');wrap.append(el('span',label));const item=el(tag);item.name=name;if(tag==='input')item.type=type;Object.assign(item,attrs);item.value=value;wrap.append(item);parent.append(wrap);return item;
  }
  function check(parent,label,name,value){const input=field(parent,label,name,{type:'checkbox',value:'on'});input.checked=value;input.parentElement.classList.add('engagement-check');return input;}
  function option(select,value,label){const node=el('option',label);node.value=value;select.append(node);}
  function card(title){const c=el('section','','engagement-card');if(title)c.append(el('h3',title));return c;}
  function actions(...items){const row=el('div','','engagement-actions');row.append(...items);return row;}
  function label(node,index){return (index+1)+'. '+types[node.type]+' · '+(node.text.split('\n')[0].slice(0,45)||'Sin mensaje');}
  function stepSelect(parent,title,name,value,{allowEmpty=false,omitId=''}={}){
    const select=field(parent,title,name,{tag:'select'});if(allowEmpty)option(select,'','Selecciona un paso');
    draft.nodes.forEach((node,index)=>{if(node.id!==omitId)option(select,node.id,label(node,index));});select.value=value;return select;
  }
  function open(flow,example=false){draft=copy(flow);editingId=flows().some(item=>item.id===flow.id)?flow.id:'';selectedNodeId=draft.entryNodeId;defaultFlow=config()?.bot.defaultFlowId===flow.id;preview=null;previewRows=[];previewState=null;render();if(example)say('Ejemplo creado como borrador. Revisa sus respuestas antes de guardar y habilitarlo.');}
  function render(){if(destroyed)return;content.replaceChildren();if(draft)renderDraft();else renderList();}
  function renderList(){
    content.append(el('h3','Flujos de conversación'),el('p','Crea menús numerados y preguntas que recuerdan las respuestas de cada persona.','engagement-muted'));
    content.append(actions(button('Crear flujo',()=>open(newFlow()),'engagement-primary','bot-flow-new'),button('Usar ejemplo menú 1–8',()=>open(exampleSalesFlow(),true),'engagement-secondary','bot-flow-example')));
    content.append(el('p','En WhatsApp Web se envía una lista de texto. El cliente responde 1, 2…8 para elegir; no son botones interactivos de la API de Meta.','engagement-muted'));
    if(!flows().length)content.append(el('p','Todavía no tienes flujos. Puedes empezar con el ejemplo y editar cada paso.','engagement-empty'));
    for(const flow of flows()){
      const row=card(flow.name),badge=el('span',flow.enabled?'Habilitado':'Desactivado','engagement-pill');row.append(badge,el('p',flow.nodes.length+' pasos'+(config()?.bot.defaultFlowId===flow.id?' · Se usa al comenzar una conversación':''),'engagement-muted'));
      row.append(actions(button('Editar',()=>open(flow)),button('Probar',()=>{open(flow);startPreview();}),button('Duplicar',()=>{const draftCopy=copy(flow);draftCopy.id=uid();draftCopy.name+=' · copia';draftCopy.enabled=false;open(draftCopy);}),button('Eliminar',async()=>{
        if((config()?.bot.rules||[]).some(rule=>rule.flowId===flow.id))throw Error('Este flujo está usado por una regla. Cambia esa regla antes de eliminarlo.');
        if(!confirm('¿Eliminar este flujo? Las conversaciones ya enviadas conservarán su historial.'))return;
        await save(next=>{next.bot.flows=(next.bot.flows||[]).filter(item=>item.id!==flow.id);if(next.bot.defaultFlowId===flow.id)next.bot.defaultFlowId='';});say('Flujo eliminado.');render();
      },'engagement-danger')));content.append(row);
    }
  }
  async function saveDraft(){
    const value=cleanBotFlow(draft);
    if(value.enabled&&!defaultFlow&&!value.triggerKeywords.length&&!(config()?.bot.rules||[]).some(rule=>rule.flowId===value.id))throw Error('Añade palabras de inicio o marca que este flujo se muestre al comenzar una conversación.');
    await save(next=>{
      next.bot.flows||=[];
      if(editingId)next.bot.flows=next.bot.flows.map(item=>item.id===editingId?value:item);
      else{if(next.bot.flows.length>=20)throw Error('Puedes guardar hasta veinte flujos.');next.bot.flows.push(value);}
      if(defaultFlow)next.bot.defaultFlowId=value.id;else if(next.bot.defaultFlowId===value.id)next.bot.defaultFlowId='';
    });
    draft=null;editingId='';say('Flujo guardado. No se enviaron mensajes. Activa el chatbot de tu línea cuando quieras usarlo.');render();
  }
  function renderDraft(){
    content.append(actions(button('← Flujos',()=>{if(!confirm('¿Salir del borrador sin guardar?'))return;draft=null;preview=null;render();},'engagement-text'),button('Guardar flujo',saveDraft,'engagement-primary','bot-flow-save')));
    const general=card(editingId?'Editar flujo':'Nuevo flujo');
    const name=field(general,'Nombre del flujo','flowName',{value:draft.name,maxLength:160,required:true});name.id='bot-flow-name';name.addEventListener('input',()=>draft.name=name.value);
    const enabled=check(general,'Habilitar este flujo','flowEnabled',draft.enabled);enabled.id='bot-flow-enabled';enabled.addEventListener('change',()=>draft.enabled=enabled.checked);
    const defaults=check(general,'Mostrar este flujo al comenzar una conversación','defaultFlow',defaultFlow);defaults.id='bot-flow-default';defaults.addEventListener('change',()=>defaultFlow=defaults.checked);
    const triggers=field(general,'Palabras o frases que inician este flujo','triggers',{tag:'textarea',rows:2,value:draft.triggerKeywords.join('\n'),placeholder:'hola\nquiero comprar\nmenú'});triggers.id='bot-flow-triggers';triggers.addEventListener('input',()=>draft.triggerKeywords=[...new Set(triggers.value.split(/[\n,]+/).map(text=>text.trim()).filter(Boolean))]);
    const entry=stepSelect(general,'Primer paso','entryNodeId',draft.entryNodeId);entry.addEventListener('change',()=>draft.entryNodeId=entry.value);
    general.append(el('p','Guardar no activa una línea ni envía mensajes. Puedes usar menú o 0 para volver al inicio y salir para terminar.','engagement-muted'));content.append(general);
    const steps=card('Pasos del flujo');
    const select=stepSelect(steps,'Paso que quieres editar','selectedNode',selectedNodeId);select.id='bot-flow-step';select.addEventListener('change',()=>{selectedNodeId=select.value;render();});
    steps.append(actions(button('Añadir paso',()=>{if(draft.nodes.length>=50)throw Error('El flujo admite hasta cincuenta pasos.');const node=emptyNode('end');node.text='Escribe tu respuesta.';draft.nodes.push(node);selectedNodeId=node.id;render();},'engagement-secondary','bot-flow-add-step')));
    const current=draft.nodes.find(item=>item.id===selectedNodeId)||draft.nodes[0];selectedNodeId=current.id;
    const type=field(steps,'Tipo de paso','nodeType',{tag:'select'});type.id='bot-flow-node-type';for(const[key,text]of Object.entries(types))option(type,key,text);type.value=current.type;
    type.addEventListener('change',()=>{current.type=type.value;if(current.type==='menu'&&!current.options.length)current.options=[{key:'1',label:'Opción 1',nextNodeId:draft.nodes.find(item=>item.id!==current.id)?.id||''}];if(['question','message'].includes(current.type)&&!current.nextNodeId)current.nextNodeId=draft.nodes.find(item=>item.id!==current.id)?.id||'';render();});
    const body=field(steps,'Mensaje de este paso','nodeText',{tag:'textarea',rows:5,value:current.text,maxLength:8000,placeholder:'Escribe lo que debe recibir tu cliente.'});body.id='bot-flow-node-text';body.addEventListener('input',()=>current.text=body.value);
    if(current.type==='menu')renderOptions(steps,current);
    if(current.type==='question'){
      const variable=field(steps,'Guardar la respuesta en','variable',{value:current.variable||'',maxLength:40,placeholder:'servicio, consulta, correo…'});variable.id='bot-flow-variable';variable.addEventListener('input',()=>current.variable=variable.value.trim());
      const validation=field(steps,'Respuesta que se acepta','validation',{tag:'select'});for(const[key,text]of [['text','Texto'],['number','Número'],['email','Correo electrónico'],['phone','Teléfono']])option(validation,key,text);validation.value=current.validation||'text';validation.addEventListener('change',()=>current.validation=validation.value);
      steps.append(el('p','Puedes usar esa respuesta después como {consulta} o con el nombre que elijas.','engagement-muted'));
    }
    if(['question','message'].includes(current.type)){const next=stepSelect(steps,'Continuar con el paso','nextNodeId',current.nextNodeId,{allowEmpty:true,omitId:current.type==='message'?current.id:''});next.id='bot-flow-next-step';next.addEventListener('change',()=>current.nextNodeId=next.value);}
    if(['question','menu'].includes(current.type)){const invalid=field(steps,'Si la respuesta no es válida (opcional)','invalidText',{tag:'textarea',rows:2,value:current.invalidText||'',maxLength:1000,placeholder:'Elige un número de la lista para continuar.'});invalid.addEventListener('input',()=>current.invalidText=invalid.value);}
    if(current.type==='handoff')steps.append(el('p','Este paso termina el flujo automático para que continúe una persona. Escribe las indicaciones que debe recibir el cliente.','engagement-muted'));
    renderMedia(steps,current);
    if(draft.nodes.length>1)steps.append(button('Eliminar este paso',()=>{
      if(draft.entryNodeId===current.id)throw Error('Elige otro primer paso antes de eliminar este.');
      if(draft.nodes.some(item=>item.id!==current.id&&(item.nextNodeId===current.id||item.options?.some(option=>option.nextNodeId===current.id))))throw Error('Otro paso dirige aquí. Cambia su destino antes de eliminarlo.');
      draft.nodes=draft.nodes.filter(item=>item.id!==current.id);selectedNodeId=draft.nodes[0].id;render();
    },'engagement-danger'));content.append(steps);
    renderPreview();
    content.append(actions(button('Guardar flujo',saveDraft,'engagement-primary','bot-flow-save-bottom')));
  }
  function renderOptions(parent,current){
    const box=el('div','','bot-flow-options');box.id='bot-flow-options';
    current.options.forEach((choice,index)=>{
      const row=el('div','','bot-flow-option');row.dataset.index=index;
      const fields=el('div','','bot-flow-option-fields');
      const key=field(fields,'Número o respuesta','optionKey',{value:choice.key,maxLength:30});key.addEventListener('input',()=>choice.key=key.value.trim());
      const label=field(fields,'Opción que verá el cliente','optionLabel',{value:choice.label,maxLength:160});label.addEventListener('input',()=>choice.label=label.value);
      row.append(fields);const destination=stepSelect(row,'Al elegir, ir a','optionNext',choice.nextNodeId,{allowEmpty:true});destination.addEventListener('change',()=>choice.nextNodeId=destination.value);
      row.append(button('Quitar opción',()=>{current.options.splice(index,1);render();},'engagement-text'));box.append(row);
    });
    const add=button('Añadir opción',()=>{if(current.options.length>=10)throw Error('El menú admite hasta diez opciones.');let key=1;while(current.options.some(item=>item.key===String(key)))key++;current.options.push({key:String(key),label:'Opción '+key,nextNodeId:draft.nodes.find(item=>item.id!==current.id)?.id||''});render();},'engagement-secondary','bot-flow-add-option');add.disabled=current.options.length>=10;
    parent.append(box,add);
  }
  function renderMedia(parent,current){
    const section=el('details');section.append(el('summary','Foto o video de este paso (opcional)'));
    for(const media of current.media||[]){const row=el('div','','engagement-media-row');row.append(el('span',media.name),button('Quitar',()=>{current.media=current.media.filter(item=>item.id!==media.id);render();},'engagement-text'));section.append(row);}
    function add(values){const result=[...(current.media||[])];for(const file of values)if(!result.some(item=>item.id===file.id))result.push(file);if(result.length>10||result.reduce((sum,file)=>sum+file.size,0)>20*1024*1024)throw Error('Cada respuesta admite diez archivos y 20 MiB en total.');current.media=result;}
    if(transport.uploadMedia){
      const file=field(section,'Subir foto o video','nodeMedia',{type:'file',multiple:true,accept:'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm'});
      file.addEventListener('change',async()=>{busy++;file.disabled=true;try{const selected=[...file.files];if((current.media?.length||0)+selected.length>10||(current.media||[]).reduce((s,x)=>s+x.size,0)+selected.reduce((s,x)=>s+x.size,0)>20*1024*1024)throw Error('Los archivos superan diez adjuntos o 20 MiB.');for(const item of selected){say('Guardando '+item.name+'…');add([await transport.uploadMedia(item)]);}say('Archivos guardados en tu biblioteca privada.');render();}catch(error){report(error);}finally{busy--;file.disabled=false;}});
    }
    if(transport.listMedia){const list=el('div');section.append(button('Elegir de la biblioteca',async()=>{const result=await transport.listMedia();list.replaceChildren();for(const media of result.media||[]){const row=el('div','','engagement-media-row');row.append(el('span',media.name),button('Añadir',()=>{add([media]);render();},'engagement-text'));list.append(row);}if(!(result.media||[]).length)list.append(el('p','Todavía no hay archivos guardados.','engagement-muted'));}),list);}
    parent.append(section);
  }
  function startPreview(){preview=cleanBotFlow(draft);previewState=null;previewRows=[];applyPreview('');render();root.querySelector('#bot-flow-preview')?.scrollIntoView({block:'nearest'});}
  function applyPreview(text){
    if(text)previewRows.push({who:'Tú',text});const result=advanceFlow(preview,previewState,text);previewState=result.nextState;
    if(result.reply?.text)previewRows.push({who:'Chatbot',text:result.reply.text});
    if(result.reply?.media?.length)previewRows.push({who:'Chatbot',text:result.reply.media.map(item=>'📎 '+item.name).join('\n')});
    previewRows=previewRows.slice(-20);
  }
  function renderPreview(){
    const section=card('Probar conversación');section.id='bot-flow-preview';section.append(el('p','La prueba es local. No envía mensajes a WhatsApp ni activa tu chatbot.','engagement-muted'),button(preview?'Reiniciar prueba':'Iniciar prueba',startPreview,'engagement-secondary','bot-flow-preview-start'));
    if(preview){
      const transcript=el('div','','bot-flow-transcript');for(const row of previewRows){const message=el('div','','bot-flow-bubble'+(row.who==='Tú'?' is-user':''));message.append(el('strong',row.who),el('p',row.text));transcript.append(message);}section.append(transcript);
      if(!previewState?.ended&&!previewState?.handoff){const input=field(section,'Tu respuesta','previewAnswer',{placeholder:'Por ejemplo: 8'});input.id='bot-flow-preview-answer';const send=()=>{if(!input.value.trim())return;applyPreview(input.value);render();};section.append(button('Responder en la prueba',send,'engagement-primary','bot-flow-preview-send'));input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();try{send();}catch(error){report(error);}}});}
      else section.append(el('p',previewState?.handoff?'El flujo pasó a atención personal.':'El flujo terminó. Puedes reiniciar la prueba.','engagement-muted'));
    }
    content.append(section);
  }
  function destroy(){destroyed=true;css.remove();}
  render();
  return{refresh:()=>{if(!draft&&!busy)render();},isBusy:()=>Boolean(draft)||busy>0,hasDraft:()=>Boolean(draft),discard:()=>{draft=null;preview=null;render();},destroy};
}
