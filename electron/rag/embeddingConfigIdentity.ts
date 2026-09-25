// Stub (build recovery): builds the embedding resolver config.
// Pass-through of overrides (all AppAPIConfig fields are optional, so no-arg
// yields {}). Accepts extra keys (e.g. explicitKeyManagement, per-provider
// model overrides) that call sites spread onto the result.
import type { AppAPIConfig } from './EmbeddingProviderResolver';

export function buildEmbeddingConfig(
  overrides?: Partial<AppAPIConfig> & Record<string, unknown>,
): AppAPIConfig {
  return { ...((overrides ?? {}) as AppAPIConfig) };
}
