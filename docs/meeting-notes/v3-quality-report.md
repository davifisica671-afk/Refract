# Refract Meeting Notes V3 — Quality Report

Date: 2026-06-20

## What changed

Refract now has a feature-flagged V3 post-meeting notes pipeline designed for long meetings and product-quality outputs:

- token-aware transcript normalization and chunking
- chunk-level JSON atoms
- reducer that merges decisions/actions/questions/risks
- schema validator and repair/fallback behavior
- summary status lifecycle
- Granola-style recipe outputs
- richer mode-specific note templates
- V3 renderer in Meeting Details

Feature flag:

- `REFRACT_MEETING_SUMMARY_V3=1`
- setting key: `meetingSummaryV3Enabled`

## Test results

Commands run:

```bash
npm run build
npm run build:electron
npm run typecheck:electron
node --test electron/services/meeting/__tests__/MeetingSummaryPipeline.test.mjs electron/services/__tests__/PostCallWorkflow.test.mjs
```

Results:

- `npm run build` ✅
- `npm run build:electron` ✅
- `npm run typecheck:electron` ✅
- meeting/post-call tests: **18/18 pass** ✅

## Realistic transcript coverage

`electron/services/meeting/__tests__/MeetingSummaryPipeline.test.mjs` covers:

1. short standup
2. long 60-minute-style meeting
3. sales call
4. recruiting call
5. technical interview
6. lecture
7. messy meeting with speaker overlap / low-quality labels
8. meeting with no action items
9. meeting with vague/inferred action items
10. meeting with decisions and later contradictions

## Golden expectations verified

- `schemaVersion === 3`
- required arrays are present
- empty action item meetings keep `actionItems: []`
- inferred action items are marked `explicitness: "inferred"`
- contradictory decisions are preserved instead of merged
- long transcript chunker contains early, middle, and late content
- sales output includes objections/risks/follow-up
- recruiting and technical interview output uses mode-specific sections
- lecture output is study-note oriented
- messy transcripts produce source-quality warnings
- existing `PostCallWorkflow` V2 tests still pass

## Edge cases covered

### Long-context coverage

The chunker splits on transcript segment boundaries and carries overlap into following chunks. Tests assert that early, middle, and late transcript facts appear in chunks.

### Bad or sparse content

The validator accepts valid sparse notes if they contain decisions, action items, open questions, or risks even when overview/TLDR/sections are minimal.

### Duplicate content

The reducer merges semantically similar items with word-overlap matching and preserves contradictory decisions.

### Privacy scope

`providerDataScopes.post_call_summary === false` gates the V3 LLM path before transcript chunks are sent to providers.

### UI backward compatibility

V3 UI is gated by `schemaVersion === 3`; legacy V2 blocks are hidden where they would duplicate V3 content. Old saved meetings still render through the V2 path.

## Remaining limitations

1. V3 is feature-flagged off by default for rollout safety.
2. Deduplication is deterministic word-overlap based, not LLM-semantic.
3. Existing user-customized mode sections are respected; old default DB-seeded sections are not forcibly migrated to the richer templates.
4. Regenerate/retry UI is prepared via `summary_status`, but no visible regenerate button was added in this pass.
5. Evidence quotes are intentionally short and inspectable; they are still stored locally as part of notes because the product requirement asks for inspectable evidence.
6. Live end-to-end LLM quality depends on provider response quality; tests validate deterministic pipeline behavior and schema invariants.

## Before / after sample

### Input excerpt

```text
[00:05] Maya: We agreed to keep PostHog as the likely analytics provider, but retention still needs privacy review.
[21:13] Ari: I’ll draft the retention proposal by Friday.
[45:02] Maya: The blocker is legal approval. We cannot launch analytics until that is resolved.
```

### Old style output

```text
Overview: The meeting discussed analytics and next steps.
Action items:
- Follow up on analytics
Key points:
- PostHog was discussed
```

### V3 output shape

```text
TLDR
- PostHog is preferred, but analytics retention still needs privacy review.
- Ari will draft the retention proposal by Friday.
- Legal approval blocks analytics launch.

Decisions
- No final analytics launch decision was made.

Action Items
- Ari: draft the retention proposal by Friday (explicit, high confidence)

Open Questions
- What retention period will privacy/legal approve?

Risks / Blockers
- Legal approval blocks analytics launch. (medium severity)

Follow-up Draft
Hi team,

Decisions confirmed:
- PostHog remains the preferred analytics provider pending retention review.

Next steps:
- Ari: draft the retention proposal by Friday

Best,
```
