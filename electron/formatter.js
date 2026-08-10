// The text-cleanup pipeline that runs on every raw transcript before insertion.
// Pure functions only — no Electron imports — so the unit tests can exercise
// every rule directly.

const { applyCorrections } = require('./corrections');

const FILLERS = [
  'um', 'uh', 'uhm', 'umm', 'uhh', 'erm', 'er', 'hmm', 'mhm', 'mm-hmm',
];

const SPOKEN_PUNCT = [
  [/\b(?:full stop|period)\b/gi, '.'],
  [/\bcomma\b/gi, ','],
  [/\bquestion mark\b/gi, '?'],
  [/\bexclamation (?:mark|point)\b/gi, '!'],
  [/\bsemicolon\b/gi, ';'],
  [/\bcolon\b/gi, ':'],
  [/\bopen paren(?:thesis)?\b/gi, '('],
  [/\bclose paren(?:thesis)?\b/gi, ')'],
  [/\b(?:open|begin) quotes?\b\s*/gi, '“'],
  [/\s*\b(?:close|end) quotes?\b/gi, '”'],
  // House style: no em dashes, ever. Speaking "em dash" (which ASR renders
  // as "em dash", "m dash", or a stray "M-") gives a spaced hyphen.
  [/\s*\b(?:em|m)[\s-]?dash\b\s*/gi, ' - '],
  [/\s*\bhyphen\b\s*/gi, '-'],
  [/\bnew line\b/gi, '\n'],
  [/\bnew paragraph\b/gi, '\n\n'],
  [/\b(?:new bullet|bullet point)\b/gi, '\n- '],
];

function stripFillers(text) {
  // Remove standalone filler words along with one adjoining comma/space.
  const pattern = new RegExp(
    `(?:^|(?<=[\\s(]))(?:${FILLERS.join('|')})(?=[\\s,.!?)]|$)[,]?\\s*`,
    'gi',
  );
  return text
    .replace(pattern, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

// Spoken email addresses: "jane dot smith at gmail dot com" →
// "jane.smith@gmail.com". Only rewrites when a real TLD anchors the pattern,
// so ordinary sentences with "at" and "dot" stay untouched.
const TLDS = '(?:com|org|net|io|ai|dev|co|edu|gov|me|app|xyz)';
function applySpokenEmails(text) {
  let out = text;
  // "<u> dot <u> at <d> dot <tld>" — the user part must itself contain a
  // spoken "dot" so plain mentions ("the docs at readme dot io") never
  // convert. Restraint beats cleverness here.
  const emailRe = new RegExp(
    String.raw`\b([a-z0-9]+(?:\s+dot\s+[a-z0-9]+)+)\s+at\s+([a-z0-9]+(?:\s+dot\s+[a-z0-9]+)*)\s+dot\s+(${TLDS})\b`,
    'gi',
  );
  out = out.replace(emailRe, (m, user, domain, tld) =>
    `${user.replace(/\s+dot\s+/gi, '.')}@${domain.replace(/\s+dot\s+/gi, '.')}.${tld}`
      .toLowerCase().replace(/\s+/g, ''));
  // Whisper often writes "jane.smith at gmail.com" halfway — finish the job.
  // The user part must LOOK like an address (dot/digit/underscore/hyphen),
  // so "the docs at readme.io" never becomes an email.
  out = out.replace(new RegExp(String.raw`\b([a-z0-9]+[._-][a-z0-9._-]*|[a-z]+\d[a-z0-9._-]*)\s+at\s+([a-z0-9-]+\.${TLDS})\b`, 'gi'), '$1@$2');
  // Bare spoken domains: "example dot com" → example.com
  out = out.replace(new RegExp(String.raw`\b([a-z0-9-]+)\s+dot\s+(${TLDS})\b`, 'gi'), '$1.$2');
  return out;
}

// Throat-clearing openers: "Okay so the thing is we need to…" → "we need to…"
// Only at the very start of a dictation, only when real content follows.
const PREAMBLE_WORDS = '(?:okay|ok|so|well|alright|all right|anyway|anyways|yeah|right|look|listen|basically|the thing is)';
function stripPreamble(text) {
  const re = new RegExp(`^(?:${PREAMBLE_WORDS}[,\\s]+){1,4}`, 'i');
  const m = text.match(re);
  if (!m) return text;
  const rest = text.slice(m[0].length);
  if (rest.trim().split(/\s+/).length < 3) return text; // nothing left to say
  return rest.trim();
}

// Comma-bound hedges: "It's, you know, fine" → "It's fine". Only when whisper
// isolated the hedge with commas — "you know the answer" is never touched.
function stripHedges(text) {
  return text
    .replace(/,\s*(?:you know|sort of|kind of)\s*,\s*/gi, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1');
}

// Spoken emoji: "thumbs up emoji" → 👍. Only fires on the explicit "emoji"
// cue, so "the fire emoji feature" stays a mention… of "fire emoji" minus the
// cue-less case: we require the name directly before the word "emoji".
const EMOJI_NAMES = {
  'thumbs up': '👍', 'thumbs down': '👎', 'heart': '❤️', 'red heart': '❤️',
  'fire': '🔥', 'smiley face': '🙂', 'happy face': '🙂', 'smiling face': '🙂',
  'sad face': '🙁', 'laughing': '😂', 'crying laughing': '😂', 'joy': '😂',
  'wink': '😉', 'winking face': '😉', 'crying': '😢', 'party': '🎉',
  'party popper': '🎉', 'clap': '👏', 'clapping': '👏', 'rocket': '🚀',
  'star': '⭐', 'check mark': '✅', 'check': '✅', 'cross mark': '❌',
  'eyes': '👀', 'thinking face': '🤔', 'thinking': '🤔', 'shrug': '🤷',
  'praying hands': '🙏', 'folded hands': '🙏', 'muscle': '💪', 'flexed biceps': '💪',
  'skull': '💀', 'hundred': '💯', 'sparkles': '✨', 'waving hand': '👋',
  'wave': '👋', 'salute': '🫡', 'melting face': '🫠',
};
function applySpokenEmoji(text) {
  const names = Object.keys(EMOJI_NAMES)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = new RegExp(`\\b(${names})\\s+emoji\\b[.,]?`, 'gi');
  return text.replace(re, (m, name) => EMOJI_NAMES[name.toLowerCase()] || m);
}

// Spoken lists: "first do X second do Y" / "number one X number two Y" →
// numbered lines. Requires at least two explicit ordinal anchors, so ordinary
// sentences containing "one" or "first" alone never convert.
const ORDINALS = [
  ['first', 'firstly', 'number one'], ['second', 'secondly', 'number two'],
  ['third', 'thirdly', 'number three'], ['fourth', 'number four'],
  ['fifth', 'number five'], ['sixth', 'number six'],
];
function applyListFormation(text) {
  // Find anchor positions in ascending ordinal order.
  const lower = text.toLowerCase();
  const anchors = [];
  let searchFrom = 0;
  for (let i = 0; i < ORDINALS.length; i++) {
    let best = -1;
    let bestLen = 0;
    for (const form of ORDINALS[i]) {
      const re = new RegExp(`(?:^|[\\s,.:;])${form}[\\s,]`, 'i');
      const m = re.exec(lower.slice(searchFrom));
      const idx = m ? searchFrom + m.index + (m[0].length - form.length - 1) : -1;
      if (idx >= 0 && (best === -1 || idx < best)) {
        best = idx;
        bestLen = form.length;
      }
    }
    if (best === -1) break;
    anchors.push({ idx: best, len: bestLen, n: i + 1 });
    searchFrom = best + bestLen;
  }
  if (anchors.length < 2) return text;
  // Each anchor needs at least two words of content after it.
  const intro = text.slice(0, anchors[0].idx).replace(/[,:;\s]+$/, '');
  const items = anchors.map((a, i) => {
    const end = i + 1 < anchors.length ? anchors[i + 1].idx : text.length;
    return text.slice(a.idx + a.len, end).replace(/^[\s,.:]+|[\s,.:]+$/g, '');
  });
  if (items.some((it) => it.split(/\s+/).length < 2)) return text;
  const lines = items.map((it, i) =>
    `${i + 1}. ${it[0].toUpperCase()}${it.slice(1)}`);
  return (intro ? intro + ':\n' : '') + lines.join('\n');
}

// Narrow homophone repair: "their going to" → "they're going to".
const ING_VERBS = '(?:going|gonna|coming|trying|doing|making|getting|running|looking|working|planning|heading)';
function fixHomophones(text) {
  return text
    .replace(new RegExp(`\\btheir\\s+(${ING_VERBS})\\b`, 'gi'), (m, v) => matchCaseWord(m, "they're") + ' ' + v)
    .replace(new RegExp(`\\byour\\s+(${ING_VERBS})\\b`, 'gi'), (m, v) => matchCaseWord(m, "you're") + ' ' + v);
}
function matchCaseWord(orig, word) {
  return /^[A-Z]/.test(orig) ? word[0].toUpperCase() + word.slice(1) : word;
}

// Times: "5 p.m." / "5 PM" → "5pm" (the style the original app uses).
// The final dot of "a.m." doubles as the sentence period, so keep it unless
// the sentence clearly continues in lowercase.
function normalizeTimes(text) {
  return text.replace(/\b(\d{1,2}(?::\d{2})?)\s*([ap])\.?m\b\.?/gi,
    (m, t, ap, offset, s) => {
      const compact = `${t}${ap.toLowerCase()}m`;
      if (!m.endsWith('.')) return compact;
      const rest = s.slice(offset + m.length);
      const continuesLower = /^\s+[a-z]/.test(rest);
      return continuesLower ? compact : compact + '.';
    });
}

function applySpokenPunctuation(text) {
  let out = text;
  for (const [re, sub] of SPOKEN_PUNCT) {
    out = out.replace(re, sub);
  }
  // Tidy: no space before punctuation we just inserted, single space after.
  out = out
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s\n.)!?,;:])/g, '$1 ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/([.!?])\s*\.+/g, '$1');
  // Capitalize after sentence-enders and paragraph breaks (a single "new line"
  // continues the thought, so it keeps its casing).
  out = out.replace(/([.!?]\s+|\n{2,})([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
  return out.trim();
}

function applyDictionary(text, dictionary) {
  let out = text;
  for (const entry of dictionary || []) {
    if (!entry.word) continue;
    if (entry.replacement) {
      // "Correct a misspelling": spoken form → written form.
      const re = new RegExp(`\\b${escapeRe(entry.word)}\\b`, 'gi');
      out = out.replace(re, entry.replacement);
    } else {
      // Plain vocabulary entry: enforce the exact casing the user saved.
      const re = new RegExp(`\\b${escapeRe(entry.word)}\\b`, 'gi');
      out = out.replace(re, (m, offset) => {
        // Preserve sentence-start capitalization if the saved word is lowercase.
        const saved = entry.word;
        if (/^[a-z]/.test(saved) && isSentenceStart(out, offset)) {
          return saved[0].toUpperCase() + saved.slice(1);
        }
        return saved;
      });
    }
  }
  return out;
}

function isSentenceStart(text, offset) {
  const before = text.slice(0, offset).trimEnd();
  return before === '' || /[.!?\n]$/.test(before);
}

function applySnippets(text, snippets) {
  let out = text;
  for (const s of snippets || []) {
    if (!s.trigger || !s.expansion) continue;
    // Whole-phrase, case-insensitive; strip an immediately trailing period the
    // ASR may have added if the trigger was the whole utterance.
    const re = new RegExp(`\\b${escapeRe(s.trigger)}\\b\\.?`, 'gi');
    out = out.replace(re, s.expansion);
  }
  return out;
}

// Detects a trailing "press enter" command. Returns {text, pressEnter}.
function extractPressEnter(text) {
  // Keep the sentence's own closing punctuation — only the command goes.
  const re = /[,\s]*\b(?:press|hit)\s+enter\b[.!?]?\s*$/i;
  if (re.test(text)) {
    return { text: text.replace(re, '').trim(), pressEnter: true };
  }
  return { text, pressEnter: false };
}

// No em dashes, ever: ranges between digits become plain hyphens, prose
// dashes become spaced hyphens. Catches whisper output and LLM polish alike.
function stripEmDashes(text) {
  return text
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    .replace(/\s*[—–]\s*/g, ' - ');
}

function finalTidy(text) {
  let out = stripEmDashes(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
  if (out) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

// Style presets: formal keeps everything; casual drops the trailing period on
// short message-like text; very-casual also lowercases (keeping "I" and words
// the user explicitly cased in their dictionary).
function applyStyle(text, style, dictionary = []) {
  if (style === 'casual' || style === 'very-casual') {
    if (!text.includes('\n') && text.length < 220) {
      text = text.replace(/\.$/, '');
    }
  }
  if (style === 'very-casual') {
    text = text.toLowerCase()
      .replace(/\bi\b/g, 'I')
      .replace(/\bi'([a-z])/g, "I'$1")
      .replace(/\bi’([a-z])/g, 'I’$1');
    for (const entry of dictionary) {
      const saved = entry.replacement || entry.word;
      if (!saved || saved === saved.toLowerCase()) continue;
      const re = new RegExp(`\\b${escapeRe(saved.toLowerCase())}\\b`, 'g');
      text = text.replace(re, saved);
    }
  }
  return text;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Context-aware continuation: adapt the insert to the text already before the
// cursor — lowercase when joining mid-sentence, add a leading space when the
// existing text doesn't end with one.
function adjustForContext(text, before) {
  if (!text || !before || !before.trim()) return text;
  let out = text;
  const endsMidSentence = /[\w,;:—-]\s*$/.test(before) && !/[.!?…]\s*$/.test(before);
  if (endsMidSentence && /^[A-Z][a-z]/.test(out) && !/^I\b/.test(out)) {
    out = out[0].toLowerCase() + out.slice(1);
  }
  if (!/\s$/.test(before) && !/^[\s.,;:!?)]/.test(out)) {
    out = ' ' + out;
  }
  return out;
}

/**
 * The full pipeline. options:
 *   removeFillers, autoPunctuate, pressEnterCommand — booleans
 *   dictionary, snippets — arrays from the store
 * Returns { text, pressEnter }.
 */
function formatTranscript(rawText, options = {}) {
  const {
    removeFillers = true,
    autoPunctuate = true,
    pressEnterCommand = true,
    textStyle = 'formal',
    cleanupLevel = 'medium', // 'none' | 'light' | 'medium' | 'high'
    dictionary = [],
    snippets = [],
  } = options;

  let text = String(rawText || '').trim();
  // Whisper artifacts: bracketed non-speech like [BLANK_AUDIO], (music), ♪
  text = text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, (m) => (/[a-z]{3,}\s[a-z]/i.test(m) && !/music|noise|silence|inaudible|applause|laugh/i.test(m) ? m : ''))
    .replace(/♪/g, '')
    .trim();

  // Staged cleanup, mirroring the original's Auto Cleanup levels:
  //   none   → raw transcript (artifacts only)
  //   light  → fillers + stutters
  //   medium → + self-corrections, restatements, hedges (default)
  //   high   → + preamble stripping
  const level = ['none', 'light', 'medium', 'high'].includes(cleanupLevel)
    ? cleanupLevel : 'medium';
  const atLeast = (l) => ['none', 'light', 'medium', 'high'].indexOf(level) >=
    ['none', 'light', 'medium', 'high'].indexOf(l);

  if (level !== 'none') {
    if (removeFillers) text = stripFillers(text);
    if (atLeast('medium')) {
      text = applyCorrections(text);
      text = stripHedges(text);
    } else {
      text = require('./corrections').collapseStutters(text);
    }
    if (atLeast('high')) text = stripPreamble(text);
  }
  if (autoPunctuate) text = applySpokenPunctuation(text);
  if (level !== 'none') {
    text = applySpokenEmails(text);
    text = normalizeTimes(text);
    text = applySpokenEmoji(text);
    text = fixHomophones(text);
    text = applyListFormation(text);
  }
  text = applyDictionary(text, dictionary);
  text = applySnippets(text, snippets);

  let pressEnter = false;
  if (pressEnterCommand) {
    const r = extractPressEnter(text);
    text = r.text;
    pressEnter = r.pressEnter;
  }
  text = finalTidy(text);
  text = applyStyle(text, textStyle, dictionary);
  return { text, pressEnter };
}

module.exports = {
  formatTranscript,
  adjustForContext,
  stripEmDashes,
  stripFillers,
  stripPreamble,
  stripHedges,
  applySpokenPunctuation,
  applySpokenEmails,
  applySpokenEmoji,
  applyListFormation,
  fixHomophones,
  normalizeTimes,
  applyDictionary,
  applySnippets,
  applyStyle,
  extractPressEnter,
  FILLERS,
};
