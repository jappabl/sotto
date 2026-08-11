// The knowledge layer: "ask everything" across dictations, meetings, and
// shared org notes. Gathers a chunked corpus, indexes it with BM25, and
// answers questions grounded on the retrieved chunks via the local LLM.

const fs = require('fs');
const path = require('path');
const { BM25, reciprocalRankFusion } = require('./bm25');

const CHUNK_WORDS = 180;       // target words per transcript chunk

class Knowledge {
  constructor({ store, meetings, orgspace, polisher, embedder = null, baseDir = null, log = () => {} }) {
    this.store = store;
    this.meetings = meetings;
    this.orgspace = orgspace;
    this.polisher = polisher;
    this.embedder = embedder;
    this.log = log;
    this.index = null;
    this.chunks = new Map();   // id -> chunk
    this.vectors = new Map();  // id -> { hash, vec: Float32Array }
    this.vecPath = baseDir ? path.join(baseDir, 'knowledge-vectors.json') : null;
    this.builtAt = 0;
    this.dirty = true;
    this._vecReady = false;
    this._loadVecCache();
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
    if (this.dirty || !this.index) { this.build(); this._vecReady = false; }
  }

  // ---- vector cache (semantic search) ----

  _loadVecCache() {
    if (!this.vecPath) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.vecPath, 'utf8'));
      for (const [id, entry] of Object.entries(raw)) {
        this.vectors.set(id, { hash: entry.h, vec: Float32Array.from(entry.v) });
      }
      this.log(`loaded ${this.vectors.size} cached embeddings`);
    } catch { /* none yet */ }
  }

  _saveVecCache() {
    if (!this.vecPath) return;
    const out = {};
    for (const [id, e] of this.vectors) out[id] = { h: e.hash, v: Array.from(e.vec) };
    try {
      const tmp = this.vecPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, this.vecPath);
    } catch (err) { this.log('vec cache save failed: ' + err.message); }
  }

  // Embed any chunks whose text changed or is uncached. Batched. Prunes
  // vectors for chunks that no longer exist.
  async ensureVectors() {
    if (!this.embedder || !this.embedder.available()) return false;
    this._ensure();
    const toEmbed = [];
    for (const [id, c] of this.chunks) {
      const h = hashText(c.header + c.text);
      const cached = this.vectors.get(id);
      if (!cached || cached.hash !== h) toEmbed.push({ id, hash: h, text: `${c.header}\n${c.text}` });
    }
    // Drop stale vectors.
    for (const id of [...this.vectors.keys()]) if (!this.chunks.has(id)) this.vectors.delete(id);

    if (toEmbed.length) {
      this.log(`embedding ${toEmbed.length} chunks…`);
      const BATCH = 32;
      for (let i = 0; i < toEmbed.length; i += BATCH) {
        const slice = toEmbed.slice(i, i + BATCH);
        const vecs = await this.embedder.embed(slice.map((s) => s.text), 'document');
        if (!vecs) return false;
        slice.forEach((s, j) => this.vectors.set(s.id, { hash: s.hash, vec: vecs[j] }));
      }
      this._saveVecCache();
    }
    this._vecReady = true;
    return true;
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

  // Hybrid retrieval: fuse BM25 with semantic (embedding) results via RRF,
  // then apply recency/source/kind priors. Falls back to BM25-only when the
  // embedder or its model isn't available. Async because embedding is.
  async retrieve(query, { limit = 8 } = {}) {
    this._ensure();
    if (!this.index) return { hits: [], mode: 'none' };

    const bmList = this.index.search(query, { limit: 50 });
    let vecList = null;
    if (this.embedder && this.embedder.available()) {
      try {
        if (!this._vecReady) await this.ensureVectors();
        const { dot } = require('./embedder');
        const qv = await this.embedder.embedOne(query, 'query');
        if (qv) {
          vecList = [...this.vectors.entries()]
            .filter(([id]) => this.chunks.has(id))
            .map(([id, e]) => ({ id, sim: dot(qv, e.vec) }))
            .sort((a, b) => b.sim - a.sim)
            .slice(0, 50);
        }
      } catch (err) { this.log('semantic retrieval failed: ' + err.message); }
    }

    let fusedIds;
    if (vecList) {
      const fused = reciprocalRankFusion([bmList, vecList], { k: 60 });
      fusedIds = [...fused.entries()].map(([id, rrf]) => ({ id, rrf }));
    } else {
      // BM25-only: synthesize a comparable score from rank.
      fusedIds = bmList.map((r, i) => ({ id: r.id, rrf: 1 / (60 + i + 1) }));
    }

    const now = Date.now();
    const bmScore = new Map(bmList.map((r) => [r.id, r.score]));
    const ranked = fusedIds.map(({ id, rrf }) => {
      const c = this.chunks.get(id);
      if (!c) return null;
      const ageDays = (now - (c.ts || now)) / 86400000;
      const recency = Math.max(0.7, 1 / (1 + ageDays / 180));
      const sourceP = Knowledge.SOURCE_PRIOR[c.source] || 1;
      const kindP = Knowledge.KIND_PRIOR[c.kind] || 1;
      return { c, id, adj: rrf * recency * sourceP * kindP, bm25: bmScore.get(id) || 0 };
    }).filter(Boolean).sort((a, b) => b.adj - a.adj).slice(0, limit);

    return {
      mode: vecList ? 'hybrid' : 'bm25',
      hits: ranked.map(({ c, id, adj, bm25 }) => ({
        id, score: Math.round(adj * 1e5) / 1e5, bm25,
        source: c.source, refId: c.refId, title: c.title, ts: c.ts, kind: c.kind, t0: c.t0,
        snippet: snippet(c.text, query), text: c.text,
      })),
    };
  }

  // ---- grounded answer ----

  async ask(query, { onRetrieved = () => {} } = {}) {
    this._ensure();
    const { hits, mode } = await this.retrieve(query, { limit: 8 });
    onRetrieved(hits);
    if (!hits.length) {
      return { answer: null, reason: 'no-results', sources: [] };
    }
    // Retrieval score floor: if even the best match is weak, don't let the 3B
    // answer from world knowledge — show the near-misses instead. In hybrid
    // mode a strong semantic match can carry bm25=0, so only gate on BM25 when
    // that's the only signal we have.
    if (mode === 'bm25' && (hits[0].bm25 || 0) < 1.2) {
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
      // Per-sentence groundedness: check each claim against the source(s) it
      // cites (falling back to all sources), so an unsupported line is flagged
      // rather than trusted. A wrong-but-confident answer is worse than none.
      const sentences = checkSentences(clean, top);
      const grounded = sentences.length
        ? sentences.filter((s) => s.grounded).length / sentences.length : 1;
      return { answer: clean, sources, sentences, grounded };
    } catch (err) {
      this.log('ask failed: ' + err.message);
      return { answer: null, reason: err.message, sources: top };
    }
  }
}

// Split the answer into claims and score each against the chunk(s) it cites
// (or all chunks when it cites none). Returns [{text, grounded, overlap}].
function checkSentences(answer, sources) {
  const { tokenize } = require('./bm25');
  const parts = answer
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/[\s•\-*]/g, '').length > 3);
  const allWords = new Set(tokenize(sources.map((s) => s.text).join(' ')));
  return parts.map((text) => {
    const citeNums = [...text.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10) - 1);
    const scope = citeNums.length
      ? new Set(tokenize(citeNums.map((i) => sources[i]?.text || '').join(' ')))
      : allWords;
    const words = tokenize(text.replace(/\[\d+\]/g, ''));
    if (!words.length) return { text, grounded: true, overlap: 1 };
    let hit = 0;
    for (const w of words) if (scope.has(w)) hit++;
    const overlap = hit / words.length;
    return { text, grounded: overlap >= 0.5, overlap: Math.round(overlap * 100) / 100 };
  });
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

// djb2 — a stable fingerprint of chunk text, so cached embeddings are reused
// until the text actually changes.
function hashText(s) {
  let h = 5381;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return h.toString(36);
}

module.exports = { Knowledge, sectionsOf, transcriptWindows, __checkSentences: checkSentences };
