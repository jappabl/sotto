// Self-correction ("backtrack") engine: detects when the speaker corrects
// themselves mid-dictation and keeps only what they meant.
//
//   "Let's meet at 5, no wait, 6"        → "Let's meet at 5" tail-swapped → 6
//   "Send it to John, I mean, Jane"      → proper noun swapped → Jane
//   "Do the blue one, scratch that, the red one" → prefix-echo replacement
//   "Meet at 5. Meet at 6pm."            → plain restatement, keep the later
//
// Pure functions, no Electron imports. The strategy is deliberately
// conservative: strong markers can replace whole clauses; weak markers
// ("actually", "sorry") only ever do shape-matched tail swaps, because they
// are common as ordinary adverbs.

const STRONG_MARKERS = [
  'scratch that', 'strike that', 'change that', 'no wait', 'no, wait',
  'wait no', 'wait, no', 'i meant', 'make that', 'or rather', 'correction',
];
// "I mean" corrects only when whisper set it off with a comma (", I mean").
const BOUNDARY_MARKERS = ['i mean'];
// Weak markers: shape-matched tail replacement only — never clause deletion.
// ("I actually enjoyed the movie" and "make it pop" must survive untouched.)
const WEAK_MARKERS = ['actually', 'sorry', 'make it'];

const PREPOSITIONS = new Set([
  'at', 'to', 'on', 'in', 'for', 'with', 'by', 'from', 'about', 'into', 'the',
  'a', 'an',
]);
const WEEKDAYS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);
const MONTHS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]);
const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty',
  'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
  'noon', 'midnight',
]);

const DAY_WORDS = new Set([
  'today', 'tomorrow', 'tonight', 'yesterday',
]);

function isTime(w) {
  return /^\d{1,2}(:\d{2})?(am|pm)?$/i.test(w) || w === 'noon' || w === 'midnight';
}
function isDayWord(w) { return DAY_WORDS.has(w.toLowerCase()); }
function isNumber(w) {
  return /^\d+([.,]\d+)?(st|nd|rd|th)?$/.test(w) || NUMBER_WORDS.has(w.toLowerCase());
}
function isWeekday(w) { return WEEKDAYS.has(w.toLowerCase()); }
function isMonth(w) { return MONTHS.has(w.toLowerCase()); }
function isProper(w) { return /^[A-Z][a-z]/.test(w); }

function shapeOf(word, { sentenceStart = false } = {}) {
  const w = stripPunct(word);
  if (isTime(w)) return 'time';
  if (isNumber(w)) return 'number';
  if (isWeekday(w)) return 'weekday';
  if (isMonth(w)) return 'month';
  if (isDayWord(w)) return 'dayword';
  if (isProper(w) && !sentenceStart) return 'proper';
  return 'word';
}

const SWAPPABLE = new Set(['time', 'number', 'weekday', 'month', 'dayword', 'proper']);

function stripPunct(w) {
  return w.replace(/^[^A-Za-z0-9$€£]+|[^A-Za-z0-9%]+$/g, '');
}

function words(s) {
  return s.split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Stutters & false starts
// ---------------------------------------------------------------------------

// "the the" → "the" · "I I think" → "I think" · "I think I think it's" →
// "I think it's" (immediate bigram echo). Case-insensitive, punctuation-aware.
function collapseStutters(text) {
  let out = text;
  // Immediate duplicate word (allow an intervening comma): "the, the plan"
  const dupWord = /\b([A-Za-z][A-Za-z']*)(,?\s+)\1\b(?![-'\w])/gi;
  let prev;
  do {
    prev = out;
    out = out.replace(dupWord, (m, w1, sep, offset, s) => {
      // Keep legitimate doubles ("had had", "that that") — only collapse when
      // whisper flagged hesitation with a comma, or the word is a common
      // stutter target.
      const commonStutter = /^(i|the|a|an|we|it|is|to|and|but|so|you|they|he|she|my|in|on|at|of|that|this|was|do)$/i.test(w1);
      const hasComma = sep.includes(',');
      if (commonStutter || hasComma) return w1;
      return m;
    });
  } while (out !== prev);
  // Immediate duplicate bigram: "I think I think we" → "I think we"
  const dupBigram = /\b([A-Za-z][A-Za-z']*\s+[A-Za-z][A-Za-z']*)(,?\s+)\1\b/gi;
  do {
    prev = out;
    out = out.replace(dupBigram, '$1');
  } while (out !== prev);
  // Partial-word false starts whisper renders with a dash: "th- the plan"
  out = out.replace(/\b[A-Za-z]{1,3}-\s+(?=[A-Za-z])/g, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Marker-based corrections
// ---------------------------------------------------------------------------

// Find a marker in a clause. Returns { marker, kind, pre, frag } or null.
function findMarker(clause) {
  const lower = clause.toLowerCase();
  const all = [
    ...STRONG_MARKERS.map((m) => ({ m, kind: 'strong' })),
    ...BOUNDARY_MARKERS.map((m) => ({ m, kind: 'boundary' })),
    ...WEAK_MARKERS.map((m) => ({ m, kind: 'weak' })),
  ];
  let best = null;
  for (const { m, kind } of all) {
    const re = new RegExp(`(^|[\\s,])${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s,.!?;:])`, 'i');
    const match = re.exec(lower);
    if (match) {
      const idx = match.index + match[1].length;
      if (best === null || idx < best.idx || (idx === best.idx && m.length > best.m.length)) {
        best = { m, kind, idx };
      }
    }
  }
  if (!best) return null;
  const pre = clause.slice(0, best.idx).replace(/[,\s]+$/, '');
  let frag = clause.slice(best.idx + best.m.length).replace(/^[,\s]+/, '');
  if (!stripPunct(frag)) frag = ''; // punctuation-only remainder
  return { marker: best.m, kind: best.kind, pre, frag };
}

// Replace the tail of `pre` with `frag` using shape matching. Returns the
// merged string, or null if no confident replacement site was found.
function replaceTail(pre, frag) {
  const preWords = words(pre);
  const fragWords = words(frag);
  if (preWords.length === 0) return frag;
  if (fragWords.length === 0) return null;

  const firstFrag = stripPunct(fragWords[0]).toLowerCase();

  // 1) Prefix echo: the fragment restarts from a word used earlier in the
  //    clause ("do the blue one" → frag "the red one": cut at last "the").
  for (let i = preWords.length - 1; i >= 0; i--) {
    if (stripPunct(preWords[i]).toLowerCase() === firstFrag) {
      return [...preWords.slice(0, i), ...fragWords].join(' ');
    }
  }

  // 2) Compound multi-slot swap: every fragment word is a swappable shape
  //    ("4pm tomorrow" corrects both the time and the day in
  //    "meeting at 2pm today"). Each slot replaces the LAST same-shaped
  //    token in the clause, applied right-to-left so indices stay valid.
  if (fragWords.length >= 2 && fragWords.length <= 4 &&
      fragWords.every((w) => SWAPPABLE.has(shapeOf(w)))) {
    const out = [...preWords];
    const used = new Set();
    let allFound = true;
    for (const fw of fragWords) {
      const shape = shapeOf(fw);
      let found = -1;
      for (let i = out.length - 1; i >= 0; i--) {
        if (!used.has(i) && shapeOf(out[i], { sentenceStart: i === 0 }) === shape) {
          found = i;
          break;
        }
      }
      if (found === -1) { allFound = false; break; }
      used.add(found);
      const punct = (out[found].match(/[.!?,;]+$/) || [''])[0];
      out[found] = fw.replace(/[.!?,;]+$/, '') + punct;
    }
    if (allFound) {
      let s = out.join(' ');
      // The fragment may carry the sentence's closing punctuation.
      const fragPunct = (fragWords[fragWords.length - 1].match(/[.!?]+$/) || [''])[0];
      if (fragPunct && !/[.!?]$/.test(s)) s += fragPunct;
      return s;
    }
  }

  // 2.5) Tail-run splice: a longer fragment that OPENS with a swappable token
  //      matching the clause's trailing token replaces that trailing run and
  //      continues — "tell Sam" + "Alex that the launch moved…" →
  //      "tell Alex that the launch moved…".
  {
    const headShape = shapeOf(fragWords[0]);
    const lastIdx = preWords.length - 1;
    if (SWAPPABLE.has(headShape) &&
        shapeOf(preWords[lastIdx], { sentenceStart: lastIdx === 0 }) === headShape) {
      let start = lastIdx;
      if (headShape === 'proper') {
        while (start - 1 > 0 && isProper(preWords[start - 1])) start--;
      }
      return [...preWords.slice(0, start), ...fragWords].join(' ');
    }
  }

  // 3) Shape match: single-ish fragment replacing the last same-shaped token.
  const fragShape = shapeOf(fragWords[0]);
  if (fragWords.length <= 3 && fragShape !== 'word') {
    for (let i = preWords.length - 1; i >= 0; i--) {
      if (shapeOf(preWords[i], { sentenceStart: i === 0 }) === fragShape) {
        // For proper nouns, consume the whole surrounding name run
        // ("Sarah Chen" → both words go when replaced by "Marcus").
        let start = i;
        let end = i;
        if (fragShape === 'proper') {
          while (start - 1 > 0 && isProper(preWords[start - 1])) start--;
          while (end + 1 < preWords.length && isProper(preWords[end + 1])) end++;
        }
        // Preserve trailing punctuation of the replaced region's end.
        const tailPunct = (preWords[end].match(/[.!?,;]+$/) || [''])[0];
        const after = preWords.slice(end + 1);
        const merged = [...preWords.slice(0, start), ...fragWords, ...after];
        let s = merged.join(' ');
        if (tailPunct && !/[.!?,;]$/.test(s)) s += tailPunct;
        return s;
      }
    }
  }
  return null;
}

// Whether a fragment reads like a complete restatement (safe to replace the
// entire previous clause with it).
function isClauseLike(frag) {
  const w = words(frag);
  if (w.length >= 4) return true;
  return /\b(i|i'll|i'm|we|we'll|let's|lets|please|send|make|do|use|go|meet|call|tell|it's|its|that's)\b/i.test(frag);
}

/**
 * Apply marker-based corrections across the text.
 * Splits into sentences and comma-level clauses; a marker consumes the
 * previous clause (strong) or its matching tail (any kind).
 */
function applyMarkedCorrections(text) {
  // Work sentence by sentence, but allow a marker at the start of a sentence
  // to reach back into the previous sentence.
  const parts = text.split(/(?<=[.!?\n])\s+/);
  const sentences = parts.filter((p) => p.trim());

  for (let s = 0; s < sentences.length; s++) {
    let guard = 0;
    let changed = true;
    while (changed && guard++ < 10) {
      changed = false;
      const original = sentences[s];
      const clauses = sentences[s].split(/,\s*/);
      const commit = () => {
        sentences[s] = preserveCap(original, clauses.filter(Boolean).join(', '));
        changed = true;
      };

      for (let c = 0; c < clauses.length; c++) {
        const hit = findMarker(clauses[c]);
        if (!hit) continue;

        let { kind, pre, frag } = hit;
        // Marker stood alone in its clause → replacement lives in the next
        // clause, target is the previous clause.
        if (!frag && c + 1 < clauses.length) {
          frag = clauses[c + 1];
          clauses.splice(c + 1, 1);
        }

        // Determine the target clause (text being corrected).
        let targetIdx = c;
        let target = pre;
        let external = false; // target is a different clause / sentence
        if (!target) {
          if (c > 0) {
            targetIdx = c - 1;
            target = clauses[targetIdx];
            external = true;
          } else if (s > 0) {
            // Correction opens the sentence — reach into the prior sentence.
            const prevOriginal = sentences[s - 1];
            const prevSentence = prevOriginal.replace(/[.!?]+\s*$/, '');
            if (!frag && kind === 'strong') {
              // Bare "Scratch that." → drop the previous sentence entirely.
              sentences[s - 1] = '';
              clauses.splice(c, 1);
              commit();
              break;
            }
            const merged = correctAcross(prevSentence, frag, kind);
            if (merged !== null) {
              const punct = (prevOriginal.match(/[.!?]+\s*$/) || ['.'])[0].trim();
              sentences[s - 1] = '';
              const rest = clauses.slice(c + 1).join(', ');
              let out = merged + (rest ? ', ' + rest : '');
              out = out.replace(/[.!?,;]+$/, '') + punct;
              sentences[s] = preserveCap(prevOriginal, out);
              changed = true;
            }
            break;
          } else {
            continue;
          }
        }

        if (kind === 'boundary' && !external && pre && !/,\s*$/.test(pre)) {
          // "I mean" glued mid-clause without a comma — too risky unless the
          // fragment clearly shape-matches.
          const swapped = replaceTail(pre, frag);
          if (swapped === null) continue;
          clauses[c] = swapped;
          commit();
          break;
        }

        const swapped = replaceTail(target, frag);
        if (swapped !== null) {
          clauses[targetIdx] = swapped;
          if (external) clauses.splice(c, 1);
          commit();
          break;
        }

        // No tail match: strong markers may replace the whole clause when the
        // fragment reads like a restatement; weak ones never do.
        if (kind !== 'weak' && frag && isClauseLike(frag)) {
          clauses[targetIdx] = frag;
          if (external) clauses.splice(c, 1);
          commit();
          break;
        }
        // "…, scratch that." with nothing after → delete the target clause
        // and the marker clause.
        if (kind === 'strong' && !frag) {
          if (external) clauses.splice(targetIdx, 2);
          else clauses.splice(c, 1);
          commit();
          break;
        }
      }
    }
  }

  return sentences.filter((x) => x.trim()).map((x) => x.trim()).join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Correction fragment at sentence start reaching into the previous sentence.
function correctAcross(prevSentence, frag, kind) {
  const swapped = replaceTail(prevSentence, frag);
  if (swapped !== null) return swapped;
  if (kind !== 'weak' && isClauseLike(frag)) return frag;
  return null;
}

// ---------------------------------------------------------------------------
// Plain restatement (no marker)
// ---------------------------------------------------------------------------

// "meet at 5 meet at 6pm" · "Send the invite today. Send the invite tomorrow."
// Adjacent clauses/sentences sharing a long head are collapsed to the latter.
function collapseRestatements(text) {
  const sentences = text.split(/(?<=[.!?\n])\s+/).filter((p) => p.trim());

  // Within each sentence: comma clauses with shared 2+ word head.
  for (let s = 0; s < sentences.length; s++) {
    const original = sentences[s];
    const punct = (sentences[s].match(/[.!?]+$/) || [''])[0];
    const body = punct ? sentences[s].slice(0, -punct.length) : sentences[s];
    const clauses = body.split(/,\s*/);
    for (let c = 0; c + 1 < clauses.length; c++) {
      if (sharedHead(clauses[c], clauses[c + 1]) >= 2) {
        clauses.splice(c, 1);
        c--;
      }
    }
    sentences[s] = preserveCap(original, clauses.join(', ') + punct);
  }

  // Adjacent sentences: stricter, shared 3+ word head.
  for (let s = 0; s + 1 < sentences.length; s++) {
    const a = sentences[s].replace(/[.!?]+$/, '');
    const b = sentences[s + 1].replace(/[.!?]+$/, '');
    if (sharedHead(a, b) >= 3) {
      sentences.splice(s, 1);
      s--;
    }
  }
  return sentences.join(' ').trim();
}

// Trailing ellipsis restatement: a sentence ending in a short fragment that
// re-speaks a phrase from earlier in the same sentence with 2+ shared leading
// words — "…buy a record as a gift, as a present." → swap "as a gift".
// Requiring two shared words keeps "We ship on Friday, on time" safe.
function collapseEllipsisRestatement(text) {
  const sentences = text.split(/(?<=[.!?\n])\s+/).filter((p) => p.trim());
  for (let s = 0; s < sentences.length; s++) {
    const original = sentences[s];
    const punct = (original.match(/[.!?]+$/) || [''])[0];
    const body = punct ? original.slice(0, -punct.length) : original;
    const clauses = body.split(/,\s*/);
    if (clauses.length < 2) continue;
    const frag = clauses[clauses.length - 1];
    const fragW = words(frag);
    const main = clauses.slice(0, -1).join(', ');
    const mainW = words(main);
    if (fragW.length < 2 || fragW.length > 6 || fragW.length >= mainW.length) continue;
    const f0 = stripPunct(fragW[0]).toLowerCase();
    const f1 = stripPunct(fragW[1]).toLowerCase();
    // Find the last spot in the main clause matching the fragment's first two
    // words; if only the first matches, it's not a restatement.
    for (let i = mainW.length - 2; i >= 0; i--) {
      if (stripPunct(mainW[i]).toLowerCase() === f0 &&
          stripPunct(mainW[i + 1]).toLowerCase() === f1 &&
          !(i + 2 >= mainW.length && fragW.length === 2)) {
        sentences[s] = preserveCap(original,
          [...mainW.slice(0, i), ...fragW].join(' ') + punct);
        break;
      }
    }
  }
  return sentences.join(' ');
}

// Also: a single clause that restates its own beginning without punctuation —
// "meet at 5 meet at 6". Detected via repeated head bigram inside the clause.
function collapseInlineRestatement(text) {
  const w = words(text);
  if (w.length < 4) return text;
  for (let len = Math.min(4, Math.floor(w.length / 2)); len >= 2; len--) {
    for (let i = 1; i + len <= w.length; i++) {
      const head = w.slice(0, len).map((x) => stripPunct(x).toLowerCase()).join(' ');
      const cand = w.slice(i, i + len).map((x) => stripPunct(x).toLowerCase()).join(' ');
      if (head === cand && i >= len) {
        // Everything before the repeat is the abandoned start.
        return w.slice(i).join(' ');
      }
    }
  }
  return text;
}

function sharedHead(a, b) {
  const wa = words(a).map((x) => stripPunct(x).toLowerCase());
  const wb = words(b).map((x) => stripPunct(x).toLowerCase());
  let n = 0;
  while (n < wa.length && n < wb.length && wa[n] === wb[n] && wa[n]) n++;
  // Only meaningful if one is a genuine restatement (they differ somewhere).
  if (n === wa.length && n === wb.length) return 0; // identical — dedupe elsewhere
  return n;
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// If the pre-edit text began with a capital, keep the edited text capitalized
// too (corrections often promote a lowercase mid-sentence fragment to the
// front). Never lowercases anything.
function preserveCap(before, after) {
  if (!before || !after) return after;
  if (/^[A-Z]/.test(before) && /^[a-z]/.test(after)) return capitalize(after);
  return after;
}

/**
 * The full correction pass.
 */
function applyCorrections(text) {
  let out = collapseStutters(text);
  out = applyMarkedCorrections(out);
  out = collapseRestatements(out);
  out = collapseEllipsisRestatement(out);
  return out.replace(/\s{2,}/g, ' ').trim();
}

module.exports = {
  applyCorrections,
  collapseStutters,
  applyMarkedCorrections,
  collapseRestatements,
  collapseEllipsisRestatement,
  collapseInlineRestatement,
  replaceTail,
  findMarker,
  shapeOf,
};
