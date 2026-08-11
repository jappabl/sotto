// The knowledge layer: "ask everything" across dictations, meetings, and
// shared org notes. Gathers a chunked corpus, indexes it with BM25, and
// answers questions grounded on the retrieved chunks via the local LLM.

const { BM25 } = require('./bm25');

const CHUNK_WORDS = 180;       // target words per transcript chunk
const CHUNK_OVERLAP_WORDS = 30;

class Knowledge {
  constructor({ store, meetings, orgspace, polisher, log = () => {} }) {
    this.store = store;
    this.meetings = meetings;
    this.orgspace = orgspace;
    this.polisher = polisher;
    this.log = log;
    this.index = null;
    this.chunks = new Map();   // id -> chunk
    this.builtAt = 0;
    this.dirty = true;
  }

  markDirty() {
    this.dirty = true;
  }

  // ---- corpus assembly ----

  _gather() {
    const chunks = [];
    const push = (c) => { if (c.text && c.text.trim().length > 3) chunks.push(c); };

    // Dictations: one chunk each (they're short).
    for (const h of this.store.getHistory({ limit: 5000 })) {
      if (h.cancelled || !h.text) continue;
      push({
        id: 'dict:' + h.id,
        source: 'dictation',
        refId: h.id,
        title: h.app ? `Dictation in ${h.app}` : 'Dictation',
        ts: h.ts,
        text: h.text,
      });
    }

    // Meetings: enhanced notes (by section), user notes, transcript windows.
    for (const meta of this.meetings.list()) {
      const data = this.meetings.read(meta.id);
      if (!data) continue;
      const title = data.meta.title || 'Meeting';
      if (data.enhanced) {
        for (const [i, sec] of sectionsOf(data.enhanced).entries()) {
          push({
            id: `meet:${meta.id}:enh:${i}`,
            source: 'meeting',
            refId: meta.id,
            title,
            ts: data.meta.startedAt,
            text: sec,
            kind: 'notes',
          });
        }
      }
      if (data.notes && data.notes.trim()) {
        push({
          id: `meet:${meta.id}:notes`,
          source: 'meeting',
          refId: meta.id,
          title,
          ts: data.meta.startedAt,
          text: data.notes,
          kind: 'my-notes',
        });
      }
      for (const [i, win] of transcriptWindows(data.transcript).entries()) {
        push({
          id: `meet:${meta.id}:tx:${i}`,
          source: 'meeting',
          refId: meta.id,
          title,
          ts: data.meta.startedAt,
          text: win.text,
          t0: win.t0,
          kind: 'transcript',
        });
      }
    }

    // Shared org notes.
    if (this.orgspace && this.orgspace.status().configured) {
      for (const s of this.orgspace.list()) {
        const shared = this.orgspace.read(s.file);
        if (!shared) continue;
        const body = shared.enhanced || shared.notes;
        if (!body) continue;
        for (const [i, sec] of sectionsOf(body).entries()) {
          push({
            id: `share:${s.file}:${i}`,
            source: 'shared',
            refId: s.file,
            title: `${shared.meta.title || 'Shared note'} (by ${shared.author})`,
            ts: shared.meta.startedAt || s.sharedAt,
            text: sec,
          });
        }
      }
    }

    return chunks;
  }

  build() {
    const chunks = this._gather();
    const bm = new BM25();
    this.chunks = new Map();
    for (const c of chunks) {
      // Deterministic contextual header baked into the indexed text — a free
      // version of contextual retrieval that lifts recall a lot.
      c.header = `${c.title} · ${new Date(c.ts).toLocaleDateString()}${c.kind ? ' · ' + c.kind : ''}`;
      this.chunks.set(c.id, c);
      bm.add(c.id, `${c.header}\n${c.text}`, { title: c.title, source: c.source });
    }
    bm.build();
    this.index = bm;
    this.builtAt = Date.now();
    this.dirty = false;
    this.log(`knowledge index built: ${chunks.length} chunks`);
    return chunks.length;
  }

  _ensure() {
    if (this.dirty || !this.index) this.build();
  }

  stats() {
    this._ensure();
    const bySource = {};
    for (const c of this.chunks.values()) bySource[c.source] = (bySource[c.source] || 0) + 1;
    return { chunks: this.chunks.size, bySource, builtAt: this.builtAt };
  }

  // ---- retrieval ----

  // Source-type prior: decisions/answers live in enhanced notes and the
  // user's own notes, not raw transcript filler.
  static SOURCE_PRIOR = { meeting: 1.0, dictation: 1.0, shared: 1.05 };
  static KIND_PRIOR = { notes: 1.5, 'my-notes': 1.3, transcript: 1.0 };

  search(query, { limit = 8 } = {}) {
    this._ensure();
    if (!this.index) return [];
    const now = Date.now();
    // Pull a wider candidate set, then re-rank with recency + source priors.
    const raw = this.index.search(query, { limit: Math.max(limit * 3, 24) });
    const ranked = raw.map((r) => {
      const c = this.chunks.get(r.id);
      const ageDays = (now - (c.ts || now)) / 86400000;
      const recency = Math.max(0.7, 1 / (1 + ageDays / 180)); // gentle recent-first tiebreak
      const sourceP = Knowledge.SOURCE_PRIOR[c.source] || 1;
      const kindP = Knowledge.KIND_PRIOR[c.kind] || 1;
      return { r, c, adj: r.score * recency * sourceP * kindP };
    }).sort((a, b) => b.adj - a.adj).slice(0, limit);

    return ranked.map(({ r, c, adj }) => ({
      id: r.id,
      score: Math.round(adj * 1000) / 1000,
      bm25: r.score,
      source: c.source,
      refId: c.refId,
      title: c.title,
      ts: c.ts,
      kind: c.kind,
      t0: c.t0,
      snippet: snippet(c.text, query),
      text: c.text,
    }));
  }

  // ---- grounded answer ----

  async ask(query, { onRetrieved = () => {} } = {}) {
    this._ensure();
    const hits = this.search(query, { limit: 8 });
    onRetrieved(hits);
    if (!hits.length) {
      return { answer: null, reason: 'no-results', sources: [] };
    }
    // Retrieval score floor: if even the best match is weak, don't let the 3B
    // answer from world knowledge — show the near-misses instead.
    if ((hits[0].bm25 || 0) < 1.2) {
      return { answer: null, reason: 'weak-match', sources: hits.slice(0, 5) };
    }
    if (!this.polisher || !this.polisher.available()) {
      return { answer: null, reason: 'llm-unavailable', sources: hits };
    }
    // Keep the 5 strongest, and order them best-first but drop the 2nd-best to
    // the end (small models lose the middle of the context).
    const top = hits.slice(0, 5);
    const ordered = top.length > 2 ? [top[0], ...top.slice(2), top[1]] : top;
    const excerpts = ordered.map((h) => {
      const n = top.indexOf(h) + 1; // stable citation number = rank
      const when = new Date(h.ts).toLocaleDateString();
      return `[${n}] ${h.title} (${when}, ${h.source})\n${clip(h.text, 600)}`;
    }).join('\n\n');
    const today = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const user = `Today is ${today}.\n\nExcerpts from my notes:\n\n${excerpts}\n\nQuestion: ${query}`;
    try {
      if (!(await this.polisher.ensureServer().catch(() => false))) {
        return { answer: null, reason: 'llm-unavailable', sources: top };
      }
      const answer = await this.polisher._chat(
        [{ role: 'system', content: ASK_SYSTEM }, { role: 'user', content: user }],
        { maxTokens: 700, timeoutMs: 60000 },
      );
      const clean = String(answer || '').trim();
      if (!clean) return { answer: null, reason: 'empty', sources: top };
      if (/^NOT_FOUND\b/i.test(clean) || /\bnot (?:in|contained|found)\b/i.test(clean) && clean.length < 90) {
        return { answer: null, reason: 'not-in-notes', sources: top };
      }
      const cited = new Set((clean.match(/\[(\d+)\]/g) || []).map((m) => parseInt(m.slice(1), 10) - 1));
      const sources = top.map((h, i) => ({ ...h, cited: cited.has(i) }));
      // Cheap groundedness flag: did the answer reuse words from a cited chunk?
      const grounded = checkGrounded(clean, top);
      return { answer: clean, sources, grounded };
    } catch (err) {
      this.log('ask failed: ' + err.message);
      return { answer: null, reason: err.message, sources: top };
    }
  }
}

// Coarse groundedness: fraction of the answer's content words that appear in
// the cited chunks. Low = the model likely drifted off-source.
function checkGrounded(answer, sources) {
  const { tokenize } = require('./bm25');
  const answerWords = new Set(tokenize(answer.replace(/\[\d+\]/g, '')));
  if (answerWords.size === 0) return 1;
  const corpus = new Set(tokenize(sources.map((s) => s.text).join(' ')));
  let hit = 0;
  for (const w of answerWords) if (corpus.has(w)) hit++;
  return Math.round((hit / answerWords.size) * 100) / 100;
}

const ASK_SYSTEM = `You answer questions using ONLY the numbered excerpts from the user's own notes.
- Use only facts stated in the excerpts. Never use outside knowledge, never invent details.
- End every factual claim with the bracketed number of the excerpt that supports it, like [1] or [2].
- If the excerpts do not contain the answer, reply with exactly: NOT_FOUND
- Prefer the source's own wording. For questions spanning several notes, answer as a short bullet list, one source per bullet.
- Be brief and direct. No preamble, no "based on the excerpts", no em dashes.

Example excerpt: [1] Pricing sync (Aug 4, meeting)\nWe agreed to keep the current tiers and revisit in Q4.
Example question: what did we decide on pricing?
Example answer: Keep the current pricing tiers, revisiting in Q4 [1].`;

// ---- helpers ----

function sectionsOf(md) {
  // Split enhanced notes into section-sized chunks at markdown headings.
  const out = [];
  let cur = [];
  for (const line of String(md).split('\n')) {
    if (/^#{1,3}\s/.test(line) && cur.join('').trim()) {
      out.push(cur.join('\n').trim());
      cur = [];
    }
    cur.push(line);
  }
  if (cur.join('').trim()) out.push(cur.join('\n').trim());
  // Merge only heading-only fragments (a heading with no body beneath it)
  // into the following section, so real sections stay separate.
  const merged = [];
  for (const s of out) {
    const bodyLines = s.split('\n').filter((l) => l.trim() && !/^#{1,3}\s/.test(l));
    if (merged.length && bodyLines.length === 0) merged[merged.length - 1] += '\n' + s;
    else merged.push(s);
  }
  return merged.length ? merged : [String(md).trim()];
}

function transcriptWindows(segments) {
  if (!segments || !segments.length) return [];
  const windows = [];
  let cur = [];
  let words = 0;
  let t0 = segments[0].t0;
  for (const seg of segments) {
    const line = `${seg.who === 'me' ? 'Me' : 'Them'}: ${seg.text}`;
    cur.push(line);
    words += seg.text.split(/\s+/).length;
    if (words >= CHUNK_WORDS) {
      windows.push({ text: cur.join('\n'), t0 });
      // Overlap: carry the last line into the next window for continuity.
      const carry = cur.slice(-1);
      cur = carry;
      words = carry.join(' ').split(/\s+/).length;
      t0 = seg.t0;
    }
  }
  if (cur.length) windows.push({ text: cur.join('\n'), t0 });
  return windows;
}

function snippet(text, query, len = 220) {
  const { tokenize } = require('./bm25');
  const qset = new Set(tokenize(query));
  const words = String(text).split(/\s+/);
  // Find the first window whose center word matches a query term.
  let best = 0;
  for (let i = 0; i < words.length; i++) {
    if (qset.has((words[i].toLowerCase().match(/[a-z0-9]+/) || [''])[0])) { best = i; break; }
  }
  const start = Math.max(0, best - 12);
  const out = words.slice(start, start + 40).join(' ');
  return (start > 0 ? '… ' : '') + clip(out, len) + (words.length > start + 40 ? ' …' : '');
}

function clip(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

module.exports = { Knowledge, sectionsOf, transcriptWindows };
