// Stub (build recovery): hosted rerank provider descriptors.
// Degraded: empty catalogue; every lookup misses (callers handle null and fall
// back to 'no_endpoint'). Field list matches call-site reads (picker mapping
// uses id/name/keyUrl/keyPlaceholder/staticCatalogue/models; the test path
// uses baseUrl/wire).
export interface HostedRerankProviderDescriptor {
  id: string;
  name: string;
  baseUrl: string;
  wire: string;
  keyUrl?: string;
  keyPlaceholder?: string;
  staticCatalogue?: unknown;
  models?: unknown;
}

export const HOSTED_RERANK_PROVIDERS: Record<string, HostedRerankProviderDescriptor> = {};

export function hostedRerankProvider(id: string): HostedRerankProviderDescriptor | null {
  void id;
  return null;
}
