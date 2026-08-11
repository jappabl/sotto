// Local text embeddings via a resident llama-server running nomic-embed.
// Powers semantic search so paraphrases match ("budget talk" -> "pricing
// discussion") where BM25's exact terms miss. Entirely on-device.
//
// nomic-embed requires task prefixes: documents get "search_document: ",
// queries get "search_query: ". Skipping them measurably hurts quality.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { findBinary } = require('./transcriber');

const MODEL = 'nomic-embed-text-v1.5.Q8_0.gguf';
const MODEL_URL = 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf';

class Embedder {
  constructor({ modelsDir, log = () => {} }) {
    this.modelsDir = modelsDir;
    this.log = log;
    this.serverBin = findBinary('llama-server');
    this.server = null;
    this.port = 0;
    this.ready = false;
    this._startPromise = null;
  }

  modelPath() {
    return path.join(this.modelsDir, MODEL);
  }

  hasModel() {
    try {
      return fs.statSync(this.modelPath()).size > 5e7;
    } catch {
      return false;
    }
  }

  available() {
    return !!this.serverBin && this.hasModel();
  }

  async downloadModel(onProgress = () => {}) {
    const { httpsDownload } = require('./transcriber');
    const dest = this.modelPath();
    await httpsDownload(MODEL_URL, dest + '.download', onProgress);
    fs.renameSync(dest + '.download', dest);
    return dest;
  }

  async ensureServer() {
    if (!this.available()) return false;
    if (this.ready && this.server && !this.server.killed) return true;
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._start();
    const ok = await this._startPromise;
    this._startPromise = null;
    return ok;
  }

  async _start() {
    const port = 18300 + Math.floor(Math.random() * 400);
    this.port = port;
    const threads = Math.max(2, Math.min(6, os.cpus().length - 2));
    const proc = spawn(this.serverBin, [
      '-m', this.modelPath(),
      '--embedding', '--pooling', 'mean',
      '-c', '2048', '-b', '2048',
      '--host', '127.0.0.1', '--port', String(port),
      '-t', String(threads), '--no-warmup',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.server = proc;
    proc.stderr.on('data', () => {});
    proc.on('exit', (code) => {
      this.log(`embed-server exited (${code})`);
      if (this.server === proc) { this.server = null; this.ready = false; }
    });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) return false;
      if (await this._health()) { this.ready = true; this.log('embed-server ready on :' + port); return true; }
      await sleep(400);
    }
    this.stop();
    return false;
  }

  _health() {
    return new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: this.port, path: '/health', timeout: 1000 }, (res) => {
        let d = ''; res.on('data', (c) => { d += c; });
        res.on('end', () => resolve(res.statusCode === 200));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  stop() {
    if (this.server) { try { this.server.kill(); } catch {} this.server = null; }
    this.ready = false;
  }

  // Embed a batch of texts. kind: 'document' | 'query'. Returns Float32Array[].
  async embed(texts, kind = 'document') {
    if (!texts.length) return [];
    if (!(await this.ensureServer().catch(() => false))) return null;
    const prefix = kind === 'query' ? 'search_query: ' : 'search_document: ';
    const input = texts.map((t) => prefix + String(t).slice(0, 4000));
    const body = JSON.stringify({ input, model: 'nomic' });
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: this.port, path: '/v1/embeddings', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 60000,
      }, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(d);
            if (!json.data) return reject(new Error(json.error?.message || 'bad embed response'));
            const vecs = json.data
              .sort((a, b) => a.index - b.index)
              .map((e) => normalize(Float32Array.from(e.embedding)));
            resolve(vecs);
          } catch (e) { reject(new Error('embed parse: ' + e.message)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('embed timeout')); });
      req.end(body);
    });
  }

  async embedOne(text, kind) {
    const v = await this.embed([text], kind);
    return v ? v[0] : null;
  }
}

// L2-normalize so cosine similarity is a plain dot product.
function normalize(v) {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { Embedder, normalize, dot, MODEL };
