const { test } = require('node:test');
const assert = require('node:assert');
const {
  applyCorrections,
  collapseStutters,
  replaceTail,
  findMarker,
} = require('../../electron/corrections');

// ---- the user's canonical case ----

test('"do that no wait that" keeps only the correction', () => {
  assert.equal(applyCorrections('Do that no wait that'), 'Do that');
  assert.equal(applyCorrections('Do that, no wait, do this'), 'Do this');
});

// ---- shape-matched tail swaps ----

test('number swap: meet at 5, no wait, 6', () => {
  assert.equal(applyCorrections("Let's meet at 5, no wait, 6."), "Let's meet at 6.");
});

test('time swap with pm', () => {
  assert.equal(applyCorrections('Meet at 5, actually 6pm.'), 'Meet at 6pm.');
});

test('weekday swap: Tuesday → Friday', () => {
  assert.equal(
    applyCorrections('Can we meet Tuesday, wait no, Friday?'),
    'Can we meet Friday?',
  );
});

test('proper noun swap: John → Jane', () => {
  assert.equal(
    applyCorrections('Send it to John, I mean, Jane.'),
    'Send it to Jane.',
  );
});

test('proper noun swap consumes full name', () => {
  assert.equal(
    applyCorrections('Loop in Sarah Chen, I mean, Marcus.'),
    'Loop in Marcus.',
  );
});

test('prefix echo: the blue one → the red one', () => {
  assert.equal(
    applyCorrections("Let's use the blue one, scratch that, the red one."),
    "Let's use the red one.",
  );
});

test('preposition echo: at the office → at home', () => {
  assert.equal(
    applyCorrections("I'll work at the office, no wait, at home today."),
    "I'll work at home today.",
  );
});

// ---- whole-clause replacement (strong markers only) ----

test('scratch that replaces the whole previous clause', () => {
  assert.equal(
    applyCorrections('Send the Q3 report, scratch that, send the board deck.'),
    'Send the board deck.',
  );
});

test('scratch that reaches across a sentence boundary', () => {
  assert.equal(
    applyCorrections('Send the report today. Scratch that, send it tomorrow.'),
    'Send it tomorrow.',
  );
});

test('bare "scratch that." deletes the previous sentence', () => {
  assert.equal(
    applyCorrections('Order pizza for the team. Scratch that.'),
    '',
  );
});

test('correction preserves the rest of the sentence after the fragment', () => {
  assert.equal(
    applyCorrections('Book it for 3, no wait, 4, and invite the others.'),
    'Book it for 4, and invite the others.',
  );
});

// ---- weak markers stay conservative ----

test('adverbial "actually" is left alone', () => {
  assert.equal(
    applyCorrections('I actually think this is great.'),
    'I actually think this is great.',
  );
  assert.equal(
    applyCorrections('That was actually really fun.'),
    'That was actually really fun.',
  );
});

test('"actually" never deletes a whole clause', () => {
  assert.equal(
    applyCorrections('I love this plan, actually it reminds me of our old roadmap.'),
    'I love this plan, actually it reminds me of our old roadmap.',
  );
});

test('"sorry" swaps a name but leaves apologies alone', () => {
  assert.equal(
    applyCorrections('Ask for Diego, sorry, Marco.'),
    'Ask for Marco.',
  );
  assert.equal(
    applyCorrections("Sorry I missed your call this morning."),
    "Sorry I missed your call this morning.",
  );
});

test('"I mean" mid-flow without shape match is preserved', () => {
  assert.equal(
    applyCorrections('I mean it when I say this matters.'),
    'I mean it when I say this matters.',
  );
});

// ---- plain restatement ----

test('restated clause: meet at 5, meet at 6', () => {
  assert.equal(
    applyCorrections('Meet at 5, meet at 6pm.'),
    'Meet at 6pm.',
  );
});

test('restated sentence with shared head', () => {
  assert.equal(
    applyCorrections('Send the invite to everyone today. Send the invite to everyone tomorrow.'),
    'Send the invite to everyone tomorrow.',
  );
});

test('different sentences are not collapsed', () => {
  const s = 'Send the invite. Bring your laptop.';
  assert.equal(applyCorrections(s), s);
});

// ---- stutters & false starts ----

test('duplicate word collapse', () => {
  assert.equal(collapseStutters('I I think the the plan works'), 'I think the plan works');
});

test('duplicate bigram collapse', () => {
  assert.equal(collapseStutters('I think I think we should go'), 'I think we should go');
});

test('legitimate doubles survive', () => {
  assert.equal(collapseStutters('He had had enough'), 'He had had enough');
});

test('partial-word false start', () => {
  assert.equal(collapseStutters('th- the plan is ready'), 'the plan is ready');
});

// ---- unit-level internals ----

test('replaceTail shape matching', () => {
  assert.equal(replaceTail('meet at 5', '6'), 'meet at 6');
  assert.equal(replaceTail('fly out on Tuesday', 'Friday'), 'fly out on Friday');
  assert.equal(replaceTail('email John', 'Jane'), 'email Jane');
  assert.equal(replaceTail('do that', 'that'), 'do that');
  assert.equal(replaceTail('nothing matches here', 'xyzzy'), null);
});

test('findMarker positions', () => {
  const hit = findMarker('do that no wait that');
  assert.equal(hit.marker, 'no wait');
  assert.equal(hit.pre, 'do that');
  assert.equal(hit.frag, 'that');
  assert.equal(findMarker('the waiter brought water'), null);
});

// ---- corrections combined with real punctuation styles ----

test('marker with no commas at all', () => {
  assert.equal(
    applyCorrections('send it to John I meant Jane'),
    'send it to Jane',
  );
});

test('multiple corrections in one utterance', () => {
  assert.equal(
    applyCorrections('Meet at 4, no wait, 5. Bring Sam, I mean, Alex.'),
    'Meet at 5. Bring Alex.',
  );
});
