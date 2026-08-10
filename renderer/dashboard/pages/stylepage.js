// Style: pick how transcripts are cased and punctuated per app category.
// Deterministic presets (no LLM): Formal, Casual, Very casual.

import { el, toast } from '../ui.js';

const STYLES = [
  {
    key: 'formal',
    title: 'Formal.',
    sub: 'Caps + Punctuation',
    example: 'Running about ten minutes late, grab us a table? I’ll take the usual.',
  },
  {
    key: 'casual',
    title: 'Casual',
    sub: 'Caps + Less punctuation',
    example: 'Running about ten minutes late, grab us a table? I’ll take the usual',
  },
  {
    key: 'very-casual',
    title: 'very casual',
    sub: 'No Caps + Less punctuation',
    example: 'running about ten minutes late, grab us a table? i’ll take the usual',
  },
];

export async function renderStyle(container) {
  const settings = await window.sotto.invoke('settings:get');
  const selected = settings.textStyle || 'formal';
  container.replaceChildren();

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Style'),
    ),
  );

  container.append(
    el('div', { class: 'callout' },
      el('h2', { class: 'serif-display', html: 'How should your words <em>land</em>?' }),
      el('p', {}, 'Pick a default writing style. Sotto applies it to every dictation — capitalization, punctuation, and the finishing touches.'),
    ),
  );

  const cards = el('div', { class: 'style-cards' });
  for (const s of STYLES) {
    cards.append(
      el('div', {
        class: 'style-card' + (selected === s.key ? ' selected' : ''),
        onclick: async () => {
          await window.sotto.invoke('settings:set', { textStyle: s.key });
          toast('Style updated');
          renderStyle(container);
        },
      },
        el('h3', { class: 'serif-display' }, s.title),
        el('div', { class: 'style-sub' }, s.sub),
        el('div', { class: 'style-example' }, s.example),
      ),
    );
  }
  container.append(cards);

  // ---- Auto Cleanup level ----
  const LEVELS = [
    ['none', 'None', 'Verbatim — exactly what you said, nothing removed.'],
    ['light', 'Light', 'Strips filler words and stutters. Keeps everything else.'],
    ['medium', 'Medium', 'Also fixes self-corrections — "no wait", "scratch that", restatements.'],
    ['high', 'High', 'Also drops throat-clearing openers like "okay so the thing is…".'],
  ];
  const currentLevel = settings.cleanupLevel || 'medium';
  container.append(
    el('div', { class: 'page-head', style: 'margin-top:34px;margin-bottom:14px' },
      el('h1', { class: 'page-title', style: 'font-size:20px' }, 'Auto Cleanup'),
    ),
  );
  const levelCards = el('div', { class: 'style-cards', style: 'grid-template-columns:repeat(4,1fr)' });
  for (const [key, title, desc] of LEVELS) {
    levelCards.append(
      el('div', {
        class: 'style-card' + (currentLevel === key ? ' selected' : ''),
        onclick: async () => {
          await window.sotto.invoke('settings:set', { cleanupLevel: key });
          toast('Cleanup level updated');
          renderStyle(container);
        },
      },
        el('h3', { class: 'serif-display', style: 'font-size:20px' }, title),
        el('div', { class: 'style-sub', style: 'margin-bottom:0' }, desc),
      ),
    );
  }
  container.append(levelCards);

  container.append(
    el('div', { class: 'style-note' },
      'Everything runs on-device with deterministic rules. Any dictation can be reverted to its raw transcript from Home — hover a row and click the undo arrow.'),
  );
}
