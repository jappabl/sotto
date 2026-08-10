// Inserts finished text into the frontmost app: save clipboard → write text →
// keymon posts ⌘V → restore the user's clipboard. Mirrors the original's
// documented behavior, including the manual-paste fallback notification.

const { clipboard, Notification } = require('electron');

class Inserter {
  constructor({ hotkeys, log = () => {} }) {
    this.hotkeys = hotkeys;
    this.log = log;
    this.lastText = '';
  }

  async insert(text, { pressEnter = false } = {}) {
    if (!text) return false;
    this.lastText = text;
    const saved = this._snapshotClipboard();
    clipboard.writeText(text);

    if (!this.hotkeys.axTrusted) {
      this._manualPasteNotice();
      return false;
    }

    this.hotkeys.paste();
    if (pressEnter) {
      // Give the paste a beat to land before pressing Enter.
      await sleep(160);
      this.hotkeys.send('enter!');
    }
    // Restore the clipboard after the paste has been consumed.
    await sleep(900);
    // Only restore if nothing else claimed the clipboard meanwhile.
    if (clipboard.readText() === text) {
      this._restoreClipboard(saved);
    }
    return true;
  }

  copyLast() {
    if (this.lastText) clipboard.writeText(this.lastText);
    return !!this.lastText;
  }

  pasteLast() {
    if (!this.lastText) return false;
    clipboard.writeText(this.lastText);
    if (this.hotkeys.axTrusted) this.hotkeys.paste();
    return true;
  }

  _snapshotClipboard() {
    // Text-only snapshot keeps things simple and covers the common case.
    // (Images/files in the clipboard are left alone: we skip restore if the
    // clipboard no longer holds our text.)
    return { text: clipboard.readText() };
  }

  _restoreClipboard(saved) {
    if (saved.text) clipboard.writeText(saved.text);
    else clipboard.clear();
  }

  _manualPasteNotice() {
    new Notification({
      title: 'Click a textbox and use ⌘V to paste',
      body: 'Sotto needs Accessibility permission to paste for you. Your text is on the clipboard.',
      silent: true,
    }).show();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { Inserter };
