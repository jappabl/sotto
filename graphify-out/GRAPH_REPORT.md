# Graph Report - wispr  (2026-08-09)

## Corpus Check
- 31 files · ~125,349 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 192 nodes · 300 edges · 13 communities detected
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a659638c`
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

## God Nodes (most connected - your core abstractions)
1. `Store` - 19 edges
2. `Hotkeys` - 14 edges
3. `Recorder` - 13 edges
4. `Transcriber` - 13 edges
5. `el()` - 11 edges
6. `formatTranscript()` - 10 edges
7. `openModal()` - 8 edges
8. `Inserter` - 8 edges
9. `toast()` - 7 edges
10. `renderInsights()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `formatTranscript()`  [INFERRED]
  test/smoke/transcribe.test.js → electron/formatter.js
- `openAddModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/dictionary.js → renderer/dashboard/ui.js
- `openAddModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/snippets.js → renderer/dashboard/ui.js
- `openHotkeyModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/settings.js → renderer/dashboard/ui.js
- `activityRow()` --calls--> `timeLabel()`  [INFERRED]
  renderer/dashboard/pages/home.js → renderer/dashboard/ui.js

## Communities (21 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (23): buildNav(), navigate(), navItem(), el(), openModal(), toast(), entryRow(), exampleChip() (+15 more)

### Community 2 - "Community 2"
Cohesion: 0.21
Nodes (13): applyBacktrack(), applyDictionary(), applySnippets(), applySpokenPunctuation(), applyStyle(), escapeRe(), extractPressEnter(), finalTidy() (+5 more)

### Community 3 - "Community 3"
Cohesion: 0.22
Nodes (4): findBinary(), httpsDownload(), sleep(), Transcriber

### Community 4 - "Community 4"
Cohesion: 0.19
Nodes (3): findKeymon(), Hotkeys, specSatisfied()

### Community 6 - "Community 6"
Cohesion: 0.28
Nodes (11): abbreviateCount(), dayLabel(), timeLabel(), activityRow(), renderHome(), statText(), cap(), numWord() (+3 more)

### Community 7 - "Community 7"
Cohesion: 0.24
Nodes (6): runSmokeAutopilot(), clamp01(), createFlowbar(), createOnboarding(), flowbarBounds(), setFlowbarPosition()

### Community 10 - "Community 10"
Cohesion: 0.54
Nodes (7): emit(), emitMods(), handle(), installTap(), postKeyChord(), tapCallback(), tryInstall()

### Community 11 - "Community 11"
Cohesion: 0.48
Nodes (5): el(), go(), render(), renderDots(), stopMicMeter()

## Knowledge Gaps
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `el()` connect `Community 0` to `Community 6`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._