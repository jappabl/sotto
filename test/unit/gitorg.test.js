const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { GitOrg, normalizeRepoRef } = require('../../electron/gitorg');

test('repo ref normalization accepts the friendly forms', () => {
  for (const ref of ['jappabl/team-notes', 'github.com/jappabl/team-notes',
    'https://github.com/jappabl/team-notes', 'https://github.com/jappabl/team-notes.git',
    'https://www.github.com/jappabl/team-notes/']) {
    const n = normalizeRepoRef(ref);
    assert.ok(n, 'rejected: ' + ref);
    assert.equal(n.slug, 'jappabl/team-notes');
    assert.equal(n.url, 'https://github.com/jappabl/team-notes.git');
  }
});

test('repo ref normalization rejects everything else', () => {
  for (const ref of ['', 'not a repo', 'https://evil.com/a/b', 'git@github.com:a/b;rm -rf /',
    '../../../etc', 'a/b/c', 'https://github.com/onlyowner']) {
    assert.equal(normalizeRepoRef(ref), null, 'accepted: ' + ref);
  }
});

test('sync round-trips notes between two members via a bare repo', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sotto-git-'));
  const bare = path.join(root, 'remote.git');
  const a = path.join(root, 'memberA');
  const b = path.join(root, 'memberB');
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(['init', '--bare', '-q', bare], root);
  git(['clone', '-q', bare, a], root);
  git(['clone', '-q', bare, b], root);
  for (const d of [a, b]) {
    git(['config', 'user.email', 'test@example.com'], d);
    git(['config', 'user.name', 'Test'], d);
  }
  // Seed an initial commit so upstream tracking exists.
  fs.writeFileSync(path.join(a, 'README.md'), 'org');
  git(['add', '-A'], a); git(['commit', '-q', '-m', 'init'], a); git(['push', '-q', '-u', 'origin', 'HEAD'], a);
  git(['pull', '-q'], b);

  const orgA = new GitOrg({ baseDir: root, getSettings: () => ({ orgDir: a }), setSettings: () => {}, log: () => {} });
  const orgB = new GitOrg({ baseDir: root, getSettings: () => ({ orgDir: b }), setSettings: () => {}, log: () => {} });

  fs.writeFileSync(path.join(a, 'meeting-x.sottoshare.json'), JSON.stringify({ meta: { title: 'X' }, author: 'A', sharedAt: 1 }));
  const r1 = await orgA.sync('test');
  assert.ok(r1.ok, 'A sync failed: ' + r1.reason);
  const r2 = await orgB.sync('test');
  assert.ok(r2.ok, 'B sync failed: ' + r2.reason);
  assert.ok(fs.existsSync(path.join(b, 'meeting-x.sottoshare.json')), 'note did not reach member B');
  fs.rmSync(root, { recursive: true, force: true });
});
