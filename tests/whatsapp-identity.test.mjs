import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { matchContact, normalizeCompanionPhone, importVisibleMessages } from "../companions/conversations.mjs";

const adapterSource = await readFile(new URL("../extension/whatsapp.js", import.meta.url), "utf8");
const clients = [
  { id: "ana-prime", name: "Ana", phone: "51912345678", service: "Prime" },
  { id: "ana-netflix", name: "Ana", phone: "51912345678", service: "Netflix" },
  { id: "bea", name: "Bea", phone: "51987654321", service: "Max" },
];

function fixture({ name = "Ana", peer = "ana@lid", number = "", group = false, observe = false } = {}) {
  const state = { name, peer, number, group, quotedPeer: "", extraPeer: "", draft: "", sent: 0, now: 1000, drawers: [], drawerReads: 0, selected: null };
  const title = { getAttribute: () => state.name, get textContent() { return state.name; } };
  const phoneNode = { getAttribute: () => state.number, get textContent() { return state.number; } };
  const header = {
    get textContent() { return state.name + (state.group ? " participantes" : ""); },
    querySelector(selector) { return selector.includes("default-group") ? state.group ? {} : null : title; },
    querySelectorAll() { return state.number ? [title, phoneNode] : [title]; },
  };
  const message = (peer, quoted = false) => {
    const part = { innerText: "Texto visible de prueba", closest: () => quoted ? {} : null };
    return {
      getAttribute: () => `false_${peer}_one`, closest: () => quoted ? {} : null,
      matches: () => true, classList: { contains: value => value === "message-in" },
      querySelectorAll: () => [part], getClientRects: () => [{}],
      getBoundingClientRect: () => ({ top: 10, bottom: 50, left: 0, right: 100 }),
    };
  };
  const editor = { focus() {}, get innerText() { return state.draft; } };
  const root = {
    querySelector(selector) { return selector === "header" ? header : selector.includes("contenteditable") ? editor : null; },
    querySelectorAll() { return [state.peer && message(state.peer), state.extraPeer && message(state.extraPeer), state.quotedPeer && message(state.quotedPeer, true)].filter(Boolean); },
  };
  const visibleNode = (hidden = false) => ({
    getClientRects: () => hidden ? [] : [{}],
    getBoundingClientRect: () => ({ top: 0, bottom: 200, left: 0, right: 200 }),
    closest: () => null,
  });
  const drawerNodes = new WeakMap(), events = new Map();
  const drawerNode = data => {
    if (drawerNodes.has(data)) return drawerNodes.get(data);
    const identity = { ...visibleNode(data.identityHidden), getAttribute: name => name === "title" ? data.name : "", get textContent() { return data.name; } };
    const node = {
      ...visibleNode(), getClientRects: () => data.hidden ? [] : [{}], getAttribute: () => "",
      querySelector: selector => selector === '[data-testid="contact-info-name"]' ? identity : null,
      querySelectorAll: () => (data.phones || []).map((value, index) => ({
        ...visibleNode(data.phoneHidden), textContent: value,
        getAttribute: name => name === "href" && data.telLinks ? "tel:" + value : name === "aria-hidden" && data.phoneAriaHidden ? "true" : "",
      })),
    };
    drawerNodes.set(data, node);
    return node;
  };
  const document = {
    querySelector: selector => selector.includes("aria-selected") ? state.selected : root,
    querySelectorAll(selector) { assert.match(selector, /contact-info-drawer/); state.drawerReads++; return state.drawers.map(drawerNode); },
    addEventListener(name, handler) { events.set(name, handler); },
    execCommand(command, ui, text) { assert.equal(command, "insertText"); state.draft += text; return true; },
  };
  const timers = new Map(), broadcasts = [];
  let sequence = 0, mutation = () => {};
  const advance = milliseconds => {
    const until = state.now + milliseconds;
    let executions = 0;
    for (;;) {
      const pending = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending) break;
      if (++executions > 1000) throw Error("Timer loop");
      timers.delete(pending[0]); state.now = pending[1].at; pending[1].callback();
    }
    state.now = until;
  };
  const world = vm.createContext({ document, innerHeight: 800, innerWidth: 1200, Date: { now: () => state.now },
    ...(observe ? {
      chrome: { runtime: { id: "fixture", onMessage: { addListener() {} }, sendMessage: message => { broadcasts.push(JSON.parse(JSON.stringify(message))); return Promise.resolve(); } } },
      MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
      setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: state.now + delay }); return id; },
    } : {}),
  });
  vm.runInContext(adapterSource, world);
  return { state, adapter: world.__nexoWhatsAppAdapter, advance, broadcasts, mutate: () => mutation(),
    navigate: () => events.get("pointerdown")({ target: { closest: selector => selector.includes("#pane-side") ? {} : null } }),
    openInfo: () => events.get("pointerdown")({ target: { closest: selector => selector === "header" ? header : null } }),
  };
}

test("A stale manually entered number cannot select another customer's records in an unidentified chat", () => {
  const { adapter } = fixture({ name: "Bea", peer: "" });
  const current = adapter.context();
  assert.equal(current.chatId, "");
  assert.equal(current.phone, "");
  const staleInput = { ...current, phone: "51912345678" };
  assert.deepEqual(matchContact(clients, staleInput).matches, []);
  assert.equal(matchContact(clients, staleInput).reason, "unidentified-chat");
  assert.throws(() => adapter.bind({ phone: "51912345678", chatId: "" }), /cambió|segura/);
});

test("Visible phone matching is automatic and includes every service without guessing from display name", () => {
  const { adapter } = fixture({ name: "+51 912 345 678", peer: "" });
  const current = adapter.context();
  assert.equal(current.chatId, "phone:51912345678");
  assert.equal(current.phoneSource, "visible");
  assert.deepEqual(matchContact(clients, current).matches.map(item => item.id), ["ana-prime", "ana-netflix"]);
  assert.equal(matchContact(clients, { ...current, name: "Bea" }).matches[0].id, "ana-prime");
});

test("A confirmed hidden-number binding follows its exact peer, restores on return and expires after a changed name", () => {
  const { state, adapter } = fixture();
  adapter.bind({ phone: "+51 912 345 678", chatId: "wa:ana@lid" });
  assert.equal(adapter.context().phone, "51912345678");
  state.peer = "bea@lid"; state.name = "Bea";
  assert.equal(adapter.context().phone, "");
  assert.deepEqual(matchContact(clients, adapter.context()).matches, []);
  assert.throws(() => adapter.bind({ phone: "51912345678", chatId: "wa:ana@lid" }), /cambió/);
  adapter.bind({ phone: "51987654321", chatId: "wa:bea@lid" });
  assert.equal(matchContact(clients, adapter.context()).matches[0].id, "bea");
  state.peer = "ana@lid"; state.name = "Ana";
  assert.equal(adapter.context().phone, "51912345678");
  state.name = "Another contact during a transition";
  assert.equal(adapter.context().phone, "");
  state.name = "Ana";
  assert.equal(adapter.context().phone, "");
});

test("A contradictory visible phone invalidates a previous hidden binding and never changes the actual recipient", () => {
  const { state, adapter } = fixture();
  adapter.bind({ phone: "51912345678", chatId: "wa:ana@lid" });
  state.number = "+51 987 654 321";
  assert.equal(adapter.context().phone, "51987654321");
  assert.equal(adapter.context().phoneSource, "visible");
  assert.throws(() => adapter.prepare({ phone: "51912345678", text: "Private access" }), /no coincide/);
  assert.equal(state.draft, "");
  state.number = "";
  assert.equal(adapter.context().phone, "");
});

test("Quoted message peer IDs do not make a direct conversation ambiguous or enter captures", () => {
  const { state, adapter } = fixture({ number: "+51 912 345 678" });
  state.quotedPeer = "another-person@lid";
  assert.equal(adapter.context().ambiguous, false);
  assert.equal(adapter.context().chatId, "wa:ana@lid");
  const messages = adapter.capture();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].chatId, "wa:ana@lid");
  state.extraPeer = "another-chat@lid";
  assert.equal(adapter.context().ambiguous, true);
  assert.deepEqual(matchContact(clients, adapter.context()).matches, []);
  assert.throws(() => adapter.capture(), /ambigua/);
});

test("Phone canonicalization removes display controls and handles 00 consistently without guessing Peru", () => {
  const { adapter } = fixture();
  for (const value of ["+51 912 345 678", "0051912345678", "\u202C+51 912 345 678\u200F"])
    assert.equal(adapter.phone(value), normalizeCompanionPhone(value));
  for (const value of ["912345678", "+51 123456789", "51912345678@lid", "+0000000000"])
    assert.equal(adapter.phone(value), "");
});

test("Ambiguous and unconfirmed contexts cannot match clients or save visible text", async () => {
  const known = { name: "Ana", phone: "51912345678", chatId: "wa:ana@lid", phoneSource: "visible" };
  assert.deepEqual(matchContact(clients, { ...known, phoneSource: "draft" }).matches, []);
  assert.deepEqual(matchContact(clients, { ...known, ambiguous: true }).matches, []);
  await assert.rejects(() => importVisibleMessages(undefined, clients[0], { ...known, ambiguous: true }, []), /individual/);
  await assert.rejects(() => importVisibleMessages(undefined, clients[0], { ...known, phoneSource: "draft" }, []), /Confirma/);
});

test("A new hidden header cannot inherit a cached phone while the previous message peer remains", () => {
  const { state, adapter, advance } = fixture();
  adapter.bind({ phone: "51912345678", chatId: "wa:ana@lid" });
  state.name = "Bea";
  const during = adapter.context();
  assert.equal(during.chatId, "");
  assert.equal(during.phone, "");
  assert.equal(during.ambiguous, true);
  assert.deepEqual(matchContact(clients, during).matches, []);
  assert.throws(() => adapter.bind({ phone: "51987654321", chatId: "wa:ana@lid" }), /cambió|segura/);
  advance(251);
  // A legitimate same-peer contact rename can be linked again explicitly,
  // but its previous manual telephone never silently reappears after settling.
  assert.equal(adapter.context().phone, "");
  state.peer = "bea@lid";
  adapter.bind({ phone: "51987654321", chatId: "wa:bea@lid" });
  assert.equal(adapter.context().phone, "51987654321");
  state.peer = "ana@lid"; state.name = "Ana";
  assert.equal(adapter.context().phone, "");
});

test("A legitimate same-peer contact rename resumes after settling without restoring its stale manual phone", () => {
  const { state, adapter, advance } = fixture();
  adapter.bind({ phone: "51912345678", chatId: "wa:ana@lid" });
  state.name = "Ana renamed";
  assert.equal(adapter.context().ambiguous, true);
  advance(251);
  assert.equal(adapter.context().ambiguous, false);
  assert.equal(adapter.context().phone, "");
  const rebound = adapter.bind({ phone: "51912345678", chatId: "wa:ana@lid" });
  assert.equal(rebound.phone, "51912345678");
  assert.equal(rebound.phoneSource, "manual");
});

test("Formatting changes to the same phone title avoid quarantine, while a changed name settles safely", () => {
  const { state, adapter, advance } = fixture({ name: "+51 912 345 678", number: "+51 912 345 678" });
  adapter.context();
  state.name = "0051912345678";
  assert.equal(adapter.context().ambiguous, false);
  assert.equal(adapter.context().phone, "51912345678");
  state.name = "Ana contact name";
  assert.equal(adapter.context().phone, "");
  advance(251);
  assert.equal(adapter.context().phone, "51912345678");
  assert.equal(adapter.context().phoneSource, "visible");
});

test("Continuous DOM mutations cannot postpone the clearing broadcast, and quiet transitions settle by timer", () => {
  const { state, adapter, advance, broadcasts, mutate } = fixture({ observe: true });
  adapter.bind({ phone: "51912345678", chatId: "wa:ana@lid" });
  broadcasts.length = 0;
  state.name = "Bea";
  for (let index = 0; index < 4; index++) { mutate(); advance(10); }
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].context.phone, "");
  assert.equal(broadcasts[0].context.chatId, "");
  assert.equal(broadcasts[0].context.ambiguous, true);
  advance(251);
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[1].context.ambiguous, false);
  assert.equal(broadcasts[1].context.phone, "");
});

test("Revealing the matching native contact drawer identifies a named chat with no message IDs and all its services", () => {
  const { state, adapter } = fixture({ peer: "" });
  assert.equal(adapter.context().chatId, "");
  state.drawers = [{ name: "Ana", phones: ["+51 912 345 678"] }];
  const revealed = adapter.context();
  assert.equal(revealed.chatId, "phone:51912345678");
  assert.equal(revealed.phoneSource, "visible");
  assert.deepEqual(matchContact(clients, revealed).matches.map(client => client.id), ["ana-prime", "ana-netflix"]);
  state.drawers = [];
  assert.equal(adapter.context().phone, "");
  assert.deepEqual(matchContact(clients, adapter.context()).matches, []);
});

test("A stale drawer for another named contact never supplies a phone to the current chat", () => {
  const { state, adapter } = fixture({ name: "Bea", peer: "" });
  state.drawers = [{ name: "Ana", phones: ["+51 912 345 678"] }];
  assert.equal(adapter.context().phone, "");
  assert.deepEqual(matchContact(clients, adapter.context()).matches, []);
  state.drawers = [{ name: "Bea", phones: ["+51 987 654 321"] }];
  assert.equal(matchContact(clients, adapter.context()).matches[0].id, "bea");
});

test("Hidden drawers, hidden identity/phones, ambiguous phone values and groups do not establish contact identity", () => {
  const { state, adapter } = fixture({ peer: "" });
  for (const extras of [{ hidden: true }, { identityHidden: true }, { phoneHidden: true }, { phoneAriaHidden: true }]) {
    state.drawers = [{ name: "Ana", phones: ["+51 912 345 678"], ...extras }];
    assert.equal(adapter.context().phone, "");
  }
  state.drawers = [{ name: "Ana", phones: ["+51 912 345 678", "+51 987 654 321"] }];
  assert.equal(adapter.context().phone, "");
  assert.equal(adapter.context().ambiguous, true);
  state.drawers = [{ name: "Ana", phones: ["+51 912 345 678"] }];
  state.group = true;
  state.drawerReads = 0;
  assert.equal(adapter.context().phone, "");
  assert.equal(adapter.context().isGroup, true);
  assert.equal(state.drawerReads, 0);
});

test("Native contact tel links normalize safely while a visible header phone remains authoritative", () => {
  const { state, adapter } = fixture({ peer: "" });
  adapter.context();
  state.drawers = [{ name: "Ana", phones: ["0051912345678"], telLinks: true }];
  assert.equal(adapter.context().phone, "51912345678");
  state.number = "+51 987 654 321";
  state.drawerReads = 0;
  assert.equal(adapter.context().phone, "51987654321");
  assert.equal(state.drawerReads, 0);
});

test("A persistent native drawer cannot lend an old phone to a different peer with the same display name", () => {
  const { state, adapter } = fixture({ name: "Same name", peer: "a@lid" });
  adapter.context();
  const oldDrawer = { name: "Same name", phones: ["+51 912 345 678"] };
  state.drawers = [oldDrawer];
  assert.equal(adapter.context().phone, "51912345678");
  state.peer = "b@lid";
  assert.equal(adapter.context().phone, "");
  assert.equal(adapter.context().phone, "");
  assert.deepEqual(matchContact(clients, adapter.context()).matches, []);
  assert.throws(() => adapter.prepare({ phone: "51912345678", text: "Private credentials" }), /teléfono/);
  assert.equal(state.draft, "");
  state.drawers = [{ name: "Same name", phones: ["+51 987 654 321"] }];
  assert.equal(adapter.context().phone, "51987654321");
});

test("An initially unobserved old drawer is rejected when a visible-phone chat changes to a hidden same-name peer", () => {
  const { state, adapter } = fixture({ name: "Same name", peer: "a@lid", number: "+51 912 345 678" });
  state.drawers = [{ name: "Same name", phones: ["+51 912 345 678"] }];
  assert.equal(adapter.context().phone, "51912345678");
  state.peer = "b@lid"; state.number = "";
  assert.equal(adapter.context().phone, "");
  assert.equal(adapter.context().phone, "");
  state.drawers[0].phones = ["+51 987 654 321"];
  assert.equal(adapter.context().phone, "51987654321");
});

test("A no-peer same-name reused header loses its drawer phone after native navigation or selected row changes", () => {
  const { state, adapter, navigate } = fixture({ name: "Same name", peer: "" });
  adapter.context();
  state.drawers = [{ name: "Same name", phones: ["+51 912 345 678"] }];
  assert.equal(adapter.context().phone, "51912345678");
  navigate();
  assert.equal(adapter.context().phone, "");
  assert.equal(adapter.context().phone, "");
  state.drawers = [{ name: "Same name", phones: ["+51 987 654 321"] }];
  assert.equal(adapter.context().phone, "51987654321");
  state.selected = {};
  assert.equal(adapter.context().phone, "");
});

test("An already open no-peer drawer is unproven until a fresh appearance or actual contact-open gesture", () => {
  const { state, adapter, openInfo } = fixture({ name: "Same name", peer: "" });
  const drawer = { name: "Same name", phones: ["+51 912 345 678"] };
  state.drawers = [drawer];
  assert.equal(adapter.context().phone, "");
  assert.equal(adapter.context().phone, "");
  drawer.hidden = true; adapter.context();
  openInfo();
  drawer.hidden = false;
  assert.equal(adapter.context().phone, "51912345678");
});

test("A previous header-open intent cannot reauthorize a hidden old drawer after a same-name peer switch", () => {
  const { state, adapter, openInfo } = fixture({ name: "Same name", peer: "a@lid" });
  adapter.context(); openInfo();
  const drawer = { name: "Same name", phones: ["+51 912 345 678"] };
  state.drawers = [drawer];
  assert.equal(adapter.context().phone, "51912345678");
  drawer.hidden = true; adapter.context();
  state.peer = "b@lid";
  adapter.context();
  drawer.hidden = false;
  assert.equal(adapter.context().phone, "");
  assert.equal(adapter.context().phone, "");
});

test("Temporarily hidden or ambiguous phone fields cannot refresh an unchanged stale drawer after a peer switch", () => {
  const { state, adapter } = fixture({ name: "Same name", peer: "a@lid" });
  adapter.context();
  const drawer = { name: "Same name", phones: ["+51 912 345 678"] };
  state.drawers = [drawer];
  assert.equal(adapter.context().phone, "51912345678");
  state.peer = "b@lid";
  assert.equal(adapter.context().phone, "");
  drawer.phones = [];
  assert.equal(adapter.context().phone, "");
  drawer.phones = ["+51 912 345 678"];
  assert.equal(adapter.context().phone, "");
  drawer.phones.push("+51 987 654 321");
  assert.equal(adapter.context().phone, "");
  drawer.phones = ["+51 912 345 678"];
  assert.equal(adapter.context().phone, "");
});

test("An ignored stale drawer cannot replace the new peer's previously confirmed manual binding", () => {
  const { state, adapter } = fixture({ name: "Same name", peer: "b@lid" });
  adapter.bind({ chatId: "wa:b@lid", phone: "51987654321" });
  state.peer = "a@lid"; adapter.context();
  state.drawers = [{ name: "Same name", phones: ["+51 912 345 678"] }];
  assert.equal(adapter.context().phone, "51912345678");
  state.peer = "b@lid";
  assert.equal(adapter.context().phone, "51987654321");
  assert.equal(adapter.context().phoneSource, "manual");
});

test("An actual in-place drawer phone update remains fresh after its new conversation generation settles", () => {
  const { state, adapter } = fixture({ name: "Same name", peer: "a@lid" });
  adapter.context();
  const drawer = { name: "Same name", phones: ["+51 912 345 678"] };
  state.drawers = [drawer];
  assert.equal(adapter.context().phone, "51912345678");
  state.peer = "b@lid";
  drawer.phones = ["+51 987 654 321"];
  assert.equal(adapter.context().phone, "");
  assert.equal(adapter.context().phone, "51987654321");
});

test("Closing verified contact info retains its phone only for the same opaque peer and header generation", () => {
  const { state, adapter } = fixture({ name: "Same name", peer: "a@lid" });
  adapter.context();
  state.drawers = [{ name: "Same name", phones: ["+51 912 345 678"] }];
  assert.equal(adapter.context().phone, "51912345678");
  state.drawers = [];
  assert.equal(adapter.context().phone, "51912345678");
  assert.equal(adapter.context().phoneSource, "visible");
  state.peer = "b@lid";
  assert.equal(adapter.context().phone, "");
  assert.throws(() => adapter.prepare({ phone: "51912345678", text: "Not this customer" }), /teléfono/);
  assert.equal(state.draft, "");
});

test("A selected native row can retain a verified no-peer phone but navigation invalidates it", () => {
  const { state, adapter, navigate } = fixture({ name: "Same name", peer: "" });
  state.selected = {};
  adapter.context();
  state.drawers = [{ name: "Same name", phones: ["+51 912 345 678"] }];
  assert.equal(adapter.context().phone, "51912345678");
  state.drawers = [];
  assert.equal(adapter.context().phone, "51912345678");
  assert.equal(adapter.context().chatId, "phone:51912345678");
  navigate();
  assert.equal(adapter.context().phone, "");
  state.selected = {};
  assert.equal(adapter.context().phone, "");
});
