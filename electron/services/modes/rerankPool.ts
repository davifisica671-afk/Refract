// Stub (build recovery): rerank candidate-pool sizing (TOP-level import).
// Degraded: the untouched-install pool. Both the status panel
// (`candidateCountDefault`) and the clamp in `reranker:set-config` read this
// single export, so the renderer cannot disagree with retrieval.
export const RERANK_CANDIDATE_POOL = 3;

export function resolveRerankPoolSize(): number {
  return RERANK_CANDIDATE_POOL;
}
