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
let commandMode = false;
let meetingLive = false;
let levels = new Array(NUM_BARS).fill(0);

function setState(next) {
  state = next;
  if (next === 'idle' || next === 'flash' || next === 'error') commandMode = false;
  pill.className = next
    + (commandMode && (next === 'recording' || next === 'processing') ? ' command' : '')
    + (meetingLive ? ' meeting' : '');
  if (next !== 'recording') levels.fill(0);
}

window.sotto.on('flow:meeting-state', ({ recording }) => {
  meetingLive = !!recording;
  setState(state);
});

// ---------- audio capture ----------
let audioCtx = null;
let mediaStream = null;
let workletNode = null;
let chunks = [];
let chunksLen = 0;
let captureRate = 48000;
let recordStartTs = 0;
let stopping = false;

// Loopback/virtual devices route SYSTEM audio in as a "microphone" — never
// auto-select one of those for dictation.
const VIRTUAL_MIC = /blackhole|soundflower|loopback|aggregate|vb-?cable|obs|virtual/i;
const BUILTIN_MIC = /macbook.*microphone|built-?in/i;

async function resolveMicDeviceId(setting) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    if (setting && setting !== 'auto') {
      if (inputs.some((d) => d.deviceId === setting)) return setting;
    }
    const builtin = inputs.find((d) => BUILTIN_MIC.test(d.label));
    const def = inputs.find((d) => d.deviceId === 'default');

    // A Bluetooth headset used as the mic drops the whole device into
    // low-quality HFP "call mode" and mixes playback into the capture — voice
    // recognition falls apart. Detect it (the default input also exists as an
    // output device with the same name) and prefer the clean built-in mic.
    if (def && builtin && def.deviceId !== builtin.deviceId) {
      const outLabels = devices.filter((d) => d.kind === 'audiooutput').map((d) => d.label);
      const defName = def.label.replace(/^default\s*-?\s*/i, '').trim();
      const isHeadset = defName && outLabels.some((o) =>
        o.replace(/^default\s*-?\s*/i, '').trim() === defName);
      if (isHeadset) return builtin.deviceId; // route mic to built-in, keep audio on the headset
    }

    if (def && !VIRTUAL_MIC.test(def.label)) return undefined; // system default is fine
    const real = inputs.find((d) => d.deviceId !== 'default' && !VIRTUAL_MIC.test(d.label));
    return real ? real.deviceId : undefined;
  } catch {
    return undefined;
  }
}

async function startCapture() {
  chunks = [];
  chunksLen = 0;
  stopping = false;
  // Chromium's processing chain (echo cancellation & co.) silences the fake
  // capture device used by the E2E tests, so request raw audio there.
  const { fakeMic } = await window.sotto.invoke('app:env');
  const settings = await window.sotto.invoke('settings:get');
  const deviceId = fakeMic ? undefined : await resolveMicDeviceId(settings.micDevice);
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: fakeMic ? {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    } : {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
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
  const settings = await window.sotto.invoke('settings:get');
  if (settings.soundEffects) blip(392, 130, 0.05); // soft downward "nope"
  await window.sotto.sendAudio(keepAudio ? wav : null, { durMs, cancelled: true });
});

window.sotto.on('flow:done', async ({ words }) => {
  const settings = await window.sotto.invoke('settings:get');
  if (words > 0) {
    setState('flash');
    if (settings.soundEffects) { blip(660, 90); blip(990, 120, 0.05, 70); }
    setTimeout(() => setState('idle'), 700);
  } else {
    // Distinct empty-result cue, so nobody waits for a paste that isn't coming.
    if (settings.soundEffects && state === 'processing') blip(294, 140, 0.045);
    setState('idle');
  }
});

window.sotto.on('flow:error', ({ message }) => {
  setState('error');
  msg.textContent = message || 'Something went wrong';
  setTimeout(() => setState('idle'), 2600);
});

// Command Mode: the session becomes a voice instruction — pill turns purple.
window.sotto.on('flow:command-mode', () => {
  commandMode = true;
  setState(state);
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
  askActive = false;
  commandMode = which === 'command';
  meetingLive = which === 'meeting';
  if (which === 'recording' || which === 'command' || which === 'meeting') {
    setState('recording');
    levels = levels.map((_, i) => 0.2 + Math.abs(Math.sin(i * 0.8)) * 0.75);
    for (let i = 0; i < NUM_BARS; i++) {
      barEls[i].style.height = Math.max(3, Math.round(levels[i] * 24)) + 'px';
    }
  } else if (which === 'error') {
    setState('error');
    msg.textContent = 'Transcription failed';
  } else {
    setState(which);
  }
});

// Start with mouse pass-through enabled.
window.sotto.invoke('flow:set-ignore-mouse', true);

// ============ ask: the pill expands into an answer, in place ============

const askEl = document.getElementById('ask');
const askLabel = document.getElementById('ask-label');
const askBarsEl = document.getElementById('ask-bars');
const askQuestion = document.getElementById('ask-question');
const askAnswer = document.getElementById('ask-answer');
const askSources = document.getElementById('ask-sources');

const ASK_BARS = 22;
for (let i = 0; i < ASK_BARS; i++) askBarsEl.appendChild(document.createElement('i'));
const askBarEls = [...askBarsEl.children];
let askLevels = new Array(ASK_BARS).fill(0);

let askActive = false;
let askListening = false;
let askCtx = null;
let askStream = null;
let askNode = null;
let askChunks = [];
let askChunksLen = 0;
let askRate = 48000;
let askSpeechStarted = false;
let askLastVoice = 0;
let askStart = 0;
let askStopTimer = null;
let askCloseTimer = null;
let askRevealTimer = null;
let wordEls = [];

function askSetPhase(phase) {
  pill.className = 'ask ask-' + phase;
  if (phase !== 'answer') { pill.style.height = ''; pill.style.width = ''; }
}

// Measure the finished card, then animate the compact pill into exactly that
// box. Measuring first matters: sampling mid-transition would read the text
// wrapped at the narrow width and lock in a too-tall card.
function askExpandToContent() {
  pill.classList.remove('ask-listening', 'ask-thinking', 'ask-error');
  pill.classList.add('ask-answer');
  // Open on the first word and let the pill grow outward from there.
  if (wordEls.length) wordEls[0].el.classList.add('on');
  askFitBox();
}

// Size the pill to exactly the words revealed so far. Because the pill is
// centered, growing the box makes it expand outward from the middle, so the
// answer never sits in a half-empty capsule.
function askFitBox() {
  if (!pill.classList.contains('ask-answer')) return;
  const curW = pill.style.width;
  const curH = pill.style.height;
  pill.style.transition = 'none';
  pill.style.width = '';
  pill.style.height = '';
  // Fractional measurement, rounded up with a hair of slack: an integer
  // width one subpixel short makes the last word wrap onto its own line.
  const rect = pill.getBoundingClientRect();
  const targetW = Math.ceil(rect.width) + 2;
  const targetH = Math.min(300, Math.ceil(rect.height));
  pill.style.width = curW || targetW + 'px';
  pill.style.height = curH || targetH + 'px';
  void pill.offsetWidth; // flush the start box before animating to the new one
  pill.style.transition = '';
  requestAnimationFrame(() => {
    pill.style.width = targetW + 'px';
    pill.style.height = targetH + 'px';
  });
}

async function askBegin() {
  askReset();
  askActive = true;
  askSetPhase('listening');
  askLabel.textContent = 'Listening';
  try {
    askStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    askCtx = new AudioContext();
    askRate = askCtx.sampleRate;
    await askCtx.audioWorklet.addModule('worklet.js');
    const src = askCtx.createMediaStreamSource(askStream);
    askNode = new AudioWorkletNode(askCtx, 'capture');
    askNode.port.onmessage = (e) => onAskAudio(e.data);
    src.connect(askNode);
    askListening = true;
    askStart = performance.now();
    askLastVoice = askStart;
    askStopTimer = setTimeout(askFinishListening, 15000);
  } catch {
    askFail('Microphone unavailable');
  }
}

function onAskAudio({ samples, rms }) {
  if (!askListening) return;
  askChunks.push(samples);
  askChunksLen += samples.length;
  askLevels.push(Math.min(1, rms * 5.5));
  if (askLevels.length > ASK_BARS) askLevels.shift();
  for (let i = 0; i < ASK_BARS; i++) {
    askBarEls[i].style.height = Math.max(2, Math.round((askLevels[i] || 0) * 13)) + 'px';
  }
  const now = performance.now();
  if (rms > 0.02) { askSpeechStarted = true; askLastVoice = now; }
  if (askSpeechStarted && now - askLastVoice > 1100 && now - askStart > 800) askFinishListening();
}

async function askFinishListening() {
  if (!askListening) return;
  askListening = false;
  clearTimeout(askStopTimer);
  const durMs = Math.round(performance.now() - askStart);
  const merged = new Float32Array(askChunksLen);
  let off = 0;
  for (const c of askChunks) { merged.set(c, off); off += c.length; }
  askChunks = []; askChunksLen = 0;
  const wav = encodeWav16k(merged, askRate);
  askTeardown();
  if (!askSpeechStarted || durMs < 300) { askClose(); return; }
  askSetPhase('thinking');
  askLabel.textContent = 'Thinking';
  const res = await window.sotto.invoke('ask:voice', { wav, durMs });
  if (res && res.error) askFail('Something went wrong');
}

function askTeardown() {
  try { askNode && askNode.disconnect(); } catch {}
  try { askCtx && askCtx.close(); } catch {}
  try { askStream && askStream.getTracks().forEach((t) => t.stop()); } catch {}
  askNode = null; askCtx = null; askStream = null;
}

// ---- word-by-word reveal, driven by the speech engine's own boundaries ----

function askDisplayText(res) {
  return String(res.answer || '')
    .replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
}

function askSoftRanges(res, text) {
  const soft = [];
  for (const s of res.sentences || []) {
    if (s.grounded) continue;
    const clean = s.text.replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ').trim();
    const at = text.indexOf(clean.slice(0, 40));
    if (at >= 0) soft.push([at, at + clean.length]);
  }
  return soft;
}

function askLayoutWords(text, soft) {
  askAnswer.replaceChildren();
  wordEls = [];
  const re = /\S+\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = m[0];
    if (soft.some(([a, b]) => m.index >= a && m.index < b)) span.classList.add('soft');
    askAnswer.appendChild(span);
    wordEls.push({ el: span, at: m.index, end: m.index + m[0].length });
  }
}

function askRevealUpTo(charIndex) {
  for (const w of wordEls) {
    if (w.at <= charIndex) w.el.classList.add('on');
    w.el.classList.toggle('now', charIndex >= w.at && charIndex < w.end);
  }
}

// Reveal words up to an index in the word list (used by paced fallback).
function askRevealCount(n) {
  wordEls.forEach((w, i) => {
    w.el.classList.toggle('on', i < n);
    w.el.classList.toggle('now', i === n - 1);
  });
}

function askRevealAll() {
  for (const w of wordEls) { w.el.classList.add('on'); w.el.classList.remove('now'); }
}

function askPacedReveal(msPerWord = 165) {
  let i = 0;
  clearInterval(askRevealTimer);
  askRevealTimer = setInterval(() => {
    if (i >= wordEls.length) { clearInterval(askRevealTimer); askRevealAll(); return; }
    i++;
    askRevealCount(i);
    askFitBox();
  }, msPerWord);
}

function askSpeakAndReveal(text, speaks) {
  const synth = window.speechSynthesis;
  if (!speaks || !synth) { askPacedReveal(); return; }
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    let gotBoundary = false;
    const guard = setTimeout(() => { if (!gotBoundary) askPacedReveal(); }, 700);
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      gotBoundary = true;
      clearTimeout(guard);
      askRevealUpTo(e.charIndex);
      askFitBox();
    };
    u.onend = () => { clearTimeout(guard); clearInterval(askRevealTimer); askRevealAll(); askFitBox(); };
    u.onerror = () => { clearTimeout(guard); askPacedReveal(); };
    synth.speak(u);
  } catch {
    askPacedReveal();
  }
}

window.sotto.on('flow:ask-start', () => askBegin());

window.sotto.on('ask:answer', async (res) => {
  if (!askActive) return;
  const settings = await window.sotto.invoke('settings:get').catch(() => ({}));
  const text = res.answer ? askDisplayText(res) : (res.message || 'Nothing in your notes covers that.');
  // Lay the words out invisibly, grow the card to exactly fit them, then let
  // them arrive in step with the voice.
  askLayoutWords(text, res.answer ? askSoftRanges(res, text) : []);
  askExpandToContent();
  setTimeout(() => askSpeakAndReveal(text, settings.askSpeaks !== false), 240);
  askAutoClose(Math.max(9000, text.split(/\s+/).length * 300 + 5200));
});

function askAutoClose(ms) { clearTimeout(askCloseTimer); askCloseTimer = setTimeout(askClose, ms); }

function askFail(msg) {
  askSetPhase('error');
  askLabel.textContent = msg;
  askAutoClose(3000);
}

function askReset() {
  clearTimeout(askCloseTimer); clearTimeout(askStopTimer); clearInterval(askRevealTimer);
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
  askChunks = []; askChunksLen = 0; askSpeechStarted = false;
  askLevels = new Array(ASK_BARS).fill(0);
  askQuestion.textContent = '';
  askAnswer.replaceChildren();
  askSources.replaceChildren();
  wordEls = [];
}

function askClose() {
  clearInterval(askRevealTimer);
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
  askTeardown();
  askListening = false;
  askActive = false;
  // Collapse back into the pill, then let main shrink the window.
  setState('idle');
  window.sotto.invoke('ask:close');
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && askActive) askClose(); });

// Visual smoke hooks.
window.sotto.on('debug:ask-phase', (phase) => {
  askActive = true;
  askSetPhase(phase);
  askLabel.textContent = phase === 'listening' ? 'Listening'
    : phase === 'error' ? 'I didn’t catch that' : 'Thinking';
  if (phase === 'listening') {
    askBarEls.forEach((b, i) => { b.style.height = Math.max(2, Math.round(Math.abs(Math.sin(i * 0.7)) * 12)) + 'px'; });
  }
});

// Visual smoke hook: show a canned mid-speech answer without listening.
window.sotto.on('debug:ask-demo', (p) => {
  askActive = true;
  askLayoutWords(p.text, p.soft || []);
  askExpandToContent();
  askRevealCount(Math.floor(wordEls.length * 0.62));
  askFitBox();
});
