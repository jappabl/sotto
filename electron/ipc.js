// All ipcMain handlers, registered once. Thin wrappers over the modules.

const { ipcMain, systemPreferences, shell, app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

function registerIpc(ctx) {
  const { store, recorder, hotkeys, transcriber, inserter, windows } = ctx;

  // ---- settings ----
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const before = store.getSettings();
    const after = store.setSettings(patch);
    if (patch.hotkey && patch.hotkey !== before.hotkey) {
      hotkeys.setHotkey(patch.hotkey);
    }
    if (patch.launchAtLogin !== undefined && patch.launchAtLogin !== before.launchAtLogin) {
      app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });
    }
    if ((patch.flowBarDock && patch.flowBarDock !== before.flowBarDock) ||
        (patch.flowBarOffset !== undefined && patch.flowBarOffset !== before.flowBarOffset)) {
      const { setFlowbarPosition } = require('./windows');
      setFlowbarPosition(windows.flowbar, after);
    }
    if (patch.model && patch.model !== before.model && transcriber.hasModel(patch.model)) {
      transcriber.ensureServer(patch.model).catch(() => {});
    }
    for (const w of [windows.dashboard, windows.flowbar]) {
      if (w && !w.isDestroyed()) w.webContents.send('settings:changed', after);
    }
    return after;
  });

  // ---- stats & history ----
  ipcMain.handle('stats:get', () => store.getStats());
  ipcMain.handle('history:list', (_e, opts) => store.getHistory(opts || {}));
  ipcMain.handle('history:delete', (_e, id) => {
    store.removeHistoryEntry(id);
    return true;
  });
  ipcMain.handle('history:toggle-edit', (_e, id) => store.toggleHistoryEdit(id));
  ipcMain.handle('history:audio-path', (_e, audioFile) => {
    if (!audioFile || audioFile.includes('..') || audioFile.includes('/')) return null;
    const p = path.join(store.audioDir, audioFile);
    return fs.existsSync(p) ? 'file://' + p : null;
  });
  ipcMain.handle('history:copy', (_e, text) => {
    require('electron').clipboard.writeText(String(text || ''));
    return true;
  });

  // ---- dictionary ----
  ipcMain.handle('dict:list', () => store.dictionary);
  ipcMain.handle('dict:add', (_e, entry) => store.addDictionaryEntry(entry || {}));
  ipcMain.handle('dict:update', (_e, { id, patch }) => store.updateDictionaryEntry(id, patch || {}));
  ipcMain.handle('dict:remove', (_e, id) => { store.removeDictionaryEntry(id); return true; });

  // ---- snippets ----
  ipcMain.handle('snip:list', () => store.snippets);
  ipcMain.handle('snip:add', (_e, entry) => store.addSnippet(entry || {}));
  ipcMain.handle('snip:update', (_e, { id, patch }) => store.updateSnippet(id, patch || {}));
  ipcMain.handle('snip:remove', (_e, id) => { store.removeSnippet(id); return true; });

  // ---- flow bar ----
  ipcMain.handle('flow:audio', (_e, payload) => recorder.handleAudio(payload || {}));
  ipcMain.handle('flow:click', () => { recorder.toggleHandsFree(); return recorder.state; });
  ipcMain.handle('flow:state', () => ({ state: recorder.state, handsFree: recorder.handsFree }));
  ipcMain.handle('flow:drag', (_e, { dock, offset }) => {
    const after = store.setSettings({ flowBarDock: dock, flowBarOffset: offset });
    const { setFlowbarPosition } = require('./windows');
    setFlowbarPosition(windows.flowbar, after);
    return after;
  });
  ipcMain.handle('flow:set-ignore-mouse', (e, ignore) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true });
    return true;
  });
  ipcMain.handle('flow:move-by', (e, { dx, dy }) => {
    const win = windows.flowbar;
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition();
      win.setPosition(Math.round(x + dx), Math.round(y + dy));
    }
    return true;
  });
  ipcMain.handle('flow:drop', () => {
    // After a manual drag, translate the window position into dock + offset.
    const win = windows.flowbar;
    if (!win || win.isDestroyed()) return store.getSettings();
    const { screen } = require('electron');
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const dLeft = cx - wa.x;
    const dRight = wa.x + wa.width - cx;
    const dBottom = wa.y + wa.height - cy;
    let dock = 'bottom';
    let offset = 0.5;
    if (dLeft < 120 && dLeft < dBottom) {
      dock = 'left';
      offset = (cy - wa.y - b.height / 2) / Math.max(1, wa.height - b.height);
    } else if (dRight < 120 && dRight < dBottom) {
      dock = 'right';
      offset = (cy - wa.y - b.height / 2) / Math.max(1, wa.height - b.height);
    } else {
      dock = 'bottom';
      offset = (cx - wa.x - b.width / 2) / Math.max(1, wa.width - b.width);
    }
    offset = Math.max(0, Math.min(1, offset));
    const after = store.setSettings({ flowBarDock: dock, flowBarOffset: offset });
    const { setFlowbarPosition } = require('./windows');
    setFlowbarPosition(windows.flowbar, after);
    return after;
  });

  // ---- permissions / environment ----
  ipcMain.handle('perm:mic-status', () => systemPreferences.getMediaAccessStatus('microphone'));
  ipcMain.handle('perm:mic-request', () => systemPreferences.askForMediaAccess('microphone'));
  ipcMain.handle('perm:ax-status', () => hotkeys.axTrusted);
  ipcMain.handle('perm:ax-prompt', () => { hotkeys.promptAccessibility(); return true; });
  ipcMain.handle('perm:ax-open-settings', () => {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    return true;
  });
  ipcMain.handle('perm:mic-open-settings', () => {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    return true;
  });

  // ---- models ----
  ipcMain.handle('models:list', () => transcriber.listModels());
  ipcMain.handle('models:download', async (e, model) => {
    const send = (p) => {
      for (const w of [windows.onboarding, windows.dashboard]) {
        if (w && !w.isDestroyed()) w.webContents.send('ob:model-progress', { model, progress: p });
      }
    };
    await transcriber.downloadModel(model, send);
    send(1);
    return true;
  });

  // ---- onboarding ----
  ipcMain.handle('ob:finish', (_e, { userName }) => {
    store.setSettings({ onboarded: true, userName: userName || store.getSettings().userName });
    if (windows.onboarding && !windows.onboarding.isDestroyed()) {
      windows.onboarding.destroy();
      windows.onboarding = null;
    }
    if (windows.dashboard && !windows.dashboard.isDestroyed()) {
      windows.dashboard.show();
      windows.dashboard.webContents.send('data:changed', { what: 'all' });
    }
    return true;
  });

  // ---- misc ----
  ipcMain.handle('app:env', () => ({ fakeMic: !!process.env.SOTTO_FAKE_MIC }));
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:open-external', (_e, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(url);
    return true;
  });
  ipcMain.handle('app:hotkey-label', () => {
    const { HOTKEY_LABELS } = require('./hotkeys');
    return HOTKEY_LABELS[store.getSettings().hotkey] || ['fn'];
  });
  // Debug helper used by the visual smoke tests.
  ipcMain.handle('debug:capture', async (_e, which) => {
    const w = windows[which];
    if (!w || w.isDestroyed()) return null;
    const img = await w.webContents.capturePage();
    return img.toPNG().toString('base64');
  });
}

module.exports = { registerIpc };
