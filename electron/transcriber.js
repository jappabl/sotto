// Transcription via whisper.cpp. Prefers a resident whisper-server (model stays
// loaded → sub-second latency); falls back to one-shot whisper-cli invocations.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const MODEL_URLS = {
  'ggml-tiny.en.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  'ggml-base.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  'ggml-small.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  'ggml-large-v3-turbo-q5_0.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
};

function findBinary(name) {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', name), // packaged app
    path.join(__dirname, '..', 'bin', name),             // dev checkout
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* keep looking */ }
  }
  return null;
}

class Transcriber {
  constructor({ modelsDir, log = () => {} }) {
    this.modelsDir = modelsDir;
    this.log = log;
    fs.mkdirSync(modelsDir, { recursive: true });
    this.serverBin = findBinary('whisper-server');
    this.cliBin = findBinary('whisper-cli');
    this.server = null;
    this.serverPort = 0;
    this.serverModel = null;
    this.serverReady = false;
    this._startPromise = null;
  }

  modelPath(model) {
    return path.join(this.modelsDir, model);
  }

  hasModel(model) {
    try {
      return fs.statSync(this.modelPath(model)).size > 1e6;
    } catch {
      return false;
    }
  }

  listModels() {
    return Object.keys(MODEL_URLS).map((m) => ({
      name: m,
      installed: this.hasModel(m),
    }));
  }

  async downloadModel(model, onProgress = () => {}) {
    const url = MODEL_URLS[model];
    if (!url) throw new Error('unknown model: ' + model);
    const dest = this.modelPath(model);
    const tmp = dest + '.download';
    await httpsDownload(url, tmp, onProgress);
    fs.renameSync(tmp, dest);
    return dest;
  }

  // Ensure whisper-server is running with `model` loaded.
  async ensureServer(model) {
    if (!this.serverBin) return false;
    if (this.serverReady && this.serverModel === model && this.server && !this.server.killed) {
      return true;
    }
    if (this._startPromise && this.serverModel === model) return this._startPromise;
    this.stopServer();
    this.serverModel = model;
    this._startPromise = this._startServer(model);
    const ok = await this._startPromise;
    this._startPromise = null;
    return ok;
  }

  async _startServer(model) {
    const port = 17000 + Math.floor(Math.random() * 2000);
    this.serverPort = port;
    const args = [
      '-m', this.modelPath(model),
      '--host', '127.0.0.1',
      '--port', String(port),
      '-nt',
      // Default is 4 regardless of machine; the encoder is the whole cost here.
      '-t', String(Math.max(4, Math.min(8, os.cpus().length - 2))),
    ];
    this.log(`starting whisper-server on :${port} with ${model}`);
    const proc = spawn(this.serverBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.server = proc;
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', () => {});
    proc.on('exit', (code) => {
      this.log(`whisper-server exited (${code})`);
      if (this.server === proc) {
        this.server = null;
        this.serverReady = false;
      }
    });
    // Poll until the HTTP endpoint answers (model load can take a few seconds).
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) return false;
      if (await this._ping()) {
        this.serverReady = true;
        this.log('whisper-server ready');
        return true;
      }
      await sleep(250);
    }
    this.stopServer();
    return false;
  }

  _ping() {
    return new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: this.serverPort, path: '/', method: 'GET', timeout: 1000 },
        (res) => {
          res.resume();
          resolve(true);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  stopServer() {
    if (this.server) {
      try { this.server.kill(); } catch { /* already dead */ }
      this.server = null;
    }
    this.serverReady = false;
  }

  /**
   * Transcribe a 16 kHz mono WAV file. Returns { text, engine }.
   */
  async transcribe(wavPath, { model = 'ggml-base.bin', language = 'auto' } = {}) {
    if (!this.hasModel(model)) throw new Error('model-missing:' + model);
    if (await this.ensureServer(model).catch(() => false)) {
      try {
        const text = await this._transcribeViaServer(wavPath, language);
        return { text, engine: 'server' };
      } catch (err) {
        this.log('server transcription failed, falling back to CLI: ' + err.message);
      }
    }
    const text = await this._transcribeViaCli(wavPath, model, language);
    return { text, engine: 'cli' };
  }

  _transcribeViaServer(wavPath, language) {
    return new Promise((resolve, reject) => {
      const boundary = '----sotto' + Math.random().toString(36).slice(2);
      const fileData = fs.readFileSync(wavPath);
      const parts = [];
      const field = (name, value) =>
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        ));
      field('temperature', '0.0');
      field('response_format', 'json');
      if (language && language !== 'auto') field('language', language);
      else field('language', 'auto');
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      ));
      parts.push(fileData);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      const body = Buffer.concat(parts);

      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.serverPort,
          path: '/inference',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
          timeout: 60000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.error) return reject(new Error(json.error));
              resolve(String(json.text || '').trim());
            } catch {
              reject(new Error('bad server response: ' + data.slice(0, 200)));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('server timeout')); });
      req.end(body);
    });
  }

  _transcribeViaCli(wavPath, model, language) {
    return new Promise((resolve, reject) => {
      if (!this.cliBin) return reject(new Error('whisper-cli not found'));
      const args = [
        '-m', this.modelPath(model),
        '-f', wavPath,
        '-nt',
        '--language', language === 'auto' ? 'auto' : language,
        '-t', String(Math.max(2, Math.min(8, os.cpus().length - 2))),
      ];
      execFile(this.cliBin, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout || '').trim());
      });
    });
  }
}

function httpsDownload(url, dest, onProgress) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const get = (u, redirects) => {
      if (redirects > 5) return reject(new Error('too many redirects'));
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(new URL(res.headers.location, u).toString(), redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          done += chunk.length;
          if (total) onProgress(done / total);
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };
    get(url, 0);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { Transcriber, MODEL_URLS, findBinary, httpsDownload };
