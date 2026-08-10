const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OrgSpace } = require('../../electron/orgspace');
const { MeetingManager } = require('../../electron/meetings');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sotto-org-')); }

test('share, list, read, import round-trip', () => {
  const orgDir = tmp();
  const userA = tmp();
  const userB = tmp();
  const orgA = new OrgSpace({ getSettings: () => ({ orgDir }) });
  const orgB = new OrgSpace({ getSettings: () => ({ orgDir }) });

  const meetingData = {
    meta: { id: 'm1', title: 'Roadmap sync', startedAt: 1000, endedAt: 2000, template: 'auto', segments: 2 },
    notes: '- ship in june',
    enhanced: '## Roadmap\n- **Decision:** ship in June',
    annotated: [{ text: '- **Decision:** ship in June', origin: 'user', src: null }],
    transcript: [{ t0: 0, t1: 10, who: 'them', text: 'June works for the ship date.' }],
  };
  const r = orgA.share(meetingData, 'Hao');
  assert.ok(r.ok);
  assert.ok(fs.existsSync(path.join(orgDir, r.file.replace('.sottoshare.json', '.md'))), 'md sibling missing');

  const listed = orgB.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].author, 'Hao');
  assert.equal(listed[0].title, 'Roadmap sync');

  const meetingsB = new MeetingManager({ baseDir: userB, transcriber: {}, log: () => {} });
  const imp = orgB.import(listed[0].file, meetingsB);
  assert.ok(imp.ok);
  const data = meetingsB.read(imp.id);
  assert.equal(data.meta.appHint, 'Shared by Hao');
  assert.equal(data.transcript.length, 1);
  assert.ok(data.enhanced.includes('ship in June'));
  for (const d of [orgDir, userA, userB]) fs.rmSync(d, { recursive: true, force: true });
});

test('malformed and oversized shares are ignored', () => {
  const orgDir = tmp();
  fs.writeFileSync(path.join(orgDir, 'junk.sottoshare.json'), '{not json');
  fs.writeFileSync(path.join(orgDir, 'nometa.sottoshare.json'), '{"hello":1}');
  const org = new OrgSpace({ getSettings: () => ({ orgDir }) });
  assert.deepEqual(org.list(), []);
  assert.equal(org.read('../../../etc/passwd'), null);
  fs.rmSync(orgDir, { recursive: true, force: true });
});
