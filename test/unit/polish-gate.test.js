// Polish is for self-corrections and disfluencies. Run it on clean text and a
// 3B model invents work: these cases are taken from real dictations where it
// changed meaning rather than cleaning anything.
const { test } = require('node:test');
const assert = require('assert');
const { needsPolish, validatePolish } = require('../../electron/polisher');

test('clean text does not reach the model', () => {
  assert.equal(needsPolish('Is it already updated on my system?'), false);
  assert.equal(needsPolish('Did you update the UI for that one?'), false);
  assert.equal(needsPolish('Start with BM25 and go into the next one.'), false);
  assert.equal(needsPolish(''), false);
  assert.equal(needsPolish(null), false);
});

test('self-corrections and disfluencies do', () => {
  assert.equal(needsPolish('Can I do it Tuesday? No, actually Friday.'), true);
  assert.equal(needsPolish('Send it to John, I mean, Jane.'), true);
  assert.equal(needsPolish('Let us meet Tuesday, no wait, Wednesday.'), true);
  assert.equal(needsPolish('Tell the team the the launch slipped'), true);
  assert.equal(needsPolish('Um, what time does it start?'), true);
  assert.equal(needsPolish('It is not Friday, the following Monday'), true);
});

test('a question stays a question', () => {
  assert.equal(validatePolish('What are all this looking like?', 'What are all this looking like'), null);
  assert.equal(validatePolish('Is this fine?', 'Is this fine?'), 'Is this fine?');
});

test('whose thing it is is not a cleanup decision', () => {
  // Observed: "my system" came back as "your system".
  assert.equal(validatePolish('Is it already updated on my system?',
    'Is it already updated on your system?'), null);
  // Rewording that leaves the people alone is still allowed through.
  assert.equal(validatePolish('Let us meet Tuesday, no wait, Wednesday.',
    'Let us meet Wednesday.'), 'Let us meet Wednesday.');
  // Dropping a filler that happens to contain a pronoun is ordinary cleanup.
  assert.equal(
    validatePolish('You know what, forget the pizza place. Book the sushi spot instead.',
      'Forget the pizza place. Book the sushi spot instead.'),
    'Forget the pizza place. Book the sushi spot instead.');
});

test('interpreting the transcript is not cleaning it', () => {
  // Observed: the model answered the dictation instead of tidying it.
  assert.equal(validatePolish('what do you think is the next act we should bundle',
    'I think you mean "what do you think is the next act we should bundle?"'), null);
});
