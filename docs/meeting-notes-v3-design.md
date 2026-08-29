# Meeting Notes V3 — Design (Phase 4)

Date: 2026-06-20
Status: design of record for the spec-aligned rebuild. Supersedes the schema in the
existing `electron/services/meeting/types.ts` (which is refactored to match this).

Decisions taken (from product owner):
- **Rebuild to the exact spec schema** (not just harden the existing draft).
- **LLM follow-up draft** with deterministic fallback.
- **Editable speaker labels MVP** + diarization plan doc.
- **Default V3 ON** after hardening.

---

## 1. Pipeline

```
Meeting stopped (MeetingPersistence.stopMeeting)
  → snapshot transcript / mode / calendar / context   [exists]
  → placeholder row, fire-and-forget worker           [exists, never blocks UI]
processAndSaveMeeting (background worker)
  → TranscriptNormalizer.normalize                     [dedup, filler, speaker quality]
  → SpeakerLabelService.apply(meetingId, segments)     [NEW: apply stored renames]
  → MeetingModeDetector.detect(transcript, calendar)   [NEW: detected mode + confidence]
  → MeetingSummaryStrategySelector.select(normalized)  [NEW: direct | map_reduce | long_context]
  → strategy == direct        → single structured call → MeetingSummaryV3
     strategy == map_reduce    → chunk → per-chunk atoms → reduce → MeetingSummaryV3
     strategy == long_context  → (optional) whole-transcript structured call when token-safe
  → deterministic extractor hints (MeetingMemoryService) merged as low-confidence backfill
  → MeetingSummaryValidator (runtime schema) → repair once → fallback
  → FollowUpDraftGenerator (LLM, mode-aware) → FollowUpDraft  [NEW]
  → persist MeetingSummaryV3 (+ V2 bridge fields)      [back-compat]
  → render frontend blocks (MeetingDetails)            [Phase 12]
Later (user-initiated, IPC):
  → regenerate notes / regenerate with detected mode
  → regenerate follow-up (tone)
  → rename speaker → re-render (+ optional regenerate)
  → copy / export recipe
```

All post-stop work runs in the already-background `processAndSaveMeeting`. The UI is
**never** blocked (spec rule).

## 2. Services (new / refactor)

| Service | File | Role |
|---|---|---|
| `TranscriptNormalizer` | `meeting/TranscriptNormalizer.ts` | exists — add `segmentId` passthrough |
| `TranscriptChunker` | `meeting/TranscriptChunker.ts` | exists — carry `segmentId`, expose chunk seg ids |
| `MeetingSummaryStrategySelector` | `meeting/MeetingSummaryStrategySelector.ts` | **NEW** direct/map_reduce/long_context |
| `ChunkMeetingAtomExtractor` (rename of `ChunkSummaryGenerator`) | `meeting/ChunkSummaryGenerator.ts` | use `generateStructured` |
| `MeetingSummaryReducer` | `meeting/MeetingSummaryReducer.ts` | emit spec schema (whatChanged, statuses, generation) |
| `MeetingSummarySchema` (types + runtime validator) | `meeting/MeetingSummaryV3.ts` | **NEW** canonical spec types + `validateMeetingSummaryV3` |
| `MeetingSummaryValidator`/`Repairer` | folded into validator | repair once, then fallback |
| `FollowUpDraftGenerator` | `meeting/FollowUpDraftGenerator.ts` | **NEW** LLM prose, deterministic fallback |
| `SpeakerLabelService` | `meeting/SpeakerLabelService.ts` | **NEW** canonical ids + rename map |
| `MeetingModeDetector` | `meeting/MeetingModeDetector.ts` | **NEW** lightweight detection |
| `MeetingNoteRenderer` | client-side in `MeetingDetails.tsx` | render blocks |
| `MeetingNotesTelemetry` | via `telemetryService` | counts/timings only |
| `generateStructured<T>()` | `llm/generateStructured.ts` | **NEW** provider-aware JSON + repair |
| `MeetingContextAssembler` | `meeting/MeetingContextAssembler.ts` | orchestrate strategy + emit `generation{}` |

Existing services reused: `LLMHelper.generateMeetingSummary`, `ModesManager`,
`MeetingMemoryService`, `DatabaseManager`, `PostCallWorkflow`, `telemetryService`.

## 3. Direct vs map-reduce vs long-context

`MeetingSummaryStrategySelector.select(normalized, opts)`:

- **direct** — `totalTokensEstimate ≤ SHORT_THRESHOLD` (default 1500 tok ≈ short standup):
  one structured call producing the full `MeetingSummaryV3` directly (chunk count = 1).
- **map_reduce** — medium/long (default `> 1500` tok): chunk (3000/overlap 300) →
  per-chunk `ChunkMeetingAtoms` → reduce. **This is the default for anything non-trivial.**
- **long_context** — only when (a) a long-context-capable model is active, (b)
  `totalTokensEstimate ≤ LONG_CONTEXT_SAFE` (default ~48k, well under model window), and
  (c) the selector is explicitly allowed. Even then we **prefer map_reduce** for very long
  meetings to avoid "lost in the middle"; long_context is a single structured pass for the
  medium band where chunking would add latency without quality. Falls back to map_reduce on
  failure.

Long meetings (map_reduce) MUST: preserve chronological order; preserve
timestamp/speaker/segmentId per chunk; extract atoms per chunk; reduce all atoms; dedupe
repeated actions/decisions/questions/risks; preserve section ordering; avoid generic
summaries (filler regex in validator).

## 4. Long-context models — policy
Even on 128k/200k context models we do **not** rely solely on one massive prompt:
- map_reduce remains the default for long meetings (better recall, bounded per-call cost).
- long_context single-pass is used only for the medium token band when token count is safe
  **and** the strategy selector chooses it; it degrades to map_reduce on any failure.

## 5. Canonical schema (`electron/services/meeting/MeetingSummaryV3.ts`)

```ts
export interface MeetingSummaryV3 {
  schemaVersion: 3;
  title: string;
  tldr: string[];
  overview: string;
  whatChanged: string[];
  decisions: DecisionItem[];
  actionItems: ActionItem[];
  openQuestions: QuestionItem[];
  risks: RiskItem[];
  sections: MeetingNoteSection[];
  followUpDraft?: FollowUpDraft;
  timeline?: TimelineItem[];
  people?: PersonMention[];
  topics?: string[];
  sourceQuality: SourceQuality;
  mode: {
    selectedModeId?: string; selectedModeName?: string; selectedTemplateType?: string;
    detectedModeId?: string; detectedModeName?: string; detectedConfidence?: number;
    summaryModeUsed?: string;
  };
  generation: {
    strategy: "direct" | "map_reduce" | "long_context" | "fallback";
    provider?: string; model?: string;
    startedAt: string; completedAt?: string; durationMs?: number;
    chunkCount?: number; warnings: string[];
  };
  // Render/back-compat helpers (not in spec, kept additive):
  noteBlocks?: NoteBlock[];
  recipes?: Record<string, string>;
}

interface MeetingNoteSection { id: string; title: string; bullets: NoteBullet[]; order: number; }
interface NoteBullet { text: string; evidence?: EvidenceRef[]; confidence?: "high"|"medium"|"low"; }
interface EvidenceRef { speakerId?: string; speakerName?: string; timestampMs?: number; quote?: string; segmentId?: string; }
interface DecisionItem { id?: string; text: string; owner?: string; timestampMs?: number; evidence?: EvidenceRef[]; confidence: "high"|"medium"|"low"; }
interface ActionItem { id?: string; text: string; owner?: string; deadline?: string; sourceTimestampMs?: number; explicitness: "explicit"|"inferred"; evidence?: EvidenceRef[]; confidence: "high"|"medium"|"low"; status?: "open"|"done"|"deferred"; }
interface QuestionItem { id?: string; text: string; owner?: string; status: "open"|"answered"|"deferred"; evidence?: EvidenceRef[]; confidence?: "high"|"medium"|"low"; }
interface RiskItem { id?: string; text: string; severity: "low"|"medium"|"high"; evidence?: EvidenceRef[]; confidence?: "high"|"medium"|"low"; }
interface FollowUpDraft { type: "email"|"slack"|"project_update"|"crm_note"|"study_notes"|"interview_feedback"; subject?: string; body: string; tone: "professional"|"warm"|"concise"|"friendly"; basedOnActionItemIds?: string[]; basedOnDecisionIds?: string[]; }
interface TimelineItem { timestampMs?: number; title: string; description?: string; type: "topic_shift"|"decision"|"action_item"|"risk"|"question"; evidence?: EvidenceRef[]; }
interface PersonMention { speakerId?: string; name?: string; role?: string; organization?: string; confidence?: "high"|"medium"|"low"; }
interface SourceQuality { transcriptCoverage: number; speakerQuality: "good"|"mixed"|"poor"; actionItemConfidence: "high"|"medium"|"low"; warnings: string[]; }
```

### Naming change vs current draft
- `timestamp` → `timestampMs`, `sourceTimestamp` → `sourceTimestampMs`,
  `EvidenceRef.timestamp` → `timestampMs` (+ `speakerId/speakerName/segmentId`).
- `followUpDraft: string` → `FollowUpDraft` object.
- New: `whatChanged`, `mode{}`, `generation{}`, `ActionItem.status`,
  `Question/Risk.confidence`, `TimelineItem.type`, `Person.organization`,
  `NoteSection.order`.

### Runtime validation
`validateMeetingSummaryV3(value): { ok; data?; errors[]; repaired }` — a hand-written
runtime validator (no new dep; mirrors existing repo convention) that:
1. coerces/sanitizes every field to the schema,
2. drops invalid items, infers severities/confidence,
3. returns `repaired:true` if any coercion happened,
4. returns `ok:false` only if there is no usable content at all (→ fallback).

### Back-compat
`normalizeLegacySummary(detailedSummary)` maps any pre-V3 `detailedSummary`
(`{overview,keyPoints,actionItems,sections}`) into a minimal `MeetingSummaryV3`-shaped
view for rendering, **without** rewriting stored rows. `MeetingDetails` renders V3 if
`schemaVersion===3`, else legacy blocks. Old `followUpDraft: string` is read as
`{type:'email',body,tone:'professional'}`.

## 6. Chunk atom schema (unchanged in shape, timestamps → Ms)
`ChunkMeetingAtoms { chunkIndex, timeRange{startMs?,endMs?}, brief, topics[], decisions[],
actionItems[], openQuestions[], risks[], deadlines[], people[], importantQuotes[],
modeSpecificFindings, sourceQualityWarnings[] }`. Each chunk prompt asks for facts only
from the chunk, no invented owners/deadlines, explicit vs inferred, evidence, confidence,
mode-specific findings.

## 7. Bulletproof structured generation (`llm/generateStructured.ts`)
```ts
generateStructured<T>(opts: {
  schemaName: string;                 // for provider json_schema / tool name
  jsonShapeHint: string;              // example JSON appended to prompt
  systemPrompt: string; userContent: string;
  validate: (raw: unknown) => { ok: boolean; data?: T; errors: string[]; repaired: boolean };
  llmHelper: LLMHelper;
  fallback?: () => T;
}): Promise<{ ok: boolean; data?: T; raw: string; errors: string[]; repaired: boolean }>
```
Flow: build prompt (system + shape hint) → `llmHelper.generateMeetingSummary` (provider
chain; provider-native JSON mode used where the provider exposes it) → extract JSON →
`validate` → if invalid, **one repair retry** (send the raw + errors back asking for
corrected JSON only) → if still invalid, `fallback()` or `{ok:false}`. Every meeting-note
LLM call (chunk atoms, optional direct/long-context summary, follow-up) routes through it.

Provider-native JSON: detected via `LLMHelper`/`ProviderRouter` capability; when
unavailable (Ollama/custom) we rely on prompt-only JSON + repair. We never *depend* on
provider guarantees — the validate→repair→fallback ladder is always run.

## 8. Follow-up draft (Phase 8)
`FollowUpDraftGenerator.generate({summary, mode, tone})`:
- Maps mode → draft `type` (sales→email/crm, recruiting→email, team-meet→project_update/
  slack, technical-interview→interview_feedback, lecture→study_notes, else email).
- Builds an LLM prompt from **overview + decisions + action items + open questions only**
  (never raw transcript), instructing: short, human, copy-paste ready, no invented
  promises, tone-controlled. Routes via `generateStructured` (small JSON `{subject?,body}`).
- Deterministic fallback = upgraded version of the current builder.
- Scope-gated: if `post_call_summary` denied for cloud, use deterministic fallback (or
  Ollama via the existing scope-fallback path).

## 9. Speaker labels (Phase 9, MVP)
- Canonical ids: `me`, `speaker_1..n` derived from transcript speaker strings (`user`→`me`,
  `interviewer`/system→`speaker_1`…). Stored per meeting as a rename map in
  `summary_json.speakerLabels` (no schema migration). `SpeakerLabelService` resolves a
  display name for a speaker id, honoring user renames.
- Summary context formats lines as `[mm:ss] <DisplayName>: text`; evidence carries
  `speakerId` + resolved `speakerName`.
- UI: rename speaker, apply to all matching segments, regenerate-with-labels.
- Provider diarization + audio-channel heuristic are documented in
  `docs/speaker-diarization-plan.md` (implementation deferred; STT emits no diarization
  today).

## 10. Mode auto-detection (Phase 10)
`MeetingModeDetector.detect({transcript, calendarTitle?, participants?})` — keyword/signal
scoring over the first N minutes + calendar metadata → `{templateType, modeId?, confidence}`.
Stored in `summary.mode.detected*`. Never silently switches the live mode. High-confidence
mismatch with the selected mode → UI suggests "Regenerate as <detected>".

## 11. Privacy & telemetry
- `providerDataScopes.post_call_summary === false` gates all cloud LLM note paths (chunk,
  direct, long_context, follow-up) before any transcript leaves the device; falls back to
  Ollama or deterministic.
- Reference file bodies never enter prompts (`buildSummarySafeModeContextBlock`).
- Telemetry: only counts, durations, statuses, error classes, provider/model ids, and
  quality metrics (coverage %, chunkCount, strategy, confidence). **Never** raw transcript
  or generated note text. Evidence quotes are stored **locally** in the note only.

## 12. Feature flags
`meetingSummaryV3` (→ **default ON** after hardening), `meetingNotesMapReduce`,
`meetingNotesStructuredOutput`, `speakerLabelsV1`, `meetingModeAutoDetect`,
`followUpDraftV2`. Each additive; turning any off restores the prior path.

## 13. Implementation order
Schema (5) → structured helper (7) → strategy selector + chunker segmentId (6) →
follow-up generator (8) → speaker labels + plan (9) → mode detector (10) → UI + IPC (12)
→ cross-meeting recall (13) → tests (14) → default-ON + review + reports (16). Typecheck +
build + tests green after each phase.
