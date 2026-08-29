# Refract Meeting Notes V3 — Codebase Audit Report

Date: 2026-06-20

## Current pipeline mapped

### Stop + snapshot

`electron/MeetingPersistence.ts` owns the post-meeting lifecycle:

1. `stopMeeting()` flushes interim transcript.
2. It snapshots transcript, usage, start time, duration, session context, calendar metadata, and active mode before `session.reset()`.
3. It writes a placeholder meeting row.
4. It starts `processAndSaveMeeting()` in the background.

### Summary generation before this change

The old path generated:

- title from `data.context.substring(0, 5000)`
- summary from `data.context.substring(0, 10000)`
- mode context hint from `data.context.substring(0, 4000)`

The primary summary LLM path therefore only saw the beginning of long meetings. A 60-minute transcript could lose middle and late decisions/action items.

### Existing useful layers

- `electron/services/post-call/PostCallWorkflow.ts`
  - deterministic structured action item extraction
  - follow-up draft
  - coaching insights
- `electron/intelligence/MeetingMemoryService.ts`
  - deterministic topics, questions, decisions, action items, risks, entities, skills, companies, participants, and source quality
- `electron/services/ModesManager.ts`
  - mode-aware note sections
  - summary-safe context retrieval that strips sensitive reference content
- `electron/db/DatabaseManager.ts`
  - meetings/transcripts/usage tables
  - `summary_json` backward-compatible blob
- `src/components/MeetingDetails.tsx`
  - meeting summary, transcript, usage rendering
  - V2 action items/follow-up/coaching UI

## Weaknesses found

1. Long meetings were summarized from a prefix only (`substring(0, 10000)`), losing early/middle/late coverage.
2. Decisions, action items, questions, and risks were not first-class final note objects.
3. Action items did not consistently carry owner, deadline, explicitness, confidence, and evidence.
4. Follow-up draft could be built from overview text rather than decisions/actions only.
5. Mode templates existed but were not competitive with Granola-style workflows.
6. UI did not surface meeting memory fields clearly.
7. JSON parsing was fragile and treated bad JSON as an empty but “processed” note.
8. No internal summary status existed beyond `is_processed`.
9. No recipe/export layer existed.
10. Telemetry needed to stay counts/timings only as the pipeline became richer.

## Meetily ideas reused

Ported cleanly into Electron/TypeScript:

- chunk + overlap transcript processing
- validation that overlap is less than chunk size and step size is positive
- per-chunk structured extraction into stable JSON atoms
- reducer/aggregation layer for all chunks
- stable final summary schema
- section order preservation through template ordering and stable IDs
- frontend-friendly note block shape
- explicit processing states

## Meetily ideas intentionally not reused

- FastAPI/Python backend
- Docker deployment model
- Whisper infrastructure
- Meetily’s direct provider stack
- Separate backend schema files

Refract keeps its Electron/TypeScript architecture and existing provider routing.

## Files touched

### New V3 pipeline

- `electron/services/meeting/types.ts`
- `electron/services/meeting/TranscriptNormalizer.ts`
- `electron/services/meeting/TranscriptChunker.ts`
- `electron/services/meeting/ChunkSummaryGenerator.ts`
- `electron/services/meeting/MeetingSummaryReducer.ts`
- `electron/services/meeting/MeetingSummarySchemaValidator.ts`
- `electron/services/meeting/MeetingContextAssembler.ts`
- `electron/services/meeting/MeetingRecipes.ts`
- `electron/services/meeting/index.ts`
- `electron/services/meeting/__tests__/MeetingSummaryPipeline.test.mjs`

### Modified existing files

- `electron/MeetingPersistence.ts`
- `electron/db/DatabaseManager.ts`
- `electron/intelligence/intelligenceFlags.ts`
- `electron/services/ModesManager.ts`
- `src/components/MeetingDetails.tsx`

## New architecture summary

1. Snapshot all required meeting state before reset.
2. Normalize transcript segments.
3. Decide direct vs chunked strategy.
4. Chunk long transcripts with overlap.
5. Extract chunk-level `ChunkMeetingAtoms` JSON.
6. Reduce atoms into `MeetingSummaryV3`.
7. Validate/repair schema.
8. Persist V3 with V2 bridge fields for compatibility.
9. Render first-class V3 UI sections.
10. Generate recipe outputs for copy/export.

## Privacy notes

- `providerDataScopes.post_call_summary === false` now gates V3 before transcript chunks are sent to LLM providers.
- Mode reference context still uses `buildSummarySafeModeContextBlock()`.
- V3 persistence uses an explicit allowlist instead of spreading the entire model object.
- Telemetry stores counts/status/timing/model-agnostic strategy data only.
- Recipes are stored/generated as structured note outputs, not sent externally.

## Before / after examples

### Before

```json
{
  "overview": "The meeting discussed telemetry and next steps.",
  "actionItems": ["Follow up on telemetry"],
  "keyPoints": ["Telemetry was discussed"]
}
```

Problems:

- No decision vs discussion separation.
- No owner/deadline/evidence/confidence.
- Generic phrasing.
- Long-meeting content could be missing.

### After

```json
{
  "schemaVersion": 3,
  "tldr": [
    "Telemetry architecture remains unresolved; PostHog is preferred, but privacy retention still needs a decision.",
    "Ari will draft the retention proposal by Friday."
  ],
  "decisions": [],
  "actionItemsV3": [
    {
      "text": "draft the retention proposal",
      "owner": "Ari",
      "deadline": "Friday",
      "explicitness": "explicit",
      "confidence": "high",
      "evidence": [{ "speaker": "Ari", "timestamp": 2430000, "quote": "I’ll draft the retention proposal by Friday." }]
    }
  ],
  "openQuestions": [
    { "text": "What retention period is acceptable for product analytics?", "status": "open" }
  ],
  "risks": [
    { "text": "Analytics rollout may slip until privacy retention is approved.", "severity": "medium" }
  ]
}
```

Benefits:

- Decisions are separate from unresolved discussion.
- Action items are evidence-backed.
- Inferred items can be marked as inferred.
- Open questions and risks are visible.
- Long meetings use chunk/reduce instead of prefix truncation.
