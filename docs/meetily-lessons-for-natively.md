# Meetily — Lessons for Refract (Phase 3)

Date: 2026-06-20
Source: `meetily.md` (Zackriya Solutions "meetily", a Rust/Tauri + Python backend
meeting transcription/summary app). This extracts the *ideas* worth porting; Refract
keeps its own Electron/TypeScript architecture and provider routing.

## 1. How Meetily handles long transcripts
A dedicated `process-transcript` endpoint (`backend/app/transcript_processor.py`) takes
`{text, model, model_name, chunk_size, overlap}` (e.g. `chunk_size: 5000, overlap: 1000`).
Long transcripts are split into overlapping chunks and processed in a background
`summary_processes` job rather than one giant prompt.

## 2. Does it chunk? → Yes
Explicit `chunk_size` + `overlap` parameters. The Rust side has a
`transcript_chunk.rs` and a `summary_engine/`; the DB has a `transcript_chunks` table
(`chunk_size`, `overlap`, `model`, `model_name`) and a `summary_processes` table tracking
`status`, `chunk_count`, `processing_time`, `result`, `error`.

## 3. Does it use overlap? → Yes
`overlap: 1000` (chars) by default, smaller than `chunk_size: 5000`. Overlap carries
trailing context into the next chunk so cross-boundary facts aren't lost.

## 4. How it aggregates chunk summaries
Map-reduce: each chunk is summarized, then chunk results are aggregated into a final
structured summary persisted as `summary_processes.result`. Progress is surfaced to the
UI via a `ChunkProgressDisplay` component and the `chunk_count` on the process row.

## 5. Summary schema
Meetily stores per-transcript `summary`, `action_items`, `key_points` columns plus a
block-based editable document (BlockNote editor: `Block.tsx`, `Section.tsx`,
`BlockNoteSummaryView.tsx`, `blocknote-markdown.ts`). Summaries are **section/block
structured**, editable, and exportable to markdown.

## 6. How it preserves section ordering
The block/section model gives a stable ordered document; sections render in a fixed order
and the markdown serializer (`blocknote-markdown.ts`) preserves it.

## 7. Processing status
A first-class state machine on `summary_processes.status` (with `error`, `start_time`,
`end_time`, `chunk_count`, `processing_time`) drives a progress UI and enables retry.

## 8. Frontend note block structure
Block-based editor (BlockNote) where each note is a list of typed blocks/sections,
round-tripped to markdown for export.

---

## 9. What to copy into Refract
| Idea | Refract mapping | Status |
|---|---|---|
| Chunk + overlap | `TranscriptChunker` (token-aware, segment-boundary, overlap-validated) | ✅ done |
| Map-reduce (chunk-summary → aggregate) | `ChunkSummaryGenerator` + `MeetingSummaryReducer` | ✅ done |
| Per-chunk structured atoms | `ChunkMeetingAtoms` JSON | ✅ done |
| Status state machine | `summary_status` column + `SummaryStatus` lifecycle | ✅ done |
| `chunk_count` / `processing_time` telemetry | `generation{chunkCount,durationMs,strategy}` | ➜ Phase 6 (add to summary object) |
| Block-structured, ordered, exportable notes | `noteBlocks` + `MeetingNoteSection.order` + recipes | ◐ → finish in Phase 5/12 |
| Configurable chunk_size/overlap | `TranscriptChunkerOptions` | ✅ done |
| Progress display | regenerate/status UI | ➜ Phase 12 |

## 10. What NOT to copy
- **FastAPI / Python backend** — Refract is Electron/TypeScript; keep summarization in
  `electron/services/meeting/`.
- **Docker deployment / whisper.cpp server infra** — Refract has its own STT stack
  (Google/Deepgram/Soniox/11Labs/OpenAI/local Whisper + relay).
- **Separate DB process & block-editor dependency (BlockNote)** — Refract renders its own
  React note blocks in `MeetingDetails.tsx`; no need for a third-party editor.
- **Meetily's direct provider stack / per-model chunk_size coupling** — Refract routes
  through `LLMHelper`/`ProviderRouter` and estimates tokens itself.
- **Char-based chunk sizing** — Refract uses token-estimate sizing (more provider-robust).

## 11. Net
Meetily validates Refract's chosen architecture (chunk+overlap → per-chunk extraction →
reduce → status-tracked background job). The remaining Meetily-inspired work is cosmetic/
operational: surface chunk progress + processing metadata (`generation{}` block) and a
regenerate affordance — both already on the Phase 6/12 plan. No architectural change is
needed.
