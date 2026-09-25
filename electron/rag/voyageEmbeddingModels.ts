// Stub (build recovery): Voyage embedding-dimension probing.
// Degraded: unmeasurable (callers report dimensions_unmeasurable). Takes
// trailing extras — call sites pass (model, key, modelOverride, requestedDims).
export async function probeVoyageEmbeddingDimensions(
  model: string,
  key?: string,
  ...rest: unknown[]
): Promise<number | null> {
  void model;
  void key;
  void rest;
  return null;
}
