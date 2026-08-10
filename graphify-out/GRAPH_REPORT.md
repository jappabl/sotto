# Graph Report - wispr  (2026-08-10)

## Corpus Check
- 48 files · ~149,510 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 353 nodes · 598 edges · 22 communities detected
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d4dcca14`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]

## God Nodes (most connected - your core abstractions)
1. `MeetingManager` - 24 edges
2. `formatTranscript()` - 21 edges
3. `Store` - 20 edges
4. `Hotkeys` - 17 edges
5. `Recorder` - 15 edges
6. `Transcriber` - 13 edges
7. `el()` - 12 edges
8. `Polisher` - 12 edges
9. `toast()` - 9 edges
10. `openModal()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `formatTranscript()`  [INFERRED]
  test/smoke/transcribe.test.js → electron/formatter.js
- `runEnhance()` --calls--> `toast()`  [INFERRED]
  renderer/dashboard/pages/meetings.js → renderer/dashboard/ui.js
- `openAddModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/dictionary.js → renderer/dashboard/ui.js
- `openAddModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/snippets.js → renderer/dashboard/ui.js
- `openHotkeyModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/settings.js → renderer/dashboard/ui.js

## Communities (37 total, 7 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.1
Nodes (28): buildNav(), navigate(), navItem(), abbreviateCount(), dayLabel(), el(), openModal(), timeLabel() (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (7): isLikelyHallucination(), wavRms(), defaultTitle(), findMeetcap(), MeetingManager, readOr(), sanitize()

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (23): applyBacktrack(), applyDictionary(), applyListFormation(), applySnippets(), applySpokenEmails(), applySpokenEmoji(), applySpokenPunctuation(), applyStyle() (+15 more)

### Community 3 - "Community 3"
Cohesion: 0.21
Nodes (22): applyCorrections(), applyMarkedCorrections(), capitalize(), collapseEllipsisRestatement(), collapseInlineRestatement(), collapseRestatements(), collapseStutters(), correctAcross() (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.16
Nodes (3): findKeymon(), Hotkeys, specSatisfied()

### Community 6 - "Community 6"
Cohesion: 0.2
Nodes (4): findBinary(), httpsDownload(), sleep(), Transcriber

### Community 7 - "Community 7"
Cohesion: 0.23
Nodes (15): cleanup(), durationLabel(), escapeText(), inline(), meetingRow(), meter(), renderAnnotated(), renderEndedBody() (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.21
Nodes (8): Enhancer, transcriptWindows(), annotate(), containment(), isEcho(), mapSources(), noteLines(), tokens()

### Community 10 - "Community 10"
Cohesion: 0.27
Nodes (4): Polisher, sleep(), stripWrapping(), validatePolish()

### Community 11 - "Community 11"
Cohesion: 0.21
Nodes (6): runSmokeAutopilot(), clamp01(), createFlowbar(), createOnboarding(), flowbarBounds(), setFlowbarPosition()

### Community 12 - "Community 12"
Cohesion: 0.31
Nodes (5): ChunkWriter, convertToInt16Mono16k(), emit(), startMicCapture(), startSystemCapture()

### Community 14 - "Community 14"
Cohesion: 0.38
Nodes (8): aiPolishRow(), hotkeyRow(), micRow(), nameRow(), permRow(), renderSettings(), selectRow(), toggleRow()

### Community 15 - "Community 15"
Cohesion: 0.24
Nodes (4): collectWav(), encodeWav16k(), resolveMicDeviceId(), startCapture()

### Community 16 - "Community 16"
Cohesion: 0.42
Nodes (9): emit(), emitMods(), focusedContext(), handle(), installTap(), meetingProbe(), postKeyChord(), tapCallback() (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.48
Nodes (5): el(), go(), render(), renderDots(), stopMicMeter()

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `formatTranscript()` connect `Community 2` to `Community 9`, `Community 3`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `applyCorrections()` connect `Community 3` to `Community 2`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `isEcho()` connect `Community 8` to `Community 1`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `formatTranscript()` (e.g. with `main()` and `._handleCommand()`) actually correct?**
  _`formatTranscript()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._