// The text-cleanup pipeline that runs on every raw transcript before insertion.
// Pure functions only — no Electron imports — so the unit tests can exercise
// every rule directly.

const FILLERS = [
  'um', 'uh', 'uhm', 'umm', 'uhh', 'erm', 'er', 'hmm', 'mhm', 'mm-hmm',
];

// Backtrack phrases: everything before (and including) the phrase in the same
// sentence gets replaced by what follows it.
const BACKTRACK_PHRASES = [
  'scratch that', 'actually no', 'no wait', 'wait no', 'i mean',
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
  [/\bnew line\b/gi, '\n'],
  [/\bnew paragraph\b/gi, '\n\n'],
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

function applyBacktrack(text) {
  let out = text;
  for (const phrase of BACKTRACK_PHRASES) {
    const re = new RegExp(`([^.!?\\n]*?)[,\\s]*\\b${phrase}\\b[,\\s]*`, 'gi');
    out = out.replace(re, '');
  }
  return out.replace(/\s{2,}/g, ' ').replace(/^[\s,]+/, '').trim();
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
  // Capitalize after sentence-enders and newlines.
  out = out.replace(/([.!?]\s+|\n+)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
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
  const re = /[,.\s]*\b(?:press|hit)\s+enter\b[.!?]?\s*$/i;
  if (re.test(text)) {
    return { text: text.replace(re, '').trim(), pressEnter: true };
  }
  return { text, pressEnter: false };
}

function finalTidy(text) {
  let out = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
  if (out) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  if (removeFillers) text = stripFillers(text);
  text = applyBacktrack(text);
  if (autoPunctuate) text = applySpokenPunctuation(text);
  text = applyDictionary(text, dictionary);
  text = applySnippets(text, snippets);

  let pressEnter = false;
  if (pressEnterCommand) {
    const r = extractPressEnter(text);
    text = r.text;
    pressEnter = r.pressEnter;
  }
  text = finalTidy(text);
  return { text, pressEnter };
}

module.exports = {
  formatTranscript,
  stripFillers,
  applyBacktrack,
  applySpokenPunctuation,
  applyDictionary,
  applySnippets,
  extractPressEnter,
  FILLERS,
};
