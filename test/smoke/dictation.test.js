// The full-pipeline E2E: boots the real app with a fake microphone that plays
// a synthesized phrase, simulates the fn hotkey hold, and asserts the
// transcribed + formatted text lands in history and on the clipboard.
//
// Run: node test/smoke/dictation.test.js

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sotto-e2e-'));
const USERDATA = path.join(TMP, 'userdata');
fs.mkdirSync(USERDATA, { recursive: true });

const PHRASE = 'This is an end to end test of the dictation pipeline. It should appear in the history.';
const aiff = path.join(TMP, 'phrase.aiff');
const fakeMic = path.join(TMP, 'phrase.wav');
execFileSync('say', ['-o', aiff, PHRASE]);
// Chromium's fake capture wants standard PCM WAV; 44.1 kHz mono is safe.
execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', aiff, fakeMic]);

// Point the isolated profile at the shared models dir via a symlink so the
// test does not re-download 150 MB.
const realModels = path.join(os.homedir(), 'Library', 'Application Support', 'Sotto', 'models');
fs.symlinkSync(realModels, path.join(USERDATA, 'models'));

fs.writeFileSync(path.join(USERDATA, 'settings.json'), JSON.stringify({
  onboarded: true, userName: 'Test', soundEffects: false,
  ...(process.env.SOTTO_BENCH ? JSON.parse(process.env.SOTTO_BENCH) : {}),
}));

const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
const child = spawn(electron, ['.'], {
  cwd: ROOT,
  env: {
    ...process.env,
    SOTTO_SMOKE: '1',
    SOTTO_E2E: '1',
    SOTTO_NO_PASTE: '1',
    SOTTO_USERDATA: USERDATA,
    SOTTO_FAKE_MIC: fakeMic,
    SOTTO_E2E_HOLD_MS: '7500',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let err = '';
child.stdout.on('data', (d) => {
  out += d;
  // Surface the per-stage latency line so a regression is visible in the run.
  for (const l of String(d).split('\n')) if (l.includes('latency {')) console.log(l.trim());
});
child.stderr.on('data', (d) => { err += d; });

const timeout = setTimeout(() => {
  console.error('DICTATION_E2E_FAIL: timed out\n' + out + err);
  child.kill('SIGKILL');
  process.exit(1);
}, 120000);

child.on('exit', () => {
  clearTimeout(timeout);
  try {
    const m = out.match(/E2E_RESULT (.*)/);
    assert.ok(m, 'no E2E_RESULT in output.\n--- stdout:\n' + out + '\n--- stderr:\n' + err);
    const result = JSON.parse(m[1]);
    console.log('  transcribed:', JSON.stringify(result.text));
    console.log('  clipboard:  ', JSON.stringify(result.clipboard));
    console.log('  words:', result.words, 'durMs:', result.durMs);

    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    const got = new Set(norm(result.text));
    const want = norm(PHRASE);
    const hit = want.filter((w) => got.has(w)).length;
    const ratio = hit / want.length;
    assert.ok(ratio >= 0.7, `accuracy ${(ratio * 100).toFixed(0)}% too low — got: ${result.text}`);
    assert.equal(result.clipboard, result.text, 'clipboard should hold the inserted text');
    assert.ok(result.words >= 10, 'expected a real sentence, got ' + result.words + ' words');
    console.log('DICTATION_E2E_OK');
  } catch (e) {
    console.error('DICTATION_E2E_FAIL:', e.message);
    process.exit(1);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});
