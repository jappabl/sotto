// Persistence for settings, history, dictionary, and snippets.
// Everything is plain JSON under app.getPath('userData') so the app has zero
// runtime dependencies and the data stays human-inspectable.

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  userName: '',
  onboarded: false,
  hotkey: 'fn',              // 'fn' | 'ctrl+alt' | 'rcmd' | 'ralt'
  language: 'auto',          // whisper language code or 'auto'
  model: 'ggml-base.bin',
  soundEffects: true,
  muteWhileDictating: true,  // silence speakers during capture (no bleed)
  micDevice: 'auto',         // 'auto' avoids loopback/virtual devices
  launchAtLogin: false,
  flowBarDock: 'bottom',     // 'bottom' | 'left' | 'right'
  flowBarOffset: 0.5,        // fraction along the docked edge
  textStyle: 'formal',       // 'formal' | 'casual' | 'very-casual'
  cleanupLevel: 'medium',    // 'none' | 'light' | 'medium' | 'high'
  aiPolish: false,           // local-LLM cleanup pass (needs LLM model)
  meetingDetection: true,    // offer to take notes when a call starts
  semanticSearch: true,      // hybrid embeddings in Ask (needs embed model)
  askHotkey: 'Command+Shift+A', // speak a question, hear the answer
  askSpeaks: true,           // read answers aloud (macOS `say`)
  brainDumpHotkey: 'Command+Shift+N', // ramble -> organized note
  orgDir: '',                // shared folder = the org; empty = solo
  commandMode: true,         // fn+ctrl chord edits the selection by voice
  removeFillers: true,
  autoPunctuate: true,       // spoken punctuation commands
  autoLearn: true,           // learn dictionary words from corrections (manual add only in v1)
  pressEnterCommand: true,   // trailing "press enter" presses Enter
  handsFreeCap: 20 * 60 * 1000,
  audioRetentionDays: 14,
};

class Store {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.audioDir = path.join(baseDir, 'audio');
    fs.mkdirSync(this.audioDir, { recursive: true });
    this.settingsPath = path.join(baseDir, 'settings.json');
    this.historyPath = path.join(baseDir, 'history.jsonl');
    this.dictionaryPath = path.join(baseDir, 'dictionary.json');
    this.snippetsPath = path.join(baseDir, 'snippets.json');
    this.settings = { ...DEFAULT_SETTINGS, ...this._readJson(this.settingsPath, {}) };
    this.dictionary = this._readJson(this.dictionaryPath, []);
    this.snippets = this._readJson(this.snippetsPath, []);
    this._history = null; // lazy cache
  }

  _readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  _writeJson(file, value) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  }

  // ---- settings ----
  getSettings() {
    return { ...this.settings };
  }

  setSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this._writeJson(this.settingsPath, this.settings);
    return this.getSettings();
  }

  // ---- dictionary ----
  addDictionaryEntry({ word, replacement = '', starred = false, auto = false }) {
    const entry = {
      id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      word: String(word).slice(0, 60).trim(),
      replacement: String(replacement).slice(0, 60).trim(),
      starred, auto, ts: Date.now(),
    };
    if (!entry.word) return null;
    const dup = this.dictionary.find(
      (d) => d.word.toLowerCase() === entry.word.toLowerCase(),
    );
    if (dup) return dup;
    this.dictionary.push(entry);
    this._writeJson(this.dictionaryPath, this.dictionary);
    return entry;
  }

  updateDictionaryEntry(id, patch) {
    const e = this.dictionary.find((d) => d.id === id);
    if (!e) return null;
    Object.assign(e, patch);
    this._writeJson(this.dictionaryPath, this.dictionary);
    return e;
  }

  removeDictionaryEntry(id) {
    this.dictionary = this.dictionary.filter((d) => d.id !== id);
    this._writeJson(this.dictionaryPath, this.dictionary);
  }

  // ---- snippets ----
  addSnippet({ trigger, expansion }) {
    const entry = {
      id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      trigger: String(trigger).slice(0, 60).trim(),
      expansion: String(expansion).slice(0, 4000),
      ts: Date.now(),
    };
    if (!entry.trigger || !entry.expansion) return null;
    const dup = this.snippets.find(
      (s) => s.trigger.toLowerCase() === entry.trigger.toLowerCase(),
    );
    if (dup) return dup;
    this.snippets.push(entry);
    this._writeJson(this.snippetsPath, this.snippets);
    return entry;
  }

  updateSnippet(id, patch) {
    const e = this.snippets.find((s) => s.id === id);
    if (!e) return null;
    Object.assign(e, patch);
    this._writeJson(this.snippetsPath, this.snippets);
    return e;
  }

  removeSnippet(id) {
    this.snippets = this.snippets.filter((s) => s.id !== id);
    this._writeJson(this.snippetsPath, this.snippets);
  }

  // ---- history ----
  _loadHistory() {
    if (this._history) return this._history;
    this._history = [];
    try {
      const lines = fs.readFileSync(this.historyPath, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try { this._history.push(JSON.parse(line)); } catch { /* skip bad line */ }
      }
    } catch { /* no history yet */ }
    return this._history;
  }

  addHistoryEntry({ text, raw, app, bundle, durMs, audioFile = null, cancelled = false }) {
    const words = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
    const entry = {
      id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      text: text || '',
      raw: raw || '',
      app: app || '',
      bundle: bundle || '',
      durMs: durMs || 0,
      words,
      wpm: durMs > 1500 && words > 0 ? Math.round(words / (durMs / 60000)) : 0,
      audioFile,
      cancelled,
    };
    this._loadHistory().push(entry);
    fs.appendFileSync(this.historyPath, JSON.stringify(entry) + '\n');
    return entry;
  }

  removeHistoryEntry(id) {
    const hist = this._loadHistory();
    const e = hist.find((h) => h.id === id);
    if (e && e.audioFile) {
      try { fs.unlinkSync(path.join(this.audioDir, e.audioFile)); } catch { /* gone */ }
    }
    this._history = hist.filter((h) => h.id !== id);
    this._rewriteHistory();
  }

  // "Undo AI edit": swap the cleaned text back to the raw transcript (and
  // back again). The raw transcript is always retained.
  toggleHistoryEdit(id) {
    const e = this._loadHistory().find((h) => h.id === id);
    if (!e || !e.raw) return null;
    if (e.text === e.raw) {
      if (e.edited === undefined || e.edited === e.raw) return null; // nothing to redo
      e.text = e.edited; // redo AI edit
    } else {
      e.edited = e.text;
      e.text = e.raw; // undo AI edit
    }
    this._rewriteHistory();
    return e;
  }

  _rewriteHistory() {
    const tmp = this.historyPath + '.tmp';
    fs.writeFileSync(tmp, this._history.map((h) => JSON.stringify(h)).join('\n') + (this._history.length ? '\n' : ''));
    fs.renameSync(tmp, this.historyPath);
  }

  getHistory({ limit = 200 } = {}) {
    return this._loadHistory().slice(-limit).reverse();
  }

  // Stats derived from history. `now` injectable for tests.
  getStats(now = Date.now()) {
    const hist = this._loadHistory().filter((h) => !h.cancelled);
    const totalWords = hist.reduce((a, h) => a + h.words, 0);
    const totalMs = hist.reduce((a, h) => a + (h.words > 0 ? h.durMs : 0), 0);
    const avgWpm = totalMs > 4000 ? Math.round(totalWords / (totalMs / 60000)) : 0;
    const apps = new Set(hist.filter((h) => h.bundle).map((h) => h.bundle));

    const dayKey = (ts) => {
      const d = new Date(ts);
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    };
    const days = new Set(hist.map((h) => dayKey(h.ts)));
    // Daily streak: consecutive days ending today (or yesterday, so an
    // early-morning check doesn't zero it out).
    let dailyStreak = 0;
    const MS_DAY = 86400000;
    let cursor = now;
    if (!days.has(dayKey(cursor))) cursor -= MS_DAY;
    while (days.has(dayKey(cursor))) {
      dailyStreak += 1;
      cursor -= MS_DAY;
    }
    // Weekly streak: consecutive ISO-ish weeks (week = Monday start) with activity.
    const weekKey = (ts) => {
      const d = new Date(ts);
      const monday = new Date(d);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return monday.getTime();
    };
    const weeks = new Set(hist.map((h) => weekKey(h.ts)));
    let weeklyStreak = 0;
    let wcursor = weekKey(now);
    while (weeks.has(wcursor)) {
      weeklyStreak += 1;
      wcursor -= 7 * MS_DAY;
    }
    // Words today, for the daily challenge card.
    const wordsToday = hist
      .filter((h) => dayKey(h.ts) === dayKey(now))
      .reduce((a, h) => a + h.words, 0);
    return { totalWords, avgWpm, appCount: apps.size, dailyStreak, weeklyStreak, wordsToday, count: hist.length };
  }

  pruneOldAudio(now = Date.now()) {
    const cutoff = now - this.settings.audioRetentionDays * 86400000;
    let changed = false;
    for (const h of this._loadHistory()) {
      if (h.audioFile && h.ts < cutoff) {
        try { fs.unlinkSync(path.join(this.audioDir, h.audioFile)); } catch { /* gone */ }
        h.audioFile = null;
        changed = true;
      }
    }
    if (changed) this._rewriteHistory();
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
