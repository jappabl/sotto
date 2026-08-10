// Help: a practical cheat-sheet for everything Sotto can do.

import { el } from '../ui.js';

export async function renderHelp(container) {
  const hotkeyLabel = await window.sotto.invoke('app:hotkey-label');
  container.replaceChildren();

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Help'),
    ),
  );

  container.append(
    el('div', { class: 'callout' },
      el('h2', { class: 'serif-display', html: 'Talk, don’t <em>type</em>.' }),
      el('p', {}, 'Everything works from one gesture: hold your key, say what you mean, let go.'),
    ),
  );

  const caps = hotkeyLabel.map((k) => `<span class="keycap">${k}</span>`).join(' + ');
  const rows = [
    ['Dictate anywhere', `Click into any textbox, hold ${caps}, speak, release. Your words are cleaned up and pasted at the cursor.`],
    ['Hands-free mode', `Double-tap ${caps} (or click the flow bar) to keep dictating without holding. Tap once or press <span class="keycap">esc</span> to stop.`],
    ['Cancel a dictation', `Press <span class="keycap">esc</span> while recording. Longer takes are kept in Recent activity as audio.`],
    ['Spoken punctuation', 'Say “comma”, “period”, “question mark”, “new line”, or “new paragraph” to punctuate as you go.'],
    ['Fix yourself mid-sentence', 'Say “scratch that” or “I mean” and Sotto keeps only the correction.'],
    ['Send instantly', 'End with “press enter” and Sotto hits Enter after pasting — great in chat apps.'],
    ['Teach it your words', 'Add names and jargon in Dictionary. Add “spoken phrase → written form” rules for shorthand.'],
    ['Never re-type boilerplate', 'Save Snippets — say “personal email” and your full address appears.'],
    ['Choose your voice', 'Pick Formal, Casual, or very casual in Style to control caps and punctuation.'],
    ['Everything stays here', 'Transcription runs on-device. No account, no cloud, no telemetry.'],
  ];

  const list = el('div', { class: 'entry-list' });
  for (const [title, desc] of rows) {
    list.append(
      el('div', { class: 'activity-row' },
        el('div', { class: 'act-text' },
          el('div', { style: 'font-weight:600;margin-bottom:3px' }, title),
          el('div', { style: 'color:var(--ink-soft)', html: desc }),
        ),
      ),
    );
  }
  container.append(list);
}
