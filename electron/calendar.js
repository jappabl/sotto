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

  // `meetingsOnly` keeps the half of a calendar that is actually other people.
  async upcoming(hours = 12, { meetingsOnly = true } = {}) {
    const r = await this._run(`upcoming ${Math.max(1, Math.min(72, hours))}`);
    const events = (r.events || []).map((e) => ({ ...e, conference: conferenceUrl(e) }));
    return { status: r.status, events: meetingsOnly ? events.filter(isMeeting) : events };
  }

  // The next meeting starting within `withinMinutes` (or currently running).
  async next({ withinMinutes = 15 } = {}) {
    const { events } = await this.upcoming(6);
    const now = Date.now();
    return events.find((e) => e.startMs - now <= withinMinutes * 60000 && e.endMs > now) || null;
  }

  // The meeting happening right now, for naming a recording as it starts.
  async current({ graceMinutes = 10 } = {}) {
    const { events } = await this.upcoming(3);
    const now = Date.now();
    const live = events.filter((e) => e.startMs - graceMinutes * 60000 <= now && e.endMs > now);
    live.sort((a, b) => Math.abs(a.startMs - now) - Math.abs(b.startMs - now));
    return live[0] || null;
  }
}

// Video call links, which are the strongest evidence an event involves people
// who are not in the room. Ordered by how common they are in practice.
const CONFERENCE_PATTERNS = [
  /https?:\/\/[\w.-]*zoom\.us\/j\/\S+/i,
  /https?:\/\/meet\.google\.com\/[a-z-]{5,}/i,
  /https?:\/\/teams\.(?:microsoft|live)\.com\/l\/meetup-join\/\S+/i,
  /https?:\/\/[\w.-]*webex\.com\/\S+/i,
  /https?:\/\/[\w.-]*whereby\.com\/\S+/i,
  /https?:\/\/meet\.jit\.si\/\S+/i,
  /https?:\/\/[\w.-]*bluejeans\.com\/\S+/i,
  /https?:\/\/[\w.-]*around\.co\/\S+/i,
];

function conferenceUrl(event) {
  const haystack = [event.location, event.url, event.notes].filter(Boolean).join('\n');
  for (const re of CONFERENCE_PATTERNS) {
    const m = haystack.match(re);
    if (m) return m[0].replace(/[).,>\]]+$/, '');
  }
  return null;
}

// A calendar holds two kinds of thing: appointments with other people, and
// blocks you put on your own day. Only the first kind is a meeting, and only
// the first kind is worth preparing for.
function isMeeting(event) {
  if (!event) return false;
  if (event.myStatus === 'declined') return false;
  const others = (event.attendees || []).filter((a) => a && (a.name || a.email));
  if (others.length) return true;
  if (event.conference || conferenceUrl(event)) return true;
  // No other people and no link: a focus block, a commute, a reminder.
  return false;
}

module.exports = { Calendar, isMeeting, conferenceUrl };
