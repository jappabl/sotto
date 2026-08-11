const { test } = require('node:test');
const assert = require('node:assert');
const { Briefer, stripHtml, decodeEntities, GENERIC_DOMAINS } = require('../../electron/briefer');

function makeBriefer(hits = []) {
  const knowledge = { search: () => hits };
  return new Briefer({ knowledge, polisher: null, calendar: null, baseDir: null,
    getSettings: () => ({ webRecon: false }), log: () => {} });
}

test('company domains skip personal email providers', () => {
  const b = makeBriefer();
  const domains = b.companyDomains({ attendees: [
    { email: 'sam@gmail.com' }, { email: 'kai@acme.io' }, { email: 'x@icloud.com' },
  ] });
  assert.deepEqual(domains, ['acme.io']);
  assert.ok(GENERIC_DOMAINS.has('gmail.com'));
});

test('local recon searches the title and each attendee', () => {
  const queries = [];
  const knowledge = { search: (q) => { queries.push(q); return []; } };
  const b = new Briefer({ knowledge, polisher: null, baseDir: null, getSettings: () => ({}), log: () => {} });
  b.localRecon({ title: 'Pricing sync', attendees: [{ name: 'Sarah Chen', email: 'sarah.chen@acme.io' }] });
  assert.ok(queries.includes('Pricing sync'));
  assert.ok(queries.includes('Sarah Chen'));
  assert.ok(queries.some((q) => q.includes('sarah')));
});

test('weak matches are filtered out of recon', () => {
  const b = makeBriefer([
    { id: 'a', score: 2.4, title: 'Pricing sync', text: 'we agreed on tiers', ts: Date.now() },
    { id: 'b', score: 0.2, title: 'Unrelated', text: 'noise', ts: Date.now() },
  ]);
  const hits = b.localRecon({ title: 'Pricing', attendees: [] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'a');
});

test('brief without notes or web is marked empty, never fabricated', async () => {
  const b = makeBriefer([]);
  const brief = await b.build({ id: 'e1', title: 'Random sync', startMs: Date.now(), attendees: [] });
  assert.equal(brief.empty, true);
  assert.equal(brief.text, '');
});

test('brief falls back to raw matches when no model is available', async () => {
  const now = Date.now();
  const b = makeBriefer([
    { id: 'a', score: 3, title: 'Pricing sync', text: 'keep the tiers', snippet: 'keep the tiers', ts: now, source: 'meeting', refId: 'm1' },
  ]);
  const brief = await b.build({ id: 'e2', title: 'Pricing', startMs: now, attendees: [] });
  assert.equal(brief.empty, false);
  assert.ok(brief.text.includes('Pricing sync'));
  assert.equal(brief.sources.length, 1);
});

test('html helpers', () => {
  assert.equal(stripHtml('<p>Hello <b>world</b></p><script>bad()</script>'), 'Hello world');
  assert.equal(decodeEntities('A &amp; B &quot;C&quot;'), 'A & B "C"');
});

test('brief preamble echoes are stripped', () => {
  const { tidyBrief } = require('../../electron/briefer');
  const out = tidyBrief('Meeting: Acme follow-up\nWith: Sarah Chen\n\n## Open commitments\n- Send the comparison');
  assert.ok(out.startsWith('## Open commitments'), 'got: ' + out);
  assert.ok(!out.includes('With: Sarah'));
  assert.equal(tidyBrief('## Where you left off\n- thing'), '## Where you left off\n- thing');
});
