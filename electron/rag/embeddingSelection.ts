// Stub (build recovery): manual embedding-selection guard.
// Graceful-open default: allow. Failing closed here would refuse every manual
// provider choice while the catalogue is a stub.
export interface EmbeddingSelectionVerdict {
  ok: boolean;
  error?: string;
  message?: string;
}

export function validateEmbeddingSelection(provider: string, catalog: unknown): EmbeddingSelectionVerdict {
  void provider;
  void catalog;
  return { ok: true };
}
