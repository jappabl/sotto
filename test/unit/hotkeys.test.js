const { test } = require('node:test');
const assert = require('node:assert');
const { specSatisfied, HOTKEY_DEFS, KEY } = require('../../electron/hotkeys');

test('fn spec', () => {
  const spec = HOTKEY_DEFS.fn;
  assert.equal(specSatisfied(spec, { keys: [], fn: true }), true);
  assert.equal(specSatisfied(spec, { keys: [KEY.LCTRL], fn: false }), false);
});

test('ctrl+alt spec accepts either side', () => {
  const spec = HOTKEY_DEFS['ctrl+alt'];
  assert.equal(specSatisfied(spec, { keys: [KEY.LCTRL, KEY.LALT], fn: false }), true);
  assert.equal(specSatisfied(spec, { keys: [KEY.RCTRL, KEY.RALT], fn: false }), true);
  assert.equal(specSatisfied(spec, { keys: [KEY.LCTRL, KEY.RALT], fn: false }), true);
  assert.equal(specSatisfied(spec, { keys: [KEY.LCTRL], fn: false }), false);
});

test('right-side-only specs', () => {
  assert.equal(specSatisfied(HOTKEY_DEFS.rcmd, { keys: [KEY.RCMD], fn: false }), true);
  assert.equal(specSatisfied(HOTKEY_DEFS.rcmd, { keys: [KEY.LCMD], fn: false }), false);
  assert.equal(specSatisfied(HOTKEY_DEFS.ralt, { keys: [KEY.RALT], fn: false }), true);
});

test('extra held keys do not break the chord', () => {
  assert.equal(specSatisfied(HOTKEY_DEFS.rcmd, { keys: [KEY.RCMD, KEY.LSHIFT], fn: false }), true);
});
