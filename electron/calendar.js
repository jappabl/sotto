// Calendar access via the calmon helper. Read-only, on demand: the helper is
// spawned for a query and exits, so nothing sits resident holding your
// calendar open.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function findCalmon() {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', 'calmon'),
    path.join(__dirname, '..', 'bin', 'calmon'),
  ];
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

class Calendar {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.lastStatus = 'unknown';
  }

  available() {
    return !!findCalmon();
  }

  // Run one command, collect events/auth replies, then exit.
  _run(command, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve) => {
      const bin = findCalmon();
      if (!bin) return resolve({ status: 'missing', events: [] });
      const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
      const result = { status: 'unknown', events: [] };
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        try { proc.kill(); } catch { /* gone */ }
        this.lastStatus = result.status;
        resolve(result);
      };
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.e === 'ready' || msg.e === 'auth') {
          result.status = msg.status || result.status;
          if (command === 'auth?' || command === 'request!') {
            if (msg.e === 'auth') done();
          }
        }
        if (msg.e === 'events') {
          result.events = Array.isArray(msg.events) ? msg.events : [];
          if (msg.reason) result.status = msg.reason;
          done();
        }
      });
      proc.on('exit', done);
      setTimeout(done, timeoutMs);
      try { proc.stdin.write(command + '\n'); } catch { done(); }
    });
  }

  async status() {
    const r = await this._run('auth?');
    return r.status;
  }

  async requestAccess() {
    const r = await this._run('request!', { timeoutMs: 60000 });
    return r.status;
  }

  async upcoming(hours = 12) {
    const r = await this._run(`upcoming ${Math.max(1, Math.min(72, hours))}`);
    return { status: r.status, events: r.events };
  }

  // The next meeting starting within `withinMinutes` (or currently running).
  async next({ withinMinutes = 15 } = {}) {
    const { events } = await this.upcoming(6);
    const now = Date.now();
    return events.find((e) => e.startMs - now <= withinMinutes * 60000 && e.endMs > now) || null;
  }
}

module.exports = { Calendar };
