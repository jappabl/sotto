// GitHub-backed org spaces with zero git knowledge required.
//
//   Create: `gh repo create <name> --private` + clone into userData/orgs/,
//           point the org space at the clone. Done.
//   Join:   paste "owner/repo" (or a github.com URL) → clone → done.
//   Sync:   pull --rebase + push, automatically: at launch, after every
//           share, and on a timer. Nobody runs git by hand.
//
// Membership and auth stay GitHub's problem (repo collaborators), which is
// exactly where they belong: no Sotto accounts, no Sotto server.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).slice(0, 300)));
      else resolve(String(stdout));
    });
  });
}

// "owner/repo", "github.com/owner/repo", full https URLs (with or without
// .git) all normalize to a safe https clone URL. Anything else is rejected.
function normalizeRepoRef(ref) {
  const s = String(ref || '').trim()
    .replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/^github\.com[:/]/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}.git`, slug: `${m[1]}/${m[2]}` };
}

class GitOrg {
  constructor({ baseDir, getSettings, setSettings, log = () => {} }) {
    this.orgsDir = path.join(baseDir, 'orgs');
    fs.mkdirSync(this.orgsDir, { recursive: true });
    this.getSettings = getSettings;
    this.setSettings = setSettings;
    this.log = log;
    this.syncing = false;
    this.onSynced = null;
  }

  async capability() {
    const out = { git: false, gh: false, login: null };
    try { await run('git', ['--version']); out.git = true; } catch { /* none */ }
    try {
      const user = JSON.parse(await run('gh', ['api', 'user']));
      out.gh = true;
      out.login = user.login;
      this._ghUser = user;
    } catch { /* not authed */ }
    return out;
  }

  _isGitOrg() {
    const d = this.getSettings().orgDir;
    return d && fs.existsSync(path.join(d, '.git')) ? d : null;
  }

  async _configureIdentity(dir) {
    // Commit as the member's own GitHub identity (noreply email) so org
    // history attributes correctly for everyone.
    try {
      const user = this._ghUser || JSON.parse(await run('gh', ['api', 'user']));
      await run('git', ['config', 'user.name', user.login], { cwd: dir });
      await run('git', ['config', 'user.email', `${user.id}+${user.login}@users.noreply.github.com`], { cwd: dir });
    } catch { /* fall back to the machine's git config */ }
  }

  async create(name) {
    const safe = String(name || '').trim().replace(/[^A-Za-z0-9._ -]/g, '').replace(/\s+/g, '-').slice(0, 60);
    if (!safe) throw new Error('Give the org a name');
    const dest = path.join(this.orgsDir, safe);
    if (fs.existsSync(dest)) throw new Error('An org with that name already exists here');
    await run('gh', ['repo', 'create', safe, '--private', '--clone'], { cwd: this.orgsDir, timeout: 120000 });
    await this._configureIdentity(dest);
    // Seed a readme so teammates know what the repo is.
    const readme = path.join(dest, 'README.md');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, `# ${safe}\n\nShared meeting notes, synced by [Sotto](https://github.com/jappabl/sotto).\n\nTo join: install Sotto, then Settings > General > Org space > Join from GitHub, and paste \`OWNER/${safe}\`.\n`);
      await run('git', ['add', '-A'], { cwd: dest });
      await run('git', ['commit', '-m', 'Set up org space'], { cwd: dest }).catch(() => {});
      await run('git', ['push', '-u', 'origin', 'HEAD'], { cwd: dest, timeout: 120000 }).catch(() => {});
    }
    this.setSettings({ orgDir: dest });
    return { dir: dest, name: safe };
  }

  async join(ref) {
    const norm = normalizeRepoRef(ref);
    if (!norm) throw new Error('Use the form owner/repo (or a github.com link)');
    const dest = path.join(this.orgsDir, norm.repo);
    if (!fs.existsSync(dest)) {
      // Prefer gh (uses the user's auth for private repos); fall back to git.
      try {
        await run('gh', ['repo', 'clone', norm.slug, dest], { timeout: 180000 });
      } catch {
        await run('git', ['clone', norm.url, dest], { timeout: 180000 });
      }
      await this._configureIdentity(dest);
    }
    this.setSettings({ orgDir: dest });
    return { dir: dest, name: norm.repo };
  }

  // Pull teammates' notes, push ours. Serialized; quiet on no-op.
  async sync(reason = 'timer') {
    const dir = this._isGitOrg();
    if (!dir || this.syncing) return { ok: false, reason: dir ? 'busy' : 'not-git' };
    this.syncing = true;
    try {
      await run('git', ['pull', '--rebase', '--autostash', '--quiet'], { cwd: dir, timeout: 120000 })
        .catch((e) => this.log('org pull: ' + e.message));
      const status = await run('git', ['status', '--porcelain'], { cwd: dir });
      if (status.trim()) {
        await run('git', ['add', '-A'], { cwd: dir });
        await run('git', ['commit', '-q', '-m', 'Shared notes update'], { cwd: dir });
      }
      const ahead = await run('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd: dir }).catch(() => '0');
      if (parseInt(ahead, 10) > 0) {
        await run('git', ['push', '--quiet'], { cwd: dir, timeout: 120000 });
      }
      this.log(`org synced (${reason})`);
      if (this.onSynced) this.onSynced();
      return { ok: true };
    } catch (err) {
      this.log('org sync failed: ' + err.message);
      return { ok: false, reason: err.message };
    } finally {
      this.syncing = false;
    }
  }

  inviteUrl() {
    const dir = this._isGitOrg();
    if (!dir) return null;
    return run('git', ['remote', 'get-url', 'origin'], { cwd: dir })
      .then((u) => {
        const norm = normalizeRepoRef(u.trim());
        return norm ? { settings: `https://github.com/${norm.slug}/settings/access`, slug: norm.slug } : null;
      })
      .catch(() => null);
  }
}

module.exports = { GitOrg, normalizeRepoRef };
