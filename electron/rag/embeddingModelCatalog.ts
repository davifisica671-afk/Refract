// Stub (build recovery): downloadable/bundled embedding model catalogue.
// Degraded: catalogue is empty, so every lookup misses (callers null-check).
// Field list matches call-site reads (license gates, dimensions, support).
export const BUNDLED_CATALOG_ID = 'bundled-local';

export interface EmbeddingCatalogLicense {
  spdx: string;
  url: string;
  requiresAcknowledgement: boolean;
  commercialUseRestricted?: boolean;
}

export interface EmbeddingCatalogModel {
  id: string;
  name: string;
  runtime: string;
  repo: string;
  dimensions: number;
  supported: boolean;
  unsupportedReason?: string;
  license: EmbeddingCatalogLicense;
}

export function findEmbeddingCatalogModel(id: string): EmbeddingCatalogModel | null {
  void id;
  return null;
}
