import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFlow, cleanBotFlow, cleanBotFlows, cleanFlowState, selectBotFlow } from '../bot-flows.mjs';
import { cleanEngagementConfig, emptyEngagement } from '../engagement.mjs';

function menuFlow() {
  return {
    id: 'sales', name: 'Ventas por etapas', enabled: true, entryNodeId: 'intro', triggerKeywords: ['comprar'],
    nodes: [
      {id:'intro',type:'message',text:'Hola {nombre}. Elige una opción.',nextNodeId:'menu'},
      {id:'menu',type:'menu',text:'Servicios disponibles',options:Array.from({length:8},(_,index)=>({key:String(index+1),label:'Servicio '+(index+1),nextNodeId:index===7?'email':'other'}))},
      {id:'email',type:'question',text:'Escribe tu correo.',variable:'correo',validation:'email',nextNodeId:'name',invalidText:'Necesito un correo válido.'},
      {id:'name',type:'question',text:'¿Cómo te llamas?',variable:'cliente_nombre',validation:'text',nextNodeId:'result'},
      {id:'result',type:'end',text:'Gracias {cliente_nombre}. Te contactaremos en {correo}.'},
      {id:'other',type:'handoff',text:'Un asesor continuará con tu solicitud.'},
    ],
  };
}

test('a numbered eight-option menu branches into questions and renders the captured answer',()=>{
  const flow=menuFlow(),original=structuredClone(flow);
  const start=advanceFlow(flow,null,'Quiero comprar');
  assert.match(start.reply.text,/Hola \{nombre\}/);assert.match(start.reply.text,/8\. Servicio 8/);assert.equal(start.nextState.nodeId,'menu');assert.equal(start.waiting,true);
  const selected=advanceFlow(flow,start.nextState,'8');assert.equal(selected.nextState.nodeId,'email');assert.match(selected.reply.text,/correo/);
  const invalid=advanceFlow(flow,selected.nextState,'esto no es correo');assert.equal(invalid.accepted,false);assert.equal(invalid.nextState.nodeId,'email');assert.deepEqual(invalid.nextState.variables,{});assert.match(invalid.reply.text,/Necesito un correo válido/);
  const email=advanceFlow(flow,invalid.nextState,'persona@example.test');assert.equal(email.nextState.nodeId,'name');assert.equal(email.nextState.variables.correo,'persona@example.test');
  const finished=advanceFlow(flow,email.nextState,'Ana');assert.equal(finished.ended,true);assert.equal(finished.handoff,false);assert.equal(finished.reply.text,'Gracias Ana. Te contactaremos en persona@example.test.');assert.deepEqual(flow,original);
});

test('conversation variables remain isolated, invalid menu replies stay put, and restart clears answers',()=>{
  const flow=menuFlow(),start=advanceFlow(flow,null,'hola');
  const invalid=advanceFlow(flow,start.nextState,'99');assert.equal(invalid.reason,'invalid');assert.equal(invalid.nextState.nodeId,'menu');assert.match(invalid.reply.text,/Elige una opción/);
  const first=advanceFlow(flow,advanceFlow(flow,start.nextState,'Servicio 8').nextState,'ana@example.test');
  const second=advanceFlow(flow,start.nextState,'8. Servicio 8');assert.deepEqual(second.nextState.variables,{});
  const restarted=advanceFlow(flow,first.nextState,'MENÚ');assert.equal(restarted.reason,'restart');assert.equal(restarted.nextState.nodeId,'menu');assert.deepEqual(restarted.nextState.variables,{});
  const cancelled=advanceFlow(flow,first.nextState,'salir');assert.equal(cancelled.reason,'cancelled');assert.equal(cancelled.ended,true);assert.equal(cancelled.waiting,false);
});

test('human handoff stays quiet until the conversation is explicitly restarted',()=>{
  const flow=menuFlow(),start=advanceFlow(flow,null,'hola');
  const handedOff=advanceFlow(flow,start.nextState,'1');assert.equal(handedOff.handoff,true);
  const quiet=advanceFlow(flow,handedOff.nextState,'Necesito más ayuda');assert.equal(quiet.reply,null);assert.equal(quiet.reason,'handoff');assert.deepEqual(quiet.nextState,handedOff.nextState);
  const restarted=advanceFlow(flow,quiet.nextState,'0');assert.equal(restarted.nextState.nodeId,'menu');assert.equal(restarted.handoff,false);
});

test('graph validation rejects missing destinations and automatic cycles but permits user-selected menu loops',()=>{
  const missing=menuFlow();missing.nodes[0].nextNodeId='does-not-exist';assert.throws(()=>cleanBotFlow(missing),/destino/);
  const cycle=menuFlow();cycle.nodes[0].nextNodeId='intro';assert.throws(()=>cleanBotFlow(cycle),/ciclo/);
  const loop=menuFlow();loop.nodes[1].options[0].nextNodeId='intro';assert.doesNotThrow(()=>cleanBotFlow(loop));
  const duplicate=menuFlow();duplicate.nodes[1].options[1].key='1';assert.throws(()=>cleanBotFlow(duplicate),/diferentes/);
  const reserved=menuFlow();reserved.nodes[1].options[0].key='0';assert.throws(()=>cleanBotFlow(reserved),/reservan/);
  assert.throws(()=>cleanBotFlows([menuFlow(),menuFlow()]),/repetidos/);
});

test('automatic replies are bounded and identical attachments are sent once per compiled response',()=>{
  const media={id:'a'.repeat(32),name:'Foto.png',type:'image/png',size:12,sha256:'b'.repeat(64)};
  const flow=menuFlow();flow.nodes[0].media=[media];flow.nodes[1].media=[media];
  assert.equal(advanceFlow(flow,null,'hola').reply.media.length,1);
  const large=menuFlow();large.nodes[0].text='x'.repeat(7900);assert.throws(()=>cleanBotFlow(large),/8000/);
  const retry=menuFlow();retry.nodes[2].text='x'.repeat(7990);assert.throws(()=>cleanBotFlow(retry),/8000/);
  const tooMuch=menuFlow();tooMuch.nodes[0].media=[{...media,size:20971520}];tooMuch.nodes[1].media=[{...media,id:'c'.repeat(32),size:1}];assert.throws(()=>cleanBotFlow(tooMuch),/20 MiB/);
});

test('typed questions validate phone and number without changing an earlier state',()=>{
  const flow={id:'typed',name:'Datos',enabled:true,entryNodeId:'phone',nodes:[{id:'phone',type:'question',text:'Teléfono',variable:'telefono_cliente',validation:'phone',nextNodeId:'amount'},{id:'amount',type:'question',text:'Importe',variable:'importe',validation:'number',nextNodeId:'done'},{id:'done',type:'end',text:'{telefono_cliente} · {importe}'}]};
  const first=advanceFlow(flow,null,'hola'),phone=advanceFlow(flow,first.nextState,'987 654 321');assert.equal(phone.nextState.variables.telefono_cliente,'51987654321');assert.deepEqual(first.nextState.variables,{});
  const bad=advanceFlow(flow,phone.nextState,'doce');assert.equal(bad.accepted,false);
  assert.equal(advanceFlow(flow,bad.nextState,'12,50').reply.text,'51987654321 · 12.50');
  const invalidState={...phone.nextState,variables:JSON.parse('{"constructor":"x"}')};assert.throws(()=>cleanFlowState(flow,invalidState),/variable/);
});

test('engagement retains optional flow configuration and rejects orphan references while legacy shape is unchanged',()=>{
  const old=emptyEngagement();assert.deepEqual(cleanEngagementConfig(old),old);
  const config=emptyEngagement();config.bot.flows=[menuFlow()];config.bot.defaultFlowId='sales';config.bot.conversationTtlMinutes=30;
  config.bot.rules=[{id:'start',name:'Iniciar',enabled:true,match:'contains',keywords:['hola'],text:'',media:[],flowId:'sales'}];
  const clean=cleanEngagementConfig(config);assert.equal(clean.bot.flows[0].entryNodeId,'intro');assert.equal(clean.bot.rules[0].flowId,'sales');assert.equal(clean.bot.conversationTtlMinutes,30);
  assert.throws(()=>cleanEngagementConfig({...config,bot:{...config.bot,defaultFlowId:'missing'}}),/existente/);
  assert.throws(()=>cleanEngagementConfig({...config,bot:{...config.bot,conversationTtlMinutes:1441}}));
});

test('flow selection respects explicit active flow, triggers, linked rules and configured default',()=>{
  const flow=cleanBotFlow(menuFlow()),other={...flow,id:'other',name:'Otro',triggerKeywords:['soporte']};
  const bot={enabled:true,flows:[flow,other],defaultFlowId:'sales',rules:[{id:'help',enabled:true,flowId:'other',match:'exact',keywords:['ayuda']}]};
  assert.equal(selectBotFlow(bot,'no importa',{flowId:'other'}).id,'other');assert.equal(selectBotFlow(bot,'quiero comprar').id,'sales');assert.equal(selectBotFlow(bot,'necesito soporte').id,'other');assert.equal(selectBotFlow(bot,'AYUDA').id,'other');assert.equal(selectBotFlow(bot,'otra consulta').id,'sales');
  assert.equal(selectBotFlow({...bot,enabled:false},'hola'),null);assert.equal(selectBotFlow(bot,'hola',{flowId:'missing'}),null);
});

test('legacy rule hints cannot suppress a trigger or default flow, while linked rules retain priority',()=>{
  const sales=cleanBotFlow(menuFlow()),support={...sales,id:'support',name:'Soporte',triggerKeywords:['soporte']};
  const bot={enabled:true,flows:[sales,support],defaultFlowId:'sales',rules:[
    {id:'old_contains',enabled:true,match:'contains',keywords:['hola'],text:'Hola'},
    {id:'old_fallback',enabled:true,match:'fallback',text:'Te atenderemos'},
    {id:'linked',enabled:true,match:'contains',keywords:['hola'],flowId:'support'},
  ]};
  for(const ruleId of ['old_contains','old_fallback','removed']){
    assert.equal(selectBotFlow(bot,'Necesito soporte',{ruleId}).id,'support');
    assert.equal(selectBotFlow(bot,'Otra consulta',{ruleId}).id,'sales');
  }
  assert.equal(selectBotFlow(bot,'Quiero comprar',{ruleId:'linked'}).id,'support');
  bot.flows[1].enabled=false;assert.equal(selectBotFlow(bot,'Quiero comprar',{ruleId:'linked'}).id,'sales');
});
