# Graph Report - wispr  (2026-08-09)

## Corpus Check
- 38 files · ~137,833 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 254 nodes · 421 edges · 16 communities detected
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `be9848d2`
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

## God Nodes (most connected - your core abstractions)
1. `Store` - 20 edges
2. `formatTranscript()` - 19 edges
3. `Recorder` - 15 edges
4. `Hotkeys` - 15 edges
5. `Transcriber` - 13 edges
6. `Polisher` - 12 edges
7. `el()` - 11 edges
8. `shapeOf()` - 9 edges
9. `openModal()` - 8 edges
10. `renderSettings()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `formatTranscript()`  [INFERRED]
  test/smoke/transcribe.test.js → electron/formatter.js
- `openAddModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/dictionary.js → renderer/dashboard/ui.js
- `openAddModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/snippets.js → renderer/dashboard/ui.js
- `openHotkeyModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/settings.js → renderer/dashboard/ui.js
- `formatTranscript()` --calls--> `applyCorrections()`  [INFERRED]
  electron/formatter.js → electron/corrections.js

## Communities (28 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (35): buildNav(), navigate(), navItem(), abbreviateCount(), dayLabel(), el(), openModal(), timeLabel() (+27 more)

### Community 1 - "Community 1"
Cohesion: 0.21
Nodes (22): applyCorrections(), applyMarkedCorrections(), capitalize(), collapseEllipsisRestatement(), collapseInlineRestatement(), collapseRestatements(), collapseStutters(), correctAcross() (+14 more)

### Community 2 - "Community 2"
Cohesion: 0.18
Nodes (17): applyBacktrack(), applyDictionary(), applyListFormation(), applySnippets(), applySpokenEmails(), applySpokenEmoji(), applySpokenPunctuation(), applyStyle() (+9 more)

### Community 4 - "Community 4"
Cohesion: 0.2
Nodes (4): findBinary(), httpsDownload(), sleep(), Transcriber

### Community 5 - "Community 5"
Cohesion: 0.18
Nodes (3): findKeymon(), Hotkeys, specSatisfied()

### Community 7 - "Community 7"
Cohesion: 0.27
Nodes (4): Polisher, sleep(), stripWrapping(), validatePolish()

### Community 8 - "Community 8"
Cohesion: 0.24
Nodes (6): runSmokeAutopilot(), clamp01(), createFlowbar(), createOnboarding(), flowbarBounds(), setFlowbarPosition()

### Community 11 - "Community 11"
Cohesion: 0.47
Nodes (8): emit(), emitMods(), focusedContext(), handle(), installTap(), postKeyChord(), tapCallback(), tryInstall()

### Community 12 - "Community 12"
Cohesion: 0.48
Nodes (5): el(), go(), render(), renderDots(), stopMicMeter()

### Community 13 - "Community 13"
Cohesion: 0.5
Nodes (3): norm(), checkAccuracy(), main()

## Knowledge Gaps
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `formatTranscript()` connect `Community 2` to `Community 1`, `Community 13`, `Community 6`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `applyCorrections()` connect `Community 1` to `Community 2`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `formatTranscript()` (e.g. with `main()` and `._handleCommand()`) actually correct?**
  _`formatTranscript()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._