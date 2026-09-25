// Stub (build recovery): OpenRouter embedding-model discovery + probing.
// Degraded: empty list, unmeasurable dimensions. The probe takes trailing
// extras — call sites pass (model, key, modelOverride, requestedDims).
export async function listOpenRouterEmbeddingModels(args: { apiKey?: string }): Promise<unknown[]> {
  void args;
  return [];
}

export async function probeOpenRouterEmbeddingDimensions(
  model: string,
  key?: string,
  ...rest: unknown[]
): Promise<number | null> {
  void model;
  void key;
  void rest;
  return null;
}
