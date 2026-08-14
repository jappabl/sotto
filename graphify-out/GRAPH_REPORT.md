# Graph Report - wispr  (2026-08-11)

## Corpus Check
- 68 files · ~186,678 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 532 nodes · 901 edges · 30 communities detected
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5e5846bb`
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
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]

## God Nodes (most connected - your core abstractions)
1. `MeetingManager` - 24 edges
2. `formatTranscript()` - 22 edges
3. `Store` - 20 edges
4. `Recorder` - 17 edges
5. `Hotkeys` - 17 edges
6. `el()` - 14 edges
7. `Transcriber` - 13 edges
8. `Knowledge` - 13 edges
9. `Polisher` - 12 edges
10. `Embedder` - 12 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `formatTranscript()`  [INFERRED]
  test/smoke/transcribe.test.js → electron/formatter.js
- `runEnhance()` --calls--> `toast()`  [INFERRED]
  renderer/dashboard/pages/meetings.js → renderer/dashboard/ui.js
- `openAddModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/dictionary.js → renderer/dashboard/ui.js
- `openAddModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/snippets.js → renderer/dashboard/ui.js
- `orgNameModal()` --calls--> `openModal()`  [INFERRED]
  renderer/dashboard/pages/settings.js → renderer/dashboard/ui.js

## Communities (53 total, 9 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (42): buildNav(), navigate(), navItem(), renderPage(), abbreviateCount(), el(), openModal(), toast() (+34 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (6): Embedder, sleep(), findBinary(), httpsDownload(), sleep(), Transcriber

### Community 2 - "Community 2"
Cohesion: 0.13
Nodes (29): dayLabel(), timeLabel(), activityRow(), renderHome(), statText(), cleanup(), durationLabel(), escapeText() (+21 more)

### Community 3 - "Community 3"
Cohesion: 0.13
Nodes (7): isLikelyHallucination(), wavRms(), defaultTitle(), findMeetcap(), MeetingManager, readOr(), sanitize()

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (18): askAutoClose(), askBegin(), askClose(), askExpandToContent(), askFail(), askFinishListening(), askFitBox(), askPacedReveal() (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (23): applyBacktrack(), applyDictionary(), applyListFormation(), applySnippets(), applySpokenEmails(), applySpokenEmoji(), applySpokenPunctuation(), applyStyle() (+15 more)

### Community 6 - "Community 6"
Cohesion: 0.21
Nodes (22): applyCorrections(), applyMarkedCorrections(), capitalize(), collapseEllipsisRestatement(), collapseInlineRestatement(), collapseRestatements(), collapseStutters(), correctAcross() (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.16
Nodes (3): findKeymon(), Hotkeys, specSatisfied()

### Community 9 - "Community 9"
Cohesion: 0.19
Nodes (7): checkSentences(), clip(), hashText(), Knowledge, sectionsOf(), snippet(), transcriptWindows()

### Community 10 - "Community 10"
Cohesion: 0.19
Nodes (9): droppedNames(), Enhancer, transcriptWindows(), annotate(), containment(), isEcho(), mapSources(), noteLines() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.27
Nodes (4): Polisher, sleep(), stripWrapping(), validatePolish()

### Community 13 - "Community 13"
Cohesion: 0.22
Nodes (7): runSmokeAutopilot(), clamp01(), createFlowbar(), createOnboarding(), flowbarBounds(), setFlowbarExpanded(), setFlowbarPosition()

### Community 14 - "Community 14"
Cohesion: 0.24
Nodes (4): Calendar, conferenceUrl(), findCalmon(), isMeeting()

### Community 15 - "Community 15"
Cohesion: 0.29
Nodes (5): Briefer, decodeEntities(), httpsGetText(), stripHtml(), tidyBrief()

### Community 16 - "Community 16"
Cohesion: 0.27
Nodes (4): defaultTitle(), Notes, readOr(), sanitize()

### Community 18 - "Community 18"
Cohesion: 0.38
Nodes (3): GitOrg, normalizeRepoRef(), run()

### Community 19 - "Community 19"
Cohesion: 0.31
Nodes (5): ChunkWriter, convertToInt16Mono16k(), emit(), startMicCapture(), startSystemCapture()

### Community 20 - "Community 20"
Cohesion: 0.27
Nodes (4): BM25, reciprocalRankFusion(), stem(), tokenize()

### Community 22 - "Community 22"
Cohesion: 0.42
Nodes (9): emit(), emitMods(), focusedContext(), handle(), installTap(), meetingProbe(), postKeyChord(), tapCallback() (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.57
Nodes (7): authStatusString(), emailOf(), emit(), handle(), myStatus(), requestAccess(), upcoming()

### Community 24 - "Community 24"
Cohesion: 0.48
Nodes (5): el(), go(), render(), renderDots(), stopMicMeter()

## Knowledge Gaps
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `formatTranscript()` connect `Community 5` to `Community 11`, `Community 6`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `applyCorrections()` connect `Community 6` to `Community 5`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `isEcho()` connect `Community 10` to `Community 3`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `formatTranscript()` (e.g. with `main()` and `._handleBrainDump()`) actually correct?**
  _`formatTranscript()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._