// Snippets: spoken triggers that expand into saved text.

import { el, toast, openModal } from '../ui.js';
import { icons } from '../icons.js';

let calloutDismissed = false;

export async function renderSnippets(container) {
  const snippets = await window.sotto.invoke('snip:list');
  container.replaceChildren();

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Snippets'),
      el('button', { class: 'btn-dark', onclick: () => openAddModal(container) }, 'Add new'),
    ),
  );

  container.append(
    el('div', { class: 'tabbar' },
      el('div', { class: 'tab active' }, 'All'),
      el('div', { class: 'tab-tools' },
        el('button', { title: 'Refresh', html: icons.refresh, onclick: () => renderSnippets(container) }),
      ),
    ),
  );

  if (!calloutDismissed && snippets.length < 3) {
    container.append(
      el('div', { class: 'callout' },
        el('button', {
          class: 'callout-close', html: icons.close,
          onclick: () => { calloutDismissed = true; renderSnippets(container); },
        }),
        el('h2', { class: 'serif-display' }, 'Say it once, never type it again.'),
        el('p', { html: 'Save a spoken shortcut for the things you write constantly — <b>emails, links, addresses, intros</b>. Speak the trigger and Sotto expands it instantly.' }),
        el('div', { class: 'callout-chips' },
          triggerChip('personal email', 'you@example.com'),
          triggerChip('my calendar link', 'cal.com/your-name'),
          triggerChip('intro email', 'Hey! Great to meet you — would love to find time to chat…'),
        ),
        el('button', { class: 'btn-dark', onclick: () => openAddModal(container) }, 'Add new snippet'),
      ),
    );
  }

  const items = [...snippets].reverse();
  if (items.length === 0) {
    container.append(
      el('div', { class: 'empty-state' },
        el('div', { class: 'serif-display' }, 'No snippets yet.'),
        el('div', {}, 'Create one for anything you find yourself typing twice a week.'),
      ),
    );
    return;
  }

  const list = el('div', { class: 'entry-list' });
  for (const sn of items) {
    const preview = sn.expansion.length > 64 ? sn.expansion.slice(0, 64) + '…' : sn.expansion;
    list.append(
      el('div', { class: 'entry-row' },
        el('span', { class: 'entry-word' },
          el('span', {}, sn.trigger),
          el('span', { class: 'arrow' }, '→'),
          el('span', { class: 'exp' }, preview),
        ),
        el('div', { class: 'entry-actions' },
          el('button', {
            title: 'Edit', html: icons.pencil,
            onclick: () => openAddModal(container, sn),
          }),
          el('button', {
            title: 'Delete', html: icons.trash,
            onclick: async () => {
              await window.sotto.invoke('snip:remove', sn.id);
              toast('Snippet removed');
              renderSnippets(container);
            },
          }),
        ),
      ),
    );
  }
  container.append(list);
}

function triggerChip(trigger, expansion) {
  const shortExp = expansion.length > 44 ? expansion.slice(0, 44) + '…' : expansion;
  return el('span', { class: 'chip' },
    el('span', {}, trigger),
    el('span', { class: 'arrow' }, '→'),
    el('span', {}, shortExp),
  );
}

function openAddModal(container, existing = null) {
  const trigInput = el('input', { placeholder: 'e.g. personal email', maxlength: '60', value: existing?.trigger || '' });
  const expInput = el('textarea', { rows: '4', maxlength: '4000', placeholder: 'What should Sotto type when you say the trigger?' });
  if (existing) expInput.value = existing.expansion;

  const save = async () => {
    const trigger = trigInput.value.trim();
    const expansion = expInput.value;
    if (!trigger || !expansion.trim()) return;
    if (existing) {
      await window.sotto.invoke('snip:update', { id: existing.id, patch: { trigger, expansion } });
    } else {
      await window.sotto.invoke('snip:add', { trigger, expansion });
    }
    close();
    toast(existing ? 'Snippet updated' : 'Snippet added');
    renderSnippets(container);
  };

  const modal = el('div', { class: 'modal form-modal' },
    el('h2', {}, existing ? 'Edit snippet' : 'Add a snippet'),
    el('div', { class: 'form-field' },
      el('label', {}, 'When I say'),
      trigInput,
      el('div', { class: 'form-hint' }, 'Matched as a whole phrase, any capitalization.'),
    ),
    el('div', { class: 'form-field' },
      el('label', {}, 'Type this instead'),
      expInput,
    ),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn-gray', onclick: () => close() }, 'Cancel'),
      el('button', { class: 'btn-dark', onclick: save }, 'Save'),
    ),
  );
  const close = openModal(modal);
  trigInput.focus();
}
