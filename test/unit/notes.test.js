const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Notes } = require('../../electron/notes');
const { droppedNames } = require('../../electron/enhancer');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sotto-notes-')); }

test('brain dump note lifecycle', () => {
  const dir = tmp();
  const n = new Notes({ baseDir: dir });
  const meta = n.create({ raw: 'this is a spoken thought about the launch plan', durMs: 5000 });
  assert.ok(meta.id);
  assert.equal(meta.state, 'raw');
  assert.equal(meta.words, 9);
  assert.ok(meta.title.length > 0, 'gets a provisional title');

  n.saveOrganized(meta.id, '## Launch\n- ship it');
  const read = n.read(meta.id);
  assert.equal(read.meta.state, 'organized');
  assert.ok(read.note.includes('ship it'));
  assert.ok(read.raw.includes('spoken thought'));

  assert.equal(n.list().length, 1);
  n.remove(meta.id);
  assert.equal(n.list().length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dropped names are detected for restoration', () => {
  const source = 'I should ask Marcus about analytics. Also email Sarah today.';
  const note = '## Tasks\n- Email Sarah about the thing';
  const dropped = droppedNames(source, note);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].name, 'Marcus');
  assert.ok(dropped[0].sentence.includes('analytics'));
});

test('names already present are not duplicated, sentence starts ignored', () => {
  const source = 'Marcus said the build is fine. Everything looks good.';
  const note = '## Notes\n- Marcus says the build is fine';
  assert.deepEqual(droppedNames(source, note), []);
});
