import test from "node:test";
import assert from "node:assert/strict";
import { emptyOutreach, validateOutreach, recipientsFromRows, recipientsFromClients, createCampaign, transitionCampaign, recordRecipientResult, personalizeMessage, exportContactsCSV } from "../outreach.mjs";
import { emptyState, cleanState } from "../cloud/state.mjs";
import { applyWorkspaceCommand } from "../companions/workspace.mjs";

test("Recipient import maps arbitrary Excel columns, normalizes Peru, skips duplicate and invalid rows", () => {
  const result = recipientsFromRows([["Nombre","WhatsApp","Oferta"],["Ana",987654321,"Video"],["Alias","+51 987 654 321","Duplicado"],["Error","no-phone",""]]);
  assert.equal(result.recipients.length,1); assert.equal(result.duplicates,1); assert.equal(result.invalid,1);
  assert.equal(result.recipients[0].phone,"51987654321");
  assert.equal(personalizeMessage("Hola {nombre}, {oferta}",result.recipients[0]),"Hola Ana, Video");
  const unsafe=recipientsFromRows([["nombre","telefono","__proto__"],["X","987654321","bad"]]);assert.equal(unsafe.recipients.length,0);assert.equal(unsafe.invalid,1);
});
test("One client with several services is one campaign recipient and exclusions are retained", () => {
  const rows=recipientsFromClients([{name:"Ana",phone:"987654321",service:"MAX"},{name:"Ana",phone:"+51987654321",service:"PRIME"}]);
  assert.equal(rows.length,1);assert.equal(rows[0].fields.servicios,"MAX · PRIME");
  assert.equal(recipientsFromClients([{name:"Ana",phone:"987654321"}],{excludedPhones:["51987654321"]}).length,0);
});
test("Campaign attempts persist before send and uncertain results never automatically repeat", () => {
  let c=createCampaign({name:"Fotos",body:"Hola {nombre}",recipients:[{name:"Ana",phone:"987654321"}]});
  c=transitionCampaign(c,"start"); c=recordRecipientResult(c,c.recipients[0].id,{status:"sending"});
  assert.equal(c.recipients[0].attempts,1);
  c=transitionCampaign(c,"recover");assert.equal(c.status,"paused");assert.equal(c.recipients[0].status,"uncertain");
  assert.throws(()=>transitionCampaign(c,"start"),/pendientes/);
  assert.throws(()=>recordRecipientResult(c,c.recipients[0].id,{status:"sent_observed"}),/resultado/);
  c=recordRecipientResult(c,c.recipients[0].id,{status:"sent_manual",reviewed:true});
  assert.equal(c.recipients[0].status,"sent_manual");
});
test("Outreach save survives server sanitization without modifying customers, inventory or money", () => {
  const base=emptyState();const o=emptyOutreach();o.campaigns=[createCampaign({name:"Campaña",body:"Hola",recipients:[{name:"Ana",phone:"987654321"}]})];
  const updated=applyWorkspaceCommand(base,"saveOutreach",{outreach:o});
  assert.deepEqual(updated.clients,base.clients);assert.deepEqual(updated.accounts,base.accounts);assert.deepEqual(updated.ledger,base.ledger);
  const clean=cleanState(updated);assert.deepEqual(clean.growth.outreach,o);
  assert.equal(base.growth,undefined);
});
test("CSV escapes formulas, media is metadata only and file limits reject oversized campaigns", () => {
  assert.match(exportContactsCSV([{name:"=SUM(A1)",phone:"+51987654321",labels:[]}]),/'=SUM/);
  const o=emptyOutreach();o.campaigns=[createCampaign({name:"Foto",body:"",media:[{id:"a".repeat(32),name:"foto.png",type:"image/png",size:100,sha256:"b".repeat(64),data:"PRIVATE-BYTES"}]})];
  assert.equal(validateOutreach(o).campaigns[0].media[0].data,undefined);
  assert.throws(()=>createCampaign({name:"Muy grande",body:"",media:[{id:"a",name:"a.mp4",type:"video/mp4",size:20971520},{id:"b",name:"b.png",type:"image/png",size:1}]}),/20 MB/);
});
