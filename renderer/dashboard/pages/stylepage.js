// Style: pick how transcripts are cased and punctuated per app category.
// Deterministic presets (no LLM): Formal, Casual, Very casual.

import { el, toast } from '../ui.js';

const STYLES = [
  {
    key: 'formal',
    title: 'Formal.',
    sub: 'Caps + Punctuation',
    example: 'Running about ten minutes late — grab us a table? I’ll take the usual.',
  },
  {
    key: 'casual',
    title: 'Casual',
    sub: 'Caps + Less punctuation',
    example: 'Running about ten minutes late — grab us a table? I’ll take the usual',
  },
  {
    key: 'very-casual',
    title: 'very casual',
    sub: 'No Caps + Less punctuation',
    example: 'running about ten minutes late — grab us a table? i’ll take the usual',
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

  container.append(
    el('div', { class: 'style-note' },
      'Styles are applied on-device with deterministic rules — filler words removed, sentence caps, and punctuation tuned to the level you choose.'),
  );
}
