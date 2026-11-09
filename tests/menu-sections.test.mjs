import test from "node:test";
import assert from "node:assert/strict";
import { MENU_SECTION_KEYS, validateWorkspace } from "../crm.mjs";
import { cleanState, emptyState } from "../cloud/state.mjs";

test("legacy workspace validation and cleaning do not add menu preferences", () => {
  const state = emptyState();
  const original = structuredClone(state);
  assert.equal(validateWorkspace(state), state);
  assert.equal(Object.hasOwn(state.settings, "menuSections"), false);
  assert.equal(Object.hasOwn(cleanState(state).settings, "menuSections"), false);
  assert.deepEqual(state, original);
});

test("empty, partial, and full preferences survive cloud cleaning and JSON backup restore", () => {
  const choices = [
    {},
    { security: true, automation: false },
    {
      security: false,
      automation: true,
      integrations: false,
      settings: true,
      marketing: false,
      social: true,
    },
  ];
  assert.deepEqual(MENU_SECTION_KEYS, Object.keys(choices[2]));
  for (const preferences of choices) {
    const state = emptyState();
    state.settings.menuSections = preferences;
    const original = structuredClone(state);
    const clean = cleanState(state);
    assert.deepEqual(clean.settings.menuSections, preferences);
    const restored = JSON.parse(JSON.stringify(clean));
    assert.equal(validateWorkspace(restored), restored);
    assert.deepEqual(cleanState(restored).settings.menuSections, preferences);
    assert.deepEqual(state, original);
  }
});

test("menu preferences reject malformed objects, unknown keys, and non-boolean flags", () => {
  const invalid = [
    null,
    undefined,
    [],
    [true],
    "security",
    true,
    1,
    { clients: false },
    { security: true, unknown: false },
    JSON.parse('{"__proto__":false}'),
    ...[null, undefined, 0, 1, "", "true", "false", [], {}].map((value) => ({
      security: value,
    })),
  ];
  for (const preferences of invalid) {
    const state = emptyState();
    state.settings.menuSections = preferences;
    assert.throws(() => validateWorkspace(state), /Preferencias del menú/);
    assert.throws(() => cleanState(state), /Preferencias del menú/);
  }
});
