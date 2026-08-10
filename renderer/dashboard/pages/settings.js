// Settings: sub-sidebar (General / System / Experimental / About) with the
// hotkey modal, model picker, permission status, and formatter toggles.

import { el, toast, openModal } from '../ui.js';
import { icons } from '../icons.js';

let section = 'general';

const LANGS = [
  ['auto', 'Auto-detect'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'],
  ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['hi', 'Hindi'],
  ['ru', 'Russian'], ['ar', 'Arabic'], ['pl', 'Polish'], ['tr', 'Turkish'],
  ['vi', 'Vietnamese'], ['uk', 'Ukrainian'], ['sv', 'Swedish'], ['da', 'Danish'],
];

const HOTKEY_OPTIONS = [
  ['fn', ['fn'], 'Hold the fn key'],
  ['ctrl+alt', ['ctrl', 'opt'], 'Hold Control + Option'],
  ['rcmd', ['right ⌘'], 'Hold Right Command'],
  ['ralt', ['right ⌥'], 'Hold Right Option'],
];

export async function renderSettings(container) {
  const [settings, version, micStatus, axStatus, models, polish] = await Promise.all([
    window.sotto.invoke('settings:get'),
    window.sotto.invoke('app:version'),
    window.sotto.invoke('perm:mic-status'),
    window.sotto.invoke('perm:ax-status'),
    window.sotto.invoke('models:list'),
    window.sotto.invoke('polish:status'),
  ]);

  container.replaceChildren();

  const body = el('div', { class: 'settings-body' });
  const sections = [
    ['general', 'General', icons.sliders],
    ['system', 'System', icons.display],
    ['experimental', 'Experimental', icons.flask],
    ['about', 'About', icons.info],
  ];
  const nav = el('div', { class: 'settings-nav' },
    el('div', { class: 'sn-label' }, 'SETTINGS'),
    sections.map(([key, label, icon]) =>
      el('div', {
        class: 'sn-item' + (section === key ? ' active' : ''),
        onclick: () => { section = key; renderSettings(container); },
      }, el('span', { html: icon }), label)),
  );

  container.append(el('div', { class: 'settings-layout' }, nav, body));

  const rerender = () => renderSettings(container);

  if (section === 'general') {
    body.append(el('h1', { class: 'settings-title serif-display' }, 'General'));
    body.append(nameRow(settings, rerender));
    body.append(hotkeyRow(settings, rerender));
    body.append(selectRow({
      name: 'Language',
      desc: 'Language you dictate in. Auto-detect figures it out per dictation.',
      value: settings.language,
      options: LANGS,
      onChange: async (v) => { await save({ language: v }); },
    }));
    body.append(await orgRow(rerender));
    body.append(toggleRow({
      name: 'Launch at login',
      desc: 'Start Sotto quietly in the menu bar when you log in.',
      value: settings.launchAtLogin,
      onChange: (v) => save({ launchAtLogin: v }, rerender),
    }));
  }

  if (section === 'system') {
    body.append(el('h1', { class: 'settings-title serif-display' }, 'System'));
    body.append(permRow('Microphone', micStatus === 'granted',
      'Needed to hear you. ',
      () => window.sotto.invoke('perm:mic-open-settings')));
    body.append(permRow('Accessibility', axStatus,
      'Needed for the dictation hotkey and to paste text for you. ',
      () => window.sotto.invoke('perm:ax-open-settings')));
    body.append(selectRow({
      name: 'Transcription model',
      desc: 'Bigger models are more accurate, smaller ones are faster. All run on-device.',
      value: settings.model,
      options: models.map((m) => [m.name, modelLabel(m)]),
      onChange: async (v) => {
        const m = models.find((x) => x.name === v);
        if (m && !m.installed) {
          toast('Downloading model…');
          try {
            await window.sotto.invoke('models:download', v);
          } catch {
            toast('Download failed — check your connection');
            rerender();
            return;
          }
        }
        await save({ model: v });
        toast('Model ready');
        rerender();
      },
    }));
    body.append(aiPolishRow(settings, polish, save, rerender));
    body.append(toggleRow({
      name: 'Command Mode',
      desc: 'Hold your talk key + ctrl, then speak an instruction — "make this shorter" rewrites the selected text. Needs AI Polish.',
      value: settings.commandMode,
      onChange: (v) => save({ commandMode: v }, rerender),
    }));
    body.append(toggleRow({
      name: 'Meeting detection',
      desc: 'When a call starts in Zoom, Teams, Webex, FaceTime, Slack, or Discord, offer to take meeting notes.',
      value: settings.meetingDetection,
      onChange: (v) => save({ meetingDetection: v }, rerender),
    }));
    body.append(toggleRow({
      name: 'Auto-learn dictionary',
      desc: 'When you hand-correct a word after dictating, Sotto quietly adds the fixed spelling to your dictionary (marked ✨).',
      value: settings.autoLearn,
      onChange: (v) => save({ autoLearn: v }, rerender),
    }));
    body.append(toggleRow({
      name: 'Sound effects',
      desc: 'Play a soft ping when dictation starts and a pop when text lands.',
      value: settings.soundEffects,
      onChange: (v) => save({ soundEffects: v }, rerender),
    }));
    body.append(toggleRow({
      name: 'Mute system audio while dictating',
      desc: 'Silences your speakers during capture so music and videos never leak into transcripts. Restored the moment you release.',
      value: settings.muteWhileDictating,
      onChange: (v) => save({ muteWhileDictating: v }, rerender),
    }));
    body.append(await micRow(settings, save));
    body.append(selectRow({
      name: 'Flow bar position',
      desc: 'Where the dictation pill lives. You can also drag the pill itself.',
      value: settings.flowBarDock,
      options: [['bottom', 'Bottom'], ['left', 'Left edge'], ['right', 'Right edge']],
      onChange: (v) => save({ flowBarDock: v }),
    }));
  }

  if (section === 'experimental') {
    body.append(el('h1', { class: 'settings-title serif-display' }, 'Experimental'));
    body.append(toggleRow({
      name: 'Remove filler words',
      desc: 'Strip "um", "uh", and friends from transcripts.',
      value: settings.removeFillers,
      onChange: (v) => save({ removeFillers: v, }, rerender),
    }));
    body.append(toggleRow({
      name: 'Spoken punctuation & commands',
      desc: 'Say "comma", "new line", or "new paragraph" to punctuate as you go.',
      value: settings.autoPunctuate,
      onChange: (v) => save({ autoPunctuate: v }, rerender),
    }));
    body.append(toggleRow({
      name: '"Press enter" command',
      desc: 'End a dictation with "press enter" to send the message after pasting.',
      value: settings.pressEnterCommand,
      onChange: (v) => save({ pressEnterCommand: v }, rerender),
    }));
  }

  if (section === 'about') {
    body.append(el('h1', { class: 'settings-title serif-display' }, 'About'));
    body.append(el('div', { class: 'setting-row' },
      el('div', { class: 'setting-info' },
        el('div', { class: 'setting-name' }, 'Sotto'),
        el('div', { class: 'setting-desc' },
          'Open-source voice dictation for macOS. Speech never leaves your Mac — transcription runs locally on whisper.cpp.'),
      ),
    ));
    body.append(el('div', { class: 'setting-row' },
      el('div', { class: 'setting-info' },
        el('div', { class: 'setting-name' }, 'Privacy'),
        el('div', { class: 'setting-desc' },
          'No account, no cloud, no telemetry. History and audio live in your Application Support folder and stay there.'),
      ),
    ));
    body.append(el('div', { class: 'settings-version' },
      el('span', { html: icons.cloudOff }),
      `Sotto v${version} · offline transcription`));
  }

  async function save(patch, cb) {
    await window.sotto.invoke('settings:set', patch);
    cb && cb();
  }
}

function modelLabel(m) {
  const names = {
    'ggml-tiny.en.bin': 'Tiny (English, fastest)',
    'ggml-base.bin': 'Base (all languages)',
    'ggml-small.bin': 'Small (all languages)',
    'ggml-large-v3-turbo-q5_0.bin': 'Large Turbo (most accurate)',
  };
  return (names[m.name] || m.name) + (m.installed ? '' : ' — download');
}

async function orgRow(rerender) {
  const [org, cap] = await Promise.all([
    window.sotto.invoke('org:status'),
    window.sotto.invoke('org:git-capability'),
  ]);
  const right = org.configured
    ? el('span', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end' },
        el('button', {
          class: 'btn-gray',
          onclick: async () => {
            const ok = await window.sotto.invoke('org:invite');
            toast(ok
              ? 'Invite copied. Add them as a collaborator on the page that just opened.'
              : 'This org is a plain folder. Share the folder itself to invite.');
          },
        }, 'Invite'),
        el('button', {
          class: 'btn-gray',
          onclick: async () => {
            toast('Syncing…');
            const r = await window.sotto.invoke('org:sync');
            toast(r.ok ? 'Org synced' : 'Nothing to sync');
          },
        }, 'Sync now'),
        el('button', { class: 'btn-ghost', onclick: async () => { await window.sotto.invoke('org:open-folder'); } }, 'Open'),
        el('button', { class: 'btn-ghost', onclick: async () => { await window.sotto.invoke('org:leave'); rerender(); } }, 'Leave'),
      )
    : el('span', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end' },
        cap.gh ? el('button', {
          class: 'btn-dark',
          onclick: () => orgNameModal(rerender, cap.login),
        }, 'Create on GitHub') : null,
        el('button', {
          class: 'btn-gray',
          onclick: () => orgJoinModal(rerender),
        }, 'Join from GitHub'),
        el('button', {
          class: 'btn-ghost',
          onclick: async () => { await window.sotto.invoke('org:choose'); rerender(); },
        }, 'Use a folder'),
      );
  return el('div', { class: 'setting-row' },
    el('div', { class: 'setting-info' },
      el('div', { class: 'setting-name' }, 'Org space'),
      el('div', { class: 'setting-desc' },
        org.configured
          ? el('span', {}, 'Sharing through ', el('b', {}, org.name),
              org.members > 1 ? ` · ${org.members} people have shared` : '',
              '. Notes you share sync automatically; teammates in the same org see them in Meetings.')
          : cap.gh
            ? `One click makes a private repo on your GitHub (${cap.login}) that becomes your team's shared notes space. Joining is pasting owner/repo. No accounts beyond GitHub, no server.`
            : 'Join a GitHub-backed org by pasting owner/repo, or use any shared folder (iCloud, Dropbox, Drive). Install the gh CLI to create orgs in one click.'),
    ),
    right,
  );
}

function orgNameModal(rerender, login) {
  const input = el('input', { placeholder: 'e.g. team-notes', maxlength: '60' });
  const go = async () => {
    const name = input.value.trim();
    if (!name) return;
    close();
    toast('Creating your org on GitHub…');
    try {
      const r = await window.sotto.invoke('org:create-github', name);
      toast(`Org "${r.name}" is live. Use Invite to add people.`);
    } catch (e) {
      toast(String(e.message || 'Creation failed').replace(/^.*Error:\s*/, '').slice(0, 90));
    }
    rerender();
  };
  const modal = el('div', { class: 'modal form-modal' },
    el('h2', {}, 'Create your org'),
    el('div', { class: 'form-field' },
      el('label', {}, 'Org name'),
      input,
      el('div', { class: 'form-hint' }, `Creates a private repo under ${login}. Teammates you invite as collaborators become the org.`),
    ),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn-gray', onclick: () => close() }, 'Cancel'),
      el('button', { class: 'btn-dark', onclick: go }, 'Create'),
    ),
  );
  const close = openModal(modal);
  input.focus();
  modal.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

function orgJoinModal(rerender) {
  const input = el('input', { placeholder: 'owner/repo or a github.com link' });
  const go = async () => {
    const ref = input.value.trim();
    if (!ref) return;
    close();
    toast('Joining org…');
    try {
      const r = await window.sotto.invoke('org:join-github', ref);
      toast(`Joined "${r.name}". Shared notes appear in Meetings.`);
    } catch (e) {
      toast(String(e.message || 'Join failed').replace(/^.*Error:\s*/, '').slice(0, 90));
    }
    rerender();
  };
  const modal = el('div', { class: 'modal form-modal' },
    el('h2', {}, 'Join an org'),
    el('div', { class: 'form-field' },
      el('label', {}, 'GitHub repo'),
      input,
      el('div', { class: 'form-hint' }, 'Ask a teammate for their org repo, like jappabl/team-notes. Private repos need you added as a collaborator first.'),
    ),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn-gray', onclick: () => close() }, 'Cancel'),
      el('button', { class: 'btn-dark', onclick: go }, 'Join'),
    ),
  );
  const close = openModal(modal);
  input.focus();
  modal.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

async function micRow(settings, save) {
  let options = [['auto', 'Automatic (skips virtual devices)']];
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.label);
    options = options.concat(devices.map((d) => [d.deviceId, d.label]));
  } catch { /* labels appear once mic permission is granted */ }
  return selectRow({
    name: 'Microphone',
    desc: 'Which input Sotto listens to. Automatic never picks loopback devices like BlackHole or OBS.',
    value: settings.micDevice,
    options,
    onChange: (v) => save({ micDevice: v }),
  });
}

function aiPolishRow(settings, polish, save, rerender) {
  const installed = polish.models.some((m) => m.installed);
  const desc = !polish.engine
    ? 'Needs llama.cpp — run "brew install llama.cpp", then relaunch Sotto. '
    : installed
      ? 'A small language model runs on-device after each dictation, catching the fuzzy self-corrections rules can miss. '
      : 'Downloads a ~2 GB on-device language model (one time). ';
  const row = el('div', { class: 'setting-row' },
    el('div', { class: 'setting-info' },
      el('div', { class: 'setting-name' }, 'AI Polish (beta)'),
      el('div', { class: 'setting-desc' }, desc,
        settings.aiPolish && installed ? el('span', { class: 'perm-ok' }, 'Active ✓') : null),
    ),
  );
  const sw = el('div', { class: 'switch' + (settings.aiPolish ? ' on' : '') });
  row.append(sw);
  row.addEventListener('click', async () => {
    if (settings.aiPolish) return save({ aiPolish: false }, rerender);
    if (!polish.engine) return toast('Install llama.cpp first: brew install llama.cpp');
    if (!installed) {
      toast('Downloading the polish model (~2 GB)…');
      try {
        await window.sotto.invoke('polish:download', null);
      } catch {
        toast('Download failed — check your connection');
        return rerender();
      }
    }
    await save({ aiPolish: true }, rerender);
    toast('AI Polish is on');
  });
  return row;
}

function toggleRow({ name, desc, value, onChange }) {
  const sw = el('div', { class: 'switch' + (value ? ' on' : '') });
  const row = el('div', { class: 'setting-row' },
    el('div', { class: 'setting-info' },
      el('div', { class: 'setting-name' }, name),
      el('div', { class: 'setting-desc' }, desc),
    ),
    sw,
  );
  row.addEventListener('click', () => onChange(!value));
  return row;
}

function selectRow({ name, desc, value, options, onChange }) {
  const sel = el('select', {},
    options.map(([v, label]) => {
      const opt = el('option', { value: v }, label);
      if (v === value) opt.selected = true;
      return opt;
    }));
  sel.addEventListener('change', () => onChange(sel.value));
  return el('div', { class: 'setting-row' },
    el('div', { class: 'setting-info' },
      el('div', { class: 'setting-name' }, name),
      el('div', { class: 'setting-desc' }, desc),
    ),
    sel,
  );
}

function permRow(name, granted, desc, openSettings) {
  return el('div', { class: 'setting-row' },
    el('div', { class: 'setting-info' },
      el('div', { class: 'setting-name' }, name),
      el('div', { class: 'setting-desc' }, desc,
        granted
          ? el('span', { class: 'perm-ok' }, 'Granted ✓')
          : el('span', { class: 'perm-warn' }, 'Not granted')),
    ),
    granted ? null : el('button', { class: 'btn-gray', onclick: openSettings }, 'Open System Settings'),
  );
}

function nameRow(settings, rerender) {
  const input = el('input', {
    value: settings.userName || '',
    placeholder: 'Your name',
    style: 'border:1px solid var(--line);border-radius:9px;padding:7px 10px;background:#fff;outline:none;width:170px;',
  });
  input.addEventListener('change', async () => {
    await window.sotto.invoke('settings:set', { userName: input.value.trim() });
    toast('Saved');
  });
  return el('div', { class: 'setting-row' },
    el('div', { class: 'setting-info' },
      el('div', { class: 'setting-name' }, 'Your name'),
      el('div', { class: 'setting-desc' }, 'Used for the Home screen greeting.'),
    ),
    input,
  );
}

function hotkeyRow(settings, rerender) {
  const caps = (HOTKEY_OPTIONS.find(([k]) => k === settings.hotkey) || HOTKEY_OPTIONS[0])[1];
  return el('div', { class: 'setting-row' },
    el('div', { class: 'setting-info' },
      el('div', { class: 'setting-name' }, 'Shortcuts'),
      el('div', { class: 'setting-desc' },
        'Push to talk: ',
        ...caps.flatMap((k, i) => [i ? ' + ' : '', el('span', { class: 'keycap' }, k)]),
        ' · double-tap for hands-free',
      ),
    ),
    el('button', {
      class: 'btn-gray',
      onclick: () => openHotkeyModal(settings, rerender),
    }, 'Change'),
  );
}

function openHotkeyModal(settings, rerender) {
  let current = settings.hotkey;
  const optionEls = new Map();

  const renderSelection = () => {
    for (const [key, node] of optionEls) {
      node.classList.toggle('selected', key === current);
    }
  };

  const pick = async (key) => {
    current = key;
    renderSelection();
    await window.sotto.invoke('settings:set', { hotkey: key });
    toast('Shortcut updated');
    rerender();
  };

  const opts = el('div', { class: 'hk-opts' });
  for (const [key, caps] of HOTKEY_OPTIONS) {
    const node = el('div', { class: 'hk-opt', onclick: () => pick(key) },
      ...caps.flatMap((k, i) => [i ? '+' : '', el('span', { class: 'keycap' }, k)]),
    );
    optionEls.set(key, node);
    opts.append(node);
  }
  renderSelection();

  const modal = el('div', { class: 'modal hotkey-modal' },
    el('h2', {}, 'Change hotkeys'),
    el('div', { class: 'hk-sub' }, 'Customize how you talk to Sotto'),
    el('div', { class: 'hk-row' },
      el('div', { class: 'hk-info' },
        el('div', { class: 'hk-name' }, 'Push to talk'),
        el('div', { class: 'hk-desc' }, 'Dictate short bursts of text while holding this hotkey'),
      ),
      opts,
    ),
    el('div', { class: 'hk-row' },
      el('div', { class: 'hk-info' },
        el('div', { class: 'hk-name' }, 'Hands-free mode'),
        el('div', { class: 'hk-desc' }, 'Double-tap your push-to-talk key to start, tap once (or press Esc) to stop'),
      ),
      el('div', { class: 'hk-opts' },
        el('div', { class: 'hk-opt', style: 'cursor:default' },
          el('span', { class: 'keycap' }, 'double-tap')),
      ),
    ),
    el('button', {
      class: 'hk-reset',
      onclick: () => pick('fn'),
    }, 'Reset to default'),
  );
  openModal(modal, { onClose: rerender });
}
