# Sotto

**Open-source voice dictation for macOS.** Hold a key, speak, release — clean,
formatted text appears at your cursor in any app. Modeled on the Wispr Flow
experience, rebuilt from scratch, and **100% local**: transcription runs
on-device with whisper.cpp. No account, no cloud, no telemetry.

![Home](docs/screenshots/dash-home.png)

## How it works

Hold **fn** (or a hotkey you pick), talk, and let go.

- Sotto records while you hold, then transcribes in one pass on-device
  (whisper.cpp with Metal, kept resident for sub-second turnaround).
- The transcript is cleaned deterministically: filler words stripped, spoken
  punctuation ("comma", "new line") applied, self-corrections resolved
  ("…scratch that…" keeps only the fix), your dictionary and snippets applied.
- The finished text is pasted at your cursor via a clipboard swap; your old
  clipboard is restored right after.

The **flow bar** — the little pill at the bottom of your screen — shows a live
waveform while you speak, shimmers while it thinks, and can be clicked for
hands-free mode (double-tapping the hotkey works too, Esc cancels). Drag it to
dock at the bottom, left, or right edge.

| | |
|---|---|
| ![Idle](docs/screenshots/flow-idle.png) | ![Recording](docs/screenshots/flow-recording.png) |

## Features

- **Push-to-talk & hands-free** dictation into any macOS app
- **Dictionary** — teach it names and jargon, plus "spoken → written" rules
  ("by the way" → "btw")
- **Snippets** — say "personal email", get your full address
- **Styles** — Formal / Casual / very casual casing and punctuation presets
- **"Press enter"** — end a dictation with it to send the message
- **History & insights** — searchable recent activity with audio playback,
  streaks, words dictated, average WPM
- **Guided onboarding** — permissions, mic check, hotkey choice, model download
- **100+ languages** via whisper's multilingual models, with auto-detect

![Dictionary](docs/screenshots/dash-dictionary.png)

## Install

Requirements: macOS 13+ on Apple Silicon, Xcode Command Line Tools
(`xcode-select --install`), Node 20+, and [Homebrew](https://brew.sh) with
whisper.cpp for building (`brew install whisper-cpp`).

```bash
git clone <this repo> sotto && cd sotto
npm install
npm run build:native   # builds keymon + bundles whisper.cpp into bin/
npm start
```

Onboarding walks you through microphone + Accessibility permissions and
downloads the speech model (~150 MB, one time). To build a standalone
`Sotto.app` (whisper.cpp bundled inside, Homebrew not needed afterwards):

```bash
npm run dist           # → dist/mac-arm64/Sotto.app
```

Tip: if the fn key opens the emoji picker or changes input sources on your
Mac, set *System Settings → Keyboard → "Press 🌐 key to" → Do Nothing*, or
pick a different hotkey in Settings → General.

## Testing

```bash
npm test               # unit suites: formatter, store, hotkey chords
npm run test:smoke     # + transcription E2E (synthesized speech → whisper),
                       #   app-launch autopilot (screenshots every screen),
                       #   full-pipeline dictation E2E (fake mic → pasteboard)
```

## Architecture

Electron with **zero runtime npm dependencies**. A small Swift helper
(`native/keymon.swift`) provides what Electron can't: global fn-key
detection via a CGEventTap, frontmost-app queries, and ⌘V injection. The
renderer records 16 kHz mono WAV through an AudioWorklet; the main process
runs `whisper-server` (resident model) with `whisper-cli` as fallback; a pure
formatter module applies every text rule (fully unit-tested). Data lives in
plain JSON under `~/Library/Application Support/Sotto/`.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design document.

## Privacy

Everything — audio, transcripts, settings, stats — stays on your Mac.
Dictation audio is kept for 14 days (for playback in History), then pruned.
The only network request Sotto ever makes is downloading a whisper model.

## License

MIT. "Wispr Flow" is a trademark of its owner; Sotto is an independent
open-source project and is not affiliated with or endorsed by Wispr.
