// Stub (build recovery): user-hosted OpenAI-compatible endpoint discovery.
// Degraded: empty catalogue, unmeasurable dimensions. List functions must
// resolve to [] (never reject) — callers Promise.all them.
export async function listCustomEmbeddingModels(endpoint: string, key?: string): Promise<unknown[]> {
  void endpoint;
  void key;
  return [];
}

export async function probeCustomEmbeddingDimensions(
  endpoint: string,
  model: string,
  key?: string,
): Promise<number | null> {
  void endpoint;
  void model;
  void key;
  return null;
}
