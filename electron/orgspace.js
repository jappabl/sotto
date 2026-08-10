// Org spaces: team sharing with no server and no accounts.
//
// An org is simply a folder every member has (an iCloud shared folder,
// Dropbox, Drive, a git repo — whatever the team already syncs with).
// Sharing a meeting writes `<title>-<id>.sottoshare.json` (structured, for
// Sotto) plus a plain `.md` sibling (readable by anyone) into that folder.
// Every member's Sotto watches the folder and shows the shared notes.

const fs = require('fs');
const path = require('path');

const MAX_SHARE_BYTES = 5 * 1024 * 1024;

class OrgSpace {
  constructor({ getSettings, log = () => {} }) {
    this.getSettings = getSettings;
    this.log = log;
    this.watcher = null;
    this.onChange = null; // wired to dashboard refresh
  }

  dir() {
    const d = this.getSettings().orgDir;
    return d && fs.existsSync(d) ? d : null;
  }

  status() {
    const d = this.dir();
    return {
      configured: !!d,
      dir: d,
      name: d ? path.basename(d) : null,
      members: d ? this._authors().length : 0,
    };
  }

  _authors() {
    const seen = new Set();
    for (const item of this.list()) if (item.author) seen.add(item.author);
    return [...seen];
  }

  watch() {
    this.unwatch();
    const d = this.dir();
    if (!d) return;
    try {
      let t = null;
      this.watcher = fs.watch(d, () => {
        clearTimeout(t);
        t = setTimeout(() => this.onChange && this.onChange(), 800);
      });
    } catch (err) {
      this.log('org watch failed: ' + err.message);
    }
  }

  unwatch() {
    if (this.watcher) {
      try { this.watcher.close(); } catch { /* fine */ }
      this.watcher = null;
    }
  }

  list() {
    const d = this.dir();
    if (!d) return [];
    let files = [];
    try { files = fs.readdirSync(d).filter((f) => f.endsWith('.sottoshare.json')); } catch { return []; }
    const items = [];
    for (const f of files) {
      try {
        const p = path.join(d, f);
        if (fs.statSync(p).size > MAX_SHARE_BYTES) continue;
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!j || typeof j !== 'object' || !j.meta) continue;
        items.push({
          file: f,
          author: String(j.author || 'Someone').slice(0, 60),
          sharedAt: Number(j.sharedAt) || 0,
          title: String(j.meta.title || 'Shared meeting').slice(0, 120),
          startedAt: Number(j.meta.startedAt) || 0,
          segments: Number(j.meta.segments) || 0,
        });
      } catch { /* skip malformed */ }
    }
    items.sort((a, b) => b.sharedAt - a.sharedAt);
    return items;
  }

  share(meetingData, authorName) {
    const d = this.dir();
    if (!d) return { ok: false, reason: 'no-org' };
    const { meta, notes, enhanced, annotated, transcript } = meetingData;
    const safeTitle = String(meta.title || 'meeting')
      .replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'meeting';
    const base = `${safeTitle}-${meta.id}`;
    const payload = {
      version: 1,
      author: String(authorName || 'Someone').slice(0, 60),
      sharedAt: Date.now(),
      meta: { id: meta.id, title: meta.title, startedAt: meta.startedAt, endedAt: meta.endedAt, template: meta.template, segments: meta.segments },
      notes,
      enhanced,
      annotated: annotated || null,
      transcript,
    };
    try {
      fs.writeFileSync(path.join(d, base + '.sottoshare.json'), JSON.stringify(payload));
      // Human-readable copy for teammates without Sotto.
      const md = [
        `# ${meta.title}`,
        `*Shared by ${payload.author} · ${new Date(meta.startedAt).toLocaleString()}*`,
        '',
        enhanced || notes || '(no notes)',
      ].join('\n');
      fs.writeFileSync(path.join(d, base + '.md'), md);
      return { ok: true, file: base + '.sottoshare.json' };
    } catch (err) {
      this.log('share failed: ' + err.message);
      return { ok: false, reason: err.message };
    }
  }

  read(file) {
    const d = this.dir();
    if (!d) return null;
    const name = path.basename(String(file));
    if (!name.endsWith('.sottoshare.json')) return null;
    try {
      const p = path.join(d, name);
      if (fs.statSync(p).size > MAX_SHARE_BYTES) return null;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!j || !j.meta) return null;
      // Sanitize shapes we render.
      return {
        author: String(j.author || 'Someone').slice(0, 60),
        sharedAt: Number(j.sharedAt) || 0,
        meta: j.meta,
        notes: String(j.notes || ''),
        enhanced: String(j.enhanced || ''),
        annotated: Array.isArray(j.annotated)
          ? j.annotated.slice(0, 2000).map((l) => ({
              text: String(l.text || ''),
              origin: l.origin === 'user' ? 'user' : 'ai',
              src: l.src && typeof l.src === 'object'
                ? { t0: Number(l.src.t0) || 0, t1: Number(l.src.t1) || 0 } : null,
            }))
          : null,
        transcript: Array.isArray(j.transcript)
          ? j.transcript.slice(0, 5000).map((s) => ({
              t0: Number(s.t0) || 0,
              t1: Number(s.t1) || 0,
              who: s.who === 'me' ? 'me' : 'them',
              text: String(s.text || '').slice(0, 2000),
            }))
          : [],
      };
    } catch {
      return null;
    }
  }

  // Copy a shared note into the local meetings library.
  import(file, meetings) {
    const shared = this.read(file);
    if (!shared) return { ok: false, reason: 'unreadable' };
    const id = 'imp' + Date.now().toString(36);
    const dir = path.join(meetings.baseDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      id,
      title: String(shared.meta.title || 'Shared meeting').slice(0, 120),
      startedAt: Number(shared.meta.startedAt) || Date.now(),
      endedAt: Number(shared.meta.endedAt) || Date.now(),
      state: shared.enhanced ? 'enhanced' : 'ended',
      template: 'auto',
      appHint: 'Shared by ' + shared.author,
      segments: shared.transcript.length,
      imported: true,
    }, null, 2));
    fs.writeFileSync(path.join(dir, 'notes.md'), shared.notes);
    if (shared.enhanced) fs.writeFileSync(path.join(dir, 'enhanced.md'), shared.enhanced);
    if (shared.annotated) fs.writeFileSync(path.join(dir, 'enhanced.json'), JSON.stringify(shared.annotated));
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'),
      shared.transcript.map((s) => JSON.stringify(s)).join('\n') + (shared.transcript.length ? '\n' : ''));
    return { ok: true, id };
  }
}

module.exports = { OrgSpace };
