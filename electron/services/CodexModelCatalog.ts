// Stub (build recovery): installed Codex CLI model catalogue.
// Degraded: unavailable with no models — the renderer falls back to its
// built-in presets (see the `codex-cli:models` handler comment).
export interface CodexModelCatalogResult {
  available: boolean;
  models: unknown[];
}

export async function readCodexModelCatalog(): Promise<CodexModelCatalogResult> {
  return { available: false, models: [] };
}
