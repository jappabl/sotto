// Insights: the personal productivity snapshot.

import { el, abbreviateCount } from '../ui.js';

export async function renderInsights(container) {
  const stats = await window.sotto.invoke('stats:get');
  container.replaceChildren();

  container.append(
    el('div', { class: 'insights-head' },
      el('h2', {}, 'You’ve been on a roll.'),
      el('p', {}, 'A personal snapshot of your dictation with Sotto.'),
    ),
  );

  const words = stats.totalWords;
  const wordsSub = words >= 80000
    ? `That’s a whole novel’s worth of words!`
    : words >= 20000
      ? `That’s a short story and change.`
      : words >= 3000
        ? `A solid essay’s worth — keep going.`
        : `Every word counts. Keep talking.`;

  const grid = el('div', { class: 'stats-grid' },
    statCard('DAILY STREAK', `${stats.dailyStreak} ${plural(stats.dailyStreak, 'day')} 🔥`,
      stats.dailyStreak >= 2 ? `${cap(numWord(stats.dailyStreak))} days in a row. Keep it rolling.` : 'Dictate today to start a streak.'),
    statCard('AVERAGE SPEED', `${stats.avgWpm} words per minute 🏆`,
      stats.avgWpm >= 120 ? 'Roughly three times faster than typing.' : 'Speaking beats typing — stay with it.'),
    statCard('TOTAL WORDS DICTATED', `${abbreviateCount(words)} 🚀`, wordsSub),
    statCard('TOTAL APPS USED', `${stats.appCount} ${plural(stats.appCount, 'app')} 👑`,
      stats.appCount >= 8 ? 'You’re dictating nearly everywhere!' : 'Try dictating in more of your apps.'),
  );
  container.append(grid);
}

function statCard(label, value, sub) {
  return el('div', { class: 'stat-card' },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: 'stat-value' }, value),
    el('div', { class: 'stat-sub' }, sub),
  );
}

function plural(n, w) {
  return `${w}${n === 1 ? '' : 's'}`;
}

function numWord(n) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return words[n] || String(n);
}

function cap(s) {
  return s[0].toUpperCase() + s.slice(1);
}
