const { test } = require('node:test');
const assert = require('node:assert');
const { annotate, mapSources, isEcho } = require('../../electron/provenance');

test('user lines get user origin, ai additions gray', () => {
  const notes = '- budget 12k approved\n- maya owns hero design';
  const enhanced = '## Budget\n- Budget of 12k was approved by finance\n- The launch lands June 9th\n## Design\n- Maya owns the hero design';
  const { lines, appended } = annotate(enhanced, notes);
  const byText = (frag) => lines.find((l) => l.text.includes(frag));
  assert.equal(byText('12k was approved').origin, 'user');
  assert.equal(byText('June 9th').origin, 'ai');
  assert.equal(byText('hero design').origin, 'user');
  assert.deepEqual(appended, []);
});

test('dropped user lines are re-appended verbatim', () => {
  const notes = '- competitor uses video bg, we wont';
  const enhanced = '## Summary\n- The meeting covered timelines only';
  const { lines, appended } = annotate(enhanced, notes);
  assert.equal(appended.length, 1);
  const last = lines[lines.length - 1];
  assert.equal(last.origin, 'user');
  assert.ok(last.text.includes('competitor uses video bg'));
});

test('mapSources links ai lines to transcript moments', () => {
  const lines = [
    { text: '- The launch lands around June 9th if scope freezes', origin: 'ai' },
    { text: '- budget 12k approved', origin: 'user' },
  ];
  const segs = [
    { t0: 26, t1: 44, who: 'them', text: 'If we freeze scope this week the launch lands around June 9th.' },
    { t0: 58, t1: 74, who: 'me', text: 'Finance approved the budget.' },
  ];
  const refs = mapSources(lines, segs);
  assert.ok(refs[0] && refs[0].t0 === 26, 'ai line should map to the June segment');
  assert.equal(refs[1], null, 'user lines get no magnifier');
});

test('echo suppression drops the mic copy of speaker bleed', () => {
  const recent = [{ t0: 10, t1: 40, who: 'them', text: 'The quarterly numbers look strong and the team should be proud' }];
  const echo = { t0: 12, t1: 41, who: 'me', text: 'the quarterly numbers look strong and the team should be proud' };
  assert.equal(isEcho(echo, recent), true);
  const real = { t0: 42, t1: 60, who: 'me', text: 'Thanks, I want to talk about the roadmap next quarter instead' };
  assert.equal(isEcho(real, recent), false);
});
