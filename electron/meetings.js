// Meeting capture + transcription pipeline (the Granola-style notetaker).
//
// A meeting is a directory under userData/meetings/<id>/:
//   meta.json         {id, title, startedAt, endedAt, state, template, appHint}
//   transcript.jsonl  {t0, t1, who: 'me'|'them', text} per segment
//   notes.md          the user's rough notes (autosaved live)
//   enhanced.md       AI-enhanced notes (after the meeting)
//
// Audio flows: meetcap writes 30 s WAV chunks (sys = them, mic = me) →
// we transcribe each with whisper-cli (keeping whisper-server free for
// dictation) → segments append to transcript.jsonl → live UI updates.
// Chunk WAVs are deleted after transcription; no audio is retained.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

function findMeetcap() {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', 'meetcap'),
    path.join(__dirname, '..', 'bin', 'meetcap'),
  ];
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

class MeetingManager {
  constructor({ baseDir, transcriber, log = () => {} }) {
    this.baseDir = path.join(baseDir, 'meetings');
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.transcriber = transcriber;
    this.log = log;
    this.active = null;      // { id, dir, proc, meta, queue: Promise chain }
    this.onEvent = null;     // (event, payload) => void  — wired to windows
  }

  _emit(event, payload) {
    if (this.onEvent) this.onEvent(event, payload);
  }

  // ---- listing / reading ----

  list() {
    let ids = [];
    try { ids = fs.readdirSync(this.baseDir); } catch { /* none */ }
    const metas = [];
    for (const id of ids) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(this.baseDir, id, 'meta.json'), 'utf8'));
        metas.push(meta);
      } catch { /* skip broken */ }
    }
    metas.sort((a, b) => b.startedAt - a.startedAt);
    return metas;
  }

  read(id) {
    const dir = path.join(this.baseDir, sanitize(id));
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      const notes = readOr(path.join(dir, 'notes.md'), '');
      const enhanced = readOr(path.join(dir, 'enhanced.md'), '');
      const transcript = readOr(path.join(dir, 'transcript.jsonl'), '')
        .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => a.t0 - b.t0);
      return { meta, notes, enhanced, transcript };
    } catch {
      return null;
    }
  }

  saveNotes(id, notes) {
    const dir = path.join(this.baseDir, sanitize(id));
    if (!fs.existsSync(dir)) return false;
    fs.writeFileSync(path.join(dir, 'notes.md'), String(notes ?? ''));
    return true;
  }

  saveEnhanced(id, enhanced) {
    const dir = path.join(this.baseDir, sanitize(id));
    if (!fs.existsSync(dir)) return false;
    fs.writeFileSync(path.join(dir, 'enhanced.md'), String(enhanced ?? ''));
    return true;
  }

  updateMeta(id, patch) {
    const dir = path.join(this.baseDir, sanitize(id));
    const metaPath = path.join(dir, 'meta.json');
    try {
      const meta = { ...JSON.parse(fs.readFileSync(metaPath, 'utf8')), ...patch };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      return meta;
    } catch {
      return null;
    }
  }

  remove(id) {
    if (this.active && this.active.id === id) this.stop();
    fs.rmSync(path.join(this.baseDir, sanitize(id)), { recursive: true, force: true });
    return true;
  }

  // ---- live capture ----

  start({ title = '', template = 'auto', appHint = '' } = {}) {
    if (this.active) return { ok: false, reason: 'already-recording', id: this.active.id };
    const bin = findMeetcap();
    if (!bin) return { ok: false, reason: 'meetcap-missing' };

    const id = 'm' + Date.now().toString(36);
    const dir = path.join(this.baseDir, id);
    const chunksDir = path.join(dir, 'chunks');
    fs.mkdirSync(chunksDir, { recursive: true });

    const meta = {
      id,
      title: title || defaultTitle(),
      startedAt: Date.now(),
      endedAt: null,
      state: 'recording',
      template,
      appHint,
      segments: 0,
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(dir, 'notes.md'), '');

    const proc = spawn(bin, ['--dir', chunksDir, '--chunk', '30'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.active = { id, dir, chunksDir, proc, meta, queue: Promise.resolve(), sysAlive: false };

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      this._handleCapEvent(msg);
    });
    proc.stderr.on('data', (d) => this.log('meetcap stderr: ' + String(d).slice(0, 200)));
    proc.on('exit', (code) => {
      this.log(`meetcap exited (${code})`);
      if (this.active && this.active.proc === proc && this.active.meta.state === 'recording') {
        // Unexpected death mid-meeting: finalize what we have.
        this._finalize('capture-died');
      }
    });

    this.log(`meeting started: ${id}`);
    this._emit('meeting:started', { id, meta });
    return { ok: true, id, meta };
  }

  _handleCapEvent(msg) {
    if (!this.active) return;
    switch (msg.e) {
      case 'ready':
        this.active.sysAlive = !!msg.sys;
        this._emit('meeting:ready', { id: this.active.id, sys: !!msg.sys, mic: !!msg.mic });
        if (!msg.sys) {
          this._emit('meeting:warning', {
            id: this.active.id,
            message: 'System audio unavailable — only your mic is being captured. Grant System Audio Recording in Settings.',
          });
        }
        break;
      case 'level':
        this._emit('meeting:level', { id: this.active.id, mic: msg.mic || 0, sys: msg.sys || 0 });
        break;
      case 'chunk':
        this._queueChunk(msg);
        break;
      case 'error':
        this.log('meetcap error: ' + msg.message);
        break;
      default:
        break;
    }
  }

  _queueChunk(msg) {
    const session = this.active;
    if (!session) return;
    session.queue = session.queue.then(() => this._transcribeChunk(session, msg))
      .catch((err) => this.log('chunk transcribe failed: ' + err.message));
  }

  async _transcribeChunk(session, msg) {
    const wavPath = path.join(session.chunksDir, path.basename(msg.file));
    if (!fs.existsSync(wavPath)) return;
    const { wavRms, isLikelyHallucination } = require('./formatter');
    const rms = wavRms(fs.readFileSync(wavPath));
    if (rms < 0.0015) {
      fs.unlinkSync(wavPath);
      return; // silent chunk — nothing was said
    }
    const model = this.transcriber.hasModel('ggml-base.bin') ? 'ggml-base.bin'
      : this.transcriber.listModels().find((m) => m.installed)?.name;
    if (!model) return;
    const text = await this._whisperCli(wavPath, model);
    fs.unlinkSync(wavPath);
    const clean = String(text || '').trim();
    if (!clean || isLikelyHallucination(clean, rms)) return;
    const seg = {
      t0: msg.t0,
      t1: msg.t1,
      who: msg.kind === 'mic' ? 'me' : 'them',
      text: clean,
    };
    fs.appendFileSync(path.join(session.dir, 'transcript.jsonl'), JSON.stringify(seg) + '\n');
    session.meta.segments += 1;
    this._emit('meeting:segment', { id: session.id, seg });
  }

  _whisperCli(wavPath, model) {
    return new Promise((resolve, reject) => {
      if (!this.transcriber.cliBin) return reject(new Error('whisper-cli missing'));
      execFile(this.transcriber.cliBin, [
        '-m', this.transcriber.modelPath(model),
        '-f', wavPath, '-nt', '--language', 'auto',
        '-t', String(Math.max(2, Math.min(4, os.cpus().length - 4))),
      ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err); else resolve(String(stdout));
      });
    });
  }

  // Stop recording; transcription of queued chunks continues, then finalize.
  async stop() {
    const session = this.active;
    if (!session) return { ok: false, reason: 'not-recording' };
    try { session.proc.stdin.write('stop\n'); } catch { /* dead */ }
    // Give meetcap a moment to flush final chunks, then wait for the queue.
    await new Promise((r) => setTimeout(r, 1200));
    await session.queue;
    return this._finalize('stopped');
  }

  _finalize(reason) {
    const session = this.active;
    if (!session) return { ok: false };
    this.active = null;
    try { session.proc.kill(); } catch { /* gone */ }
    fs.rmSync(session.chunksDir, { recursive: true, force: true });
    const meta = this.updateMeta(session.id, {
      endedAt: Date.now(),
      state: 'ended',
      segments: session.meta.segments,
    });
    this.log(`meeting ended (${reason}): ${session.id}, ${session.meta.segments} segments`);
    this._emit('meeting:ended', { id: session.id, meta });
    return { ok: true, id: session.id, meta };
  }

  status() {
    if (!this.active) return { recording: false };
    return {
      recording: true,
      id: this.active.id,
      startedAt: this.active.meta.startedAt,
      sys: this.active.sysAlive,
    };
  }
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}

function readOr(p, fallback) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return fallback; }
}

function defaultTitle() {
  const d = new Date();
  const day = d.toLocaleDateString([], { weekday: 'long' });
  const hour = d.getHours();
  const slot = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return `${day} ${slot} meeting`;
}

module.exports = { MeetingManager };
