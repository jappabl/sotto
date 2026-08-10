// Auto-learn: after a dictation lands, look at the field a little later and
// detect words the user manually corrected — those become dictionary entries
// (the ✨ ones). Pure logic, deliberately conservative:
//   - only single-word substitutions of words ≥4 chars
//   - the replacement must be close (edit distance ≤ 3, same first letter,
//     or a casing-only change)
//   - most of the inserted text must still be present, so we know we're
//     looking at the same message
//   - at most 2 suggestions per dictation

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

function tokenize(s) {
  return String(s || '')
    .split(/[^A-Za-z0-9''-]+/)
    .filter((w) => w.length > 0);
}

/**
 * Compare what we inserted with what the field holds now.
 * Returns [{from, to}] — words the user appears to have corrected.
 */
function detectCorrections(insertedText, fieldText) {
  const inserted = tokenize(insertedText);
  const field = tokenize(fieldText);
  if (inserted.length < 3 || field.length === 0) return [];

  const fieldSet = new Set(field.map((w) => w.toLowerCase()));
  const insertedSet = new Set(inserted.map((w) => w.toLowerCase()));

  // Same message? Most inserted words should still be present.
  const present = inserted.filter((w) => fieldSet.has(w.toLowerCase())).length;
  if (present / inserted.length < 0.6) return [];

  const results = [];
  const seen = new Set();
  for (const word of inserted) {
    const lower = word.toLowerCase();
    if (word.length < 4 || fieldSet.has(lower) || seen.has(lower)) continue;
    if (!/^[A-Za-z]/.test(word)) continue;
    // Find candidate replacements: in the field, not in what we inserted.
    const candidates = field.filter((f) => {
      const fl = f.toLowerCase();
      if (insertedSet.has(fl) || f.length < 3) return false;
      if (fl === lower) return false;
      if (fl[0] !== lower[0]) return false;
      const dist = levenshtein(lower, fl);
      return dist >= 1 && dist <= 3 && dist <= Math.ceil(word.length / 3);
    });
    const unique = [...new Set(candidates)];
    if (unique.length === 1) {
      seen.add(lower);
      results.push({ from: word, to: unique[0] });
      if (results.length >= 2) break;
    }
  }
  return results;
}

module.exports = { detectCorrections, levenshtein };
