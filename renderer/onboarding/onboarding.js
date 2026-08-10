// Onboarding wizard: welcome → name → permissions → mic test → shortcut →
// model check → try it yourself → done.

const stage = document.getElementById('stage');
const dotsEl = document.getElementById('dots');

const STEPS = ['welcome', 'name', 'permissions', 'mic', 'shortcut', 'model', 'try', 'done'];
let stepIndex = 0;
let userName = '';
let chosenHotkey = 'fn';
let micStream = null;
let smokeMode = false; // set by the visual smoke test: no mic, no downloads

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

function renderDots() {
  dotsEl.replaceChildren();
  for (let i = 0; i < STEPS.length - 1; i++) {
    dotsEl.append(el('i', { class: i <= stepIndex ? 'done' : '' }));
  }
}

function go(delta = 1) {
  stopMicMeter();
  stepIndex = Math.max(0, Math.min(STEPS.length - 1, stepIndex + delta));
  render();
}

function render() {
  renderDots();
  stage.replaceChildren();
  const step = STEPS[stepIndex];
  RENDERERS[step]();
}

const RENDERERS = {
  welcome() {
    stage.append(
      el('h1', { class: 'ob-title serif-display', html: 'Don’t type it.<br /><em>Just say it.</em>' }),
      el('p', { class: 'ob-sub' },
        'Sotto turns your voice into clean, ready-to-send text in any app — entirely on this Mac. No account. No cloud. Nothing leaves your machine.'),
      el('div', { class: 'ob-actions' },
        el('button', { class: 'btn-dark', onclick: () => go(1) }, 'Get started'),
      ),
    );
  },

  name() {
    const input = el('input', { class: 'ob-input', placeholder: 'What should we call you?', maxlength: '40' });
    const next = () => {
      userName = input.value.trim();
      go(1);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    stage.append(
      el('h1', { class: 'ob-title serif-display' }, 'First things first.'),
      el('p', { class: 'ob-sub' }, 'Your name stays on this Mac — it just makes the app feel like yours.'),
      input,
      el('div', { class: 'ob-actions' },
        el('button', { class: 'btn-dark', onclick: next }, 'Continue'),
        el('button', { class: 'btn-ghost', onclick: () => go(1) }, 'Skip'),
      ),
    );
    input.focus();
  },

  permissions() {
    const cards = el('div', { class: 'perm-cards' });
    stage.append(
      el('h1', { class: 'ob-title serif-display' }, 'Two permissions, then magic.'),
      el('p', { class: 'ob-sub' },
        'Sotto needs your microphone to hear you, and Accessibility to watch for the hotkey and paste text where your cursor is.'),
      cards,
      el('div', { class: 'ob-actions' },
        el('button', { class: 'btn-dark', onclick: () => go(1) }, 'Continue'),
      ),
    );

    const micIcon = '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="6" y="1.8" width="4" height="7.4" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0"/><path d="M8 12v2.2"/></svg>';
    const axIcon = '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="5.4" r="1.5"/><path d="M4.8 8.2h6.4M8 8.2v3.6M6.4 13l1.6-1.6L9.6 13"/></svg>';

    const refresh = async () => {
      const [mic, ax] = await Promise.all([
        window.sotto.invoke('perm:mic-status'),
        window.sotto.invoke('perm:ax-status'),
      ]);
      cards.replaceChildren(
        permCard(micIcon, 'Microphone', 'So Sotto can hear what you say.',
          mic === 'granted', async () => {
            const ok = await window.sotto.invoke('perm:mic-request');
            if (!ok) await window.sotto.invoke('perm:mic-open-settings');
            setTimeout(refresh, 800);
          }),
        permCard(axIcon, 'Accessibility', 'For the global hotkey and pasting into apps.',
          ax, async () => {
            await window.sotto.invoke('perm:ax-prompt');
            await window.sotto.invoke('perm:ax-open-settings');
          }),
      );
    };

    window.sotto.on('ob:ax-status', refresh);
    refresh();
    // Poll while this step is visible — the user grants in System Settings.
    const poll = setInterval(() => {
      if (STEPS[stepIndex] !== 'permissions') return clearInterval(poll);
      refresh();
    }, 1500);

    function permCard(icon, name, desc, granted, onAllow) {
      return el('div', { class: 'perm-card' },
        el('div', { class: 'perm-icon', html: icon }),
        el('div', { class: 'perm-info' },
          el('div', { class: 'perm-name' }, name),
          el('div', { class: 'perm-desc' }, desc),
        ),
        el('div', { class: 'perm-action' },
          granted
            ? el('span', { class: 'perm-granted' }, '✓ Granted')
            : el('button', { class: 'btn-dark', onclick: onAllow }, 'Allow'),
        ),
      );
    }
  },

  mic() {
    const meter = el('div', { class: 'mic-meter' });
    const NUM = 24;
    for (let i = 0; i < NUM; i++) meter.append(el('i'));
    const barEls = [...meter.children];
    stage.append(
      el('h1', { class: 'ob-title serif-display' }, 'Say something.'),
      el('p', { class: 'ob-sub' }, 'Anything at all — watch the bars move when Sotto hears you.'),
      meter,
      el('div', { class: 'ob-actions' },
        el('button', { class: 'btn-dark', onclick: () => go(1) }, 'The bars moved!'),
        el('button', { class: 'btn-ghost', onclick: () => go(1) }, 'Skip'),
      ),
    );
    startMicMeter(barEls);
  },

  shortcut() {
    const options = [
      ['fn', ['fn'], 'Bottom-left of most keyboards'],
      ['ctrl+alt', ['ctrl', 'opt'], 'If fn is busy on yours'],
      ['rcmd', ['right ⌘'], 'Right thumb, zero reach'],
    ];
    const cardEls = new Map();
    const cards = el('div', { class: 'hk-cards' });
    for (const [key, caps, label] of options) {
      const card = el('div', {
        class: 'hk-card' + (chosenHotkey === key ? ' selected' : ''),
        onclick: () => {
          chosenHotkey = key;
          for (const [k, n] of cardEls) n.classList.toggle('selected', k === key);
        },
      },
        el('div', {}, ...caps.flatMap((c, i) => [i ? ' + ' : '', el('span', { class: 'keycap' }, c)])),
        el('div', { class: 'hk-card-label' }, label),
      );
      cardEls.set(key, card);
      cards.append(card);
    }
    stage.append(
      el('h1', { class: 'ob-title serif-display', html: 'Pick your <em>talk</em> key.' }),
      el('p', { class: 'ob-sub' }, 'Hold it to dictate, release to paste. Double-tap it for hands-free. You can change this anytime in Settings.'),
      cards,
      el('div', { class: 'ob-actions' },
        el('button', {
          class: 'btn-dark',
          onclick: async () => {
            await window.sotto.invoke('settings:set', { hotkey: chosenHotkey });
            go(1);
          },
        }, 'Continue'),
      ),
    );
  },

  async model() {
    stage.append(el('h1', { class: 'ob-title serif-display' }, 'Waking the transcriber.'));
    const sub = el('p', { class: 'ob-sub' }, 'Checking for the on-device speech model…');
    stage.append(sub);
    if (smokeMode) {
      sub.textContent = 'Downloading the speech model (~150 MB). Runs entirely on your Mac, forever offline.';
      const t = el('div', { class: 'dl-track' }, el('div', { class: 'dl-fill', style: 'right:45%' }));
      stage.append(t);
      return;
    }
    const models = await window.sotto.invoke('models:list');
    const settings = await window.sotto.invoke('settings:get');
    const target = models.find((m) => m.name === settings.model) || models[1];
    if (target && target.installed) {
      go(1);
      return;
    }
    sub.textContent = 'Downloading the speech model (~150 MB). Runs entirely on your Mac, forever offline.';
    const track = el('div', { class: 'dl-track' }, el('div', { class: 'dl-fill' }));
    stage.append(track);
    const fill = track.firstChild;
    window.sotto.on('ob:model-progress', ({ progress }) => {
      fill.style.right = `${Math.max(0, 100 - progress * 100)}%`;
    });
    try {
      await window.sotto.invoke('models:download', target.name);
      go(1);
    } catch {
      sub.textContent = 'Download failed. Check your connection and try again.';
      stage.append(el('div', { class: 'ob-actions' },
        el('button', { class: 'btn-dark', onclick: () => render() }, 'Retry'),
        el('button', { class: 'btn-ghost', onclick: () => go(1) }, 'Skip for now'),
      ));
    }
  },

  try() {
    const caps = { fn: ['fn'], 'ctrl+alt': ['ctrl', 'opt'], rcmd: ['right ⌘'] }[chosenHotkey] || ['fn'];
    const capHtml = caps.map((c) => `<span class="keycap">${c}</span>`).join(' + ');
    const box = el('textarea', { class: 'try-box', placeholder: 'Click here, then hold your key and talk…' });
    stage.append(
      el('h1', { class: 'ob-title serif-display', html: 'Now — <em>try it.</em>' }),
      el('p', { class: 'ob-sub' }, 'Click the box so your cursor is in it. Hold your key, say a sentence, and let go.'),
      box,
      el('div', { class: 'try-hint', html: `Hold ${capHtml} · speak · release` }),
      el('div', { class: 'ob-actions' },
        el('button', { class: 'btn-dark', onclick: () => go(1) }, 'It worked!'),
        el('button', { class: 'btn-ghost', onclick: () => go(1) }, 'Finish anyway'),
      ),
    );
    box.focus();
  },

  done() {
    stage.append(
      el('h1', { class: 'ob-title serif-display', html: 'You’re in <em>the flow.</em>' }),
      el('p', { class: 'ob-sub' },
        'Sotto lives in your menu bar and the little pill at the bottom of your screen. Teach it words in Dictionary, save Snippets for boilerplate, and just talk.'),
      el('div', { class: 'ob-actions' },
        el('button', {
          class: 'btn-dark',
          onclick: () => window.sotto.invoke('ob:finish', { userName }),
        }, 'Open Sotto'),
      ),
    );
  },
};

// ---- mic level meter ----
let meterRaf = null;
async function startMicMeter(barEls) {
  if (smokeMode) {
    barEls.forEach((b, i) => {
      const v = Math.abs(Math.sin(i * 0.9)) * 0.8;
      b.style.height = `${8 + v * 56}px`;
      b.classList.toggle('hot', v > 0.3);
    });
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(micStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const levels = new Array(barEls.length).fill(0);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      levels.push(Math.min(1, rms * 6));
      levels.shift();
      barEls.forEach((b, i) => {
        const v = levels[i];
        b.style.height = `${8 + v * 56}px`;
        b.classList.toggle('hot', v > 0.06);
      });
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
    micStream._ctx = ctx;
  } catch {
    // Mic not available — the skip button still works.
  }
}

function stopMicMeter() {
  cancelAnimationFrame(meterRaf);
  if (micStream) {
    try { micStream.getTracks().forEach((t) => t.stop()); } catch {}
    try { micStream._ctx && micStream._ctx.close(); } catch {}
    micStream = null;
  }
}

// Visual smoke-test hook: jump to a step directly.
window.sotto.on('debug:ob-step', (i) => {
  smokeMode = true;
  stopMicMeter();
  stepIndex = Math.max(0, Math.min(STEPS.length - 1, i));
  render();
});

render();
