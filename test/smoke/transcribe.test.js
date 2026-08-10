// End-to-end transcription smoke test (no Electron): synthesize speech with the
// macOS `say` voice, convert to 16 kHz WAV, run it through the Transcriber
// (server and CLI engines) and the formatter, and check the words come back.
//
// Run: node test/smoke/transcribe.test.js

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Transcriber } = require('../../electron/transcriber');
const { formatTranscript } = require('../../electron/formatter');

const MODELS_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Sotto', 'models');
const TMP = path.join(__dirname, 'tmp');

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  const t = new Transcriber({ modelsDir: MODELS_DIR, log: (m) => console.log('  [transcriber]', m) });

  assert.ok(t.cliBin || t.serverBin, 'whisper.cpp not installed (brew install whisper-cpp)');
  assert.ok(t.hasModel('ggml-base.bin'), 'ggml-base.bin missing from ' + MODELS_DIR);

  const phrase = 'Hello team. The quarterly report is ready for review. Please send feedback by Friday.';
  const aiff = path.join(TMP, 'speech.aiff');
  const wav = path.join(TMP, 'speech.wav');
  execFileSync('say', ['-o', aiff, phrase]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav]);

  // Engine 1: resident server
  const t0 = Date.now();
  const server = await t.transcribe(wav, { model: 'ggml-base.bin', language: 'auto' });
  const serverMs = Date.now() - t0;
  console.log(`  server engine (${serverMs}ms):`, JSON.stringify(server.text));
  checkAccuracy(server.text, phrase);

  // Engine 2: CLI fallback
  t.stopServer();
  t.serverBin = null; // force CLI path
  const t1 = Date.now();
  const cli = await t.transcribe(wav, { model: 'ggml-base.bin', language: 'auto' });
  const cliMs = Date.now() - t1;
  assert.equal(cli.engine, 'cli');
  console.log(`  cli engine (${cliMs}ms):`, JSON.stringify(cli.text));
  checkAccuracy(cli.text, phrase);

  // Formatter integration
  const { text } = formatTranscript(server.text, {});
  assert.ok(text.length > 20, 'formatted text too short: ' + text);
  assert.ok(/^[A-Z]/.test(text), 'formatted text should start capitalized');
  console.log('  formatted:', JSON.stringify(text));

  // A dictation-style phrase with a spoken command through the full pipeline.
  const aiff2 = path.join(TMP, 'cmd.aiff');
  const wav2 = path.join(TMP, 'cmd.wav');
  execFileSync('say', ['-o', aiff2, 'Sounds good, see you then. Press enter.']);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff2, wav2]);
  const r2 = await t.transcribe(wav2, { model: 'ggml-base.bin', language: 'auto' });
  const f2 = formatTranscript(r2.text, {});
  console.log('  press-enter raw:', JSON.stringify(r2.text), '→', JSON.stringify(f2));
  assert.equal(f2.pressEnter, true, 'expected pressEnter=true from: ' + r2.text);

  // Spoken self-corrections through real ASR audio (Backtrack).
  const corrections = [
    {
      phrase: 'Let us meet at five, no wait, six.',
      mustNot: [/\bfive\b/i, /\b5\b/, /\bwait\b/i],
      must: [/\b(six|6)\b/i],
    },
    {
      phrase: 'Send the file to John. Scratch that, send it to Jane.',
      mustNot: [/\bJohn\b/, /scratch/i],
      must: [/\bJane\b/],
    },
  ];
  for (const c of corrections) {
    const a = path.join(TMP, 'corr.aiff');
    const w = path.join(TMP, 'corr.wav');
    execFileSync('say', ['-o', a, c.phrase]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', a, w]);
    const r = await t.transcribe(w, { model: 'ggml-base.bin', language: 'auto' });
    const out = formatTranscript(r.text, {}).text;
    console.log('  backtrack raw:', JSON.stringify(r.text), '→', JSON.stringify(out));
    for (const re of c.mustNot) {
      assert.ok(!re.test(out), `"${out}" should not match ${re} (raw: ${r.text})`);
    }
    for (const re of c.must) {
      assert.ok(re.test(out), `"${out}" should match ${re} (raw: ${r.text})`);
    }
  }

  t.stopServer();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('TRANSCRIBE_SMOKE_OK');
}

function checkAccuracy(got, want) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const gotWords = new Set(norm(got));
  const wantWords = norm(want);
  const hit = wantWords.filter((w) => gotWords.has(w)).length;
  const ratio = hit / wantWords.length;
  assert.ok(ratio >= 0.8, `accuracy ${(ratio * 100).toFixed(0)}% — got: ${got}`);
}

main().catch((err) => {
  console.error('TRANSCRIBE_SMOKE_FAIL:', err.message);
  process.exit(1);
});
