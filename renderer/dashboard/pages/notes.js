// Notes: brain dumps. Talk to yourself, get organized notes back.

import { el, toast, timeLabel, dayLabel } from '../ui.js';
import { icons } from '../icons.js';

let openId = null;
let unsubs = [];
function cleanup() { for (const u of unsubs) { try { u(); } catch {} } unsubs = []; }

export async function renderNotes(container) {
  cleanup();
  unsubs.push(window.sotto.on('notes:changed', () => renderNotes(container)));
  if (openId) return renderOne(container, openId);
  return renderList(container);
}

async function renderList(container) {
  const [notes, hotkey] = await Promise.all([
    window.sotto.invoke('notes:list'),
    window.sotto.invoke('notes:hotkey'),
  ]);
  container.replaceChildren();

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Notes'),
      el('button', {
        class: 'btn-dark',
        onclick: async () => {
          const r = await window.sotto.invoke('notes:toggle-capture');
          toast(r === 'started' ? 'Talking… press again (or the shortcut) when done'
            : r === 'stopping' ? 'Writing your note…' : 'Finish your dictation first');
        },
      }, 'Start brain dump'),
    ),
  );

  container.append(
    el('div', { class: 'tip-card' },
      el('div', {},
        el('h3', {}, 'Think out loud, get written notes'),
        el('p', {}, 'Press ', ...keycaps(hotkey), ' anywhere and just talk. Ramble, backtrack, jump around. Sotto organizes it into headings, action items, and open questions, then makes it searchable in Ask.'),
      ),
    ),
  );

  if (!notes.length) {
    container.append(
      el('div', { class: 'empty-state' },
        el('div', { class: 'serif-display' }, 'Nothing dumped yet.'),
        el('div', {}, 'Next time a thought won’t leave you alone, talk it out.'),
      ),
    );
    return;
  }

  let day = null;
  let list = null;
  for (const n of notes) {
    const label = dayLabel(n.createdAt);
    if (label !== day) {
      day = label;
      container.append(el('div', { class: 'day-label' }, label));
      list = el('div', { class: 'activity-list' });
      container.append(list);
    }
    list.append(
      el('div', {
        class: 'activity-row meet-row',
        onclick: () => { openId = n.id; renderNotes(container); },
      },
        el('div', { class: 'act-time' }, timeLabel(n.createdAt)),
        el('div', { class: 'act-text' },
          el('span', { style: 'font-weight:600' }, n.title),
          el('span', { style: 'color:var(--ink-faint)' }, `  ·  ${n.words} words`),
        ),
        n.state === 'organized'
          ? el('span', { class: 'meet-badge done' }, '✦ Written')
          : el('span', { class: 'meet-badge live' }, 'RAW'),
        el('div', { class: 'act-actions' },
          el('button', {
            title: 'Delete', html: icons.trash,
            onclick: async (e) => {
              e.stopPropagation();
              await window.sotto.invoke('notes:remove', n.id);
              renderList(container);
            },
          }),
        ),
      ),
    );
  }
}

async function renderOne(container, id) {
  const data = await window.sotto.invoke('notes:read', id);
  if (!data) { openId = null; return renderList(container); }
  container.replaceChildren();

  let tab = data.note ? 'Written' : 'What I said';
  const body = el('div', { class: 'meet-body' });

  container.append(
    el('div', { class: 'meet-head' },
      el('button', { class: 'btn-ghost', onclick: () => { openId = null; renderNotes(container); } }, '← All notes'),
      el('div', { class: 'meet-head-right' },
        el('button', {
          class: 'btn-gray',
          onclick: async () => {
            await window.sotto.invoke('meet:copy', tab === 'Written' ? data.note : data.raw);
            toast('Copied');
          },
        }, 'Copy'),
        data.note ? null : el('button', {
          class: 'btn-dark',
          onclick: async () => {
            toast('Writing…');
            try { await window.sotto.invoke('notes:organize', id); toast('Note written ✦'); }
            catch { toast('Needs AI Polish — Settings → System'); }
            renderNotes(container);
          },
        }, '✦ Write it up'),
      ),
    ),
    el('div', { class: 'meet-title-row' }, el('h1', { class: 'page-title' }, data.meta.title)),
  );

  const tabs = data.note ? ['Written', 'What I said'] : ['What I said'];
  const bar = el('div', { class: 'tabbar' },
    tabs.map((t) => el('div', {
      class: 'tab' + (t === tab ? ' active' : ''),
      onclick: () => {
        tab = t;
        [...bar.querySelectorAll('.tab')].forEach((n) => n.classList.toggle('active', n.textContent === t));
        paint();
      },
    }, t)));

  function paint() {
    body.replaceChildren();
    if (tab === 'Written' && data.note) {
      body.append(el('div', { class: 'meet-rendered', html: renderMd(data.note) }));
    } else {
      body.append(el('div', { class: 'note-raw' }, data.raw || '(empty)'));
    }
  }
  paint();
  container.append(bar, body);
}

function keycaps(hotkey) {
  return String(hotkey || 'Command+Shift+N').split('+').flatMap((k, i) => [
    i ? ' + ' : '',
    el('span', { class: 'keycap' }, k.replace('Command', '⌘').replace('Shift', '⇧').replace('Control', '⌃').replace('Alt', '⌥')),
  ]);
}

function renderMd(md) {
  const esc = String(md).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const out = [];
  let inList = false;
  for (const line of esc.split('\n')) {
    const h = line.match(/^(#{1,3})\s+(.*)/);
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (h) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
    } else if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (!line.trim()) {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}
function inline(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}
