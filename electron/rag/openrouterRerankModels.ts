// Stub (build recovery): OpenRouter rerank-model catalogue.
// Degraded: empty list (callers serve the last-known list + stale flag).
export const CATALOG_TTL_MS = 5 * 60 * 1000;

export async function listOpenRouterRerankModels(args: { apiKey?: string }): Promise<unknown[]> {
  void args;
  return [];
}
