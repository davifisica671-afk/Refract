// Stub (build recovery): per-provider embedding catalogue builder.
// Degraded: empty provider list. Takes the whole options object (call sites
// pass more fields than any fixed sketch) and returns the providers ARRAY
// directly — the 'embedding:get-catalog' handler assigns it to `providers:`.
export type EmbeddingCatalogProvider = Record<string, unknown>;

export function buildEmbeddingCatalog(_opts: Record<string, unknown>): EmbeddingCatalogProvider[] {
  return [];
}
