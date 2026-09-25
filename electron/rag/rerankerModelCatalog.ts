// Stub (build recovery): local reranker model catalogue.
// Degraded: catalogue is empty, so every lookup misses (callers null-check and
// fall back to the bundled model). Field list matches call-site reads
// (supported gating, unsupportedReason messages, gguf runtime branching).
export const BUILT_IN_RERANKER = { id: 'built-in', name: 'Built-in' };

export interface RerankerCatalogModel {
  id: string;
  name: string;
  runtime: string;
  repo?: string;
  supported: boolean;
  unsupportedReason?: string;
}

export function findCatalogModel(id: string): RerankerCatalogModel | null {
  void id;
  return null;
}
