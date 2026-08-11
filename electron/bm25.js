// BM25 retrieval over the personal corpus. Pure JS, zero dependencies.
//
// Okapi BM25 with light stemming and stopword filtering. Tuned for short,
// heterogeneous personal notes: k1=1.2, b=0.5 (less length penalty than the
// 0.75 default, since a long meeting note shouldn't be punished vs a one-line
// dictation). Title terms are boosted so "pricing meeting" ranks the meeting
// titled Pricing over a passing mention.

const STOPWORDS = new Set((
  'a an and are as at be but by for if in into is it no not of on or such that the ' +
  'their then there these they this to was will with i you we he she them our your my ' +
  'me us do does did done have has had having so just about up out get got ' +
  // question scaffolding — strips "what did we decide about X" down to "decide X"
  'what when who how why which whom whose were been would could should can may ' +
  'tell show give find said say does anything something'
).split(' '));

// Plural-only normalization. Full stemming mangles proper nouns and project
// names (the top query type here) and STT text doesn't need it, so we only
// fold simple plurals: meetings->meeting, tiers->tier, decisions->decision,
// while leaving pricing/Sonos/Marcus untouched.
function stem(w) {
  if (w.length <= 3) return w;
  if (/(?:ss|us|is|ous|ics)$/.test(w)) return w; // business, status, physics
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'; // categories -> category
  if (/es$/.test(w) && /(?:ch|sh|x|z|s)es$/.test(w)) return w.slice(0, -2); // boxes -> box
  if (/s$/.test(w)) return w.slice(0, -1); // meetings -> meeting
  return w;
}

function tokenize(text, { keepStop = false } = {}) {
  const raw = String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'+._-]*/g) || [];
  const out = [];
  for (let t of raw) {
    t = t.replace(/^[._-]+|[._-]+$/g, '').replace(/'s$/, '');
    if (!t) continue;
    if (!keepStop && STOPWORDS.has(t)) continue;
    out.push(stem(t));
  }
  return out;
}

class BM25 {
  constructor({ k1 = 1.2, b = 0.5, titleBoost = 2.0 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.titleBoost = titleBoost;
    this.docs = [];          // { id, meta, len }
    this.postings = new Map(); // term -> Map(docIndex -> weightedTf)
    this.avgdl = 0;
    this.built = false;
  }

  add(id, text, meta = {}) {
    const bodyTerms = tokenize(text);
    const titleTerms = meta.title ? tokenize(meta.title) : [];
    const tf = new Map();
    const bump = (terms, weight) => {
      for (const t of terms) tf.set(t, (tf.get(t) || 0) + weight);
    };
    bump(bodyTerms, 1);
    bump(titleTerms, this.titleBoost);
    // Effective length uses the raw body token count (title boost shouldn't
    // inflate the length penalty).
    const len = bodyTerms.length + titleTerms.length;
    const docIndex = this.docs.length;
    this.docs.push({ id, meta, len, tf });
    this.built = false;
    return docIndex;
  }

  build() {
    this.postings = new Map();
    let total = 0;
    this.docs.forEach((doc, i) => {
      total += doc.len;
      for (const [term, w] of doc.tf) {
        if (!this.postings.has(term)) this.postings.set(term, new Map());
        this.postings.get(term).set(i, w);
      }
    });
    this.avgdl = this.docs.length ? total / this.docs.length : 0;
    this.built = true;
    return this;
  }

  idf(term) {
    const df = this.postings.has(term) ? this.postings.get(term).size : 0;
    const N = this.docs.length;
    // BM25+ style: max(0, ...) avoids negative IDF for very common terms.
    return Math.max(0, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }

  search(query, { limit = 10 } = {}) {
    if (!this.built) this.build();
    const qTerms = [...new Set(tokenize(query))];
    if (!qTerms.length || !this.docs.length) return [];
    const scores = new Map();
    for (const term of qTerms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const idf = this.idf(term);
      for (const [docIndex, tf] of posting) {
        const doc = this.docs[docIndex];
        const denom = tf + this.k1 * (1 - this.b + this.b * (doc.len / (this.avgdl || 1)));
        const s = idf * (tf * (this.k1 + 1)) / (denom || 1);
        scores.set(docIndex, (scores.get(docIndex) || 0) + s);
      }
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([docIndex, score]) => ({
        id: this.docs[docIndex].id,
        meta: this.docs[docIndex].meta,
        score: Math.round(score * 1000) / 1000,
      }));
  }

  get size() {
    return this.docs.length;
  }
}

// Reciprocal rank fusion — used later to blend BM25 with vector results.
// Each list is [{id, ...}] in rank order. Returns fused id -> score.
function reciprocalRankFusion(lists, { k = 60 } = {}) {
  const fused = new Map();
  for (const list of lists) {
    list.forEach((item, rank) => {
      fused.set(item.id, (fused.get(item.id) || 0) + 1 / (k + rank + 1));
    });
  }
  return fused;
}

module.exports = { BM25, tokenize, stem, reciprocalRankFusion, STOPWORDS };
