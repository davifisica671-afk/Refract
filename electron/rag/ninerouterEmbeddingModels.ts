// Stub (build recovery): 9Router embedding-model discovery.
// Degraded: empty list (never rejects — callers Promise.all it).
export async function listNinerouterEmbeddingModels(args: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<unknown[]> {
  void args;
  return [];
}
