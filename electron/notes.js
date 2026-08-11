// Brain-dump notes: talk to yourself, get organized notes back.
//
// Same mechanic as meetings, minus the meeting: hold the hotkey (or click
// Start in Notes), ramble for as long as you want, and the raw transcript is
// organized into headings, action items, and open questions by the local
// model. Stored as plain files so the knowledge layer can index them.
//
//   notes/<id>/meta.json   {id, title, createdAt, durMs, state}
//   notes/<id>/raw.md      the verbatim transcript
//   notes/<id>/note.md     the organized version

const fs = require('fs');
const path = require('path');

class Notes {
  constructor({ baseDir, log = () => {} }) {
    this.dir = path.join(baseDir, 'notes');
    fs.mkdirSync(this.dir, { recursive: true });
    this.log = log;
  }

  list() {
    let ids = [];
    try { ids = fs.readdirSync(this.dir); } catch { return []; }
    const out = [];
    for (const id of ids) {
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(this.dir, id, 'meta.json'), 'utf8')));
      } catch { /* skip */ }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  read(id) {
    const d = path.join(this.dir, sanitize(id));
    try {
      return {
        meta: JSON.parse(fs.readFileSync(path.join(d, 'meta.json'), 'utf8')),
        raw: readOr(path.join(d, 'raw.md'), ''),
        note: readOr(path.join(d, 'note.md'), ''),
      };
    } catch { return null; }
  }

  create({ raw, durMs = 0, title = '' }) {
    const id = 'n' + Date.now().toString(36);
    const d = path.join(this.dir, id);
    fs.mkdirSync(d, { recursive: true });
    const meta = {
      id,
      title: title || defaultTitle(raw),
      createdAt: Date.now(),
      durMs,
      words: String(raw || '').split(/\s+/).filter(Boolean).length,
      state: 'raw',
    };
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(d, 'raw.md'), String(raw || ''));
    return meta;
  }

  saveOrganized(id, note) {
    const d = path.join(this.dir, sanitize(id));
    if (!fs.existsSync(d)) return false;
    fs.writeFileSync(path.join(d, 'note.md'), String(note || ''));
    this.updateMeta(id, { state: 'organized' });
    return true;
  }

  updateMeta(id, patch) {
    const p = path.join(this.dir, sanitize(id), 'meta.json');
    try {
      const meta = { ...JSON.parse(fs.readFileSync(p, 'utf8')), ...patch };
      fs.writeFileSync(p, JSON.stringify(meta, null, 2));
      return meta;
    } catch { return null; }
  }

  remove(id) {
    fs.rmSync(path.join(this.dir, sanitize(id)), { recursive: true, force: true });
    return true;
  }
}

function sanitize(id) { return String(id).replace(/[^a-zA-Z0-9_-]/g, ''); }
function readOr(p, f) { try { return fs.readFileSync(p, 'utf8'); } catch { return f; } }

// A first-glance title from the opening words, until the model names it.
function defaultTitle(raw) {
  const words = String(raw || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ');
  return words ? words.replace(/[.,;:]$/, '') : 'Brain dump';
}

module.exports = { Notes };
