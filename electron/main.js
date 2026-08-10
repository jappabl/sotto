// Sotto — entry point.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store } = require('./store');
const { Hotkeys } = require('./hotkeys');
const { Transcriber } = require('./transcriber');
const { Polisher } = require('./polisher');
const { Inserter } = require('./inserter');
const { Recorder } = require('./recorder');
const { registerIpc } = require('./ipc');
const { createDashboard, createFlowbar, createOnboarding } = require('./windows');
const { createTray } = require('./tray');

const SMOKE = process.env.SOTTO_SMOKE === '1';
const E2E = process.env.SOTTO_E2E === '1';

// Isolated data dir for tests (must be set before 'ready').
if (process.env.SOTTO_USERDATA) {
  app.setPath('userData', process.env.SOTTO_USERDATA);
}

// E2E dictation test: Chromium's fake capture device plays a WAV file as the
// "microphone", letting the entire pipeline run with no human speaking.
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

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    fs.mkdirSync(userData, { recursive: true });
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
    const recorder = new Recorder({ store, hotkeys, transcriber, inserter, polisher, log });

    const settings = store.getSettings();
    hotkeys.setHotkey(settings.hotkey);

    const windows = {
      dashboard: null,
      flowbar: null,
      onboarding: null,
    };
    const ctx = { store, hotkeys, transcriber, polisher, inserter, recorder, windows, app, log };

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
    hotkeys.on('holdStart', () => trayCtl.rebuild());
    hotkeys.on('holdEnd', () => trayCtl.rebuild());

    hotkeys.on('axChange', (trusted) => {
      log('accessibility: ' + trusted);
      for (const w of [windows.dashboard, windows.onboarding]) {
        if (w && !w.isDestroyed()) w.webContents.send('ob:ax-status', trusted);
      }
    });

    hotkeys.start();

    // Warm the transcription server so the first dictation is fast.
    if (transcriber.hasModel(settings.model)) {
      transcriber.ensureServer(settings.model).catch((e) => log('server warmup failed: ' + e.message));
    }
    if (settings.aiPolish && polisher.available()) {
      polisher.ensureServer().catch((e) => log('llm warmup failed: ' + e.message));
    }

    store.pruneOldAudio();

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
    for (const page of ['home', 'dictionary', 'snippets', 'style', 'insights', 'settings', 'help']) {
      windows.dashboard.webContents.send('debug:navigate', page);
      await sleep(650);
      await capture(windows.dashboard, 'dash-' + page);
    }

    for (const state of ['idle', 'recording', 'processing', 'error']) {
      windows.flowbar.webContents.send('debug:flow-state', state);
      await sleep(450);
      await capture(windows.flowbar, 'flow-' + state);
    }
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
