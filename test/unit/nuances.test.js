const { test } = require('node:test');
const assert = require('node:assert');
const {
  formatTranscript,
  stripPreamble,
  stripHedges,
  applySpokenEmoji,
  applyListFormation,
  fixHomophones,
} = require('../../electron/formatter');
const { applyCorrections } = require('../../electron/corrections');

// ---- research-sourced canonical pairs ----

test('official docs pair: coffee at 2 actually 3', () => {
  assert.equal(
    applyCorrections("Let's do coffee at 2 actually 3"),
    "Let's do coffee at 3",
  );
});

test('official docs pair: as a gift → as a present', () => {
  assert.equal(
    applyCorrections('I wanted to buy a record as a gift, as a present.'),
    'I wanted to buy a record as a present.',
  );
});

test('multi-slot swap: 2pm today → 4pm tomorrow', () => {
  assert.equal(
    applyCorrections("Let's have a meeting at 2pm today, make that 4pm tomorrow."),
    "Let's have a meeting at 4pm tomorrow.",
  );
});

test('webhook endpoint splice keeps the trailing clause', () => {
  assert.equal(
    applyCorrections('Update the API endpoint, wait no, the webhook endpoint before the client call.'),
    'Update the webhook endpoint before the client call.',
  );
});

test('guard rail: intensifier actually survives', () => {
  assert.equal(
    applyCorrections('I actually enjoyed the movie.'),
    'I actually enjoyed the movie.',
  );
});

test('guard rail: make it pop survives', () => {
  assert.equal(
    applyCorrections('Add some color and make it pop.'),
    'Add some color and make it pop.',
  );
});

test('safe non-restatement: on Friday, on time', () => {
  assert.equal(
    applyCorrections('We ship on Friday, on time.'),
    'We ship on Friday, on time.',
  );
});

// ---- preamble ----

test('preamble stripping', () => {
  assert.equal(
    stripPreamble('Okay so the thing is we need to move the deadline'),
    'we need to move the deadline',
  );
  assert.equal(stripPreamble('Well, alright, send it over now please'), 'send it over now please');
  // Content that merely starts with these words but IS the content stays.
  assert.equal(stripPreamble('Okay sounds good'), 'Okay sounds good');
});

// ---- hedges ----

test('comma-bound hedge removal', () => {
  assert.equal(stripHedges("It's, you know, fine"), "It's fine");
  assert.equal(stripHedges('You know the answer already'), 'You know the answer already');
});

// ---- emoji ----

test('spoken emoji with explicit cue', () => {
  assert.equal(applySpokenEmoji('great work thumbs up emoji'), 'great work 👍');
  assert.equal(applySpokenEmoji('ship it rocket emoji fire emoji'), 'ship it 🚀 🔥');
  assert.equal(applySpokenEmoji('I love the fire emoji feature'), 'I love the 🔥 feature');
  assert.equal(applySpokenEmoji('thumbs up from me'), 'thumbs up from me');
});

// ---- lists ----

test('spoken list formation with first/second', () => {
  assert.equal(
    applyListFormation('My goals are first finish the report second send the deck'),
    'My goals are:\n1. Finish the report\n2. Send the deck',
  );
});

test('number one / number two list', () => {
  assert.equal(
    applyListFormation('Todo number one buy groceries number two call mom'),
    'Todo:\n1. Buy groceries\n2. Call mom',
  );
});

test('lone ordinal words never convert', () => {
  assert.equal(
    applyListFormation('The first thing I noticed was the light'),
    'The first thing I noticed was the light',
  );
  assert.equal(
    applyListFormation('She came first and he came second'),
    'She came first and he came second',
  );
});

// ---- homophones ----

test('their/your going repair', () => {
  assert.equal(fixHomophones("their going to love it"), "they're going to love it");
  assert.equal(fixHomophones('Your making progress'), "You're making progress");
  assert.equal(fixHomophones('their plan is solid'), 'their plan is solid');
});

// ---- cleanup levels ----

test('cleanup level none keeps everything', () => {
  const { text } = formatTranscript('um do that no wait that', { cleanupLevel: 'none' });
  assert.equal(text, 'Um do that no wait that');
});

test('cleanup level light strips fillers but keeps corrections', () => {
  const { text } = formatTranscript('um do that no wait that', { cleanupLevel: 'light' });
  assert.equal(text, 'Do that no wait that');
});

test('cleanup level medium resolves corrections', () => {
  const { text } = formatTranscript('um do that no wait that', { cleanupLevel: 'medium' });
  assert.equal(text, 'Do that');
});

test('cleanup level high also strips preamble', () => {
  const { text } = formatTranscript('okay so basically we should ship on Friday', { cleanupLevel: 'high' });
  assert.equal(text, 'We should ship on Friday');
});

// ---- integration ----

test('the whole nine yards', () => {
  const { text, pressEnter } = formatTranscript(
    "Um, okay, tell Sam, I mean, Alex that the the launch moved to Tuesday, no wait, Thursday at 4 PM. Press enter.",
    { cleanupLevel: 'high' },
  );
  assert.equal(text, 'Tell Alex that the launch moved to Thursday at 4pm.');
  assert.equal(pressEnter, true);
});

// ---- em-dash policy ----

const { stripEmDashes } = require('../../electron/formatter');

test('em dashes never survive', () => {
  assert.equal(stripEmDashes('One thing — the deadline moved'), 'One thing - the deadline moved');
  assert.equal(stripEmDashes('pages 5–10 are done'), 'pages 5-10 are done');
  assert.equal(
    formatTranscript('The plan — such as it is — works', {}).text,
    'The plan - such as it is - works',
  );
});

test('spoken "em dash" gives a spaced hyphen', () => {
  assert.equal(
    formatTranscript('one more thing em dash the deadline moved', {}).text,
    'One more thing - the deadline moved',
  );
  assert.equal(
    formatTranscript('one more thing m dash the deadline moved', {}).text,
    'One more thing - the deadline moved',
  );
});

test('spoken "hyphen" joins words', () => {
  assert.equal(
    formatTranscript('the follow hyphen up email', {}).text,
    'The follow-up email',
  );
});
