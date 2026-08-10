const { test } = require('node:test');
const assert = require('node:assert');
const {
  formatTranscript,
  stripFillers,
  applyBacktrack,
  applySpokenPunctuation,
  applyDictionary,
  applySnippets,
  applyStyle,
  extractPressEnter,
} = require('../../electron/formatter');

test('strips filler words', () => {
  assert.equal(
    stripFillers('Um, I think, uh, we should ship it.'),
    'I think, we should ship it.',
  );
  assert.equal(stripFillers('umm so hmm yes'), 'so yes');
});

test('does not strip words containing filler substrings', () => {
  assert.equal(stripFillers('The umbrella is under the summer sun.'),
    'The umbrella is under the summer sun.');
  assert.equal(stripFillers('Bermuda era hermit'), 'Bermuda era hermit');
});

test('backtrack keeps the correction', () => {
  assert.equal(
    applyBacktrack("Let's meet at 5, scratch that, 6pm works better."),
    '6pm works better.',
  );
  assert.equal(
    applyBacktrack('Send it to John, I mean, Jane.'),
    'Jane.',
  );
});

test('backtrack only clears within the sentence', () => {
  assert.equal(
    applyBacktrack('The deadline is Friday. Send it Monday, scratch that, Tuesday.'),
    'The deadline is Friday. Tuesday.',
  );
});

test('spoken punctuation', () => {
  assert.equal(
    applySpokenPunctuation('hello comma world period'),
    'hello, world.',
  );
  assert.equal(
    applySpokenPunctuation('first item new line second item'),
    'first item\nsecond item',
  );
  assert.equal(
    applySpokenPunctuation('done question mark'),
    'done?',
  );
});

test('spoken punctuation capitalizes new sentences', () => {
  assert.equal(
    applySpokenPunctuation('it works period it really does'),
    'it works. It really does',
  );
});

test('dictionary plain word enforces casing', () => {
  const dict = [{ word: 'Figma' }];
  assert.equal(applyDictionary('we use figma daily', dict), 'we use Figma daily');
});

test('dictionary replacement rule', () => {
  const dict = [{ word: 'by the way', replacement: 'btw' }];
  assert.equal(applyDictionary('By the way this works', dict), 'btw this works');
});

test('snippet expansion is whole-phrase and case-insensitive', () => {
  const snips = [{ trigger: 'personal email', expansion: 'me@example.com' }];
  assert.equal(applySnippets('send it to Personal Email.', snips), 'send it to me@example.com');
  assert.equal(applySnippets('my personal emails are private', snips), 'my personal emails are private');
});

test('press enter extraction', () => {
  assert.deepEqual(extractPressEnter('sounds good press enter'), { text: 'sounds good', pressEnter: true });
  assert.deepEqual(extractPressEnter('press enter to continue is the label'),
    { text: 'press enter to continue is the label', pressEnter: false });
});

test('style presets', () => {
  assert.equal(applyStyle('See you at noon.', 'casual'), 'See you at noon');
  assert.equal(applyStyle("I'll See you, Sam.", 'very-casual', [{ word: 'Sam' }]),
    "I'll see you, Sam");
});

test('full pipeline end to end', () => {
  const { text, pressEnter } = formatTranscript(
    'um hello comma this is a test period send it to figma press enter',
    {
      dictionary: [{ word: 'Figma' }],
      snippets: [],
    },
  );
  assert.equal(text, 'Hello, this is a test. Send it to Figma');
  assert.equal(pressEnter, true);
});

test('whisper artifacts removed', () => {
  const { text } = formatTranscript(' [BLANK_AUDIO] hello there (music) ');
  assert.equal(text, 'Hello there');
});

test('empty input yields empty output', () => {
  const { text } = formatTranscript('   ');
  assert.equal(text, '');
});
