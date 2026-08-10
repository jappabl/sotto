const { test } = require('node:test');
const assert = require('node:assert');
const {
  adjustForContext,
  isLikelyHallucination,
  wavRms,
  normalizeMoney,
  dropTrailingPeriodForChat,
  formatTranscript,
} = require('../../electron/formatter');

// ---- seam handling v2 ----

test('seam dedup: repeated join word is dropped', () => {
  assert.equal(
    adjustForContext('The plan needs work', 'I reviewed the'),
    ' plan needs work',
  );
});

test('seam dedup that consumes everything inserts nothing', () => {
  assert.equal(adjustForContext('The', 'I reviewed the'), '');
});

test('no space added after opening bracket or quote', () => {
  // A quoted sentence keeps its capital; the point is no stray space.
  assert.equal(adjustForContext('Hello there', 'She said ("'), 'Hello there');
  assert.equal(adjustForContext('quarterly numbers', 'See ('), 'quarterly numbers');
});

test('trailing space added when cursor sits before a word', () => {
  assert.equal(adjustForContext('hello', '', 'world'), 'hello ');
});

test('no doubled punctuation against following text', () => {
  assert.equal(adjustForContext('and more.', 'The list goes on ', '. Then it ends'), 'and more');
});

test('after-text alone leaves capitalization to the formatter', () => {
  assert.equal(adjustForContext('Sure thing', '', ', right?'), 'Sure thing');
});

// ---- silence hallucination filter ----

test('classic whisper hallucinations on silence are dropped', () => {
  assert.equal(isLikelyHallucination('Thank you.', 0.001), true);
  assert.equal(isLikelyHallucination('Thanks for watching!', 0.002), true);
  assert.equal(isLikelyHallucination('you', 0.0005), true);
});

test('real speech energy is never dropped', () => {
  assert.equal(isLikelyHallucination('Thank you.', 0.05), false);
  assert.equal(isLikelyHallucination('Send the report to finance.', 0.001), false);
});

test('wavRms math', () => {
  const silent = Buffer.alloc(44 + 3200);
  assert.equal(wavRms(silent), 0);
  const loud = Buffer.alloc(44 + 3200);
  for (let i = 44; i + 1 < loud.length; i += 2) loud.writeInt16LE(16384, i);
  assert.ok(Math.abs(wavRms(loud) - 0.5) < 0.01);
});

// ---- money & percent ----

test('currency normalization', () => {
  assert.equal(normalizeMoney('it costs 20 dollars'), 'it costs $20');
  assert.equal(normalizeMoney('20 dollars and 5 cents total'), '$20.05 total');
  assert.equal(normalizeMoney('a 15 percent raise'), 'a 15% raise');
  assert.equal(normalizeMoney('50 euros please'), '€50 please');
  assert.equal(normalizeMoney('dollars are strong'), 'dollars are strong');
});

// ---- chat trailing period ----

test('chat apps lose the trailing period on short messages', () => {
  assert.equal(dropTrailingPeriodForChat('Sounds good.'), 'Sounds good');
  assert.equal(dropTrailingPeriodForChat('On my way!'), 'On my way!');
  const long = 'This is a much longer message. '.repeat(8).trim();
  assert.equal(dropTrailingPeriodForChat(long), long);
});

test('chatApp option flows through the pipeline', () => {
  assert.equal(
    formatTranscript('sounds good see you then', { chatApp: true }).text,
    'Sounds good see you then',
  );
});

// ---- pronoun i ----

test('standalone i becomes I, i.e. survives', () => {
  assert.equal(formatTranscript('i think i can', {}).text, 'I think I can');
  assert.equal(formatTranscript("well i'll try", {}).text, "Well I'll try");
});

test('dot dot dot becomes ellipsis dots, no capital after', () => {
  assert.equal(formatTranscript('well dot dot dot maybe', {}).text, 'Well... maybe');
});

test('capitalizes when inserting after a newline', () => {
  assert.equal(adjustForContext('next point here', 'First line done\n'), 'Next point here');
});
