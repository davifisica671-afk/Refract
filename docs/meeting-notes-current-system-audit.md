# Refract Meeting Notes — Current System Audit (Phase 1)

Date: 2026-06-20
Branch: `feat/browser-extension-v2-pairing`
Scope: end-to-end audit of meeting summary / note generation **as it exists in the working tree today** (including the uncommitted V3 work-in-progress).

> **Important context:** A substantial "Meeting Notes V3" pipeline already exists
> uncommitted under `electron/services/meeting/`, wired into `MeetingPersistence`
> behind the `meetingSummaryV3` flag (default OFF). This audit documents both the
> legacy V2 path and the in-progress V3 path, and is the baseline for the
> spec-aligned rebuild.

---

## 1. How a meeting is stopped

`electron/MeetingPersistence.ts → stopMeeting()` (line 33):

1. `session.flushInterimTranscript()` forces any pending interim transcript to commit.
2. Computes `durationMs`; meetings < 1000ms are discarded (`session.reset()`, return null).
3. **Privacy gate** (line 47): reads `SettingsManager.get('meetingRetention')` and
   per-meeting `doNotPersist` metadata. If retention is `never` or the meeting is
   flagged do-not-persist → emits sanitized `meeting_stop` telemetry (counts only)
   and returns **without writing any row**. Fail-secure: on settings read error it
   discards.
4. **Snapshots before reset** (line 76): `transcript`, `usage`, `startTime`,
   `durationMs`, `context`, plus `metadataSnapshot` (calendar) and `modeSnapshot`
   (`{id,name,templateType}`). The mode snapshot fixes "BUG-MODE-BLEEDING" — async
   processing must use the mode active *when the meeting stopped*, not whatever is
   active when the worker runs.
5. `session.reset()` immediately (line 104) so a new meeting can start / UI clears.
6. Writes a **placeholder row** (`title: "Processing..."`, `summaryStatus: 'queued'`),
   notifies the renderer (`meetings-updated`), then fires `processAndSaveMeeting(...)`
   **fire-and-forget** (line 135). `stopMeeting` returns the new `meetingId`
   immediately → **UI is never blocked** by post-call processing. ✅ (spec rule)

## 2. How transcript data is snapshotted

The snapshot is a deep copy (`[...this.session.getFullTranscript()]`) of
`TranscriptSegment[]` (`electron/SessionTracker.ts:8`):

```ts
interface TranscriptSegment { marker?; speaker: string; text: string; timestamp: number; final: boolean; confidence?: number }
```

- `speaker` is a free-form string but in practice one of `'user'`, `'interviewer'`,
  `'assistant'` (assigned by the two-channel STT pipeline — see §16 / speaker plan).
- `timestamp` is epoch-ms.
- There is **no `segmentId`, no diarized speaker id, no audio-channel field** on the
  segment today.

## 3. How title generation works

`processAndSaveMeeting` (line 199): if no calendar title AND `post_call_summary` scope
allowed, it builds a `titleContext` = transcript joined `speaker: text`, **`.slice(0, 8000)`**,
and calls `llmHelper.generateMeetingSummary(titlePrompt, titleContext, GROQ_TITLE_PROMPT)`.
Result is stripped of quotes/asterisks. Calendar title takes precedence.

## 4. How summary generation works

Two paths in `processAndSaveMeeting`:

### V3 path (flag `meetingSummaryV3`, line 277)
`new MeetingContextAssembler(llmHelper).assembleSummary({transcript, title, modeTemplateType, modeNoteSections, modeContextBlock, onStatusUpdate})`:

1. `TranscriptNormalizer.normalize` — dedup, filler-strip, speaker normalization,
   quality classification (`good|mixed|poor`), warnings.
2. `TranscriptChunker.chunk` — token-aware (≈4 chars/token), default chunk 3000 tok /
   overlap 300 tok, short-threshold 1500 tok. Splits on **segment boundaries**, carries
   overlap. Overlap < chunk validated in constructor.
3. `ChunkSummaryGenerator.generateAtoms` per chunk (concurrency 3) → `ChunkMeetingAtoms`
   JSON (brief, topics, decisions, actionItems, openQuestions, risks, deadlines, people,
   importantQuotes, modeSpecificFindings). Parsed + repaired by `MeetingSummarySchemaValidator`.
4. `MeetingSummaryReducer.reduce` — merges/dedupes atoms into `MeetingSummaryV3`
   (tldr, overview, sections, decisions, actionItems, openQuestions, risks, timeline,
   people, topics, followUpDraft, sourceQuality, noteBlocks).
5. `generateBuiltInRecipes` → export formats. `validateAndRepairSummary` → final schema.
6. Status lifecycle persisted via `db.updateSummaryStatus`.

Mapped into `summaryData` with `schemaVersion: 3` plus V2 bridge fields
(`actionItems: string[]`, `keyPoints`, `sections[{title,bullets:string[]}]`) for
backward-compatible rendering.

### V2 legacy path (line 329, runs when V3 off / failed / scope-denied)
A single `generateMeetingSummary` call with either a mode-section prompt (sections
object keyed by title) or the generic `GROQ_SUMMARY_JSON_PROMPT` shape
(`{overview, keyPoints[], actionItems[]}`). Context built by
`buildBalancedTranscriptContext(transcript, 16000)` (begin/middle/end — already
**not** a naïve prefix). JSON parsed with a fence-strip + `JSON.parse` in try/catch;
parse failure → summary left as empty `{actionItems:[],keyPoints:[]}` but the row is
still saved.

## 5. Are long meetings truncated?

- **Legacy title:** yes, `slice(0, 8000)` of the transcript (acceptable — title only).
- **Legacy summary:** the **old** path used `context.substring(0,10000)`; the working
  tree has already replaced it with `buildBalancedTranscriptContext(...,16000)`
  (begin+middle+end). So the naïve-prefix rule is **already satisfied** on the fallback.
- **V3 summary:** no truncation — full transcript flows through chunk→reduce.
- **Gap:** the V3 chunker drops segments only via normalization (noise/dupes), never by
  position; coverage is reported in `sourceQuality.transcriptCoverage`.

## 6. Where prompts live

- `electron/llm/prompts.ts`: `GROQ_TITLE_PROMPT` (line 931), `GROQ_SUMMARY_JSON_PROMPT`
  (line 942), all `MODE_*_PROMPT` system prompts, shared prefixes.
- Chunk-extraction prompt: inline in `ChunkSummaryGenerator.buildChunkPrompt`.
- Reducer / follow-up: deterministic (no prompt) in `MeetingSummaryReducer`.

## 7. What schemas exist

- `electron/services/meeting/types.ts`: `MeetingSummaryV3`, `ChunkMeetingAtoms`,
  `NoteBlock`, `EvidenceRef`, `DecisionItem`, `ActionItem`, `QuestionItem`, `RiskItem`,
  `TimelineItem`, `PersonMention`, `SourceQualityMeta`, `SummaryStatus`,
  `NormalizedTranscript[Segment]`, `TranscriptChunk`.
- `electron/db/DatabaseManager.ts → Meeting.detailedSummary`: a union of legacy V2 keys
  and the V3 keys (tldr, decisions, openQuestions, risks, sourceQuality, timeline,
  people, topics, recipes, noteBlocks, sectionsV3, actionItemsV3, actionItemsStructured,
  followUpDraft, coachingInsights).
- **No runtime (Zod-style) schema** — validation is hand-rolled in
  `MeetingSummarySchemaValidator`.

### Divergence from the spec schema (drives Phase 5 rebuild)
| Spec field | Current | Action |
|---|---|---|
| `whatChanged: string[]` | folded into `tldr` | add first-class |
| `mode { selected*, detected*, confidence, summaryModeUsed }` | absent | add |
| `generation { strategy, provider, model, timings, chunkCount, warnings }` | partial (telemetry meta only) | add to summary object |
| `EvidenceRef.speakerId / speakerName / segmentId` | only `speaker` | add |
| `ActionItem.status` (open/done/deferred) | absent | add |
| `QuestionItem.confidence`, `RiskItem.confidence` | absent | add |
| `FollowUpDraft` object (type/subject/body/tone) | plain `string` | upgrade |
| `TimelineItem.type` | absent | add |
| `PersonMention.organization`, `confidence` | only name/role/mentions | add |
| `MeetingNoteSection.order` | implicit (array order) | make explicit |
| `SourceQuality.transcriptCoverage` 0–1 | present | keep |

## 8. How JSON is parsed

- V3: `MeetingSummarySchemaValidator.parseJsonObject` — fence-strip → `JSON.parse` →
  fall back to first-`{`/last-`}` slice. Then deterministic field-by-field sanitize/repair.
- V2: inline fence-strip + `JSON.parse` in try/catch.
- **Gap (Phase 7):** no provider-native JSON mode (OpenAI `json_schema`, Anthropic
  tool-use, Groq JSON mode); no **LLM repair retry** — only deterministic repair. No
  generic `generateStructured<T>()` helper. `generateMeetingSummary`
  (`LLMHelper.ts:6000`) returns a raw string via a long fallback chain
  (Refract→Codex→Groq→Gemini cascade) with per-provider timeouts.

## 9. How follow-up drafts are generated

Two deterministic generators (no LLM):
- `MeetingSummaryReducer.buildFollowUpDraft(decisions, actions)` (V3) — bulleted
  "Hi team, … Decisions confirmed: … Next steps: …".
- `PostCallWorkflow.buildFollowUpDraft(mode, actionItems, summaryData)` (V2) — similar.

Both produce the rigid bullet style the spec calls out as "Bad". **Gap (Phase 8):**
no LLM prose draft, no tone control, no regenerate.

## 10. How action items are extracted

- V3: per-chunk by the extraction LLM, then reducer merges (owner/deadline/explicitness/
  confidence carried, evidence concatenated, dedup by word-overlap ≥0.8).
- V2: `PostCallWorkflow.extractStructuredActionItems` (deterministic regex over transcript
  + summary action strings) → `actionItemsStructured[{id,text,owner?,deadline?}]`.

## 11. How decisions / open questions / risks are extracted

- V3: first-class — extracted per chunk, merged in reducer, rendered as dedicated UI
  sections. Severity inferred when missing. Contradictory decisions deliberately preserved.
- V2: only via `MeetingMemoryService` (deterministic) and not surfaced as primary notes.

## 12. How mode-specific templates affect final notes

`ModesManager` (`electron/services/ModesManager.ts`):
- 7 `ModeTemplateType`: `general, sales, recruiting, team-meet, looking-for-work,
  technical-interview, lecture`.
- `TEMPLATE_NOTE_SECTIONS` (line 83) — rich, well-described section sets per mode
  (already close to spec Phase 11).
- `getNoteSections(modeId)` returns user-customized DB sections, else canonical template.
- `buildSummarySafeModeContextBlock` — injects customContext + retrieved reference
  snippets only (never raw reference file bodies), honoring `providerDataScopes`.
- V3 passes `modeNoteSections` into chunk extraction (`modeSpecificFindings`) and the
  reducer builds `sections[]` from them (order preserved, empty sections dropped).

## 13. How meeting memory is created and saved

- `MeetingMemoryService.buildMeetingRecord` (deterministic) → topics, questionsAsked,
  decisions, actionItems, risks, entities, skillsDiscussed, companiesDiscussed,
  participants, sourceQuality. Persisted into `summary_json.meetingMemory`
  (schemaVersion 2) behind `meetingMemoryV2` flag. No DB migration (new JSON key).
- `LongTermMemoryService` (Hindsight) — async retain of summary text behind
  `hindsightPostMeetingRetain`; **Noop** unless Hindsight configured + client installed.
- Attribution recorded (counts only) via `recordAttribution`.

## 14. How the frontend renders notes

`src/components/MeetingDetails.tsx`:
- `isV3Summary = detailedSummary?.schemaVersion === 3`. When true renders TLDR,
  Decisions, Open Questions, Risks with evidence labels, plus copy-all (V3-aware).
- Else legacy: overview, keyPoints, actionItems, sections, V2 action items / follow-up /
  coaching.
- **Gaps (Phase 12):** no regenerate button, no follow-up regenerate / tone, no
  evidence→transcript jump, no speaker rename, action-items/mode-sections/timeline V3
  rendering incomplete, copy-follow-up partial.

## 15. What breaks or degrades for long meetings

- **Legacy path:** balanced 16k context preserves begin/middle/end but the *middle* is a
  contiguous slice — long meetings still lose most of the body. Single-pass summary
  quality degrades and is generic.
- **V3 path:** designed for this — chunk+reduce preserves the whole timeline. Risk areas:
  many chunks × per-chunk LLM cost/latency (mitigated by concurrency 3, runs in
  background); reducer dedup is word-overlap (not semantic) so near-duplicates with
  different wording survive.

## 16. What is missing vs Granola / Otter / Fireflies (summary; full in Phase 2)

| Capability | Status |
|---|---|
| Clean skim-first notes | partial (V3 TLDR) — needs `whatChanged`, layout |
| Decisions / actions / owners / deadlines | ✅ V3 (deterministic follow-up weak) |
| Open questions / risks | ✅ V3 |
| Evidence / timestamps | ✅ stored; ⚠️ no transcript jump |
| Speaker attribution / diarization | ❌ no diarization, no rename |
| Follow-up draft quality | ❌ rigid deterministic |
| Searchability / cross-meeting recall | ⚠️ memory exists, not surfaced |
| Regenerate / edit | ⚠️ status plumbed, no UI |
| Export/copy ready | ✅ recipes (not surfaced in UI) |
| Mode auto-detect | ❌ |
| Provider-guaranteed JSON | ❌ |

---

## Files in scope

**Existing V3 (uncommitted):** `electron/services/meeting/{types,TranscriptNormalizer,
TranscriptChunker,ChunkSummaryGenerator,MeetingSummaryReducer,
MeetingSummarySchemaValidator,MeetingContextAssembler,MeetingRecipes,index}.ts` +
`__tests__/MeetingSummaryPipeline.test.mjs`.

**Modified:** `electron/MeetingPersistence.ts`, `electron/db/DatabaseManager.ts`,
`electron/intelligence/intelligenceFlags.ts`, `electron/services/ModesManager.ts`,
`src/components/MeetingDetails.tsx`, `src/components/settings/IntelligenceSettings.tsx`.

**Untouched dependencies:** `electron/LLMHelper.ts` (`generateMeetingSummary` @6000),
`electron/llm/prompts.ts`, `electron/services/post-call/PostCallWorkflow.ts`,
`electron/intelligence/MeetingMemoryService.ts`, `electron/SessionTracker.ts`,
`electron/audio/*STT.ts` (no diarization output), `electron/ipcHandlers.ts`
(`get-meeting-details`, `update-meeting-summary`, `update-meeting-title`,
`delete-meeting`; **no regenerate/follow-up/speaker IPC**).

## Baseline verification (2026-06-20)
- `npm run typecheck:electron` ✅
- `npm run build:electron` ✅
- `node --test MeetingSummaryPipeline.test.mjs` → **10/10 pass** ✅
