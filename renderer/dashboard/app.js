// Dashboard shell: sidebar navigation + page router.

import { el } from './ui.js';
import { icons } from './icons.js';
import { renderHome } from './pages/home.js';
import { renderAsk } from './pages/ask.js';
import { renderNotes } from './pages/notes.js';
import { renderMeetings } from './pages/meetings.js';
import { renderDictionary } from './pages/dictionary.js';
import { renderSnippets } from './pages/snippets.js';
import { renderStyle } from './pages/stylepage.js';
import { renderInsights } from './pages/insights.js';
import { renderSettings } from './pages/settings.js';
import { renderHelp } from './pages/help.js';

const PAGES = {
  home: { label: 'Home', icon: icons.home, render: renderHome },
  ask: { label: 'Ask', icon: icons.sparkleSearch, render: renderAsk },
  notes: { label: 'Notes', icon: icons.notepad, render: renderNotes },
  meetings: { label: 'Meetings', icon: icons.people, render: renderMeetings },
  dictionary: { label: 'Dictionary', icon: icons.book, render: renderDictionary },
  snippets: { label: 'Snippets', icon: icons.scissors, render: renderSnippets },
  style: { label: 'Style', icon: icons.type, render: renderStyle },
  insights: { label: 'Insights', icon: icons.wave, render: renderInsights },
};

const BOTTOM_PAGES = {
  settings: { label: 'Settings', icon: icons.gear, render: renderSettings },
  help: { label: 'Help', icon: icons.help, render: renderHelp },
};

const page = document.getElementById('page');
const navTop = document.getElementById('nav-top');
const navBottom = document.getElementById('nav-bottom');
let current = 'home';
let permBadge = false;

function buildNav() {
  navTop.replaceChildren();
  navBottom.replaceChildren();
  for (const [key, def] of Object.entries(PAGES)) {
    navTop.append(navItem(key, def));
  }
  for (const [key, def] of Object.entries(BOTTOM_PAGES)) {
    navBottom.append(navItem(key, def));
  }
}

function navItem(key, def) {
  const item = el('div', {
    class: 'nav-item' + (current === key ? ' active' : ''),
    onclick: () => navigate(key),
  }, el('span', { html: def.icon }), def.label);
  if (key === 'settings' && permBadge) {
    item.append(el('span', { class: 'nav-badge' }, '1'));
  }
  return item;
}

async function navigate(key) {
  current = key;
  buildNav();
  const def = PAGES[key] || BOTTOM_PAGES[key];
  page.scrollTop = 0;
  await def.render(page);
}

window.addEventListener('navigate', (e) => navigate(e.detail));
window.sotto.on('debug:navigate', (pageKey) => navigate(pageKey));

// Live refresh when dictation lands or settings change elsewhere.
window.sotto.on('data:changed', () => {
  if (current === 'home' || current === 'insights') navigate(current);
});
window.sotto.on('settings:changed', () => {
  if (current === 'settings' || current === 'home') navigate(current);
});
window.sotto.on('ob:ax-status', async () => { await refreshPermBadge(); buildNav(); });
window.sotto.on('know:goto-meeting', (id) => {
  window.__gotoMeeting = id;
  navigate('meetings');
});

async function refreshPermBadge() {
  const [mic, ax] = await Promise.all([
    window.sotto.invoke('perm:mic-status'),
    window.sotto.invoke('perm:ax-status'),
  ]);
  permBadge = mic !== 'granted' || !ax;
}

(async () => {
  await refreshPermBadge();
  buildNav();
  navigate('home');
})();
