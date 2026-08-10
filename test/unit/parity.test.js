const { test } = require('node:test');
const assert = require('node:assert');
const { detectCorrections, levenshtein } = require('../../electron/autolearn');
const { adjustForContext } = require('../../electron/formatter');
const { validatePolish } = require('../../electron/polisher');
const { applyCorrections } = require('../../electron/corrections');

// ---- new marker ----

test('"no hold on" resolves like no wait', () => {
  assert.equal(
    applyCorrections('We launch Monday, no hold on, Tuesday morning.'),
    'We launch Tuesday morning.',
  );
});

// ---- auto-learn diff ----

test('detects a single-word manual correction', () => {
  const inserted = 'Send the propsal to Marketing by Friday please';
  const field = 'Send the proposal to Marketing by Friday please';
  assert.deepEqual(detectCorrections(inserted, field), [
    { from: 'propsal', to: 'proposal' },
  ]);
});

test('no learning when the message was rewritten wholesale', () => {
  const inserted = 'Send the propsal to Marketing by Friday';
  const field = 'Completely different text about other things entirely here';
  assert.deepEqual(detectCorrections(inserted, field), []);
});

test('no learning from distant words', () => {
  const inserted = 'Meet me at the cafe on Main Street soon';
  const field = 'Meet me at the bakery on Main Street soon';
  // cafe → bakery: distance too large, different first letter — no match.
  assert.deepEqual(detectCorrections(inserted, field), []);
});

test('levenshtein basics', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('same', 'same'), 0);
});

// ---- context-aware continuation ----

test('lowercases when joining mid-sentence', () => {
  assert.equal(
    adjustForContext('And then we ship it', 'I think we should test first '),
    'and then we ship it',
  );
});

test('adds a leading space when needed', () => {
  assert.equal(
    adjustForContext('and then we ship', 'test first'),
    ' and then we ship',
  );
});

test('keeps capital after a finished sentence', () => {
  assert.equal(
    adjustForContext('New paragraph here', 'That was the plan. '),
    'New paragraph here',
  );
});

test('keeps "I" capitalized mid-sentence', () => {
  assert.equal(
    adjustForContext('I think so', 'and honestly '),
    'I think so',
  );
});

test('empty context leaves text alone', () => {
  assert.equal(adjustForContext('Hello there', ''), 'Hello there');
});

// ---- polish output validation (the deterministic floor) ----

test('validator accepts a faithful cleanup', () => {
  assert.equal(
    validatePolish('um so we should ship it on Friday', 'We should ship it on Friday'),
    'We should ship it on Friday',
  );
});

test('validator strips wrapping quotes', () => {
  assert.equal(validatePolish('ship it friday', '"Ship it friday"'), 'Ship it friday');
});

test('validator rejects assistant-speak', () => {
  assert.equal(validatePolish('ship it friday', 'Here is the cleaned text: ship it'), null);
  assert.equal(validatePolish('ship it friday', "I cannot clean this transcript."), null);
});

test('validator rejects paraphrases that abandon the speaker\'s words', () => {
  assert.equal(
    validatePolish(
      'we should probably ship the release on friday',
      'The deployment ought to occur at the end of the week',
    ),
    null,
  );
});

test('validator rejects runaway length', () => {
  assert.equal(validatePolish('short note', 'short note '.repeat(20)), null);
  assert.equal(validatePolish('a decently long input sentence here', 'ok'), null);
});
