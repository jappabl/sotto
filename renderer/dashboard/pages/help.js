// Help: a practical cheat-sheet for everything Sotto can do.

import { el } from '../ui.js';

export async function renderHelp(container) {
  const hotkeyLabel = await window.sotto.invoke('app:hotkey-label');
  container.replaceChildren();

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title' }, 'Help'),
    ),
  );

  container.append(
    el('div', { class: 'callout' },
      el('h2', { class: 'serif-display', html: 'Talk, don’t <em>type</em>.' }),
      el('p', {}, 'Everything works from one gesture: hold your key, say what you mean, let go.'),
    ),
  );

  const caps = hotkeyLabel.map((k) => `<span class="keycap">${k}</span>`).join(' + ');
  const rows = [
    ['Dictate anywhere', `Click into any textbox, hold ${caps}, speak, release. Your words are cleaned up and pasted at the cursor.`],
    ['Hands-free mode', `Double-tap ${caps} (or click the flow bar) to keep dictating without holding. Tap once or press <span class="keycap">esc</span> to stop.`],
    ['Cancel a dictation', `Press <span class="keycap">esc</span> while recording. Longer takes are kept in Recent activity as audio.`],
    ['Spoken punctuation', 'Say “comma”, “period”, “question mark”, “new line”, “new paragraph”, or “bullet point” to punctuate as you go.'],
    ['Fix yourself mid-sentence', 'Say “no wait”, “scratch that”, “I mean”, “make that”, or just restate it — “meet at 5, no wait, 6” types “meet at 6”. Even multi-part fixes work: “2pm today, make that 4pm tomorrow”.'],
    ['Talk like a human', 'Stutters (“the the”), false starts, and comma-bound hedges (“, you know,”) disappear on their own. Tune how aggressive this is in Style → Auto Cleanup.'],
    ['Speak emails and lists', '“jane dot smith at gmail dot com” becomes a real address; “first do X second do Y” becomes a numbered list; “thumbs up emoji” types 👍.'],
    ['Change your mind later', 'Every dictation keeps its raw transcript — hover a row in Home and click the undo arrow to see exactly what you said.'],
    ['AI Polish (beta)', 'Turn it on in Settings → System and a small on-device language model catches the fuzzy stuff — "forget the pizza place, book sushi instead" comes out as just the sushi part. Nothing leaves your Mac.'],
    ['Command Mode', 'Select some text, hold your talk key + <span class="keycap">ctrl</span>, and say what to do — "make this more concise", "translate to Spanish". The pill turns purple while it listens.'],
    ['Send instantly', 'End with “press enter” and Sotto hits Enter after pasting — great in chat apps.'],
    ['Teach it your words', 'Add names and jargon in Dictionary. Add “spoken phrase → written form” rules for shorthand.'],
    ['Never re-type boilerplate', 'Save Snippets — say “personal email” and your full address appears.'],
    ['Choose your voice', 'Pick Formal, Casual, or very casual in Style to control caps and punctuation.'],
    ['Everything stays here', 'Transcription runs on-device. No account, no cloud, no telemetry.'],
  ];

  const list = el('div', { class: 'entry-list' });
  for (const [title, desc] of rows) {
    list.append(
      el('div', { class: 'activity-row' },
        el('div', { class: 'act-text' },
          el('div', { style: 'font-weight:600;margin-bottom:3px' }, title),
          el('div', { style: 'color:var(--ink-soft)', html: desc }),
        ),
      ),
    );
  }
  container.append(list);
}
