// Sotto — entry point.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store } = require('./store');
const { Hotkeys } = require('./hotkeys');
const { Transcriber } = require('./transcriber');
const { Inserter } = require('./inserter');
const { Recorder } = require('./recorder');
const { registerIpc } = require('./ipc');
const { createDashboard, createFlowbar, createOnboarding } = require('./windows');
const { createTray } = require('./tray');

const SMOKE = process.env.SOTTO_SMOKE === '1';

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
    const inserter = new Inserter({ hotkeys, log });
    const recorder = new Recorder({ store, hotkeys, transcriber, inserter, log });

    const settings = store.getSettings();
    hotkeys.setHotkey(settings.hotkey);

    const windows = {
      dashboard: null,
      flowbar: null,
      onboarding: null,
    };
    const ctx = { store, hotkeys, transcriber, inserter, recorder, windows, app, log };

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
    });

    app.on('will-quit', () => {
      hotkeys.stop();
      transcriber.stopServer();
    });

    log('sotto started');
    if (SMOKE) {
      // Announce readiness for the launch smoke test, then exit when asked.
      process.stdout.write('SOTTO_READY\n');
    }
  });

  app.on('window-all-closed', (e) => {
    // Tray app: stay alive unless quitting.
    if (!global.__sottoQuitting) e?.preventDefault?.();
    else app.quit();
  });
}
