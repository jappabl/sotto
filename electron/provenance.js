// Provenance: the trust layer for enhanced notes. Pure functions.
//
// After the model writes enhanced notes we diff them against the user's rough
// notes: lines that carry the user's words render black ("user"), everything
// else gray ("ai"). Any user line the model dropped is re-appended verbatim —
// the guarantee is structural, never trusted to the model. Each AI line also
// gets a best-matching transcript window (srcRef) for the hover magnifier.

function tokens(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

// Token-set containment: how much of `a` is present in `b`.
function containment(a, b) {
  const ta = tokens(a);
  if (ta.length === 0) return 0;
  const tb = new Set(tokens(b));
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit++;
  return hit / ta.length;
}

function noteLines(notes) {
  return String(notes || '').split('\n')
    .map((l) => l.replace(/^[\s#>*-]+|\[[ x]\]/g, '').trim())
    .filter((l) => tokens(l).length >= 2);
}

/**
 * Annotate enhanced-note lines with origin + guarantee no user line is lost.
 * Returns { lines: [{text, origin}], appended: [droppedUserLines] }.
 */
function annotate(enhancedMd, userNotes) {
  const userLines = noteLines(userNotes);
  const enhanced = String(enhancedMd || '').split('\n');
  const usedUser = new Set();

  const lines = enhanced.map((text) => {
    const bare = text.replace(/^[\s#>*-]+|\[[ x]\]/g, '').trim();
    if (!bare) return { text, origin: 'ai' };
    let best = 0;
    let bestIdx = -1;
    userLines.forEach((ul, i) => {
      // The user's words appearing inside the enhanced line = their ink.
      const c = containment(ul, bare);
      if (c > best) { best = c; bestIdx = i; }
    });
    if (best >= 0.6) {
      usedUser.add(bestIdx);
      return { text, origin: 'user' };
    }
    return { text, origin: 'ai' };
  });

  // Structural guarantee: dropped user lines come back verbatim.
  const appended = [];
  userLines.forEach((ul, i) => {
    if (!usedUser.has(i)) appended.push(ul);
  });
  if (appended.length) {
    lines.push({ text: '', origin: 'ai' });
    lines.push({ text: '## From my notes', origin: 'ai' });
    for (const ul of appended) lines.push({ text: '- ' + ul, origin: 'user' });
  }
  return { lines, appended };
}

/**
 * For each AI line, find the transcript window that most likely sourced it.
 * segments: [{t0, t1, who, text}]. Returns srcRefs aligned to lines:
 * {t0, t1, score} or null.
 */
function mapSources(lines, segments) {
  if (!segments || !segments.length) return lines.map(() => null);
  return lines.map((line) => {
    if (line.origin !== 'ai') return null;
    const bare = line.text.replace(/^[\s#>*-]+/, '').trim();
    if (tokens(bare).length < 3) return null;
    let best = 0;
    let bestSeg = null;
    for (const seg of segments) {
      const c = containment(bare, seg.text) * 0.7 + containment(seg.text, bare) * 0.3;
      if (c > best) { best = c; bestSeg = seg; }
    }
    if (best < 0.35 || !bestSeg) return null;
    return { t0: bestSeg.t0, t1: bestSeg.t1, score: Math.round(best * 100) / 100 };
  });
}

// Cross-channel echo suppression: laptop speakers leak "them" into the mic.
// If a new segment's text heavily overlaps a recent segment from the OTHER
// channel in overlapping time, keep the "them" copy and drop the "me" echo.
function isEcho(newSeg, recentSegs) {
  for (const prev of recentSegs) {
    if (prev.who === newSeg.who) continue;
    const timeOverlap = Math.min(newSeg.t1, prev.t1) - Math.max(newSeg.t0, prev.t0);
    if (timeOverlap < -3) continue; // not near in time
    const sim = containment(newSeg.text, prev.text);
    if (sim >= 0.75 && tokens(newSeg.text).length >= 4) {
      // Echo confirmed: drop the mic copy (them is authoritative for speech
      // we heard through the speakers).
      return newSeg.who === 'me' || containment(prev.text, newSeg.text) >= 0.75;
    }
  }
  return false;
}

module.exports = { annotate, mapSources, isEcho, containment, tokens };
