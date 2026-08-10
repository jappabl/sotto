// Note enhancement: the Granola mechanic. Takes the user's rough in-meeting
// notes plus the full transcript and produces polished notes that keep the
// user's structure and voice while filling in what was actually said.
//
// A 3B model has a small context window, so long meetings are map-reduced:
//   map: each ~12-minute transcript window → dense factual bullet digest
//   reduce: user notes + all digests → enhanced notes (+ action items)
// Every stage runs on the local llama-server via the Polisher's channel.

const WINDOW_SECONDS = 12 * 60;
const MAX_WINDOW_CHARS = 6000;

function transcriptWindows(segments) {
  const windows = [];
  let current = [];
  let currentChars = 0;
  let windowStart = null;
  for (const seg of segments) {
    if (windowStart === null) windowStart = seg.t0;
    const line = `${seg.who === 'me' ? 'Me' : 'Them'}: ${seg.text}`;
    if ((seg.t0 - windowStart > WINDOW_SECONDS || currentChars + line.length > MAX_WINDOW_CHARS) && current.length) {
      windows.push(current.join('\n'));
      current = [];
      currentChars = 0;
      windowStart = seg.t0;
    }
    current.push(line);
    currentChars += line.length + 1;
  }
  if (current.length) windows.push(current.join('\n'));
  return windows;
}

const DIGEST_SYSTEM = `You compress meeting-transcript excerpts into dense factual bullets. Keep every decision, number, date, name, commitment, and open question. Attribute who said what when it matters ("Me" is the note-taker, "Them" is everyone else). No filler, no interpretation, no introduction. Output only the bullets.`;

const ENHANCE_SYSTEM = `You are enhancing meeting notes. You get the note-taker's own rough notes plus factual digests of what was said. Produce polished meeting notes in markdown that:
1. Follow the STRUCTURE and ORDER of the rough notes wherever they exist. The rough notes are the skeleton; expand each point with specifics from the digests.
2. Fill gaps: important topics from the digests that the rough notes missed get their own short sections at the natural place.
3. Keep the note-taker's own wording where it is clear; never pad or editorialize.
4. End with two sections when content exists for them: "## Action items" (checkbox list, owner named when known) and "## Open questions".
5. Use short headers, tight bullets, bold for decisions. Never use em dashes. Output only the notes, no preamble.`;

const CHAT_SYSTEM = `You answer questions about a meeting using its notes and transcript digests. Be direct and specific; quote what was actually said when asked. If the meeting did not cover something, say so plainly. Never use em dashes.`;

class Enhancer {
  constructor({ polisher, log = () => {} }) {
    this.polisher = polisher;
    this.log = log;
  }

  available() {
    return this.polisher && this.polisher.available();
  }

  async _chat(system, user, maxTokens, timeoutMs = 90000) {
    if (!(await this.polisher.ensureServer().catch(() => false))) {
      throw new Error('llm-unavailable');
    }
    return this.polisher._chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens, timeoutMs });
  }

  // Digest every transcript window (map stage). onProgress(0..1).
  async digest(segments, onProgress = () => {}) {
    const windows = transcriptWindows(segments);
    const digests = [];
    for (let i = 0; i < windows.length; i++) {
      const out = await this._chat(DIGEST_SYSTEM, windows[i], 700);
      digests.push(out.trim());
      onProgress((i + 1) / (windows.length + 1));
    }
    return digests;
  }

  async enhance({ notes, segments, template = 'auto', title = '' }, onProgress = () => {}) {
    if (!segments.length && !notes.trim()) throw new Error('nothing-to-enhance');
    const digests = segments.length ? await this.digest(segments, onProgress) : [];
    const templateHint = TEMPLATE_HINTS[template] || '';
    const user = [
      title ? `Meeting: ${title}` : null,
      templateHint ? `Requested format: ${templateHint}` : null,
      '## Rough notes from the note-taker',
      notes.trim() || '(none taken; build the notes from the digests alone)',
      '## What was said (factual digests, in order)',
      digests.length ? digests.join('\n\n') : '(no transcript available)',
    ].filter(Boolean).join('\n\n');
    const out = await this._chat(ENHANCE_SYSTEM, user, 1600, 180000);
    onProgress(1);
    const cleaned = out.trim();
    if (!cleaned || cleaned.length < 20) throw new Error('empty-enhancement');
    return { enhanced: cleaned, digests };
  }

  async ask({ question, notes, enhanced, digests, segments }) {
    // Prefer stored digests; fall back to digesting on the fly.
    let context = digests && digests.length ? digests.join('\n\n') : '';
    if (!context && segments && segments.length) {
      context = (await this.digest(segments)).join('\n\n');
    }
    const user = [
      '## Meeting notes',
      (enhanced || notes || '(none)').slice(0, 4000),
      '## What was said',
      context.slice(0, 6000) || '(no transcript)',
      '## Question',
      question,
    ].join('\n\n');
    return (await this._chat(CHAT_SYSTEM, user, 700)).trim();
  }
}

const TEMPLATE_HINTS = {
  auto: '',
  'one-on-one': 'A 1:1 — sections for updates, feedback both ways, growth topics, and agreed next steps.',
  standup: 'A standup — sections per person or topic: done, in progress, blockers.',
  sales: 'A sales call — company background, needs and pain points, objections, pricing discussion, next steps.',
  interview: 'An interview — candidate background, strengths, concerns, notable answers, recommendation.',
  brainstorm: 'A brainstorm — the ideas raised (all of them), themes, favorites, and what happens next.',
};

module.exports = { Enhancer, transcriptWindows, TEMPLATE_HINTS };
