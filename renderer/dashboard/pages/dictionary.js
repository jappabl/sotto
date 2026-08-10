// Dictionary: teach Sotto names, jargon, and spelling corrections.

import { el, toast, openModal } from '../ui.js';
import { icons } from '../icons.js';

let tab = 'all';
let calloutDismissed = false;

export async function renderDictionary(container) {
  const entries = await window.sotto.invoke('dict:list');
  container.replaceChildren();

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Dictionary'),
      el('button', { class: 'btn-dark', onclick: () => openAddModal(container) }, 'Add new'),
    ),
  );

  const tabs = [
    ['all', 'All'],
    ['manual', 'Added by you'],
    ['auto', 'Auto-learned'],
  ];
  container.append(
    el('div', { class: 'tabbar' },
      tabs.map(([key, label]) => el('div', {
        class: 'tab' + (tab === key ? ' active' : ''),
        onclick: () => { tab = key; renderDictionary(container); },
      }, label)),
      el('div', { class: 'tab-tools' },
        el('button', { title: 'Refresh', html: icons.refresh, onclick: () => renderDictionary(container) }),
      ),
    ),
  );

  if (!calloutDismissed && entries.length < 4) {
    const callout = el('div', { class: 'callout' },
      el('button', {
        class: 'callout-close', html: icons.close,
        onclick: () => { calloutDismissed = true; renderDictionary(container); },
      }),
      el('h2', { class: 'serif-display' }, 'Your words, spelled your way.'),
      el('p', { html: 'Sotto learns the vocabulary that matters to you. Add <b>names, company jargon, product terms, or industry lingo</b> once, and every dictation gets them right.' }),
      el('div', { class: 'callout-chips' },
        exampleChip('Café Verona'),
        exampleChip('Q3 Roadmap'),
        replacementChip('sotto', 'Sotto'),
        exampleChip('SF MOMA'),
        replacementChip('by the way', 'btw'),
      ),
      el('button', { class: 'btn-dark', onclick: () => openAddModal(container) }, 'Add new word'),
    );
    container.append(callout);
  }

  const filtered = entries.filter((d) =>
    tab === 'all' ? true : tab === 'auto' ? d.auto : !d.auto).reverse();

  if (filtered.length === 0) {
    container.append(
      el('div', { class: 'empty-state' },
        el('div', { class: 'serif-display' }, 'No words yet.'),
        el('div', {}, 'Add the names and terms you use so transcripts always spell them right.'),
      ),
    );
    return;
  }

  const list = el('div', { class: 'entry-list' });
  for (const d of filtered) list.append(entryRow(d, container));
  container.append(list);
}

function exampleChip(word) {
  return el('span', { class: 'chip' }, word);
}

function replacementChip(from, to) {
  return el('span', { class: 'chip' },
    el('span', { class: 'strike' }, from),
    el('span', { class: 'arrow' }, '→'),
    el('span', {}, to),
  );
}

function entryRow(d, container) {
  const word = el('span', { class: 'entry-word' });
  if (d.replacement) {
    word.append(
      el('span', {}, d.word),
      el('span', { class: 'arrow' }, '→'),
      el('span', { class: 'exp' }, d.replacement),
    );
  } else {
    word.append(d.word);
  }

  const actions = el('div', { class: 'entry-actions' },
    el('button', {
      title: d.starred ? 'Unstar' : 'Star',
      html: d.starred ? icons.starFill : icons.star,
      onclick: async () => {
        await window.sotto.invoke('dict:update', { id: d.id, patch: { starred: !d.starred } });
        renderDictionary(container);
      },
    }),
    el('button', {
      title: 'Edit', html: icons.pencil,
      onclick: () => openAddModal(container, d),
    }),
    el('button', {
      title: 'Delete', html: icons.trash,
      onclick: async () => {
        await window.sotto.invoke('dict:remove', d.id);
        toast('Removed from dictionary');
        renderDictionary(container);
      },
    }),
  );

  return el('div', { class: 'entry-row' },
    word,
    d.auto ? el('span', { class: 'entry-spark', title: 'Learned automatically' }, '✨') : null,
    d.starred && !d.auto ? el('span', { class: 'entry-spark' }, '⭐') : null,
    actions,
  );
}

function openAddModal(container, existing = null) {
  const wordInput = el('input', { placeholder: 'e.g. Figma, Anaïs, kubectl', maxlength: '60', value: existing?.word || '' });
  const replInput = el('input', { placeholder: 'Leave empty to keep the word as-is', maxlength: '60', value: existing?.replacement || '' });

  const save = async () => {
    const word = wordInput.value.trim();
    if (!word) return;
    if (existing) {
      await window.sotto.invoke('dict:update', { id: existing.id, patch: { word, replacement: replInput.value.trim() } });
    } else {
      await window.sotto.invoke('dict:add', { word, replacement: replInput.value.trim() });
    }
    close();
    toast(existing ? 'Word updated' : 'Added to dictionary');
    renderDictionary(container);
  };

  const modal = el('div', { class: 'modal form-modal' },
    el('h2', {}, existing ? 'Edit word' : 'Add a word'),
    el('div', { class: 'form-field' },
      el('label', {}, 'Word or phrase'),
      wordInput,
      el('div', { class: 'form-hint' }, 'Sotto will match this in your speech and keep the exact spelling.'),
    ),
    el('div', { class: 'form-field' },
      el('label', {}, 'Replace with (optional)'),
      replInput,
      el('div', { class: 'form-hint' }, 'Turn a spoken phrase into a written form — "by the way" → "btw".'),
    ),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn-gray', onclick: () => close() }, 'Cancel'),
      el('button', { class: 'btn-dark', onclick: save }, 'Save'),
    ),
  );
  const close = openModal(modal);
  wordInput.focus();
  modal.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}
