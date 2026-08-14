// The dictation orchestrator: a small state machine wiring hotkeys → flow bar
// capture → transcription → formatting → insertion → history.
//
// States: idle → recording → processing → idle
// Hands-free: double-tap (or flow bar click) enters recording until toggled off.

const fs = require('fs');
const path = require('path');

const CTRL_KEYS = [59, 62]; // left/right control

// Bundle ids where short messages read better without a trailing period.
const CHAT_BUNDLES = new Set([
  'com.apple.MobileSMS', 'com.apple.iChat',
  'net.whatsapp.WhatsApp', 'com.hnc.Discord', 'com.tinyspeck.slackmacgap',
  'ru.keepcoder.Telegram', 'org.telegram.desktop', 'org.whispersystems.signal-desktop',
  'com.facebook.archon', 'com.microsoft.teams2',
]);

class Recorder {
  constructor({ store, hotkeys, transcriber, inserter, polisher = null, sysaudio = null, log = () => {} }) {
    this.store = store;
    this.hotkeys = hotkeys;
    this.transcriber = transcriber;
    this.inserter = inserter;
    this.polisher = polisher;
    this.sysaudio = sysaudio;
    this.log = log;
    this.state = 'idle';
    this.handsFree = false;
    this.commandMode = false;
    this.flowbar = null;         // BrowserWindow, set by main
    this.dashboard = null;
    this.sessionStart = 0;
    this.frontApp = { name: '', bundle: '' };
    this.context = { ok: false, before: '', after: '', selected: '' };
    this.capTimer = null;
    this._pendingStop = null;
    this.onStateChange = null; // set by main; called with the new state

    hotkeys.on('holdStart', () => this._onHoldStart());
    hotkeys.on('holdEnd', (dur) => this._onHoldEnd(dur));
    hotkeys.on('doubleTap', () => this.toggleHandsFree());
    hotkeys.on('esc', () => this.cancel());
    // Adding ctrl while the push-to-talk hold is young switches the session
    // to Command Mode ("edit my selection with what I'm about to say").
    hotkeys.on('mods', (mods) => {
      if (this.state === 'recording' && !this.commandMode &&
          this.store.getSettings().commandMode &&
          Date.now() - this.sessionStart < 2000 &&
          mods.fn && mods.keys.some((k) => CTRL_KEYS.includes(k))) {
        this.commandMode = true;
        this._sendFlowbar('flow:command-mode', {});
        this.log('switched to command mode');
      }
    });
  }

  attachWindows({ flowbar, dashboard }) {
    this.flowbar = flowbar;
    this.dashboard = dashboard;
  }

  _sendFlowbar(channel, payload) {
    if (this.flowbar && !this.flowbar.isDestroyed()) {
      this.flowbar.webContents.send(channel, payload);
    }
  }

  _sendDashboard(channel, payload) {
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.dashboard.webContents.send(channel, payload);
    }
  }

  _onHoldStart() {
    if (this.state === 'idle' && !this.handsFree) {
      this.startRecording('hold');
    }
  }

  _onHoldEnd() {
    if (this.state === 'recording' && !this.handsFree) {
      this.stopRecording();
    }
  }

  toggleHandsFree() {
    if (this.state === 'recording') {
      this.handsFree = false;
      this.stopRecording();
    } else if (this.state === 'idle') {
      this.handsFree = true;
      this.startRecording('hands-free');
    }
  }

  // Brain dump: hands-free capture whose transcript becomes an organized
  // note instead of being pasted at the cursor.
  toggleBrainDump() {
    if (this.state === 'recording' && this.brainDump) {
      this.handsFree = false;
      this.stopRecording();
      return 'stopping';
    }
    if (this.state !== 'idle') return 'busy';
    this.brainDump = true;
    this.handsFree = true;
    this.startRecording('brain-dump');
    return 'started';
  }

  async startRecording(mode) {
    if (this.state !== 'idle') return;
    const settings = this.store.getSettings();
    if (!this.transcriber.hasModel(settings.model)) {
      this._sendFlowbar('flow:error', { message: 'Model missing — open Settings' });
      this.handsFree = false;
      return;
    }
    this.state = 'recording';
    this.sessionStart = Date.now();
    this.commandMode = false;
    if (this.onStateChange) this.onStateChange('recording');
    this.hotkeys.setRecording(true);
    // Load the models now rather than when the key comes up. Whatever this
    // costs is hidden behind the time spent speaking, which is the only free
    // time in the whole pipeline.
    this.transcriber.ensureServer(settings.model).catch(() => {});
    if (settings.aiPolish && this.polisher && settings.cleanupLevel !== 'none') {
      this.polisher.warm().catch(() => {});
    }
    // Snapshot the frontmost app + text context now — that's where text lands.
    this.hotkeys.queryFront().then((f) => { this.frontApp = f; });
    this.context = { ok: false, before: '', after: '', selected: '' };
    this.hotkeys.queryContext().then((c) => { this.context = c; });
    this._sendFlowbar('flow:record-start', {
      mode,
      sound: settings.soundEffects,
    });
    // Silence the speakers so the mic only hears the speaker's voice.
    // Slight delay lets the start ping play first. Never during a meeting:
    // muting would cut the call audio (and the meeting capture with it).
    const inMeeting = this.meetingsRef && this.meetingsRef.status().recording;
    if (settings.muteWhileDictating && this.sysaudio && !inMeeting) {
      setTimeout(() => {
        if (this.state === 'recording') this.sysaudio.muteForDictation();
      }, 260);
    }
    // Hands-free session cap (matches the original's 20-minute limit).
    this.capTimer = setTimeout(() => {
      if (this.state === 'recording') this.stopRecording();
    }, settings.handsFreeCap);
    this.log(`recording started (${mode})`);
  }

  stopRecording() {
    if (this.state !== 'recording') return;
    // Everything from here until the text lands is latency the user sits through.
    this.releasedAt = Date.now();
    this.state = 'processing';
    if (this.onStateChange) this.onStateChange('processing');
    this.handsFree = false;
    clearTimeout(this.capTimer);
    this.hotkeys.setRecording(false);
    if (this.sysaudio) this.sysaudio.restore();
    this._sendFlowbar('flow:record-stop', {});
    // Renderer replies with audio via ipc 'flow:audio' → handleAudio().
    // Guard: if no audio arrives (renderer wedged), reset in 10 s.
    this._pendingStop = setTimeout(() => {
      if (this.state === 'processing') {
        this.log('no audio received — resetting');
        this._finish(null);
      }
    }, 10000);
  }

  cancel() {
    if (this.state !== 'recording') return;
    this.state = 'idle';
    if (this.onStateChange) this.onStateChange('idle');
    this.handsFree = false;
    clearTimeout(this.capTimer);
    this.hotkeys.setRecording(false);
    if (this.sysaudio) this.sysaudio.restore();
    const durMs = Date.now() - this.sessionStart;
    this._sendFlowbar('flow:record-cancel', { keepAudio: durMs > 2000 });
    this.log('recording cancelled');
  }

  // Called from IPC when the flow bar delivers captured audio.
  async handleAudio({ wav, durMs, cancelled }) {
    clearTimeout(this._pendingStop);
    const settings = this.store.getSettings();

    if (cancelled) {
      // Keep cancelled audio (>2 s) in history as audio-only, like the original.
      if (wav && durMs > 2000) {
        const audioFile = `c-${Date.now()}.wav`;
        fs.writeFileSync(path.join(this.store.audioDir, audioFile), Buffer.from(wav));
        this.store.addHistoryEntry({
          text: '', raw: '', app: this.frontApp.name, bundle: this.frontApp.bundle,
          durMs, audioFile, cancelled: true,
        });
        this._sendDashboard('data:changed', { what: 'history' });
      }
      this.state = 'idle';
      return { ok: true };
    }

    // Require real audio: >0.35 s duration and enough PCM bytes (~0.4 s at
    // 16 kHz mono 16-bit) to weed out mic failures and stray taps.
    if (!wav || wav.byteLength < 44 + 12000 || durMs < 350 || durMs > 25 * 60 * 1000) {
      this._finish(null);
      return { ok: false, reason: 'too-short' };
    }

    const formatter = require('./formatter');

    // Dead-silent audio (accidental tap, muted mic): skip transcription
    // entirely — whisper would only hallucinate a pleasantry from it.
    const rms = formatter.wavRms(Buffer.from(wav));
    if (rms < 0.0015) {
      this.log(`silent audio (rms ${rms.toFixed(5)}) — skipping transcription`);
      this._finish(null);
      return { ok: false, reason: 'silent' };
    }

    const audioFile = `a-${Date.now()}.wav`;
    const wavPath = path.join(this.store.audioDir, audioFile);
    const tDeliver = Date.now();
    fs.writeFileSync(wavPath, Buffer.from(wav));
    const tWav = Date.now();

    try {
      const t0 = Date.now();
      const { text: rawText, engine } = await this.transcriber.transcribe(wavPath, {
        model: settings.model,
        language: settings.language,
      });
      const tAsr = Date.now();
      this.log(`transcribed in ${tAsr - t0}ms via ${engine}: ${rawText.slice(0, 60)}`);

      if (this.commandMode) {
        return await this._handleCommand(rawText, { durMs, audioFile, wavPath });
      }
      if (this.brainDump) {
        return await this._handleBrainDump(rawText, { durMs, wavPath });
      }

      // Whisper hallucinates pleasantries on near-silence — drop them.
      if (formatter.isLikelyHallucination(rawText, rms)) {
        this.log(`dropped silence hallucination (rms ${rms.toFixed(4)}): ${rawText.slice(0, 30)}`);
        // Loud audio that yields no words = the mic heard noise/music, not
        // speech (a Bluetooth headset mic or a noisy room). Say so instead of
        // failing silently, so it never looks like the app is just broken.
        if (rms > 0.05 && !rawText.trim()) {
          this._sendFlowbar('flow:error', { message: 'Didn’t catch speech — try the built-in mic or move closer' });
        }
        this.state = 'idle';
        if (this.onStateChange) this.onStateChange('idle');
        try { fs.unlinkSync(wavPath); } catch { /* fine */ }
        return { ok: false, reason: 'silence' };
      }

      let { text, pressEnter } = formatter.formatTranscript(rawText, {
        removeFillers: settings.removeFillers,
        autoPunctuate: settings.autoPunctuate,
        pressEnterCommand: settings.pressEnterCommand,
        textStyle: settings.textStyle,
        cleanupLevel: settings.cleanupLevel,
        chatApp: CHAT_BUNDLES.has(this.frontApp.bundle),
        dictionary: this.store.dictionary,
        snippets: this.store.snippets,
      });

      if (!text) {
        this._finish(null);
        try { fs.unlinkSync(wavPath); } catch { /* fine */ }
        return { ok: false, reason: 'empty' };
      }

      // Optional local-LLM polish: catches fuzzy corrections the rules
      // missed. Deterministic text is the floor — null means keep ours.
      const { needsPolish } = require('./polisher');
      if (settings.aiPolish && this.polisher && settings.cleanupLevel !== 'none'
          && needsPolish(text)) {
        const polished = await this.polisher.polish(text, {
          context: this.context.ok ? this.context : null,
          appName: this.frontApp.name,
        });
        if (polished && polished !== text) {
          this.log('polish applied: ' + polished.slice(0, 60));
          text = formatter.applyStyle(
            formatter.stripEmDashes(polished),
            settings.textStyle,
            this.store.dictionary,
          );
        }
      }

      const tPolish = Date.now();

      // Continuation casing/spacing against the text already around the cursor.
      if (this.context.ok) {
        text = formatter.adjustForContext(text, this.context.before, this.context.after);
        if (!text) {
          this._finish(null);
          return { ok: false, reason: 'seam-empty' };
        }
      }

      const entry = this.store.addHistoryEntry({
        text, raw: rawText,
        app: this.frontApp.name, bundle: this.frontApp.bundle,
        durMs, audioFile,
      });

      // If the user switched apps while we transcribed, never blind-paste
      // into the wrong window — hold the text on the clipboard instead.
      const nowFront = await this.hotkeys.queryFront();
      if (this.frontApp.bundle && nowFront.bundle &&
          nowFront.bundle !== this.frontApp.bundle) {
        this.log(`focus moved (${this.frontApp.bundle} → ${nowFront.bundle}) — holding paste`);
        this.inserter.holdToClipboard(text);
        this._finish({ words: entry.words });
        this._sendDashboard('data:changed', { what: 'history' });
        return { ok: true, text, held: true };
      }

      await this.inserter.insert(text, { pressEnter });
      // One line per dictation, so a slow one can be explained rather than guessed at.
      if (this.releasedAt) {
        this.log('latency ' + JSON.stringify({
          total: Date.now() - this.releasedAt,
          deliver: tDeliver - this.releasedAt,
          wav: tWav - tDeliver,
          asr: tAsr - t0,
          polish: tPolish - tAsr,
          insert: Date.now() - tPolish,
          audioMs: durMs,
        }));
      }
      this._finish({ words: entry.words });
      this._sendDashboard('data:changed', { what: 'history' });
      this._scheduleAutoLearn(text);
      return { ok: true, text };
    } catch (err) {
      this.log('transcription failed: ' + err.message);
      this._sendFlowbar('flow:error', { message: 'Transcription failed' });
      this.state = 'idle';
      return { ok: false, reason: err.message };
    }
  }

  // Brain dump: the whole ramble becomes an organized note, not pasted text.
  async _handleBrainDump(rawText, { durMs, wavPath }) {
    this.brainDump = false;
    try { fs.unlinkSync(wavPath); } catch { /* fine */ }
    const { formatTranscript } = require('./formatter');
    // Light cleanup only: keep every thought, just drop fillers/stutters.
    const clean = formatTranscript(rawText, {
      cleanupLevel: 'light', pressEnterCommand: false, textStyle: 'formal',
      dictionary: this.store.dictionary, snippets: this.store.snippets,
    }).text;
    if (!clean || clean.split(/\s+/).length < 8) {
      this._sendFlowbar('flow:error', { message: 'Too short to make a note' });
      this.state = 'idle';
      if (this.onStateChange) this.onStateChange('idle');
      return { ok: false, reason: 'too-short' };
    }
    const meta = this.notesRef.create({ raw: clean, durMs });
    this.log(`brain dump captured: ${meta.words} words -> ${meta.id}`);
    this._finish({ words: meta.words });
    if (this.onBrainDump) this.onBrainDump(meta);
    return { ok: true, noteId: meta.id };
  }

  // Command Mode: the dictation is an instruction applied to the selection.
  async _handleCommand(instructionRaw, { durMs, audioFile }) {
    const { formatTranscript } = require('./formatter');
    const instruction = formatTranscript(instructionRaw, {
      cleanupLevel: 'light', pressEnterCommand: false,
    }).text;
    if (!instruction) {
      this._finish(null);
      return { ok: false, reason: 'empty-instruction' };
    }
    if (!this.polisher || !this.polisher.available() || !this.store.getSettings().aiPolish) {
      this._sendFlowbar('flow:error', { message: 'Turn on AI Polish for Command Mode' });
      this.state = 'idle';
      return { ok: false, reason: 'polish-off' };
    }
    const selected = this.context.selected || '';
    this.log(`command: "${instruction.slice(0, 50)}" over ${selected.length} chars`);
    const result = await this.polisher.applyInstruction(instruction, selected);
    if (!result) {
      this._sendFlowbar('flow:error', { message: 'Command didn’t produce a result' });
      this.state = 'idle';
      return { ok: false, reason: 'no-result' };
    }
    this.store.addHistoryEntry({
      text: result, raw: `⌘ ${instruction}`,
      app: this.frontApp.name, bundle: this.frontApp.bundle,
      durMs, audioFile,
    });
    // Pasting over a selection replaces it.
    await this.inserter.insert(result, {});
    this._finish({ words: result.split(/\s+/).length });
    this._sendDashboard('data:changed', { what: 'history' });
    return { ok: true, text: result };
  }

  // A little while after inserting, see if the user hand-corrected any words
  // and teach the dictionary (✨ entries).
  _scheduleAutoLearn(insertedText) {
    const settings = this.store.getSettings();
    if (!settings.autoLearn || !this.context.ok) return;
    const bundle = this.frontApp.bundle;
    setTimeout(async () => {
      try {
        const front = await this.hotkeys.queryFront();
        if (front.bundle !== bundle) return; // they moved on
        const ctx = await this.hotkeys.queryContext();
        if (!ctx.ok) return;
        const fieldText = `${ctx.before}${ctx.selected}${ctx.after}`;
        const { detectCorrections } = require('./autolearn');
        for (const { to } of detectCorrections(insertedText, fieldText)) {
          const added = this.store.addDictionaryEntry({ word: to, auto: true });
          if (added) {
            this.log(`auto-learned: ${to}`);
            this._sendDashboard('data:changed', { what: 'dictionary' });
          }
        }
      } catch { /* best-effort */ }
    }, 15000);
  }

  _finish(result) {
    this.state = 'idle';
    if (this.onStateChange) this.onStateChange('idle');
    this.handsFree = false;
    clearTimeout(this.capTimer);
    clearTimeout(this._pendingStop);
    this.hotkeys.setRecording(false);
    if (this.sysaudio) this.sysaudio.restore(); // belt & braces
    this._sendFlowbar('flow:done', result || {});
  }
}

module.exports = { Recorder };
