// Meetings: the Granola-style notetaker. List view + meeting view.
// While recording: rough-notes editor with a live transcript rail.
// After: one-click enhancement, tabs for Enhanced / My notes / Transcript,
// and ask-anything chat. All local.

import { el, toast, openModal, timeLabel, dayLabel } from '../ui.js';
import { icons } from '../icons.js';
import { TEMPLATES } from './meeting-templates.js';

let currentMeetingId = null;
let unsubs = [];

function cleanup() {
  for (const u of unsubs) { try { u(); } catch { /* fine */ } }
  unsubs = [];
}

export async function renderMeetings(container) {
  cleanup();
  // Deep-link from Ask: open a specific meeting.
  if (window.__gotoMeeting) {
    currentMeetingId = window.__gotoMeeting;
    window.__gotoMeeting = null;
  }
  if (currentMeetingId) return renderMeeting(container, currentMeetingId);
  return renderList(container);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function renderList(container) {
  const [meetings, status, org, shared] = await Promise.all([
    window.sotto.invoke('meet:list'),
    window.sotto.invoke('meet:status'),
    window.sotto.invoke('org:status'),
    window.sotto.invoke('org:list'),
  ]);
  container.replaceChildren();
  unsubs.push(window.sotto.on('org:changed', () => {
    if (!currentMeetingId) renderList(container);
  }));

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Meetings'),
      status.recording
        ? el('button', {
            class: 'btn-dark rec-live',
            onclick: () => { currentMeetingId = status.id; renderMeetings(container); },
          }, el('span', { class: 'rec-dot' }), 'Recording — open')
        : el('button', {
            class: 'btn-dark',
            onclick: async () => {
              const r = await window.sotto.invoke('meet:start', {});
              if (!r.ok) return toast(r.reason === 'meetcap-missing' ? 'Capture helper missing — run npm run build:native' : 'Could not start');
              currentMeetingId = r.id;
              renderMeetings(container);
            },
          }, 'Start meeting notes'),
    ),
  );

  // The calendar helper is a process spawn, so it must never gate the page.
  // Reserve the slot in document order and fill it when it answers.
  const comingSlot = el('div');
  container.append(comingSlot);
  fillComingUp(comingSlot, container);

  if (meetings.length === 0) {
    container.append(
      el('div', { class: 'callout' },
        el('h2', { class: 'serif-display', html: 'Be in the meeting, <em>not in your notes.</em>' }),
        el('p', {}, 'Sotto listens alongside you with no bot joining the call. Jot half-sentences while you talk; when the meeting ends, they become complete notes built from what was actually said. Everything stays on this Mac.'),
        el('div', { class: 'callout-chips' },
          el('span', { class: 'chip' }, '🎙 No meeting bot'),
          el('span', { class: 'chip' }, '📝 Your notes, completed'),
          el('span', { class: 'chip' }, '🔒 100% local'),
        ),
      ),
      el('div', { class: 'empty-state' },
        el('div', { class: 'serif-display' }, 'No meetings yet.'),
        el('div', {}, 'Start one manually, or just join a call — Sotto will offer to take notes.'),
      ),
    );
    return;
  }

  let currentDay = null;
  let list = null;
  for (const m of meetings) {
    const label = dayLabel(m.startedAt);
    if (label !== currentDay) {
      currentDay = label;
      container.append(el('div', { class: 'day-label' }, label));
      list = el('div', { class: 'activity-list' });
      container.append(list);
    }
    list.append(meetingRow(m, container, status));
  }

  // ---- org: notes shared into the team folder ----
  if (org.configured && shared.length) {
    container.append(el('div', { class: 'day-label' }, `SHARED · ${org.name.toUpperCase()}`));
    const slist = el('div', { class: 'activity-list' });
    for (const s of shared) {
      slist.append(el('div', { class: 'activity-row meet-row' },
        el('div', { class: 'act-time' }, timeLabel(s.sharedAt || s.startedAt)),
        el('div', { class: 'act-text' },
          el('span', { style: 'font-weight:600' }, s.title),
          el('span', { style: 'color:var(--ink-faint)' }, `  ·  by ${s.author}`),
        ),
        el('div', { class: 'act-actions', style: 'display:flex' },
          el('button', {
            class: 'btn-gray', style: 'padding:4px 12px;font-size:12.5px',
            onclick: async (e) => {
              e.stopPropagation();
              const r = await window.sotto.invoke('org:import', s.file);
              if (r.ok) {
                toast('Added to your meetings');
                renderList(container);
              } else toast('Could not import that note');
            },
          }, 'Import'),
        ),
      ));
    }
    container.append(slist);
  } else if (!org.configured) {
    container.append(
      el('div', { class: 'style-note', style: 'margin-top:26px' },
        'Working with a team? Point Sotto at a shared folder in Settings → General and shared notes appear here for everyone. No accounts, no server.'),
    );
  }
}

// "Coming up": the next few calendar meetings, each with a brief built from
// what you already know about the people in them.
async function fillComingUp(slot, container) {
  const cal = await window.sotto.invoke('cal:status').catch(() => ({ available: false }));
  // The page may have moved on while the helper was starting up.
  if (!slot.isConnected) return;
  if (!cal || !cal.available) return;
  if (cal.status !== 'authorized') {
    slot.append(
      el('div', { class: 'tip-card', style: 'margin-bottom:22px' },
        el('div', {},
          el('h3', {}, 'Get briefed before every call'),
          el('p', {}, 'Let Sotto read your calendar and it will remind you what you last agreed with the people you are about to meet. Read-only, and it stays on this Mac.'),
        ),
        el('button', {
          class: 'btn-cal',
          title: 'Connect calendar',
          onclick: async () => {
            const status = await window.sotto.invoke('cal:request').catch(() => null);
            // macOS only ever shows its prompt once. If it was already answered,
            // the click has nothing to show, so send them where they can change it.
            if (status !== 'authorized') {
              toast('Calendar access is off. Turn on Sotto under Privacy and Security.');
              await window.sotto.invoke('perm:cal-open-settings').catch(() => {});
            }
            renderList(container);
          },
        }, el('span', { html: icons.gcal })),
      ),
    );
    return;
  }

  const { events } = await window.sotto.invoke('cal:upcoming', 12).catch(() => ({ events: [] }));
  if (!events.length || !slot.isConnected) return;

  slot.append(el('div', { class: 'day-label' }, 'COMING UP'));
  const list = el('div', { class: 'activity-list' });
  for (const ev of events.slice(0, 4)) {
    const who = (ev.attendees || []).map((a) => a.name || a.email).filter(Boolean);
    const row = el('div', { class: 'activity-row' },
      el('div', { class: 'act-time' }, timeLabel(ev.startMs)),
      el('div', { class: 'act-text' },
        el('span', { style: 'font-weight:600' }, ev.title),
        who.length ? el('span', { style: 'color:var(--ink-faint)' }, `  ·  ${who.slice(0, 3).join(', ')}`) : null,
      ),
      el('button', {
        class: 'btn-gray', style: 'padding:4px 12px;font-size:12.5px;white-space:nowrap',
        onclick: async (e) => {
          const btn = e.target;
          btn.textContent = 'Preparing…';
          const brief = await window.sotto.invoke('brief:build', { event: ev }).catch(() => null);
          btn.remove();
          showBrief(row, brief);
        },
      }, 'Brief me'),
    );
    list.append(row);
  }
  slot.append(list);

  // A notification click asks us to open a specific brief immediately.
  unsubs.push(window.sotto.on('brief:open', async ({ eventId }) => {
    const cached = await window.sotto.invoke('brief:cached', eventId).catch(() => null);
    if (cached) {
      const first = list.querySelector('.activity-row');
      if (first) showBrief(first, cached);
    }
  }));
}

function showBrief(row, brief) {
  const existing = row.parentElement.querySelector('.brief-body');
  if (existing) existing.remove();
  const body = el('div', { class: 'brief-body' });
  if (!brief || brief.empty || !brief.text) {
    body.append(el('div', { class: 'brief-empty' },
      'Nothing in your notes about this one yet.'));
  } else {
    body.append(el('div', { class: 'meet-rendered', html: renderMarkdown(brief.text) }));
    if (brief.company) {
      body.append(el('div', { class: 'brief-src' }, `Company info from ${brief.company.domain}`));
    }
    if (brief.sources && brief.sources.length) {
      body.append(el('div', { class: 'brief-src' },
        'From your notes: ' + brief.sources.slice(0, 3).map((s) => s.title).join(' · ')));
    }
  }
  row.after(body);
}

function meetingRow(m, container, status) {
  const isLive = status.recording && status.id === m.id;
  const dur = m.endedAt ? durationLabel(m.endedAt - m.startedAt)
    : isLive ? 'recording' : '';
  const stateBadge = isLive
    ? el('span', { class: 'meet-badge live' }, el('span', { class: 'rec-dot' }), 'LIVE')
    : m.state === 'enhanced'
      ? el('span', { class: 'meet-badge done' }, '✦ Enhanced')
      : null;

  const actions = el('div', { class: 'act-actions' },
    el('button', {
      title: 'Delete', html: icons.trash,
      onclick: async (e) => {
        e.stopPropagation();
        await window.sotto.invoke('meet:remove', m.id);
        toast('Meeting deleted');
        renderList(container);
      },
    }),
  );

  return el('div', {
    class: 'activity-row meet-row',
    onclick: () => { currentMeetingId = m.id; renderMeetings(container); },
  },
    el('div', { class: 'act-time' }, timeLabel(m.startedAt)),
    el('div', { class: 'act-text' },
      el('span', { style: 'font-weight:600' }, m.title),
      m.appHint ? el('span', { style: 'color:var(--ink-faint)' }, `  ·  ${m.appHint}`) : null,
    ),
    el('div', { class: 'act-meta' }, [dur, stateBadge ? '' : null].filter(Boolean).join('')),
    stateBadge,
    actions,
  );
}

// ---------------------------------------------------------------------------
// Meeting view (live + ended)
// ---------------------------------------------------------------------------

async function renderMeeting(container, id) {
  cleanup();
  const data = await window.sotto.invoke('meet:read', id);
  const status = await window.sotto.invoke('meet:status');
  if (!data) { currentMeetingId = null; return renderList(container); }
  const live = status.recording && status.id === id;
  container.replaceChildren();

  // ---- header ----
  const titleInput = el('input', { class: 'meet-title', value: data.meta.title, maxlength: '120' });
  titleInput.addEventListener('change', () =>
    window.sotto.invoke('meet:rename', { id, title: titleInput.value.trim() || data.meta.title }));

  const back = el('button', {
    class: 'btn-ghost',
    onclick: () => { currentMeetingId = null; renderMeetings(container); },
  }, '← All meetings');

  const headRight = el('div', { class: 'meet-head-right' });
  if (live) {
    headRight.append(
      el('span', { class: 'meet-badge live' }, el('span', { class: 'rec-dot' }), 'LIVE'),
      el('button', {
        class: 'btn-dark',
        onclick: async () => {
          toast('Wrapping up…');
          await window.sotto.invoke('meet:stop');
          renderMeeting(container, id);
        },
      }, 'End meeting'),
    );
  } else {
    const tSel = el('select', { class: 'meet-template' },
      Object.entries(TEMPLATES).map(([k, t]) => {
        const o = el('option', { value: k }, t.label);
        if (k === (data.meta.template || 'auto')) o.selected = true;
        return o;
      }));
    tSel.addEventListener('change', () =>
      window.sotto.invoke('meet:set-template', { id, template: tSel.value }));
    headRight.append(tSel);
    headRight.append(el('button', {
      class: 'btn-gray',
      onclick: async () => {
        const org = await window.sotto.invoke('org:status');
        if (!org.configured) {
          return toast('Set an org folder first: Settings → General → Org space');
        }
        const r = await window.sotto.invoke('org:share', id);
        toast(r.ok ? `Shared with ${org.name}` : 'Share failed');
      },
    }, 'Share'));
    headRight.append(el('button', {
      class: 'btn-dark',
      onclick: () => runEnhance(container, id),
    }, data.enhanced ? 'Re-enhance' : '✦ Enhance notes'));
  }

  container.append(
    el('div', { class: 'meet-head' }, back, headRight),
    el('div', { class: 'meet-title-row' }, titleInput),
  );

  // ---- body ----
  if (live) {
    renderLiveBody(container, id, data);
  } else {
    renderEndedBody(container, id, data);
  }
}

let showTranscript = false; // hidden by default: notes are the product

function renderLiveBody(container, id, data) {
  const notes = el('textarea', {
    class: 'meet-notes',
    placeholder: 'Type rough cues, typos and all. "pricing pushback", "follow up re: API". Sotto completes them afterwards from what was said.',
  });
  notes.value = data.notes;
  let saveTimer = null;
  notes.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() =>
      window.sotto.invoke('meet:save-notes', { id, notes: notes.value }), 600);
  });

  const feed = el('div', { class: 'meet-feed' });
  for (const seg of data.transcript.slice(-40)) feed.append(segmentRow(seg));

  const meters = el('div', { class: 'meet-meters' },
    meter('You', 'mic'), meter('Them', 'sys'));

  const layout = el('div', { class: 'meet-live' + (showTranscript ? '' : ' solo') });
  const toggle = el('button', {
    class: 'btn-ghost',
    style: 'font-size:12px;padding:3px 8px',
    onclick: () => {
      showTranscript = !showTranscript;
      renderMeeting(container, id);
    },
  }, showTranscript ? 'Hide transcript' : 'Show transcript');

  layout.append(
    el('div', { class: 'meet-pane' },
      el('div', { class: 'meet-pane-label' }, 'MY NOTES',
        el('span', { style: 'display:flex;gap:10px;align-items:center' }, meters, toggle)),
      notes,
    ),
  );
  if (showTranscript) {
    layout.append(
      el('div', { class: 'meet-pane meet-pane-feed' },
        el('div', { class: 'meet-pane-label' }, 'LIVE TRANSCRIPT',
          el('span', { style: 'font-weight:500;letter-spacing:0;text-transform:none;color:var(--ink-faint)' },
            'Make sure everyone’s okay with transcription')),
        feed,
      ),
    );
  }
  container.append(layout);
  notes.focus();
  feed.scrollTop = feed.scrollHeight;

  unsubs.push(window.sotto.on('meeting:titled', ({ id: mid, title }) => {
    // The calendar named it a moment after recording began. Do not overwrite
    // a title the user has already started typing over.
    if (mid !== id || !title || document.activeElement === titleInput) return;
    // Only replace the generated stand-in ("Monday morning meeting").
    if (!titleInput.value || /(morning|afternoon|evening) meeting$/i.test(titleInput.value)) {
      titleInput.value = title;
    }
  }));
  unsubs.push(window.sotto.on('meeting:segment', ({ id: mid, seg }) => {
    if (mid !== id) return;
    feed.append(segmentRow(seg));
    feed.scrollTop = feed.scrollHeight;
  }));
  unsubs.push(window.sotto.on('meeting:level', ({ id: mid, mic, sys }) => {
    if (mid !== id) return;
    setMeter('mic', mic);
    setMeter('sys', sys);
  }));
  unsubs.push(window.sotto.on('meeting:warning', ({ id: mid, message }) => {
    if (mid !== id) return;
    toast(message);
  }));
  unsubs.push(window.sotto.on('meeting:ended', ({ id: mid }) => {
    if (mid === id) renderMeeting(container, id);
  }));
}

function meter(label, key) {
  return el('span', { class: 'meet-meter' },
    el('span', { class: 'meet-meter-label' }, label),
    el('span', { class: 'meet-meter-track' },
      el('span', { class: 'meet-meter-fill', id: 'meter-' + key })),
  );
}

function setMeter(key, v) {
  const fill = document.getElementById('meter-' + key);
  if (fill) fill.style.width = Math.min(100, Math.round(Math.sqrt(v) * 260)) + '%';
}

function segmentRow(seg) {
  return el('div', { class: 'meet-seg ' + (seg.who === 'me' ? 'me' : 'them') },
    el('span', { class: 'meet-who' }, seg.who === 'me' ? 'You' : 'Them'),
    el('span', { class: 'meet-seg-text' }, seg.text),
  );
}

function renderEndedBody(container, id, data) {
  const tabs = ['Enhanced', 'My notes', 'Transcript'];
  let active = data.enhanced ? 'Enhanced' : 'My notes';
  const body = el('div', { class: 'meet-body' });

  const bar = el('div', { class: 'tabbar' },
    tabs.map((t) => el('div', {
      class: 'tab' + (t === active ? ' active' : ''),
      onclick: () => { active = t; paint(); rebuildTabs(); },
    }, t)),
    el('div', { class: 'tab-tools' },
      el('button', {
        title: 'Copy current view', html: icons.copy,
        onclick: async () => {
          const text = active === 'Enhanced' ? data.enhanced
            : active === 'My notes' ? data.notes
            : data.transcript.map((s) => `${s.who === 'me' ? 'You' : 'Them'}: ${s.text}`).join('\n');
          await window.sotto.invoke('meet:copy', text);
          toast('Copied');
        },
      }),
    ),
  );
  function rebuildTabs() {
    [...bar.querySelectorAll('.tab')].forEach((n) =>
      n.classList.toggle('active', n.textContent === active));
  }

  function paint() {
    body.replaceChildren();
    if (active === 'Enhanced') {
      if (data.enhanced) {
        if (data.annotated && data.annotated.length) {
          body.append(
            el('div', { class: 'meet-provenance-hint' },
              'Black is what you wrote. Gray is what Sotto heard. Hover a gray line and click “source” to see the moment it came from.'),
            renderAnnotated(data.annotated, data.transcript),
          );
        } else {
          body.append(el('div', { class: 'meet-rendered', html: renderMarkdown(data.enhanced) }));
        }
      } else {
        body.append(el('div', { class: 'empty-state' },
          el('div', { class: 'serif-display' }, 'Not enhanced yet.'),
          el('div', {}, 'Click “✦ Enhance notes” to turn your rough notes and the transcript into finished notes.'),
        ));
      }
    } else if (active === 'My notes') {
      const notes = el('textarea', { class: 'meet-notes tall' });
      notes.value = data.notes;
      let t = null;
      notes.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          data.notes = notes.value;
          window.sotto.invoke('meet:save-notes', { id, notes: notes.value });
        }, 600);
      });
      body.append(notes);
    } else {
      const feed = el('div', { class: 'meet-feed tall' });
      if (data.transcript.length === 0) {
        feed.append(el('div', { class: 'empty-state' }, el('div', {}, 'No transcript was captured.')));
      }
      for (const seg of data.transcript) feed.append(segmentRow(seg));
      body.append(feed);
    }
  }
  paint();

  // ---- ask anything ----
  const q = el('input', { class: 'meet-ask-input', placeholder: 'Ask about this meeting… "what did we decide on pricing?"' });
  const askBtn = el('button', { class: 'btn-dark', onclick: () => ask() }, 'Ask');
  const answers = el('div', { class: 'meet-answers' });
  const chips = el('div', { class: 'meet-chips' },
    el('button', { class: 'meet-chip-btn', onclick: () => ask('List every action item with its owner.') }, 'List actions'),
    el('button', { class: 'meet-chip-btn', onclick: () => ask('Give me a three sentence summary of this meeting.') }, 'TL;DR'),
    el('button', { class: 'meet-chip-btn', onclick: () => ask('Draft a short follow-up message to the other participants covering what we agreed and the next steps.') }, 'Draft follow-up'),
  );
  async function ask(preset) {
    const question = preset || q.value.trim();
    if (!question) return;
    if (!preset) q.value = '';
    const row = el('div', { class: 'meet-answer' },
      el('div', { class: 'meet-answer-q' }, question),
      el('div', { class: 'meet-answer-a' }, 'Thinking…'));
    answers.prepend(row);
    try {
      const a = await window.sotto.invoke('meet:ask', { id, question });
      row.lastChild.textContent = a || 'No answer.';
    } catch {
      row.lastChild.textContent = 'Needs AI Polish — enable it in Settings → System.';
    }
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });

  container.append(bar, body, chips,
    el('div', { class: 'meet-ask' }, q, askBtn),
    el('div', { class: 'meet-chat-footer' }, 'Answers come from this meeting only, on this Mac. Double-check important details.'),
    answers);
}

// Provenance-aware rendering: per-line origin colors + source magnifier.
function renderAnnotated(annotated, transcript) {
  const root = el('div', { class: 'meet-rendered' });
  let list = null;
  for (const line of annotated) {
    const raw = line.text;
    const h = raw.match(/^(#{1,3})\s+(.*)/);
    const li = raw.match(/^\s*[-*]\s+(\[[ x]\]\s+)?(.*)/);
    const cls = 'meet-line-' + (line.origin === 'user' ? 'user' : 'ai');
    let node;
    if (h) {
      list = null;
      node = el('h' + (h[1].length + 1), { class: cls, html: inline(escapeText(h[2])) });
      root.append(node);
    } else if (li) {
      if (!list) { list = el('ul'); root.append(list); }
      const checked = li[1] ? (li[1].includes('x') ? '☑ ' : '☐ ') : '';
      node = el('li', { class: cls, html: checked + inline(escapeText(li[2])) });
      list.append(node);
    } else if (raw.trim() === '') {
      list = null;
      continue;
    } else {
      list = null;
      node = el('p', { class: cls, html: inline(escapeText(raw)) });
      root.append(node);
    }
    if (line.origin === 'ai' && line.src && transcript && transcript.length) {
      const btn = el('span', { class: 'meet-src-btn' }, '🔍 source');
      let pop = null;
      btn.addEventListener('click', () => {
        if (pop) { pop.remove(); pop = null; return; }
        const from = line.src.t0 - 20;
        const to = line.src.t1 + 20;
        const segs = transcript.filter((s) => s.t1 >= from && s.t0 <= to).slice(0, 6);
        pop = el('div', { class: 'meet-src-pop' },
          segs.length ? segs.map((s) => segmentRow(s)) : el('span', {}, 'Source moment not found.'));
        node.after(pop);
      });
      node.append(btn);
    }
  }
  return root;
}

function escapeText(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function runEnhance(container, id) {
  const scrim = el('div', { class: 'scrim' },
    el('div', { class: 'modal enhance-modal' },
      el('h2', { class: 'serif-display', style: 'font-size:26px;margin-bottom:8px' }, 'Enhancing your notes.'),
      el('p', { style: 'color:var(--ink-soft);margin-bottom:18px', id: 'enh-stage' },
        'Getting started…'),
      el('div', { class: 'dl-track', style: 'width:100%' },
        el('div', { class: 'dl-fill', id: 'enh-fill' })),
    ));
  document.getElementById('modal-root').append(scrim);
  const un = window.sotto.on('meet:enhance-progress', ({ id: mid, stage, progress }) => {
    if (mid !== id) return;
    const f = document.getElementById('enh-fill');
    if (f) f.style.right = `${Math.max(0, 100 - progress * 100)}%`;
    const s = document.getElementById('enh-stage');
    if (s && stage) s.textContent = stage + ' All on this Mac.';
  });
  try {
    await window.sotto.invoke('meet:enhance', id);
    toast('Notes enhanced ✦');
  } catch (err) {
    toast(String(err.message || '').includes('llm')
      ? 'Enable AI Polish in Settings → System first'
      : 'Enhancement failed — try again');
  } finally {
    un();
    scrim.remove();
    renderMeeting(container, id);
  }
}

// Minimal, safe markdown: escape everything first, then whitelist transforms.
function renderMarkdown(md) {
  const esc = String(md)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const lines = esc.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)/);
    const li = line.match(/^\s*[-*]\s+(\[[ x]\]\s+)?(.*)/);
    if (h) {
      if (inList) { out.push('</ul>'); inList = false; }
      const level = h[1].length;
      out.push(`<h${level + 1}>${inline(h[2])}</h${level + 1}>`);
    } else if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      const checked = li[1] ? (li[1].includes('x') ? '☑ ' : '☐ ') : '';
      out.push(`<li>${checked}${inline(li[2])}</li>`);
    } else if (line.trim() === '') {
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
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function durationLabel(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}
