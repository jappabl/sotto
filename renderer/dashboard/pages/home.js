// Home: greeting, stats pill, tip + challenge cards, recent activity feed.

import { el, toast, timeLabel, dayLabel, abbreviateCount } from '../ui.js';
import { icons } from '../icons.js';

const DAILY_GOAL = 100;

export async function renderHome(container) {
  const [settings, stats, history, hotkeyLabel] = await Promise.all([
    window.sotto.invoke('settings:get'),
    window.sotto.invoke('stats:get'),
    window.sotto.invoke('history:list', { limit: 200 }),
    window.sotto.invoke('app:hotkey-label'),
  ]);

  container.replaceChildren();

  // ---- header ----
  const hour = new Date().getHours();
  const salutation = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = settings.userName ? `, ${settings.userName}` : '';
  const greeting = history.length === 0
    ? `${salutation}${name}`
    : `Welcome back${name}`;

  const streakSeg = el('span', { class: 'seg' }, '🔥 ', statText(stats.weeklyStreak, 'week'));
  const wordsSeg = el('span', { class: 'seg' }, '🚀 ', `${abbreviateCount(stats.totalWords)} words`);
  const wpmSeg = el('span', { class: 'seg' }, '🏅 ', `${stats.avgWpm} WPM`);
  container.append(
    el('div', { class: 'home-head' },
      el('h1', { class: 'home-greeting' }, greeting),
      el('div', { class: 'stats-pill' }, streakSeg, wordsSeg, wpmSeg),
    ),
  );

  // ---- tip card ----
  const keycaps = hotkeyLabel.map((k, i) => [
    i > 0 ? ' + ' : '',
    el('span', { class: 'keycap' }, k),
  ]);
  container.append(
    el('div', { class: 'tip-card' },
      el('div', {},
        el('h3', {}, 'Voice dictation in any app'),
        el('p', {}, 'Hold down the trigger key ', ...keycaps.flat(), ' and speak into any textbox'),
      ),
      el('button', {
        class: 'btn-dark',
        onclick: () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'help' })),
      }, 'See what you can do'),
    ),
  );

  // ---- daily challenge ----
  const done = Math.min(stats.wordsToday, DAILY_GOAL);
  const pct = Math.round((done / DAILY_GOAL) * 100);
  container.append(
    el('div', { class: 'challenge-card' },
      el('div', { class: 'challenge-body' },
        el('div', { class: 'challenge-title' }, `${DAILY_GOAL} Words a Day Challenge`),
        el('div', { class: 'challenge-sub' },
          done >= DAILY_GOAL ? 'Done for today — keep the streak alive!' : 'A little dictation every day builds the habit.'),
        el('div', { class: 'challenge-track' },
          el('div', { class: 'challenge-fill', style: `width:${pct}%` })),
        el('div', { class: 'challenge-count' }, `${done}/${DAILY_GOAL} WORDS`),
      ),
      el('div', { class: 'challenge-icon', html: icons.wave.replace('width="16" height="16"', 'width="28" height="28"') }),
    ),
  );

  // ---- activity ----
  container.append(el('div', { class: 'section-label' }, 'Recent activity'));

  const visible = history.filter((h) => !h.cancelled || h.audioFile);
  if (visible.length === 0) {
    container.append(
      el('div', { class: 'empty-state' },
        el('div', { class: 'serif-display' }, 'Nothing here yet — say something.'),
        el('div', {}, 'Your dictations will appear here, newest first.'),
      ),
    );
    return;
  }

  let currentDay = null;
  let list = null;
  for (const h of visible) {
    const label = dayLabel(h.ts);
    if (label !== currentDay) {
      currentDay = label;
      container.append(el('div', { class: 'day-label' }, label));
      list = el('div', { class: 'activity-list' });
      container.append(list);
    }
    list.append(activityRow(h, container));
  }
}

function statText(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function activityRow(h, container) {
  const isAudioOnly = !h.text && h.audioFile;
  const textEl = el('div', { class: 'act-text' + (isAudioOnly ? ' audio-only' : '') },
    isAudioOnly ? 'Cancelled dictation (audio saved)' : h.text);
  const meta = [];
  if (h.app) meta.push(h.app);
  if (h.wpm) meta.push(`${h.wpm} WPM`);

  const actions = el('div', { class: 'act-actions' });
  if (h.text) {
    actions.append(el('button', {
      title: 'Copy',
      html: icons.copy,
      onclick: async () => {
        await window.sotto.invoke('history:copy', h.text);
        toast('Copied to clipboard');
      },
    }));
  }
  if (h.raw && h.text && h.raw !== h.text) {
    actions.append(el('button', {
      title: 'Undo AI edit — show the raw transcript',
      html: icons.undo,
      onclick: async () => {
        await window.sotto.invoke('history:toggle-edit', h.id);
        toast('Showing raw transcript');
        renderHome(container);
      },
    }));
  } else if (h.raw && h.text === h.raw && h.words > 0) {
    actions.append(el('button', {
      title: 'Redo AI edit',
      html: icons.spark,
      onclick: async () => {
        const r = await window.sotto.invoke('history:toggle-edit', h.id);
        if (r) toast('AI edit restored');
        renderHome(container);
      },
    }));
  }
  if (h.audioFile) {
    actions.append(el('button', {
      title: 'Play audio',
      html: icons.play,
      onclick: async (e) => {
        const url = await window.sotto.invoke('history:audio-path', h.audioFile);
        if (!url) return toast('Audio no longer available');
        const audio = new Audio(url);
        audio.play();
      },
    }));
  }
  actions.append(el('button', {
    title: 'Delete',
    html: icons.trash,
    onclick: async () => {
      await window.sotto.invoke('history:delete', h.id);
      renderHome(container);
    },
  }));

  return el('div', { class: 'activity-row' },
    el('div', { class: 'act-time' }, timeLabel(h.ts)),
    textEl,
    el('div', { class: 'act-meta' }, meta.join(' · ')),
    actions,
  );
}
