// Ask: search and chat across everything you've captured — dictations,
// meetings, shared notes. BM25 retrieval + a grounded local-LLM answer with
// citations back to the source.

import { el, toast } from '../ui.js';
import { icons } from '../icons.js';

let unsubs = [];
function cleanup() { for (const u of unsubs) { try { u(); } catch {} } unsubs = []; }

export async function renderAsk(container) {
  cleanup();
  const stats = await window.sotto.invoke('know:stats');
  container.replaceChildren();

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Ask'),
      el('span', { class: 'act-meta' },
        stats.chunks
          ? `${stats.chunks} passages across your notes`
          : 'nothing captured yet'),
    ),
  );

  const input = el('input', {
    class: 'ask-input',
    placeholder: 'Ask anything: "what did we decide about pricing?"  ·  "action items from last week"',
  });
  const askBtn = el('button', { class: 'btn-dark', onclick: () => run() }, 'Ask');
  container.append(el('div', { class: 'ask-bar' }, input, askBtn));

  const suggestions = el('div', { class: 'meet-chips', style: 'margin-top:6px' },
    ...['What did we decide recently?', 'List my open action items', 'What have I said about pricing?']
      .map((q) => el('button', {
        class: 'meet-chip-btn',
        onclick: () => { input.value = q; run(); },
      }, q)));

  const result = el('div', { class: 'ask-result' });

  if (!stats.chunks) {
    container.append(
      el('div', { class: 'callout', style: 'margin-top:20px' },
        el('h2', { class: 'serif-display', html: 'One place for <em>everything</em> you\'ve said.' }),
        el('p', {}, 'Once you dictate and take a few meetings, ask questions across all of it here. Answers are built only from your own notes and cite exactly where they came from. Nothing leaves this Mac.'),
      ),
    );
    return;
  }
  container.append(suggestions, result);
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  async function run() {
    const q = input.value.trim();
    if (!q) return;
    suggestions.style.display = 'none';
    result.replaceChildren(
      el('div', { class: 'ask-answer-card' },
        el('div', { class: 'ask-thinking' },
          el('span', { class: 'ask-spinner' }), 'Searching your notes…')),
    );

    // Show retrieved sources as they arrive, before the answer finishes.
    cleanup();
    let hitsSeen = [];
    unsubs.push(window.sotto.on('know:retrieved', (hits) => { hitsSeen = hits; }));

    let res;
    try {
      res = await window.sotto.invoke('know:ask', q);
    } catch {
      result.replaceChildren(el('div', { class: 'ask-answer-card' }, 'Something went wrong. Try again.'));
      return;
    }

    result.replaceChildren();
    const card = el('div', { class: 'ask-answer-card' });

    if (res.answer) {
      const sources = res.sources || [];
      card.append(el('div', { class: 'ask-answer', html: renderAnswer(res.answer, sources) }));
      if (res.grounded !== undefined && res.grounded < 0.45) {
        card.append(el('div', { class: 'ask-warn' }, '⚠ This answer may not be fully grounded in your notes — check the sources.'));
      }
      const cited = sources.filter((s) => s.cited).length ? sources.filter((s) => s.cited) : sources.slice(0, 3);
      card.append(sourceList('Sources', cited));
    } else if (res.reason === 'llm-unavailable') {
      card.append(
        el('div', {}, 'Found matching notes, but answering needs the local model.'),
        el('div', { class: 'ask-hint' }, 'Turn on AI Polish in Settings → System to enable answers.'),
        sourceList('Matching notes', res.sources || hitsSeen),
      );
    } else if (res.reason === 'no-results') {
      card.append(el('div', {}, 'Nothing in your notes matches that yet.'));
    } else if (res.reason === 'weak-match' || res.reason === 'not-in-notes') {
      card.append(
        el('div', {}, 'I couldn’t find that in your notes.'),
        sourceList('Closest matches', res.sources || []),
      );
    } else {
      card.append(el('div', {}, 'Could not find an answer in your notes.'),
        sourceList('Closest matches', res.sources || []));
    }
    result.append(card);
  }
}

function sourceList(label, sources) {
  if (!sources || !sources.length) return el('div', {});
  const wrap = el('div', { class: 'ask-sources' }, el('div', { class: 'ask-sources-label' }, label));
  for (const s of sources) {
    wrap.append(
      el('div', {
        class: 'ask-source',
        onclick: () => window.sotto.invoke('know:open', { source: s.source, refId: s.refId }),
      },
        el('span', { class: 'ask-source-badge ' + s.source }, sourceLabel(s.source)),
        el('span', { class: 'ask-source-title' }, s.title),
        el('span', { class: 'ask-source-date' }, new Date(s.ts).toLocaleDateString()),
        el('div', { class: 'ask-source-snippet' }, s.snippet || ''),
      ),
    );
  }
  return wrap;
}

function sourceLabel(source) {
  return source === 'dictation' ? 'Dictation' : source === 'shared' ? 'Shared' : 'Meeting';
}

// Turn [1]/[2] citations into superscript chips; escape everything else.
function renderAnswer(text, sources) {
  const esc = String(text)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return esc.replace(/\[(\d+)\]/g, (m, n) => {
    const i = parseInt(n, 10) - 1;
    const title = sources[i] ? sources[i].title.replace(/"/g, '') : '';
    return `<sup class="ask-cite" title="${title}">${n}</sup>`;
  }).replace(/\n/g, '<br>');
}
