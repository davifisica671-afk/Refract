# Embedding System Discovery & Migration Analysis (Phase 1)

**Date:** 2026-06-01

## 1. Two independent embedding systems

### A. Desktop app (the one that powers all user-facing intelligence)
- **Entry:** `EmbeddingPipeline` → `EmbeddingProviderResolver.resolve()` picks a provider.
- **Provider chain (priority):** OpenAI (if key) → **Gemini (if key)** → Ollama (localhost) → bundled Local (always works).
- **Gemini provider** (`electron/rag/providers/GeminiEmbeddingProvider.ts`):
  - `DEFAULT_MODEL = 'gemini-embedding-2'`, `DEFAULT_DIMS = 768` (**already migrated**).
  - Hits Google directly: `generativelanguage.googleapis.com/.../{model}:embedContent`, auth via `x-goog-api-key` header, user's own key.
  - v2 formatting: task baked into text (`formatDocument`/`formatQuery`), no `task_type` param.
  - Rollback levers: `REFRACT_GEMINI_EMBED_MODEL` / `REFRACT_GEMINI_EMBED_DIMS`, plus explicit config override.
- **Storage:** local SQLite, `vec_chunks_{dim}` tables + `embedding_space` column.
- **Retrieval:** `RAGRetriever` → `VectorStore.search()` (filters by `embedding_space`) → `vectorSearchWorker` (cosine in a worker thread).
- **Re-index:** `EmbeddingPipeline` compares active space vs stored space; mismatch → re-embed queue. v16 DB migration backfills legacy rows' space.

This system powers: Resume, JD, Custom Context, AI Persona, Negotiation, Reference files,
RAG, semantic search, vector retrieval, interview assistant, "What should I answer", lecture,
research — **all client-side, all on the user's own vectors.**

### B. Server (`refract-api/server.js`)
- **Entry:** `getEmbedding(text)` → `callEmbedModel(model, text)`.
- **Waterfall (pre-fix):** `text-embedding-004` (primary) → `gemini-embedding-001` (fallback).
- **Reality:** `text-embedding-004` 404s on the key (verified), so the server effectively
  runs on `gemini-embedding-001` only, after a wasted round-trip + warning per call.
- **Endpoint:** `POST /v1/embed` — the only consumer of `getEmbedding`.
- **Storage:** none. Pure proxy; returns the 768-float vector to the caller.

## 2. Embedding generation flow (server, post-fix target)
```
/v1/embed → auth → quota gate → getEmbedding(text)
   → [optional, flag] callEmbedModel('text-embedding-004')   # only if ENABLE_LEGACY_TEXT_EMBEDDING_004
   → callEmbedModel(PRIMARY = 'gemini-embedding-2')          # NEW primary
   → callEmbedModel(FALLBACK = 'gemini-embedding-001')       # unchanged fallback
   → billAI() → { embedding, model, dimensions:768 }
```

## 3. Retrieval flow (desktop)
```
query → EmbeddingPipeline.embed(query) [gemini-embedding-2 @ 768]
  → spaceKey = 'gemini:gemini-embedding-2:768'
  → VectorStore.search(queryVec, spaceKey)
       SELECT … WHERE embedding_space = spaceKey AND byteLength = 768*4
  → vectorSearchWorker cosine → topK chunks → prompt grounding
```

## 4. Risks

| # | Risk | Affected | Mitigation |
|---|---|---|---|
| R1 | Server primary `004` dead | server `/v1/embed` latency | Phase 4: 2 as primary |
| R2 | 001↔2 incompatible space | desktop retrieval correctness | Already mitigated (space filter + reindex) |
| R3 | No server-side embed observability | ops | Phase 5/6: health + telemetry |
| R4 | Re-embedding existing desktop data | desktop UX (cost/time) | Phase 7 doc; client already does lazy re-index, no forced bulk |
| R5 | Old app versions | installed base | Unaffected — they self-embed with own key |

## 5. Migration requirements
1. Server: swap waterfall to `2 → 001`, keep `004` behind a flag, keep dims=768, env-driven names. (Phase 4)
2. Server: add embedding provider health + failover + telemetry. (Phase 5/6)
3. Desktop: **verify** (not change) the existing v2 migration + space safety. (Phase 8)
4. No forced re-embedding of production data; tooling/plan only. (Phase 7)
