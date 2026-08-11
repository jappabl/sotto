// Ask HUD renderer: capture a spoken question, auto-stop on silence, then
// show the answer the main process retrieves from the knowledge layer.

const hud = document.getElementById('hud');
const modeLabel = document.getElementById('mode-label');
const barsEl = document.getElementById('bars');
const questionEl = document.getElementById('question');
const answerEl = document.getElementById('answer');
const sourcesEl = document.getElementById('sources');

const NUM_BARS = 32;
for (let i = 0; i < NUM_BARS; i++) barsEl.appendChild(document.createElement('i'));
const barEls = [...barsEl.children];
let levels = new Array(NUM_BARS).fill(0);

let audioCtx = null;
let stream = null;
let node = null;
let chunks = [];
let chunksLen = 0;
let rate = 48000;
let listening = false;
let speechStarted = false;
let lastVoiceTs = 0;
let startedTs = 0;
let stopTimer = null;

function setState(s) { hud.className = 'show ' + s; }

// ---------- capture ----------
async function startListening() {
  reset();
  setState('listening');
  modeLabel.textContent = 'Listening…';
  hud.classList.add('show');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    audioCtx = new AudioContext();
    rate = audioCtx.sampleRate;
    await audioCtx.audioWorklet.addModule('../flowbar/worklet.js');
    const src = audioCtx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(audioCtx, 'capture');
    node.port.onmessage = (e) => onAudio(e.data);
    src.connect(node);
    listening = true;
    startedTs = performance.now();
    lastVoiceTs = performance.now();
    // Hard cap: 15s.
    stopTimer = setTimeout(() => finishListening(), 15000);
  } catch {
    fail('Microphone unavailable');
  }
}

function onAudio({ samples, rms }) {
  if (!listening) return;
  chunks.push(samples);
  chunksLen += samples.length;
  pushLevel(rms);
  const now = performance.now();
  if (rms > 0.02) { speechStarted = true; lastVoiceTs = now; }
  // Auto-stop: 1.1s of silence after the user has actually started speaking.
  if (speechStarted && now - lastVoiceTs > 1100 && now - startedTs > 800) {
    finishListening();
  }
}

async function finishListening() {
  if (!listening) return;
  listening = false;
  clearTimeout(stopTimer);
  const { wav, durMs } = collectWav();
  teardown();
  if (!speechStarted || durMs < 300) { close(); return; }
  setState('thinking');
  modeLabel.textContent = 'Searching your notes…';
  questionEl.textContent = '…';
  const res = await window.sotto.invoke('ask:voice', { wav, durMs });
  // main replies via the ask:answer event (below) — nothing else to do here.
  if (res && res.error) fail(res.error);
}

function teardown() {
  try { node && node.disconnect(); } catch {}
  try { audioCtx && audioCtx.close(); } catch {}
  try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
  node = null; audioCtx = null; stream = null;
}

function collectWav() {
  const durMs = Math.round(performance.now() - startedTs);
  const merged = new Float32Array(chunksLen);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  chunks = []; chunksLen = 0;
  return { wav: encodeWav16k(merged, rate), durMs };
}

function encodeWav16k(samples, fromRate) {
  const target = 16000;
  let out;
  if (fromRate === target) out = samples;
  else {
    const ratio = fromRate / target;
    const n = Math.floor(samples.length / ratio);
    out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, samples.length - 1);
      const f = pos - i0;
      out[i] = samples[i0] * (1 - f) + samples[i1] * f;
    }
  }
  const dataLen = out.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, target, true); v.setUint32(28, target * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < out.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, out[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

// ---------- waveform ----------
function pushLevel(rms) { levels.push(Math.min(1, rms * 5.5)); if (levels.length > NUM_BARS) levels.shift(); }
function render() {
  if (listening) for (let i = 0; i < NUM_BARS; i++) barEls[i].style.height = Math.max(3, Math.round((levels[i] || 0) * 16)) + 'px';
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// ---------- answer rendering ----------
function escHtml(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function renderAnswer(sentences, plain, sources) {
  const cite = (t) => escHtml(t).replace(/\[(\d+)\]/g, (m, n) => `<sup>${n}</sup>`);
  if (sentences && sentences.length) {
    return sentences.map((s) => s.grounded
      ? `<span>${cite(s.text)}</span>`
      : `<span class="ungrounded">${cite(s.text)}</span>`).join(' ');
  }
  return cite(plain).replace(/\n/g, '<br>');
}

window.sotto.on('ask:answer', (res) => {
  questionEl.textContent = res.question ? '“' + res.question + '”' : '';
  if (res.answer) {
    setState('answer');
    modeLabel.textContent = 'From your notes';
    answerEl.innerHTML = renderAnswer(res.sentences, res.answer, res.sources || []);
    sourcesEl.replaceChildren();
    for (const s of (res.sources || []).filter((x) => x.cited).slice(0, 4)) {
      const chip = document.createElement('div');
      chip.className = 'src';
      chip.textContent = s.title;
      chip.onclick = () => window.sotto.invoke('know:open', { source: s.source, refId: s.refId });
      sourcesEl.appendChild(chip);
    }
    autoClose(14000);
  } else {
    setState('answer');
    modeLabel.textContent = 'From your notes';
    answerEl.textContent = res.message || 'I couldn’t find that in your notes.';
    sourcesEl.replaceChildren();
    autoClose(9000);
  }
});

window.sotto.on('ask:start', () => startListening());

let closeTimer = null;
function autoClose(ms) { clearTimeout(closeTimer); closeTimer = setTimeout(close, ms); }
function fail(msg) { setState('error'); modeLabel.textContent = msg; autoClose(3500); }
function reset() {
  clearTimeout(closeTimer); clearTimeout(stopTimer);
  chunks = []; chunksLen = 0; speechStarted = false;
  questionEl.textContent = ''; answerEl.textContent = ''; sourcesEl.replaceChildren();
}
function close() { teardown(); listening = false; window.sotto.invoke('ask:close'); }

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
