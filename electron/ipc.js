// All ipcMain handlers, registered once. Thin wrappers over the modules.

const { ipcMain, systemPreferences, shell, app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

function registerIpc(ctx) {
  const { store, recorder, hotkeys, transcriber, polisher, inserter, windows } = ctx;

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
    if (patch.aiPolish === true && polisher.available()) {
      polisher.ensureServer().catch(() => {});
    }
    if (patch.aiPolish === false) {
      polisher.stop();
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

  // ---- AI polish ----
  ipcMain.handle('polish:status', () => ({
    engine: !!polisher.serverBin,
    models: polisher.listModels(),
    ready: polisher.ready,
  }));
  ipcMain.handle('polish:download', async (_e, model) => {
    const { LLM_MODELS, DEFAULT_LLM } = require('./polisher');
    const name = model || DEFAULT_LLM;
    const def = LLM_MODELS[name];
    if (!def) throw new Error('unknown llm model');
    const send = (p) => {
      if (windows.dashboard && !windows.dashboard.isDestroyed()) {
        windows.dashboard.webContents.send('ob:model-progress', { model: name, progress: p });
      }
    };
    const { httpsDownload } = require('./transcriber');
    const dest = require('path').join(polisher.modelsDir, name);
    await httpsDownload(def.url, dest + '.download', send);
    require('fs').renameSync(dest + '.download', dest);
    send(1);
    return true;
  });

  // ---- meetings ----
  const { meetings, enhancer } = ctx;
  ipcMain.handle('meet:list', () => meetings.list());
  ipcMain.handle('meet:read', (_e, id) => meetings.read(id));
  ipcMain.handle('meet:start', (_e, opts) => meetings.start(opts || {}));
  ipcMain.handle('meet:stop', () => meetings.stop());
  ipcMain.handle('meet:status', () => meetings.status());
  ipcMain.handle('meet:save-notes', (_e, { id, notes }) => meetings.saveNotes(id, notes));
  ipcMain.handle('meet:rename', (_e, { id, title }) => meetings.updateMeta(id, { title: String(title || '').slice(0, 120) }));
  ipcMain.handle('meet:set-template', (_e, { id, template }) => meetings.updateMeta(id, { template }));
  ipcMain.handle('meet:remove', (_e, id) => meetings.remove(id));
  ipcMain.handle('meet:enhance', async (e, id) => {
    let data = meetings.read(id);
    if (!data) throw new Error('meeting-not-found');
    if (!enhancer.available()) throw new Error('llm-unavailable');
    const send = (stage, p) => {
      if (windows.dashboard && !windows.dashboard.isDestroyed()) {
        windows.dashboard.webContents.send('meet:enhance-progress', { id, stage, progress: p });
      }
    };
    // Stage 1: accuracy re-pass over the kept audio with the best installed
    // whisper model (runs once; chunks are deleted afterwards).
    const best = ['ggml-large-v3-turbo-q5_0.bin', 'ggml-small.bin']
      .find((m) => transcriber.hasModel(m));
    if (best && !data.meta.repassed) {
      send('Improving transcript…', 0);
      const improved = await meetings.repass(id, {
        model: best,
        onProgress: (p) => send('Improving transcript…', p * 0.4),
      }).catch(() => false);
      if (improved) data = meetings.read(id);
    }
    // Stages 2-3: digest + enhance on the local LLM.
    const { enhanced, annotated, digests } = await enhancer.enhance({
      notes: data.notes,
      segments: data.transcript,
      template: data.meta.template,
      title: data.meta.title,
    }, (p) => send(p < 0.95 ? 'Reading the conversation…' : 'Enhancing your notes…', 0.4 + p * 0.6));
    meetings.saveEnhanced(id, enhanced);
    meetings.saveAnnotated(id, annotated);
    const patch = { state: 'enhanced', digests };
    // Ad-hoc meetings earn a real title from their content.
    if (/(morning|afternoon|evening) meeting$/.test(data.meta.title)) {
      const t = await enhancer.suggestTitle(digests);
      if (t) patch.title = t;
    }
    meetings.updateMeta(id, patch);
    return { enhanced };
  });
  ipcMain.handle('meet:ask', async (_e, { id, question }) => {
    const data = meetings.read(id);
    if (!data) throw new Error('meeting-not-found');
    if (!enhancer.available()) throw new Error('llm-unavailable');
    return enhancer.ask({
      question: String(question || '').slice(0, 500),
      notes: data.notes,
      enhanced: data.enhanced,
      digests: data.meta.digests,
      segments: data.transcript,
    });
  });
  ipcMain.handle('meet:copy', (_e, text) => {
    require('electron').clipboard.writeText(String(text || ''));
    return true;
  });

  // ---- org space (shared-folder team notes) ----
  const { orgspace } = ctx;
  ipcMain.handle('org:status', () => orgspace.status());
  ipcMain.handle('org:choose', async () => {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog(windows.dashboard, {
      title: 'Choose your org folder',
      message: 'Pick a folder your team shares (iCloud, Dropbox, Drive, a repo). Shared notes live there.',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return orgspace.status();
    store.setSettings({ orgDir: r.filePaths[0] });
    orgspace.watch();
    return orgspace.status();
  });
  ipcMain.handle('org:leave', () => {
    store.setSettings({ orgDir: '' });
    orgspace.unwatch();
    return orgspace.status();
  });
  ipcMain.handle('org:list', () => orgspace.list());
  ipcMain.handle('org:share', (_e, id) => {
    const data = meetings.read(id);
    if (!data) return { ok: false, reason: 'meeting-not-found' };
    return orgspace.share(data, store.getSettings().userName || 'Someone');
  });
  ipcMain.handle('org:read', (_e, file) => orgspace.read(file));
  ipcMain.handle('org:import', (_e, file) => orgspace.import(file, meetings));
  ipcMain.handle('org:open-folder', () => {
    const d = orgspace.dir();
    if (d) shell.openPath(d);
    return true;
  });

  // ---- GitHub-backed orgs (zero-git-knowledge flows) ----
  const { gitorg } = ctx;
  ipcMain.handle('org:git-capability', () => gitorg.capability());
  ipcMain.handle('org:create-github', async (_e, name) => {
    const r = await gitorg.create(name);
    orgspace.watch();
    await gitorg.sync('create');
    return { ok: true, ...r };
  });
  ipcMain.handle('org:join-github', async (_e, ref) => {
    const r = await gitorg.join(ref);
    orgspace.watch();
    await gitorg.sync('join');
    return { ok: true, ...r };
  });
  ipcMain.handle('org:sync', () => gitorg.sync('manual'));
  ipcMain.handle('org:invite', async () => {
    const info = await gitorg.inviteUrl();
    if (info) {
      require('electron').clipboard.writeText(
        `Join my Sotto org: install Sotto (github.com/jappabl/sotto), then Settings > General > Org space > Join from GitHub, and paste: ${info.slug}\n(I need to add you as a collaborator first: ${info.settings})`);
      shell.openExternal(info.settings);
    }
    return !!info;
  });

  // ---- brain-dump notes ----
  const { notes } = ctx;
  ipcMain.handle('notes:list', () => notes.list());
  ipcMain.handle('notes:read', (_e, id) => notes.read(id));
  ipcMain.handle('notes:remove', (_e, id) => { notes.remove(id); ctx.knowledge.markDirty(); return true; });
  ipcMain.handle('notes:hotkey', () => store.getSettings().brainDumpHotkey);
  ipcMain.handle('notes:toggle-capture', () => recorder.toggleBrainDump());
  ipcMain.handle('notes:organize', async (_e, id) => {
    const data = notes.read(id);
    if (!data) throw new Error('note-not-found');
    if (!enhancer.available()) throw new Error('llm-unavailable');
    const organized = await enhancer.organizeDump(data.raw, { title: data.meta.title });
    notes.saveOrganized(id, organized);
    const t = await enhancer.suggestTitle([organized.slice(0, 2000)]);
    if (t) notes.updateMeta(id, { title: t });
    ctx.knowledge.markDirty();
    return { organized };
  });

  // ---- knowledge (ask everything) ----
  const { knowledge, embedder } = ctx;
  ipcMain.handle('know:stats', () => {
    const s = knowledge.stats();
    s.semantic = {
      engine: !!embedder.serverBin,
      installed: embedder.hasModel(),
      on: store.getSettings().semanticSearch !== false && embedder.available(),
    };
    return s;
  });
  ipcMain.handle('know:search', async (_e, query) => {
    const r = await knowledge.retrieve(String(query || ''), { limit: 12 });
    return r.hits;
  });
  ipcMain.handle('know:reindex', async () => {
    knowledge.markDirty();
    knowledge.build();
    if (store.getSettings().semanticSearch !== false) await knowledge.ensureVectors().catch(() => {});
    return knowledge.stats();
  });
  ipcMain.handle('know:download-embed', async () => {
    const send = (p) => {
      if (windows.dashboard && !windows.dashboard.isDestroyed()) {
        windows.dashboard.webContents.send('ob:model-progress', { model: 'embed', progress: p });
      }
    };
    await embedder.downloadModel(send);
    send(1);
    knowledge.markDirty();
    knowledge.build();
    await knowledge.ensureVectors().catch(() => {});
    return true;
  });
  ipcMain.handle('know:ask', async (e, query) => {
    const send = (hits) => {
      if (windows.dashboard && !windows.dashboard.isDestroyed()) {
        windows.dashboard.webContents.send('know:retrieved', hits);
      }
    };
    return knowledge.ask(String(query || ''), { onRetrieved: send });
  });
  // Ask by voice: the HUD sends the recorded question; we transcribe it,
  // answer it from the notes, push the result back, and read it aloud.
  ipcMain.handle('ask:voice', async (_e, { wav, durMs }) => {
    const hud = windows.askhud;
    const reply = (payload) => {
      if (hud && !hud.isDestroyed()) hud.webContents.send('ask:answer', payload);
    };
    try {
      const fs2 = require('fs');
      const path2 = require('path');
      const os2 = require('os');
      const formatter = require('./formatter');
      if (!wav || wav.byteLength < 44 + 8000) {
        reply({ answer: null, message: 'I didn’t catch a question.' });
        return { ok: false };
      }
      const buf = Buffer.from(wav);
      const rms = formatter.wavRms(buf);
      if (rms < 0.0015) {
        reply({ answer: null, message: 'I didn’t hear anything.' });
        return { ok: false };
      }
      const tmp = path2.join(os2.tmpdir(), `sotto-ask-${Date.now()}.wav`);
      fs2.writeFileSync(tmp, buf);
      const settings = store.getSettings();
      let question = '';
      try {
        const t = await transcriber.transcribe(tmp, { model: settings.model, language: settings.language });
        question = formatter.formatTranscript(t.text, { cleanupLevel: 'light', pressEnterCommand: false }).text;
      } finally {
        try { fs2.unlinkSync(tmp); } catch { /* fine */ }
      }
      if (!question || formatter.isLikelyHallucination(question, rms)) {
        reply({ answer: null, message: 'I didn’t catch a question.' });
        return { ok: false };
      }
      const res = await knowledge.ask(question);
      reply({
        question,
        answer: res.answer,
        sentences: res.sentences,
        sources: res.sources,
        message: res.answer ? null
          : res.reason === 'llm-unavailable' ? 'Turn on AI Polish in Settings to get spoken answers.'
          : 'I couldn’t find that in your notes.',
      });
      // Speak it. macOS `say` keeps this dependency-free; the answer is
      // stripped of citation markers so it reads naturally.
      if (res.answer && store.getSettings().askSpeaks) {
        const spoken = res.answer.replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ').slice(0, 700);
        const { execFile } = require('child_process');
        if (ctx.sayProc) { try { ctx.sayProc.kill(); } catch {} }
        ctx.sayProc = execFile('/usr/bin/say', ['-r', '190', spoken], () => { ctx.sayProc = null; });
      }
      return { ok: true };
    } catch (err) {
      ctx.log('ask:voice failed: ' + err.message);
      reply({ answer: null, message: 'Something went wrong.' });
      return { ok: false, error: 'failed' };
    }
  });
  ipcMain.handle('ask:close', () => {
    if (ctx.sayProc) { try { ctx.sayProc.kill(); } catch {} ctx.sayProc = null; }
    const hud = windows.askhud;
    if (hud && !hud.isDestroyed()) hud.hide();
    return true;
  });

  ipcMain.handle('know:open', (_e, { source, refId }) => {
    if (!windows.dashboard || windows.dashboard.isDestroyed()) return false;
    windows.dashboard.show();
    if (source === 'meeting') windows.dashboard.webContents.send('know:goto-meeting', refId);
    else windows.dashboard.webContents.send('debug:navigate', source === 'dictation' ? 'home' : 'meetings');
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
