// Flow bar renderer: pill states, live waveform, audio capture, drag/dock.

const pill = document.getElementById('pill');
const dots = document.getElementById('dots');
const bars = document.getElementById('bars');
const msg = document.getElementById('msg');
const tooltip = document.getElementById('tooltip');

const NUM_DOTS = 9;
const NUM_BARS = 28;
for (let i = 0; i < NUM_DOTS; i++) dots.appendChild(document.createElement('i'));
for (let i = 0; i < NUM_BARS; i++) bars.appendChild(document.createElement('i'));
const barEls = [...bars.children];

let state = 'idle';
let levels = new Array(NUM_BARS).fill(0);

function setState(next) {
  state = next;
  pill.className = next;
  if (next !== 'recording') levels.fill(0);
}

// ---------- audio capture ----------
let audioCtx = null;
let mediaStream = null;
let workletNode = null;
let chunks = [];
let chunksLen = 0;
let captureRate = 48000;
let recordStartTs = 0;
let stopping = false;

async function startCapture() {
  chunks = [];
  chunksLen = 0;
  stopping = false;
  // Chromium's processing chain (echo cancellation & co.) silences the fake
  // capture device used by the E2E tests, so request raw audio there.
  const { fakeMic } = await window.sotto.invoke('app:env');
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: fakeMic ? {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    } : {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  audioCtx = new AudioContext();
  captureRate = audioCtx.sampleRate;
  await audioCtx.audioWorklet.addModule('worklet.js');
  const source = audioCtx.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioCtx, 'capture');
  workletNode.port.onmessage = (e) => {
    const { samples, rms } = e.data;
    chunks.push(samples);
    chunksLen += samples.length;
    pushLevel(rms);
  };
  source.connect(workletNode);
  // Worklet output is silent; no need to connect to destination.
  recordStartTs = performance.now();
}

function teardownCapture() {
  try { workletNode && workletNode.disconnect(); } catch {}
  try { audioCtx && audioCtx.close(); } catch {}
  try { mediaStream && mediaStream.getTracks().forEach((t) => t.stop()); } catch {}
  workletNode = null;
  audioCtx = null;
  mediaStream = null;
}

function collectWav() {
  const durMs = Math.round(performance.now() - recordStartTs);
  const merged = new Float32Array(chunksLen);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  chunks = [];
  chunksLen = 0;
  const wav = encodeWav16k(merged, captureRate);
  return { wav, durMs };
}

// Linear-interpolation resample to 16 kHz then 16-bit PCM WAV.
function encodeWav16k(samples, fromRate) {
  const targetRate = 16000;
  let out;
  if (fromRate === targetRate) {
    out = samples;
  } else {
    const ratio = fromRate / targetRate;
    const n = Math.floor(samples.length / ratio);
    out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, samples.length - 1);
      const frac = pos - i0;
      out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
    }
  }
  const dataLen = out.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < out.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, out[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

// ---------- waveform ----------
function pushLevel(rms) {
  levels.push(Math.min(1, rms * 5.5));
  if (levels.length > NUM_BARS) levels.shift();
}

function renderBars() {
  if (state === 'recording') {
    for (let i = 0; i < NUM_BARS; i++) {
      const v = levels[i] || 0;
      barEls[i].style.height = Math.max(3, Math.round(v * 24)) + 'px';
    }
  }
  requestAnimationFrame(renderBars);
}
requestAnimationFrame(renderBars);

// ---------- sounds ----------
function blip(freq, durMs, gainV = 0.06, delayMs = 0) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + delayMs / 1000;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainV, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.05);
    setTimeout(() => ctx.close(), durMs + delayMs + 200);
  } catch { /* sound is best-effort */ }
}

// ---------- IPC wiring ----------
window.sotto.on('flow:record-start', async ({ sound }) => {
  setState('recording');
  try {
    await startCapture();
    if (sound) blip(880, 140);
  } catch (err) {
    setState('error');
    msg.textContent = 'Microphone unavailable';
    teardownCapture();
    // Report failure so the recorder resets.
    window.sotto.sendAudio(null, { durMs: 0, cancelled: false, micError: true });
    setTimeout(() => setState('idle'), 2200);
  }
});

window.sotto.on('flow:record-stop', async () => {
  if (stopping) return;
  stopping = true;
  setState('processing');
  // Let the worklet flush its last batch.
  await new Promise((r) => setTimeout(r, 60));
  const { wav, durMs } = collectWav();
  teardownCapture();
  const result = await window.sotto.sendAudio(wav, { durMs, cancelled: false });
  if (result && result.ok) {
    // recorder sends flow:done which handles the flash
  }
});

window.sotto.on('flow:record-cancel', async ({ keepAudio }) => {
  await new Promise((r) => setTimeout(r, 40));
  const { wav, durMs } = collectWav();
  teardownCapture();
  setState('idle');
  await window.sotto.sendAudio(keepAudio ? wav : null, { durMs, cancelled: true });
});

window.sotto.on('flow:done', async ({ words }) => {
  const settings = await window.sotto.invoke('settings:get');
  if (words > 0) {
    setState('flash');
    if (settings.soundEffects) { blip(660, 90); blip(990, 120, 0.05, 70); }
    setTimeout(() => setState('idle'), 700);
  } else {
    setState('idle');
  }
});

window.sotto.on('flow:error', ({ message }) => {
  setState('error');
  msg.textContent = message || 'Something went wrong';
  setTimeout(() => setState('idle'), 2600);
});

// ---------- hover / click / drag ----------
// The window ignores mouse events except when the cursor is over the pill.
let overPill = false;
document.addEventListener('mousemove', (e) => {
  const r = pill.getBoundingClientRect();
  const inside = e.clientX >= r.left - 6 && e.clientX <= r.right + 6 &&
                 e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6;
  if (inside !== overPill) {
    overPill = inside;
    window.sotto.invoke('flow:set-ignore-mouse', !inside);
    if (state === 'idle') tooltip.classList.toggle('show', inside);
  }
});

let dragStart = null;
let dragged = false;
pill.addEventListener('mousedown', (e) => {
  dragStart = { x: e.screenX, y: e.screenY };
  dragged = false;
});
document.addEventListener('mousemove', (e) => {
  if (!dragStart) return;
  const dx = e.screenX - dragStart.x;
  const dy = e.screenY - dragStart.y;
  if (!dragged && Math.hypot(dx, dy) > 5) dragged = true;
  if (dragged) {
    window.sotto.invoke('flow:move-by', { dx, dy });
    dragStart = { x: e.screenX, y: e.screenY };
  }
});
document.addEventListener('mouseup', async () => {
  if (!dragStart) return;
  const wasDrag = dragged;
  dragStart = null;
  dragged = false;
  if (wasDrag) {
    await window.sotto.invoke('flow:drop');
  } else {
    tooltip.classList.remove('show');
    await window.sotto.invoke('flow:click');
  }
});

// Visual smoke-test hook: force a pill state without recording.
window.sotto.on('debug:flow-state', (which) => {
  if (which === 'recording') {
    setState('recording');
    levels = levels.map(() => 0.15 + Math.random() * 0.8);
  } else if (which === 'error') {
    setState('error');
    msg.textContent = 'Transcription failed';
  } else {
    setState(which);
  }
});

// Start with mouse pass-through enabled.
window.sotto.invoke('flow:set-ignore-mouse', true);
