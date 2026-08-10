// Global hotkey engine. Spawns the native keymon helper and turns its raw
// modifier-state events into push-to-talk / hands-free semantics.
//
// Hotkey specs (settings.hotkey):
//   'fn'        hold the fn key
//   'ctrl+alt'  hold control+option (either side)
//   'rcmd'      hold right command
//   'ralt'      hold right option
//
// Emits via callbacks: onHoldStart, onHoldEnd, onToggle (double-tap),
// onCancel (Esc), onAxChange(trusted), onFront({name,bundle}), onReady.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// flagsChanged keycodes
const KEY = {
  RCMD: 54, LCMD: 55, LSHIFT: 56, CAPS: 57, LALT: 58, LCTRL: 59,
  RSHIFT: 60, RALT: 61, RCTRL: 62, FN: 63,
};

const HOTKEY_DEFS = {
  fn: { fn: true, keys: [] },
  'ctrl+alt': { fn: false, keys: [[KEY.LCTRL, KEY.RCTRL], [KEY.LALT, KEY.RALT]] },
  rcmd: { fn: false, keys: [[KEY.RCMD]] },
  ralt: { fn: false, keys: [[KEY.RALT]] },
};

const HOTKEY_LABELS = {
  fn: ['fn'],
  'ctrl+alt': ['ctrl', 'opt'],
  rcmd: ['right ⌘'],
  ralt: ['right ⌥'],
};

function findKeymon() {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', 'keymon'),
    path.join(__dirname, '..', 'bin', 'keymon'),
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* next */ }
  }
  return null;
}

// Pure function: does the current mod state satisfy the spec?
function specSatisfied(spec, state) {
  if (spec.fn) return state.fn;
  return spec.keys.every((alternatives) =>
    alternatives.some((k) => state.keys.includes(k)));
}

class Hotkeys {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.proc = null;
    this.spec = HOTKEY_DEFS.fn;
    this.hotkeyName = 'fn';
    this.active = false;          // hotkey currently held
    this.lastTapEnd = 0;          // for double-tap detection
    this.lastTapDuration = 0;
    this.axTrusted = false;
    this.ready = false;
    this.handlers = {};
    this._frontWaiters = [];
  }

  setHotkey(name) {
    if (HOTKEY_DEFS[name]) {
      this.hotkeyName = name;
      this.spec = HOTKEY_DEFS[name];
    }
  }

  on(name, fn) {
    if (!this.handlers[name]) this.handlers[name] = [];
    this.handlers[name].push(fn);
  }

  _fire(name, ...args) {
    for (const fn of this.handlers[name] || []) fn(...args);
  }

  start() {
    const bin = findKeymon();
    if (!bin) {
      this.log('keymon binary missing — hotkeys disabled');
      this._fire('error', 'keymon-missing');
      return false;
    }
    const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      this._handleEvent(msg);
    });
    proc.stderr.on('data', (d) => this.log('keymon stderr: ' + d));
    proc.on('exit', (code) => {
      this.log('keymon exited: ' + code);
      this.ready = false;
      if (this.proc === proc) {
        this.proc = null;
        // Auto-restart unless we're shutting down.
        if (!this._stopping) {
          setTimeout(() => this.start(), 1500);
        }
      }
    });
    return true;
  }

  stop() {
    this._stopping = true;
    if (this.proc) {
      this.send('quit');
      try { this.proc.kill(); } catch { /* fine */ }
      this.proc = null;
    }
  }

  send(cmd) {
    if (this.proc && this.proc.stdin.writable) {
      this.proc.stdin.write(cmd + '\n');
    }
  }

  setRecording(isRecording) {
    this.send(isRecording ? 'rec 1' : 'rec 0');
  }

  promptAccessibility() {
    this.send('prompt-ax!');
  }

  checkAccessibility() {
    this.send('ax?');
  }

  paste() {
    this.send('paste!');
  }

  queryFront() {
    return new Promise((resolve) => {
      this._frontWaiters.push(resolve);
      this.send('front?');
      setTimeout(() => {
        const i = this._frontWaiters.indexOf(resolve);
        if (i >= 0) {
          this._frontWaiters.splice(i, 1);
          resolve({ name: '', bundle: '' });
        }
      }, 1000);
    });
  }

  _handleEvent(msg) {
    switch (msg.e) {
      case 'ready':
        this.ready = true;
        this._fire('ready');
        break;
      case 'ax':
        if (msg.trusted !== this.axTrusted) {
          this.axTrusted = msg.trusted;
          this._fire('axChange', msg.trusted);
        } else {
          this.axTrusted = msg.trusted;
        }
        this._fire('axStatus', msg.trusted);
        break;
      case 'mods': {
        const satisfied = specSatisfied(this.spec, { keys: msg.keys || [], fn: !!msg.fn });
        if (satisfied && !this.active) {
          this.active = true;
          this.holdStartTs = Date.now();
          this._fire('holdStart');
        } else if (!satisfied && this.active) {
          this.active = false;
          const now = Date.now();
          const dur = now - this.holdStartTs;
          // Double-tap: two short taps (<350 ms each) within 500 ms.
          if (dur < 350 && this.lastTapDuration < 350 && now - this.lastTapEnd < 500) {
            this.lastTapEnd = 0;
            this.lastTapDuration = 0;
            this._fire('doubleTap');
          } else {
            this.lastTapEnd = now;
            this.lastTapDuration = dur;
          }
          this._fire('holdEnd', dur);
        }
        break;
      }
      case 'key':
        if (msg.code === 53 && msg.down) this._fire('esc');
        break;
      case 'front': {
        const w = this._frontWaiters.shift();
        if (w) w({ name: msg.name || '', bundle: msg.bundle || '' });
        break;
      }
      case 'tap_reenabled':
        this.log('event tap re-enabled');
        break;
      default:
        break;
    }
  }
}

module.exports = { Hotkeys, HOTKEY_DEFS, HOTKEY_LABELS, specSatisfied, KEY };
