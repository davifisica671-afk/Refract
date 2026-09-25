// Stub (build recovery): user-hosted rerank endpoint discovery.
// Degraded: empty catalogue (never rejects — callers await it inline).
export async function listCustomRerankModels(endpoint: string, key?: string): Promise<unknown[]> {
  void endpoint;
  void key;
  return [];
}
