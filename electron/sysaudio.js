// System-output mute while dictating, so the mic never hears your speakers.
// Uses osascript volume control (no extra permissions needed).

const { execFile } = require('child_process');

function osa(script) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 3000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout).trim());
    });
  });
}

class SystemAudio {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.wasMutedByUs = false;
  }

  async muteForDictation() {
    try {
      const already = (await osa('output muted of (get volume settings)')) === 'true';
      if (already) return; // user had it muted — leave their state alone
      await osa('set volume output muted true');
      this.wasMutedByUs = true;
    } catch (err) {
      this.log('mute failed: ' + err.message);
    }
  }

  async restore() {
    if (!this.wasMutedByUs) return;
    this.wasMutedByUs = false;
    try {
      await osa('set volume output muted false');
    } catch (err) {
      this.log('unmute failed: ' + err.message);
    }
  }
}

module.exports = { SystemAudio };
