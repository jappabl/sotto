const { test } = require('node:test');
const assert = require('node:assert');
const { Knowledge, sectionsOf, transcriptWindows } = require('../../electron/knowledge');

test('sectionsOf splits enhanced notes at headings', () => {
  const md = '## Pricing\n- keep tiers\n## Design\n- new hero\n- mobile first';
  const secs = sectionsOf(md);
  assert.equal(secs.length, 2);
  assert.ok(secs[0].includes('Pricing'));
  assert.ok(secs[1].includes('Design'));
});

test('transcriptWindows groups turns and carries overlap', () => {
  const segs = Array.from({ length: 20 }, (_, i) => ({
    t0: i * 10, t1: i * 10 + 9, who: i % 2 ? 'them' : 'me',
    text: 'This is turn number ' + i + ' with roughly a dozen words of content here.',
  }));
  const wins = transcriptWindows(segs);
  assert.ok(wins.length >= 2);
  assert.ok(wins[0].text.includes('Me:'));
  assert.ok(typeof wins[0].t0 === 'number');
});

// End-to-end retrieval over a fake corpus (no LLM).
function fakeKnowledge(history, meetingsData) {
  const store = { getHistory: () => history };
  const meetings = {
    list: () => meetingsData.map((m) => m.meta),
    read: (id) => meetingsData.find((m) => m.meta.id === id) || null,
  };
  return new Knowledge({ store, meetings, orgspace: null, polisher: null, log: () => {} });
}

test('search finds the meeting decision over unrelated dictations', () => {
  const now = Date.now();
  const k = fakeKnowledge(
    [
      { id: 'd1', ts: now, text: 'Reminder to buy oat milk and pick up laundry', app: 'Notes' },
      { id: 'd2', ts: now, text: 'Draft tweet about the new blog post going live', app: 'X' },
    ],
    [{
      meta: { id: 'm1', title: 'Pricing sync', startedAt: now },
      notes: '', enhanced: '## Decision\n- We agreed to keep the enterprise pricing tier and revisit in Q4',
      transcript: [{ t0: 0, t1: 8, who: 'them', text: 'I think we keep the pricing as is for now' }],
    }],
  );
  const hits = k.search('what did we decide about pricing');
  assert.ok(hits.length > 0);
  assert.equal(hits[0].source, 'meeting');
  assert.ok(/pricing|enterprise/i.test(hits[0].text));
});

test('enhanced-note chunks outrank raw transcript for decision queries', () => {
  const now = Date.now();
  const k = fakeKnowledge([], [{
    meta: { id: 'm1', title: 'Planning', startedAt: now },
    notes: '',
    enhanced: '## Decisions\n- Ship the redesign on June 9th',
    transcript: [
      { t0: 0, t1: 8, who: 'me', text: 'so about the ship date for the redesign' },
      { t0: 9, t1: 16, who: 'them', text: 'the ship date we are thinking is June' },
    ],
  }]);
  const hits = k.search('ship date decision');
  assert.equal(hits[0].kind, 'notes'); // enhanced-note section wins via kind prior
});

test('markDirty forces a rebuild', () => {
  const now = Date.now();
  let history = [{ id: 'd1', ts: now, text: 'alpha beta gamma', app: 'A' }];
  const store = { getHistory: () => history };
  const k = new Knowledge({ store, meetings: { list: () => [], read: () => null }, orgspace: null, polisher: null, log: () => {} });
  assert.equal(k.search('alpha').length, 1);
  history = history.concat({ id: 'd2', ts: now, text: 'alpha delta epsilon', app: 'B' });
  k.markDirty();
  assert.equal(k.search('alpha').length, 2);
});

test('retrieve falls back to bm25 mode without an embedder', async () => {
  const now = Date.now();
  const k = fakeKnowledge(
    [{ id: 'd1', ts: now, text: 'quarterly budget planning notes', app: 'Notes' }],
    [],
  );
  const r = await k.retrieve('budget');
  assert.equal(r.mode, 'bm25');
  assert.ok(r.hits.length >= 1);
  assert.equal(r.hits[0].source, 'dictation');
});

test('per-sentence groundedness flags an unsupported claim', () => {
  const { __checkSentences } = require('../../electron/knowledge');
  const sources = [{ text: 'We agreed to keep the current three tiers and revisit enterprise pricing in Q4.' }];
  const s = __checkSentences('Keep the current tiers, revisiting in Q4 [1]. We also chose the Berlin office [1].', sources);
  assert.equal(s.length, 2);
  assert.equal(s[0].grounded, true);   // matches the cited source
  assert.equal(s[1].grounded, false);  // fabricated, no overlap
});
