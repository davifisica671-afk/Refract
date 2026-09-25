// Stub (build recovery): cloud provider embedding-model discovery.
// Degraded: empty list (callers record the attempt and report success).
export async function fetchEmbeddingModels(providerId: string, key?: string): Promise<unknown[]> {
  void providerId;
  void key;
  return [];
}
