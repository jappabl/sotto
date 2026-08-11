// Sotto — entry point.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store } = require('./store');
const { SystemAudio } = require('./sysaudio');
const { MeetingManager } = require('./meetings');
const { Enhancer } = require('./enhancer');
const { Hotkeys } = require('./hotkeys');
const { Transcriber } = require('./transcriber');
const { Polisher } = require('./polisher');
const { Inserter } = require('./inserter');
const { Recorder } = require('./recorder');
const { registerIpc } = require('./ipc');
const { createDashboard, createFlowbar, createOnboarding, setFlowbarExpanded } = require('./windows');
const { createTray } = require('./tray');

const SMOKE = process.env.SOTTO_SMOKE === '1';
const E2E = process.env.SOTTO_E2E === '1';

// Isolated data dir for tests (must be set before 'ready').
if (process.env.SOTTO_USERDATA) {
  app.setPath('userData', process.env.SOTTO_USERDATA);
}

// E2E dictation test: Chromium's fake capture device plays a WAV file as the
// "microphone", letting the entire pipeline run with no human speaking.
// System-wide echo cancellation: lets Chromium subtract OTHER apps' audio
// (music, videos) from the mic signal on macOS.
app.commandLine.appendSwitch('enable-features', 'ChromeWideEchoCancellation');

if (process.env.SOTTO_FAKE_MIC) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.SOTTO_FAKE_MIC);
  // The sandboxed out-of-process audio service can't read the fake-capture
  // file; keep audio in the browser process for tests.
  app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess,AudioServiceSandbox');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  boot();
}

function boot() {
  const logFile = () => path.join(app.getPath('userData'), 'sotto.log');
  const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { fs.appendFileSync(logFile(), line); } catch { /* fine */ }
    if (process.env.SOTTO_DEBUG || SMOKE) process.stdout.write('sotto: ' + line);
  };

  app.whenReady().then(async () => {
    const userData = app.getPath('userData');
    fs.mkdirSync(userData, { recursive: true });
    // Renderer assets are local files that change with every build; a stale
    // HTTP cache silently serves old CSS/JS after an update.
    try { await require('electron').session.defaultSession.clearCache(); } catch { /* fine */ }
    const store = new Store(userData);
    const transcriber = new Transcriber({
      modelsDir: path.join(userData, 'models'),
      log,
    });
    const hotkeys = new Hotkeys({ log });
    const polisher = new Polisher({
      modelsDir: path.join(userData, 'models'),
      log,
    });
    const inserter = new Inserter({ hotkeys, log });
    const sysaudio = new SystemAudio({ log });
    const recorder = new Recorder({ store, hotkeys, transcriber, inserter, polisher, sysaudio, log });
    const { OrgSpace } = require('./orgspace');
    const orgspace = new OrgSpace({ getSettings: () => store.getSettings(), log });
    const meetings = new MeetingManager({ baseDir: userData, transcriber, log });
    meetings.getDictionary = () => store.dictionary;
    meetings.sweepOrphans();
    recorder.meetingsRef = meetings;
    const enhancer = new Enhancer({ polisher, log });
    const { Notes } = require('./notes');
    const notes = new Notes({ baseDir: userData, log });
    recorder.notesRef = notes;
    const { Embedder } = require('./embedder');
    const embedder = new Embedder({ modelsDir: path.join(userData, 'models'), log });
    const { Knowledge } = require('./knowledge');
    const knowledge = new Knowledge({ store, meetings, orgspace, polisher, embedder, notes, baseDir: userData, log });

    // First-run demo meeting: lets you try Enhance before your first real call.
    if (meetings.list().length === 0 && !store.getSettings().demoSeeded) {
      try { seedDemoMeeting(meetings); } catch (e) { log('demo seed failed: ' + e.message); }
      store.setSettings({ demoSeeded: true });
    }

    const settings = store.getSettings();
    hotkeys.setHotkey(settings.hotkey);

    const windows = {
      dashboard: null,
      flowbar: null,
      onboarding: null,
    };
    const ctx = { store, hotkeys, transcriber, polisher, inserter, recorder, meetings, enhancer, orgspace, knowledge, embedder, notes, windows, app, log };

    // A finished brain dump gets organized by the local model, then indexed.
    recorder.onBrainDump = async (meta) => {
      knowledge.markDirty();
      if (windows.dashboard && !windows.dashboard.isDestroyed()) {
        windows.dashboard.webContents.send('notes:changed', { id: meta.id, state: 'raw' });
      }
      if (!enhancer.available()) return;
      try {
        const data = notes.read(meta.id);
        const organized = await enhancer.organizeDump(data.raw, { title: '' });
        notes.saveOrganized(meta.id, organized);
        const t = await enhancer.suggestTitle([organized.slice(0, 2000)]);
        if (t) notes.updateMeta(meta.id, { title: t });
        knowledge.markDirty();
        log(`brain dump organized: ${meta.id}`);
        if (windows.dashboard && !windows.dashboard.isDestroyed()) {
          windows.dashboard.webContents.send('notes:changed', { id: meta.id, state: 'organized' });
        }
        new (require('electron').Notification)({
          title: 'Note written',
          body: (notes.read(meta.id)?.meta.title) || 'Your brain dump is organized.',
          silent: true,
        }).show();
      } catch (e) {
        log('brain dump organize failed: ' + e.message);
      }
    };

    // Any change to the corpus invalidates the search index (rebuilt lazily).
    const origAddHistory = store.addHistoryEntry.bind(store);
    store.addHistoryEntry = (...a) => { const r = origAddHistory(...a); knowledge.markDirty(); return r; };
    const origMeetEmit = meetings._emit.bind(meetings);
    meetings._emit = (event, payload) => {
      if (event === 'meeting:ended' || event === 'meeting:segment') knowledge.markDirty();
      origMeetEmit(event, payload);
    };

    orgspace.onChange = () => {
      if (windows.dashboard && !windows.dashboard.isDestroyed()) {
        windows.dashboard.webContents.send('org:changed', {});
      }
    };
    orgspace.watch();

    const { GitOrg } = require('./gitorg');
    const gitorg = new GitOrg({
      baseDir: userData,
      getSettings: () => store.getSettings(),
      setSettings: (p) => store.setSettings(p),
      log,
    });
    ctx.gitorg = gitorg;
    gitorg.onSynced = () => orgspace.onChange && orgspace.onChange();
    // Keep the org fresh: pull/push at launch and every 3 minutes.
    if (!SMOKE) {
      setTimeout(() => gitorg.sync('launch'), 8000);
      setInterval(() => gitorg.sync('timer'), 3 * 60 * 1000);
    }
    // Push right after a share lands in the folder.
    const origShare = orgspace.share.bind(orgspace);
    orgspace.share = (...args) => {
      const r = origShare(...args);
      if (r.ok) setTimeout(() => gitorg.sync('share'), 500);
      return r;
    };

    // Meeting events flow to the dashboard for live UI.
    meetings.onEvent = (event, payload) => {
      if (windows.dashboard && !windows.dashboard.isDestroyed()) {
        windows.dashboard.webContents.send(event, payload);
      }
      if (event === 'meeting:started' || event === 'meeting:ended') {
        if (windows.flowbar && !windows.flowbar.isDestroyed()) {
          windows.flowbar.webContents.send('flow:meeting-state', {
            recording: event === 'meeting:started',
          });
        }
      }
    };

    // Meeting detection: when a meeting app holds the mic and we're not
    // already capturing, offer to take notes (once per hour per app).
    const meetPromptCooldown = new Map();
    setInterval(async () => {
      try {
        const settings2 = store.getSettings();
        if (!settings2.meetingDetection || meetings.status().recording) return;
        if (recorder.state !== 'idle') return;
        const probe = await hotkeys.queryMeeting();
        if (!probe.app || !probe.micBusy) return;
        const last = meetPromptCooldown.get(probe.app) || 0;
        if (Date.now() - last < 60 * 60 * 1000) return;
        meetPromptCooldown.set(probe.app, Date.now());
        const { Notification } = require('electron');
        const n = new Notification({
          title: `Meeting detected in ${probe.name}`,
          body: 'Click to start taking notes with Sotto.',
          silent: true,
        });
        n.on('click', () => {
          meetings.start({ appHint: probe.name });
          if (windows.dashboard && !windows.dashboard.isDestroyed()) {
            windows.dashboard.show();
            windows.dashboard.webContents.send('debug:navigate', 'meetings');
          }
        });
        n.show();
      } catch { /* best-effort */ }
    }, 15000);

    registerIpc(ctx);

    windows.dashboard = createDashboard();
    windows.flowbar = createFlowbar(settings);
    recorder.attachWindows({ flowbar: windows.flowbar, dashboard: windows.dashboard });

    if (!settings.onboarded && !SMOKE) {
      windows.onboarding = createOnboarding();
    } else {
      windows.dashboard.once('ready-to-show', () => {
        if (!SMOKE) windows.dashboard.show();
      });
    }

    const trayCtl = createTray(ctx);
    recorder.onStateChange = (state) => trayCtl.setRecording(state === 'recording');

    // Global "paste last transcript" — works even if the original paste
    // landed in the wrong field.
    const { globalShortcut } = require('electron');
    try {
      globalShortcut.register('Command+Control+V', () => inserter.pasteLast());
    } catch (e) {
      log('paste-last shortcut unavailable: ' + e.message);
    }

    // Ask by voice: one hotkey and the flow bar pill itself grows into the
    // answer. No second window, no focus stolen.
    const openAskHud = () => {
      if (recorder.state !== 'idle') return; // don't fight a dictation
      const w = windows.flowbar;
      if (!w || w.isDestroyed()) return;
      setFlowbarExpanded(w, store.getSettings(), true);
      w.showInactive();
      w.webContents.send('flow:ask-start', {});
    };
    try {
      globalShortcut.register(store.getSettings().askHotkey || 'Command+Shift+A', openAskHud);
    } catch (e) {
      log('ask hotkey unavailable: ' + e.message);
    }
    ctx.openAskHud = openAskHud;

    // Brain dump: hold a thought, talk it out, get a written note back.
    try {
      globalShortcut.register(store.getSettings().brainDumpHotkey || 'Command+Shift+N', () => {
        const r = recorder.toggleBrainDump();
        if (r === 'started') {
          new (require('electron').Notification)({
            title: 'Brain dump started',
            body: 'Talk it out. Press the shortcut again when you’re done.',
            silent: true,
          }).show();
        }
      });
    } catch (e) {
      log('brain dump hotkey unavailable: ' + e.message);
    }

    hotkeys.on('axChange', (trusted) => {
      log('accessibility: ' + trusted);
      for (const w of [windows.dashboard, windows.onboarding]) {
        if (w && !w.isDestroyed()) w.webContents.send('ob:ax-status', trusted);
      }
    });

    hotkeys.start();

    // If Accessibility isn't granted (fresh install, or the packaged app
    // after dev mode), fire the system prompt once instead of dying silently.
    let axPrompted = false;
    hotkeys.on('axStatus', (trusted) => {
      if (!trusted && !axPrompted && !SMOKE) {
        axPrompted = true;
        hotkeys.promptAccessibility();
        log('accessibility missing — showed system prompt');
      }
    });

    // Keep the flow bar on-screen when displays connect/disconnect or change
    // resolution — a saved position can otherwise land in the void.
    const { screen } = require('electron');
    const reposition = () => {
      const { setFlowbarPosition } = require('./windows');
      setFlowbarPosition(windows.flowbar, store.getSettings());
    };
    screen.on('display-added', reposition);
    screen.on('display-removed', reposition);
    screen.on('display-metrics-changed', reposition);

    // Warm the transcription server so the first dictation is fast.
    if (transcriber.hasModel(settings.model)) {
      transcriber.ensureServer(settings.model).catch((e) => log('server warmup failed: ' + e.message));
    }
    if (settings.aiPolish && polisher.available()) {
      polisher.ensureServer().catch((e) => log('llm warmup failed: ' + e.message));
    }

    store.pruneOldAudio();

    // Warm the search index (and embeddings) in the background so the first
    // Ask is instant, not a cold build.
    if (!SMOKE) {
      setTimeout(() => {
        try {
          knowledge.build();
          if (store.getSettings().semanticSearch !== false && embedder.available()) {
            knowledge.ensureVectors().catch((e) => log('vector warmup failed: ' + e.message));
          }
        } catch (e) { log('knowledge warmup failed: ' + e.message); }
      }, 12000);
    }

    app.on('second-instance', () => {
      if (windows.dashboard && !windows.dashboard.isDestroyed()) {
        windows.dashboard.show();
        windows.dashboard.focus();
      }
    });

    app.on('activate', () => {
      if (windows.dashboard && !windows.dashboard.isDestroyed()) windows.dashboard.show();
    });

    app.on('before-quit', () => {
      global.__sottoQuitting = true;
      // The flow bar is closable:false — destroy it explicitly so quit
      // is never stuck waiting on a window that refuses to close.
      if (windows.flowbar && !windows.flowbar.isDestroyed()) {
        windows.flowbar.destroy();
      }
    });

    app.on('will-quit', () => {
      hotkeys.stop();
      transcriber.stopServer();
      polisher.stop();
      embedder.stop();
      sysaudio.restore();
    });

    log('sotto started');
    if (SMOKE) {
      process.stdout.write('SOTTO_READY\n');
      const drive = E2E ? runE2EDictation(ctx) : runSmokeAutopilot(ctx);
      drive.catch((err) => {
        process.stdout.write('SMOKE_FAIL ' + err.message + '\n');
        global.__sottoQuitting = true;
        app.exit(1);
      });
    }
  });

  app.on('window-all-closed', (e) => {
    // Tray app: stay alive unless quitting.
    if (!global.__sottoQuitting) e?.preventDefault?.();
    else app.quit();
  });
}

// A canned first-run meeting so Enhance can be tried with zero real calls.
function seedDemoMeeting(meetings) {
  const dir = path.join(meetings.baseDir, 'demo1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    id: 'demo1', title: 'Demo: website redesign kickoff',
    startedAt: Date.now() - 3600000, endedAt: Date.now() - 3300000,
    state: 'ended', template: 'auto', appHint: 'Demo', segments: 8,
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'notes.md'),
    '- launch date??\n- maya owns hero design\n- budget 12k approved\n- competitor uses video bg, we wont');
  const segs = [
    { t0: 0, t1: 14, who: 'them', text: 'Thanks for making time. The main thing today is scoping the website redesign before the June board meeting.' },
    { t0: 14, t1: 26, who: 'me', text: 'Right. My big question is whether we can realistically launch before the conference on June 12th.' },
    { t0: 26, t1: 44, who: 'them', text: 'If we freeze scope this week, yes. Design needs three weeks, then two weeks of build. That puts launch around June 9th.' },
    { t0: 44, t1: 58, who: 'them', text: 'Maya said she can own the hero section design herself, which saves us the agency fee there.' },
    { t0: 58, t1: 74, who: 'me', text: 'And finance signed off on the twelve thousand dollar budget yesterday, so we are covered for the rest.' },
    { t0: 74, t1: 92, who: 'them', text: 'One more thing. I looked at three competitor sites. They all use full screen video backgrounds now. I honestly think we should not follow that.' },
    { t0: 92, t1: 106, who: 'me', text: 'Agreed, it kills load time. Static hero with strong typography instead.' },
    { t0: 106, t1: 122, who: 'them', text: 'Okay. So next steps. I will write the scope doc by Friday, Maya starts design Monday, and we regroup in two weeks.' },
  ];
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'),
    segs.map((s) => JSON.stringify(s)).join('\n') + '\n');
}

// Screenshot autopilot for the visual smoke test: drives every dashboard page,
// flow bar state, and onboarding step, capturing PNGs into $SOTTO_SHOTS.
async function runSmokeAutopilot(ctx) {
  const { windows } = ctx;
  const shotsDir = process.env.SOTTO_SHOTS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const waitLoaded = (win) => new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve();
    if (!win.webContents.isLoading()) return resolve();
    win.webContents.once('did-finish-load', () => resolve());
  });

  await waitLoaded(windows.dashboard);
  await waitLoaded(windows.flowbar);
  await sleep(1200);

  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    const capture = async (win, name) => {
      if (!win || win.isDestroyed()) return;
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(shotsDir, name + '.png'), img.toPNG());
    };

    windows.dashboard.show();
    await sleep(600);
    for (const page of ['home', 'ask', 'meetings', 'dictionary', 'snippets', 'style', 'insights', 'settings', 'help']) {
      windows.dashboard.webContents.send('debug:navigate', page);
      await sleep(650);
      await capture(windows.dashboard, 'dash-' + page);
    }

    for (const state of ['idle', 'recording', 'processing', 'flash', 'error', 'command', 'meeting']) {
      windows.flowbar.webContents.send('debug:flow-state', state);
      await sleep(450);
      await capture(windows.flowbar, 'flow-' + state);
    }
    windows.flowbar.webContents.send('debug:flow-state', 'idle');

    // Ask phases: compact while it works, expanded once it answers.
    const { setFlowbarExpanded } = require('./windows');
    setFlowbarExpanded(windows.flowbar, ctx.store.getSettings(), true);
    await sleep(250);
    for (const phase of ['listening', 'thinking', 'error']) {
      windows.flowbar.webContents.send('debug:ask-phase', phase);
      await sleep(600);
      await capture(windows.flowbar, 'flow-ask-' + phase);
    }
    windows.flowbar.webContents.send('debug:ask-demo', {
      question: 'What did I say I need to work on?',
      text: 'Fix the pricing page before Friday and reply to Sarah about the partnership.',
      sources: ['Project implementation discussion', 'Dictation in Claude'],
    });
    await sleep(1100);
    await capture(windows.flowbar, 'flow-ask');
    setFlowbarExpanded(windows.flowbar, ctx.store.getSettings(), false);
    windows.flowbar.webContents.send('debug:flow-state', 'idle');

    const { createOnboarding } = require('./windows');
    const ob = createOnboarding();
    windows.onboarding = ob;
    await waitLoaded(ob);
    await sleep(700);
    for (let i = 0; i < 8; i++) {
      ob.webContents.send('debug:ob-step', i);
      await sleep(500);
      await capture(ob, 'ob-' + i);
    }
    ob.destroy();
    windows.onboarding = null;
  }

  process.stdout.write('SMOKE_OK\n');
  global.__sottoQuitting = true;
  ctx.hotkeys.stop();
  ctx.transcriber.stopServer();
  // Hard exit for the test harness — regular quit paths are exercised by
  // the tray Quit item in real use.
  setTimeout(() => app.exit(0), 300);
}

// Full-pipeline E2E: simulate the hotkey while the fake microphone plays a
// known WAV, then report what landed in history.
async function runE2EDictation(ctx) {
  const { windows, hotkeys, recorder, store } = ctx;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const holdMs = parseInt(process.env.SOTTO_E2E_HOLD_MS || '6500', 10);

  const waitLoaded = (win) => new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve();
    if (!win.webContents.isLoading()) return resolve();
    win.webContents.once('did-finish-load', () => resolve());
  });
  await waitLoaded(windows.flowbar);
  await sleep(1500);

  // Synthesize the fn hold through keymon's test hook.
  hotkeys.send('test-fn 1');
  await sleep(holdMs);
  hotkeys.send('test-fn 0');

  // Wait for the pipeline to finish (transcription can take a few seconds).
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await sleep(300);
    if (recorder.state === 'idle') {
      const hist = store.getHistory({ limit: 1 });
      if (hist.length) {
        // The pasteboard write goes through keymon's runloop — give it a beat
        // before reading, so the assertion doesn't race the write.
        await sleep(400);
        const { clipboard } = require('electron');
        process.stdout.write('E2E_RESULT ' + JSON.stringify({
          text: hist[0].text,
          raw: hist[0].raw,
          words: hist[0].words,
          durMs: hist[0].durMs,
          clipboard: clipboard.readText(),
        }) + '\n');
        break;
      }
    }
  }

  process.stdout.write('SMOKE_OK\n');
  global.__sottoQuitting = true;
  ctx.hotkeys.stop();
  ctx.transcriber.stopServer();
  setTimeout(() => app.exit(0), 300);
}
