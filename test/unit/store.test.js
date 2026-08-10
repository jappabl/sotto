const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../../electron/store');

let dir;
let store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sotto-test-'));
  store = new Store(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('settings round-trip with defaults', () => {
  assert.equal(store.getSettings().hotkey, 'fn');
  store.setSettings({ hotkey: 'rcmd', userName: 'Hao' });
  const reloaded = new Store(dir);
  assert.equal(reloaded.getSettings().hotkey, 'rcmd');
  assert.equal(reloaded.getSettings().userName, 'Hao');
  assert.equal(reloaded.getSettings().soundEffects, true);
});

test('dictionary add/dedupe/update/remove', () => {
  const a = store.addDictionaryEntry({ word: 'Figma' });
  assert.ok(a.id);
  const dup = store.addDictionaryEntry({ word: 'figma' });
  assert.equal(dup.id, a.id);
  store.updateDictionaryEntry(a.id, { starred: true });
  assert.equal(new Store(dir).dictionary[0].starred, true);
  store.removeDictionaryEntry(a.id);
  assert.equal(new Store(dir).dictionary.length, 0);
});

test('snippets validation', () => {
  assert.equal(store.addSnippet({ trigger: '', expansion: 'x' }), null);
  assert.equal(store.addSnippet({ trigger: 'x', expansion: '' }), null);
  const s = store.addSnippet({ trigger: 'my email', expansion: 'a@b.c' });
  assert.ok(s.id);
});

test('history append, stats, and word math', () => {
  const now = Date.now();
  store.addHistoryEntry({ text: 'one two three four five six', durMs: 3000, app: 'Notes', bundle: 'com.apple.Notes' });
  store.addHistoryEntry({ text: 'seven eight nine ten eleven twelve', durMs: 3000, app: 'Mail', bundle: 'com.apple.mail' });
  const stats = store.getStats(now);
  assert.equal(stats.totalWords, 12);
  assert.equal(stats.appCount, 2);
  assert.equal(stats.wordsToday, 12);
  assert.equal(stats.dailyStreak, 1);
  assert.equal(stats.weeklyStreak, 1);
  // 12 words in 6 seconds = 120 WPM
  assert.equal(stats.avgWpm, 120);
});

test('history survives reload (jsonl)', () => {
  store.addHistoryEntry({ text: 'hello world', durMs: 2000 });
  const reloaded = new Store(dir);
  const hist = reloaded.getHistory();
  assert.equal(hist.length, 1);
  assert.equal(hist[0].text, 'hello world');
  assert.equal(hist[0].words, 2);
});

test('cancelled entries are excluded from stats', () => {
  store.addHistoryEntry({ text: '', durMs: 5000, cancelled: true, audioFile: null });
  const stats = store.getStats();
  assert.equal(stats.count, 0);
  assert.equal(stats.totalWords, 0);
});

test('streak math across days', () => {
  const now = Date.now();
  const DAY = 86400000;
  // activity yesterday and today → streak 2
  store.addHistoryEntry({ text: 'a b c', durMs: 2000 });
  const hist = store._loadHistory();
  hist[0].ts = now - DAY;
  store.addHistoryEntry({ text: 'd e f', durMs: 2000 });
  assert.equal(store.getStats(now).dailyStreak, 2);
});

test('history delete removes entry', () => {
  const e = store.addHistoryEntry({ text: 'to be deleted', durMs: 2000 });
  store.removeHistoryEntry(e.id);
  assert.equal(store.getHistory().length, 0);
  assert.equal(new Store(dir).getHistory().length, 0);
});
