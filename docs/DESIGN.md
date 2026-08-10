# Sotto — Design Document

*2026-08-09 · An open-source, fully local voice dictation app for macOS, functionally modeled on Wispr Flow.*

## Goal

Recreate the Wispr Flow desktop experience — hold a key, speak, release, and polished text
appears at your cursor in any app — as a self-contained open-source macOS app. The UI
mirrors Flow's layout and interaction design; all code, assets, and branding are original.
Transcription is **100% local** (whisper.cpp), which is the one deliberate departure from
the original's cloud ASR: no account, no network, no data leaves the machine.

## Non-goals

- Windows/Linux/mobile, cloud sync, teams/billing, meeting notetaker, MCP server.
- LLM rewriting (Command Mode / tone transforms). Formatting is deterministic and local.
- Pixel-identical copies of Wispr's proprietary artwork. We match layout, spacing,
  and feel with original assets and a distinct name.

## Architecture

Electron app, zero runtime npm dependencies (Electron + electron-builder as dev deps only).

```
┌─────────────────────────────── Electron main ───────────────────────────────┐
│ main.js        app lifecycle, single-instance, tray                         │
│ windows.js     dashboard · flow bar (frameless overlay) · onboarding        │
│ hotkeys.js     spawns native/keymon (Swift) → fn/hotkey down/up, Esc        │
│ recorder.js    orchestrates record → transcribe → format → insert pipeline  │
│ transcriber.js whisper.cpp (whisper-cli) invocation, model management       │
│ formatter.js   fillers · dictionary · snippets · spoken commands · caps     │
│ inserter.js    clipboard save → set → keymon pastes ⌘V → restore            │
│ store.js       settings.json · history.jsonl · dictionary/snippets (JSON)   │
└──────────────────────────────────────────────────────────────────────────────┘
        │ IPC                                   │ stdin/stdout JSON lines
┌───────┴──────────────┐               ┌────────┴─────────┐
│ renderer/flowbar     │               │ native/keymon    │
│ mic capture (worklet)│               │ Swift, CGEvent   │
│ waveform pill UI     │               │ tap: fn, combos, │
│ renderer/dashboard   │               │ Esc; posts ⌘V;   │
│ Home/Dictionary/…    │               │ AX trust check;  │
│ renderer/onboarding  │               │ frontmost app    │
└──────────────────────┘               └──────────────────┘
```

### The dictation pipeline (the product)

1. `keymon` reports `fn_down` → main tells flow bar to start capturing; ping sound.
2. Flow bar expands, renders live waveform from mic levels (AudioWorklet, 16 kHz mono).
3. `fn_up` → capture stops; WAV bytes → main; flow bar shows processing shimmer.
4. `whisper-cli` transcribes (Metal-accelerated; base model default).
5. `formatter.js` applies, in order: spoken-punctuation + "new line/paragraph" commands,
   filler-word removal, backtrack ("actually…" self-corrections), dictionary replacements,
   snippet expansion, capitalization/spacing cleanup, trailing "press enter" detection.
6. `inserter.js` saves clipboard → writes text → keymon posts ⌘V into the frontmost app →
   clipboard restored ~1 s later. Failure → notification "Click a textbox and use ⌘⌃V".
7. History entry (text, app, duration, wpm, timestamp, wav path) appended; stats update.
8. Esc mid-dictation cancels; audio kept in history as audio-only when >2 s.

Hands-free mode: double-tap fn (or fn+Space) toggles; click on the flow bar also starts.
20-minute cap with auto-stop, matching the original's limit.

### Hotkeys

Default push-to-talk **hold fn** — detected via CGEventTap `flagsChanged`
(`maskSecondaryFn`) in the Swift helper, since Electron cannot observe fn.
Fallback/custom: hold Right ⌘, hold ⌃⌥, etc. (any modifier chord; tap-to-toggle for
combos with a normal key). Esc cancels. Paste-last-transcript ⌘⌃V. All rebindable in
Settings → General → Shortcuts with the same "Change hotkeys" modal design as Flow
(keycap chips, Add another, Reset to default).

`keymon` also answers: `ax?` (Accessibility trusted), `mic?` (mic TCC state via
AVCaptureDevice), `front?` (frontmost app name/bundle for history + app-aware casing),
`paste!` (⌘V CGEvent), `open-ax!` / `open-mic!` (System Settings deep links).

### Permissions (onboarding replicates Flow's card flow)

- **Microphone** — for capture (TCC prompt from Electron on first getUserMedia).
- **Accessibility** — for the CGEventTap + posting ⌘V (deep link to System Settings,
  live re-check with the green ✓ state on grant).
- fn-key tip card: point user to set "Press 🌐 key" → "Do Nothing" in Keyboard settings.

### Transcription

- `whisper-cli` from Homebrew if present, else bundled binary in `Resources/bin`.
- Models in `~/Library/Application Support/Sotto/models`: `ggml-base.bin` (default,
  multilingual, ~148 MB, auto language detect), `ggml-tiny.en.bin` (fast/testing).
  Settings → System lets you pick model + language (or Auto).
- First-run onboarding downloads the model with a progress bar if missing.
- Flags: `-nt` (no timestamps), `--language auto|xx`, threads = perf cores, temp file WAV.

### Data

`~/Library/Application Support/Sotto/`:
- `settings.json` — hotkey, model, language, sounds, launch-at-login, flow bar position,
  formatter toggles, user name.
- `history.jsonl` — one JSON object per dictation (id, ts, app, text, raw, durMs, wpm,
  audio file name, charsInserted). Audio WAVs under `audio/`, pruned after 14 days.
- `dictionary.json`, `snippets.json` — arrays of {id, word/trigger, replacement/expansion,
  starred, auto, ts}.
- Streaks/WPM/word totals computed from history at read time (single source of truth).

## UI (mirrors Flow's layout; original assets)

Design tokens from reference screenshots: cream chrome `#F4F2EC`, white canvas
`#FFFFFF` radius 16, ink `#1A1A18`, gray card `#F5F5F4`, lavender `#E7DBFA` /
purple `#7C5CE0`, serif display (Instrument Serif) for hero/callout headlines with
italic purple accents, Inter-ish system sans for everything else, black chunky
buttons radius 12, keycap chips with 1px border + bottom shadow.

- **Dashboard** window 1200×760: cream sidebar (logo + nav Home/Dictionary/Snippets/
  Style/History, bottom Settings/Help), white rounded canvas.
  - *Home*: "Welcome back, {name}" + stats pill (🔥 streak · 🚀 words · 🏅 WPM),
    gray tip card "Voice dictation in any app — Hold down the trigger key [fn] …",
    100 Words a Day challenge card with progress bar, Recent activity grouped by
    TODAY/YESTERDAY/date with timestamp rows, hover actions (copy, play audio, delete).
  - *Dictionary*: tabs All/Personal, Add new, cream serif callout "Sotto speaks the way
    you speak." with example chips, rows with ✨ for auto-learned, replacement arrows.
  - *Snippets*: same skeleton, trigger → expansion.
  - *Style*: tone cards (Formal./Casual/very casual) — deterministic casing/punctuation
    presets per app category (Personal/Work/Email/Other) with app-bundle mapping.
  - *Settings*: sub-sidebar (General/System/Experimental + About), serif page titles,
    gray setting rows with toggles/selects; hotkey modal; version footer.
- **Flow bar**: non-activating always-on-top panel, bottom-center; idle = 64×22 black
  pill with 9 gray dots; hover tooltip "Click to start dictating"; recording = expands
  to ~200×36 with live white bars; processing = indeterminate shimmer; error = red tint
  flash. Draggable with bottom/left/right dock zones, position persisted.
- **Onboarding** window 900×640: welcome → name → permissions cards → mic test with
  live level bars → shortcut pick → language → model download → try-it-yourself
  (live dictation into a demo textbox) → done.

## Testing

- `node --test` unit suites: formatter (fillers, backtrack, dictionary, snippets,
  punctuation commands, casing), wav encoder, store (round-trip, history stats,
  streak math), hotkey chord parser.
- Smoke: `say` → AIFF → `afconvert` → WAV → whisper-cli → formatter, asserting
  transcript accuracy (tiny.en + base); app-launch smoke (Electron boots headless,
  windows created, IPC alive, keymon handshake) via `SOTTO_SMOKE=1` autopilot flag.
- Visual: dashboard/flowbar/onboarding rendered via `webContents.capturePage()`
  screenshots compared against reference shots by eye each iteration.

## Risks

- **fn double-use**: macOS may pop emoji picker — onboarding tip mitigates; alternative
  default offered during onboarding if fn conflicts detected.
- **TCC prompts** can't be granted programmatically — onboarding drives the user
  through them exactly like the original.
- **Whisper latency** on Intel Macs — model picker + tiny model escape hatch.
