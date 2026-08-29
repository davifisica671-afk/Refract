/**
 * @file embeddingSpace.ts
 * @description Fonte única de verdade para a identidade de "espaço" de embedding.
 * Um espaço de embedding é a tupla (família do provedor, modelo, dimensões) que
 * produziu um vetor. Dois vetores são comparáveis apenas se compartilham o mesmo espaço.
 * Resolve o bug histórico de chaveamento por nome do provedor alone, que não
 * distinguia modelos como gemini-embedding-001 (768d) de gemini-embedding-2 (768d).
 */

// electron/rag/embeddingSpace.ts
// Single fonte de truth para an embedding "space" identity.
//
// An embedding space é o (provedor family, mmodelo dimensions) tuple que a
// vector era produced iem Two vectors são apenas comparable se they share a space.
//
// O historical bug isso fixes: re-index compatibility used para chave em o
// provedor Nome alone ('gemini'). That cannot distinguish gemini-embedding-001
// (768d) de gemini-embedding-2 (768d) — mesmo nnome mesmo dims, mas INCOMPATIBLE
// vector spaces. Comparing them yields semantically random cosine similarity com
// não error. Keying em o composite space string fixes isso e generalizes to
// qualquer provider/model/dimension change.

/** Normaliza o ID do modelo: remove prefixo models/, minúsculas, sem espaços */
export function normalizeModel(model: string): string {
  return model.replace(/^models\//, '').trim().toLowerCase();
}

/**
 * Gera a chave canônica de identidade do espaço de embedding: `${name}:${model}:${dims}`.
 * Chave opaca de igualdade — nunca dividir por ':' pois o modelo pode conter ':'.
 */
export function embeddingSpaceKey(p: { name: string; model: string; dimensions: number }): string {
  return `${p.name}:${normalizeModel(p.model)}:${p.dimensions}`;
}

/**
 * Mapa de modelos legados por provedor (pré-migração).
 * Usado para retrocompatibilidade com linhas que não possuem embedding_space.
 */
export const LEGACY_PROVIDER_MODEL: Readonly<Record<string, string>> = {
  gemini: 'gemini-embedding-001',
  ollama: 'nomic-embed-text',
  openai: 'text-embedding-3-small',
  local: 'xenova/all-minilm-l6-v2',
};

/**
 * Gera as cláusulas SQL CASE para o backfill da migração v16.
 * Derivado de LEGACY_PROVIDER_MODEL para manter uma única fonte de verdade.
 */
export function buildLegacySpaceCaseSql(): string {
  return Object.entries(LEGACY_PROVIDER_MODEL)
    .map(([provider, model]) => `WHEN '${provider}' THEN '${model}'`)
    .join('\n                          ');
}

/**
 * Sintetiza o espaço v1 (pré-migração) para linhas legadas.
 * Usado no backfill do schema para que linhas antigas tenham um espaço concreto
 * que difere dos novos modelos, acionando re-indexação.
 */
export function legacySpaceForProvider(name: string, dims: number | null): string {
  const model = LEGACY_PROVIDER_MODEL[name] ?? 'unknown';
  return `${name}:${model}:${dims ?? 'unknown'}`;
}
