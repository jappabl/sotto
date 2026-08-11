const { test } = require('node:test');
const assert = require('node:assert');
const { BM25, tokenize, reciprocalRankFusion } = require('../../electron/bm25');

test('tokenize drops stopwords and question scaffolding', () => {
  assert.deepEqual(tokenize('what did we decide about the pricing'), ['decide', 'pricing']);
  assert.ok(!tokenize('the and of to').length);
  // plural folding, but proper nouns left alone
  assert.deepEqual(tokenize('meetings decisions Marcus'), ['meeting', 'decision', 'marcus']);
});

test('BM25 ranks the on-topic doc first', () => {
  const bm = new BM25();
  bm.add('a', 'We agreed to keep the current pricing tiers and revisit in Q4', { title: 'Pricing sync' });
  bm.add('b', 'The team discussed the new onboarding flow and mobile design', { title: 'Design review' });
  bm.add('c', 'Lunch options and office logistics for next week', { title: 'Ops' });
  bm.build();
  const r = bm.search('what did we decide about pricing');
  assert.equal(r[0].id, 'a');
});

test('title boost lifts a titled doc over a passing mention', () => {
  const bm = new BM25();
  bm.add('mention', 'someone briefly mentioned budget once in passing here', {});
  bm.add('titled', 'this note is entirely about the quarterly numbers', { title: 'Budget planning' });
  bm.build();
  const r = bm.search('budget');
  assert.equal(r[0].id, 'titled');
});

test('no query terms yields no results', () => {
  const bm = new BM25();
  bm.add('a', 'hello world', {});
  bm.build();
  assert.deepEqual(bm.search('the and of'), []);
});

test('reciprocal rank fusion blends two orderings', () => {
  const lexical = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
  const vector = [{ id: 'y' }, { id: 'x' }, { id: 'w' }];
  const fused = reciprocalRankFusion([lexical, vector]);
  const sorted = [...fused.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  // x and y appear high in both lists -> they lead; z and w trail.
  assert.deepEqual(new Set(sorted.slice(0, 2)), new Set(['x', 'y']));
  assert.ok(sorted.indexOf('w') > 1 && sorted.indexOf('z') > 1);
});

test('short name query still matches', () => {
  const bm = new BM25();
  bm.add('a', 'Marcus owns the hero design and the launch page', { title: 'Kickoff' });
  bm.add('b', 'general notes about timelines', {});
  bm.build();
  assert.equal(bm.search('Marcus')[0].id, 'a');
});
