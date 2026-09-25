// Stub (build recovery): Ollama embedding-model discovery + probing.
// Degraded: empty list, unmeasurable dimensions.
export async function listOllamaEmbeddingModels(url: string): Promise<unknown[]> {
  void url;
  return [];
}

export async function probeOllamaEmbeddingDimensions(url: string, model: string): Promise<number | null> {
  void url;
  void model;
  return null;
}
