// App-launch smoke test: boots the real Electron app in SOTTO_SMOKE mode with
// an isolated userData dir, waits for the screenshot autopilot to sweep every
// dashboard page / flow bar state / onboarding step, and asserts the captures
// exist and the app exits cleanly.
//
// Run: node test/smoke/applaunch.test.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(__dirname, 'tmp', 'shots');
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sotto-smoke-'));

// Give the smoke run its own settings marked as onboarded, with a name so the
// Home greeting renders, plus seeded history/dictionary/snippets for real UI.
fs.writeFileSync(path.join(USERDATA, 'settings.json'), JSON.stringify({
  onboarded: true, userName: 'Hao',
}));
const now = Date.now();
const seed = [
  { text: 'Just tried the new dictation flow and it feels genuinely fast on this machine.', app: 'Notes', durMs: 6200 },
  { text: 'Can you send over the updated deck before standup tomorrow morning?', app: 'Messages', durMs: 4400 },
  { text: 'Draft reply: happy to move our sync to Thursday afternoon if that is easier for everyone.', app: 'Mail', durMs: 7300 },
].map((h, i) => ({
  id: 'seed' + i, ts: now - i * 3600000, raw: h.text, text: h.text, app: h.app,
  bundle: 'seed', durMs: h.durMs, words: h.text.split(' ').length,
  wpm: Math.round(h.text.split(' ').length / (h.durMs / 60000)), audioFile: null, cancelled: false,
}));
fs.writeFileSync(path.join(USERDATA, 'history.jsonl'), seed.map((s) => JSON.stringify(s)).join('\n') + '\n');
fs.writeFileSync(path.join(USERDATA, 'dictionary.json'), JSON.stringify([
  { id: 'd1', word: 'Sotto', replacement: '', starred: true, auto: false, ts: now },
  { id: 'd2', word: 'kubectl', replacement: '', starred: false, auto: true, ts: now },
  { id: 'd3', word: 'by the way', replacement: 'btw', starred: false, auto: false, ts: now },
]));
fs.writeFileSync(path.join(USERDATA, 'snippets.json'), JSON.stringify([
  { id: 's1', trigger: 'personal email', expansion: 'hao@example.com', ts: now },
]));
// A finished meeting so the Meetings list renders with real content.
const mdir = path.join(USERDATA, 'meetings', 'mseed1');
fs.mkdirSync(mdir, { recursive: true });
fs.writeFileSync(path.join(mdir, 'meta.json'), JSON.stringify({
  id: 'mseed1', title: 'Product sync', startedAt: now - 7200000,
  endedAt: now - 5400000, state: 'enhanced', template: 'auto', appHint: 'Zoom', segments: 3,
}));
fs.writeFileSync(path.join(mdir, 'notes.md'), 'pricing pushback\nfollow up re: API');
fs.writeFileSync(path.join(mdir, 'enhanced.md'), '## Pricing\n- **Decision:** keep the current tier structure\n\n## Action items\n- [ ] Send API docs to their team');
fs.writeFileSync(path.join(mdir, 'transcript.jsonl'), [
  JSON.stringify({ t0: 0, t1: 20, who: 'them', text: 'We are a bit worried about the enterprise pricing tier.' }),
  JSON.stringify({ t0: 20, t1: 35, who: 'me', text: 'Totally fair, let me walk you through what is included.' }),
].join('\n') + '\n');

fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
const child = spawn(electron, ['.'], {
  cwd: ROOT,
  env: {
    ...process.env,
    SOTTO_SMOKE: '1',
    SOTTO_SHOTS: SHOTS,
    SOTTO_USERDATA: USERDATA,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let err = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { err += d; });

const timeout = setTimeout(() => {
  console.error('APPLAUNCH_SMOKE_FAIL: timed out\n--- stdout:\n' + out + '\n--- stderr:\n' + err);
  child.kill('SIGKILL');
  process.exit(1);
}, 90000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  try {
    assert.ok(out.includes('SOTTO_READY'), 'app never reported ready.\n' + out + err);
    assert.ok(out.includes('SMOKE_OK'), 'autopilot did not finish.\n' + out + err);
    assert.equal(code, 0, 'non-zero exit: ' + code + '\n' + err);
    const expected = [
      'dash-home', 'dash-meetings', 'dash-dictionary', 'dash-snippets', 'dash-style',
      'dash-insights', 'dash-settings', 'dash-help',
      'flow-idle', 'flow-recording', 'flow-processing', 'flow-error',
      'ob-0', 'ob-1', 'ob-2', 'ob-3', 'ob-4', 'ob-5', 'ob-6', 'ob-7',
    ];
    for (const name of expected) {
      const p = path.join(SHOTS, name + '.png');
      assert.ok(fs.existsSync(p), 'missing capture: ' + name);
      // Flow bar captures are mostly transparent, so they compress tiny.
      const min = name.startsWith('flow-') ? 1500 : 4000;
      assert.ok(fs.statSync(p).size > min, 'capture suspiciously small: ' + name);
    }
    // Renderer errors bubble to stderr as console messages in smoke mode.
    assert.ok(!/Uncaught|TypeError|ReferenceError/.test(err), 'renderer errors:\n' + err);
    console.log('APPLAUNCH_SMOKE_OK — captures in', SHOTS);
  } catch (e) {
    console.error('APPLAUNCH_SMOKE_FAIL:', e.message);
    process.exit(1);
  } finally {
    fs.rmSync(USERDATA, { recursive: true, force: true });
  }
});
