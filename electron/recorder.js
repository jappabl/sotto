// The dictation orchestrator: a small state machine wiring hotkeys → flow bar
// capture → transcription → formatting → insertion → history.
//
// States: idle → recording → processing → idle
// Hands-free: double-tap (or flow bar click) enters recording until toggled off.

const fs = require('fs');
const path = require('path');

class Recorder {
  constructor({ store, hotkeys, transcriber, inserter, log = () => {} }) {
    this.store = store;
    this.hotkeys = hotkeys;
    this.transcriber = transcriber;
    this.inserter = inserter;
    this.log = log;
    this.state = 'idle';
    this.handsFree = false;
    this.flowbar = null;         // BrowserWindow, set by main
    this.dashboard = null;
    this.sessionStart = 0;
    this.frontApp = { name: '', bundle: '' };
    this.capTimer = null;
    this._pendingStop = null;

    hotkeys.on('holdStart', () => this._onHoldStart());
    hotkeys.on('holdEnd', (dur) => this._onHoldEnd(dur));
    hotkeys.on('doubleTap', () => this.toggleHandsFree());
    hotkeys.on('esc', () => this.cancel());
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
    this.hotkeys.setRecording(true);
    // Snapshot the frontmost app now — that's where text will land.
    this.hotkeys.queryFront().then((f) => { this.frontApp = f; });
    this._sendFlowbar('flow:record-start', {
      mode,
      sound: settings.soundEffects,
    });
    // Hands-free session cap (matches the original's 20-minute limit).
    this.capTimer = setTimeout(() => {
      if (this.state === 'recording') this.stopRecording();
    }, settings.handsFreeCap);
    this.log(`recording started (${mode})`);
  }

  stopRecording() {
    if (this.state !== 'recording') return;
    this.state = 'processing';
    this.handsFree = false;
    clearTimeout(this.capTimer);
    this.hotkeys.setRecording(false);
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
    this.handsFree = false;
    clearTimeout(this.capTimer);
    this.hotkeys.setRecording(false);
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

    const audioFile = `a-${Date.now()}.wav`;
    const wavPath = path.join(this.store.audioDir, audioFile);
    fs.writeFileSync(wavPath, Buffer.from(wav));

    try {
      const t0 = Date.now();
      const { text: rawText, engine } = await this.transcriber.transcribe(wavPath, {
        model: settings.model,
        language: settings.language,
      });
      this.log(`transcribed in ${Date.now() - t0}ms via ${engine}: ${rawText.slice(0, 60)}`);
      const { text, pressEnter } = require('./formatter').formatTranscript(rawText, {
        removeFillers: settings.removeFillers,
        autoPunctuate: settings.autoPunctuate,
        pressEnterCommand: settings.pressEnterCommand,
        textStyle: settings.textStyle,
        cleanupLevel: settings.cleanupLevel,
        dictionary: this.store.dictionary,
        snippets: this.store.snippets,
      });

      if (!text) {
        this._finish(null);
        try { fs.unlinkSync(wavPath); } catch { /* fine */ }
        return { ok: false, reason: 'empty' };
      }

      const entry = this.store.addHistoryEntry({
        text, raw: rawText,
        app: this.frontApp.name, bundle: this.frontApp.bundle,
        durMs, audioFile,
      });

      await this.inserter.insert(text, { pressEnter });
      this._finish({ words: entry.words });
      this._sendDashboard('data:changed', { what: 'history' });
      return { ok: true, text };
    } catch (err) {
      this.log('transcription failed: ' + err.message);
      this._sendFlowbar('flow:error', { message: 'Transcription failed' });
      this.state = 'idle';
      return { ok: false, reason: err.message };
    }
  }

  _finish(result) {
    this.state = 'idle';
    this.handsFree = false;
    clearTimeout(this.capTimer);
    clearTimeout(this._pendingStop);
    this.hotkeys.setRecording(false);
    this._sendFlowbar('flow:done', result || {});
  }
}

module.exports = { Recorder };
