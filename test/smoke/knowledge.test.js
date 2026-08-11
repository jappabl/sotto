// Knowledge E2E: build an index over a fake corpus and ask real questions of
// the local LLM. Verifies retrieval finds the right note, the answer is
// grounded and cites, and unanswerable questions get refused (no hallucination).
//
// Run: node test/smoke/knowledge.test.js

const path = require('path');
const os = require('os');
const assert = require('assert');
const { Knowledge } = require('../../electron/knowledge');
const { Polisher } = require('../../electron/polisher');

const MODELS = path.join(os.homedir(), 'Library', 'Application Support', 'Sotto', 'models');

const now = Date.now();
const DAY = 86400000;
const history = [
  { id: 'd1', ts: now - 2 * DAY, text: 'Remember to renew the domain before it expires next month', app: 'Notes' },
  { id: 'd2', ts: now - 1 * DAY, text: 'My personal takeaway: we should lean into the privacy angle harder in marketing', app: 'Bear' },
];
const meetingsData = [
  {
    meta: { id: 'm1', title: 'Pricing sync', startedAt: now - 5 * DAY },
    notes: '- pushback on enterprise tier\n- Maya to send comparison',
    enhanced: '## Pricing decision\n- We agreed to keep the current three tiers and revisit enterprise pricing in Q4\n- Maya will send a competitor comparison by Friday\n## Concerns\n- Two customers pushed back on the enterprise price point',
    transcript: [
      { t0: 0, t1: 12, who: 'them', text: 'honestly the enterprise tier feels a bit steep for what you get' },
      { t0: 13, t1: 22, who: 'me', text: 'fair, let me walk you through what is included at that level' },
    ],
  },
  {
    meta: { id: 'm2', title: 'Website redesign kickoff', startedAt: now - 3 * DAY },
    notes: '- launch before conference\n- static hero, no video',
    enhanced: '## Timeline\n- Launch the redesign around June 9th, ahead of the June 12th conference\n## Design direction\n- Static hero with strong typography, no full screen video background',
    transcript: [
      { t0: 0, t1: 12, who: 'me', text: 'can we launch before the conference on the twelfth' },
      { t0: 13, t1: 20, who: 'them', text: 'if we freeze scope this week then yes around the ninth' },
    ],
  },
];

function makeKnowledge(polisher) {
  const store = { getHistory: () => history };
  const meetings = {
    list: () => meetingsData.map((m) => m.meta),
    read: (id) => meetingsData.find((m) => m.meta.id === id) || null,
  };
  return new Knowledge({ store, meetings, orgspace: null, polisher, log: (m) => {} });
}

async function main() {
  // Retrieval-only checks (no LLM needed).
  const kNoLLM = makeKnowledge(null);
  const built = kNoLLM.build();
  console.log('  indexed chunks:', built);

  const r1 = kNoLLM.search('what did we decide about enterprise pricing');
  assert.equal(r1[0].source, 'meeting');
  assert.ok(/pricing/i.test(r1[0].title), 'top hit should be the pricing meeting');
  console.log('  pricing query ->', r1[0].title, `(kind: ${r1[0].kind})`);

  const r2 = kNoLLM.search('when does the redesign launch');
  assert.ok(/redesign/i.test(r2[0].title), 'should find the redesign meeting');
  console.log('  launch query ->', r2[0].title);

  const r3 = kNoLLM.search('domain renewal');
  assert.equal(r3[0].source, 'dictation');
  console.log('  dictation query ->', r3[0].snippet.slice(0, 50));

  const p = new Polisher({ modelsDir: MODELS, log: () => {} });
  if (!p.available()) {
    console.log('  (LLM not installed — answer step skipped)');
    console.log('KNOWLEDGE_SMOKE_OK');
    process.exit(0);
  }

  const k = makeKnowledge(p);

  // Answerable question -> grounded, cited answer.
  const a1 = await k.ask('what did we decide about enterprise pricing?');
  console.log('  Q: enterprise pricing\n  A:', JSON.stringify((a1.answer || '(' + a1.reason + ')').slice(0, 160)));
  assert.ok(a1.answer, 'expected an answer, got ' + a1.reason);
  assert.ok(/q4|quarter|revisit|three tier|keep/i.test(a1.answer), 'answer should reflect the decision');
  assert.ok(/\[\d\]/.test(a1.answer), 'answer should cite a source');
  assert.ok(a1.sources.some((s) => s.cited), 'a source should be marked cited');
  assert.ok(!a1.answer.includes('—'), 'no em dashes');

  const a2 = await k.ask('when are we launching the website redesign?');
  console.log('  Q: redesign launch\n  A:', JSON.stringify((a2.answer || '(' + a2.reason + ')').slice(0, 160)));
  assert.ok(a2.answer && /june|9th|ninth/i.test(a2.answer), 'should recover the June 9 launch');

  // Unanswerable -> must refuse, not hallucinate.
  const a3 = await k.ask('what did we decide about the Berlin office opening?');
  console.log('  Q: Berlin office (unanswerable)\n  ->', a3.answer ? JSON.stringify(a3.answer.slice(0, 120)) : '(refused: ' + a3.reason + ')');
  const refused = !a3.answer || /not_found|couldn|no (?:mention|info|record)|does not|doesn't|not in/i.test(a3.answer);
  assert.ok(refused, 'should refuse the unanswerable question, got: ' + a3.answer);

  p.stop();
  console.log('KNOWLEDGE_SMOKE_OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('KNOWLEDGE_SMOKE_FAIL:', err.message);
  process.exit(1);
});
