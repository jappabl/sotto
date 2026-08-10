// Meeting pipeline E2E: injects a synthesized "them" audio chunk into a live
// meeting session (no system-audio permission needed), verifies transcription
// + attribution, then runs the real local-LLM enhancement over it.
//
// Run: node test/smoke/meeting.test.js

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { MeetingManager } = require('../../electron/meetings');
const { Enhancer } = require('../../electron/enhancer');
const { Transcriber } = require('../../electron/transcriber');
const { Polisher } = require('../../electron/polisher');

const MODELS = path.join(os.homedir(), 'Library', 'Application Support', 'Sotto', 'models');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sotto-meet-'));

async function main() {
  const log = (m) => console.log('  [meet]', m);
  const transcriber = new Transcriber({ modelsDir: MODELS, log: () => {} });
  assert.ok(transcriber.cliBin, 'whisper-cli required');
  assert.ok(transcriber.hasModel('ggml-base.bin'), 'base model required');

  const mgr = new MeetingManager({ baseDir: TMP, transcriber, log });
  const events = [];
  mgr.onEvent = (e, p) => events.push([e, p]);

  const started = mgr.start({ title: 'Pipeline test meeting' });
  assert.ok(started.ok, 'meeting failed to start: ' + started.reason);

  // Inject a "them" chunk: synthesized speech standing in for system audio.
  const phrase = 'The budget for the launch campaign is fifty thousand dollars and we need approval by Friday.';
  const aiff = path.join(TMP, 'p.aiff');
  execFileSync('say', ['-o', aiff, phrase]);
  const chunk = path.join(mgr.active.chunksDir, 'sys-9999.wav');
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, chunk]);
  mgr._handleCapEvent({ e: 'chunk', kind: 'sys', file: 'sys-9999.wav', t0: 0, t1: 8 });

  // User's rough notes, Granola-style half-thoughts.
  mgr.saveNotes(started.id, '- budget?\n- deadline');

  const stopped = await mgr.stop();
  assert.ok(stopped.ok, 'stop failed');

  const data = mgr.read(started.id);
  assert.ok(data, 'meeting unreadable');
  const themSegs = data.transcript.filter((s) => s.who === 'them');
  assert.ok(themSegs.length >= 1, 'no them-segments transcribed');
  const joined = themSegs.map((s) => s.text).join(' ').toLowerCase();
  console.log('  transcript:', JSON.stringify(joined.slice(0, 90)));
  assert.ok(/budget|fifty|50/.test(joined), 'transcript missed the content: ' + joined);

  // Enhancement with the real local LLM (skip gracefully if not installed).
  const polisher = new Polisher({ modelsDir: MODELS, log: () => {} });
  if (polisher.available()) {
    const enhancer = new Enhancer({ polisher, log });
    const { enhanced } = await enhancer.enhance({
      notes: data.notes,
      segments: data.transcript,
      template: 'auto',
      title: data.meta.title,
    });
    console.log('  enhanced (first 140):', JSON.stringify(enhanced.slice(0, 140)));
    assert.ok(enhanced.length > 40, 'enhancement too short');
    assert.ok(/budget|50|fifty/i.test(enhanced), 'enhancement lost the key fact');
    assert.ok(!enhanced.includes('—'), 'em dash leaked into enhanced notes');
    polisher.stop();
  } else {
    console.log('  (LLM not installed — enhancement step skipped)');
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('MEETING_SMOKE_OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('MEETING_SMOKE_FAIL:', err.message);
  process.exit(1);
});
