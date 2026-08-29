/**
 * @file EmbeddingProviderResolver.ts
 * @description Resolvedor de provedores de embedding que seleciona o melhor provedor disponível.
 * Executa verificações de disponibilidade em ordem de prioridade (OpenAI, Gemini,
 * Ollama) e usa o modelo local como fallback incondicional. Implementa
 * retentativas para provedores cloud para evitar falsos negativos e
 * preservar a estabilidade do espaço de embedding ativo.
 */

import { IEmbeddingProvider } from './providers/IEmbeddingProvider';
import { OpenAIEmbeddingProvider } from './providers/OpenAIEmbeddingProvider';
import { GeminiEmbeddingProvider } from './providers/GeminiEmbeddingProvider';
import { OllamaEmbeddingProvider } from './providers/OllamaEmbeddingProvider';
import { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';
import { ProviderScopeError, assertProviderDataScopes, type ProviderDataScopePolicy } from '../llm/ProviderRouter';

/** Configuração de API do aplicativo para provedores de embedding */
export interface AppAPIConfig {
  openaiKey?: string;
  geminiKey?: string;
  ollamaUrl?: string; // e.g. 'http://localhost:11434'
  providerDataScopes?: ProviderDataScopePolicy;
  // Optional sobrescreve para o Gemini embedding model/dims (internal escape hatch
  // para a future bump). Default para gemini-embedding-2 @ 768d quando omitted.
  geminiEmbeddingModel?: string;
  geminiEmbeddingDims?: number;
}

/**
 * Resolvedor de provedores de embedding que seleciona o melhor disponível.
 * Executa verificações de disponibilidade com retentativas para provedores cloud.
 */
export class EmbeddingProviderResolver {
  /** Cloud providers obtém a bounded probe-retry antes we demote (hysteresis). */
  private static readonly CLOUD_PROBE_ATTEMPTS = 3;
  private static readonly CLOUD_PROBE_BACKOFF_MS = 400;
  private static readonly CLOUD_PROVIDER_NAMES = new Set(['openai', 'gemini']);

  /** Verifica a disponibilidade de um provedor com retentativas para provedores cloud */
  private static async probeAvailable(provider: IEmbeddingProvider): Promise<boolean> {
    const isCloud = EmbeddingProviderResolver.CLOUD_PROVIDER_NAMES.has(provider.name);
    const attempts = isCloud ? EmbeddingProviderResolver.CLOUD_PROBE_ATTEMPTS : 1;
    for (let i = 1; i <= attempts; i++) {
      if (await provider.isAvailable()) return true;
      if (i < attempts) {
        console.log(`[EmbeddingProviderResolver] ${provider.name} probe ${i}/${attempts} failed — retrying (avoids spurious space-thrash demotion)...`);
        await new Promise(r => setTimeout(r, EmbeddingProviderResolver.CLOUD_PROBE_BACKOFF_MS * i));
      }
    }
    return false;
  }

  /** Retorna o melhor provedor de embedding disponível em ordem de prioridade */
  static async resolve(config: AppAPIConfig): Promise<IEmbeddingProvider> {
    const candidates: IEmbeddingProvider[] = [];

    let embeddingsDenied = false;

    if (config.openaiKey) {
      try {
        assertProviderDataScopes('openai_embeddings', ['embeddings'], config.providerDataScopes);
        candidates.push(new OpenAIEmbeddingProvider(config.openaiKey));
      } catch (error) {
        if (error instanceof ProviderScopeError) {
          embeddingsDenied = true;
          console.warn('[ScopeFallback] embeddings denied for cloud; routing to Ollama');
        } else {
          throw error;
        }
      }
    }
    if (config.geminiKey) {
      try {
        assertProviderDataScopes('gemini_embeddings', ['embeddings'], config.providerDataScopes);
        // Rollback lever: NATIVELY_GEMINI_EMBED_MODEL / _DIMS env vars pin o modelo
        // sem a rebuild (e.g. voltar para 'gemini-embedding-001' @ 768 em an incident).
        // Explicit configuração sobrescreve take precedence sobre env, que sobrescreve o v2 default.
        const envModel = process.env.NATIVELY_GEMINI_EMBED_MODEL;
        const envDims = process.env.NATIVELY_GEMINI_EMBED_DIMS ? Number(process.env.NATIVELY_GEMINI_EMBED_DIMS) : undefined;
        candidates.push(new GeminiEmbeddingProvider(
          config.geminiKey,
          config.geminiEmbeddingModel ?? envModel,
          config.geminiEmbeddingDims ?? (Number.isFinite(envDims) ? envDims : undefined),
        ));
      } catch (error) {
        if (error instanceof ProviderScopeError) {
          embeddingsDenied = true;
          console.warn('[ScopeFallback] embeddings denied for cloud; routing to Ollama');
        } else {
          throw error;
        }
      }
    }

    candidates.push(new OllamaEmbeddingProvider(config.ollamaUrl || 'http://localhost:11434'));

    for (const provider of candidates) {
      const available = await EmbeddingProviderResolver.probeAvailable(provider);
      if (available) {
        console.log(`[EmbeddingProviderResolver] Selected provider: ${provider.name} (${provider.dimensions}d)`);
        return provider;
      }
      console.log(`[EmbeddingProviderResolver] Provider ${provider.name} unavailable, trying next...`);
    }

    // Local é o terminal fallback. Fazer Não probe isAvailable() haqui que carrega
    // o MiniLM ONNX modelo e defeats startup lazy-loading para keyless/offline
    // users. Construction exposes dimensions/space cheaply; o actual modelo carrega
    // happens em primeiro embed()/embedQuery(), onde failures pode ainda surface and
    // tentar novamente nnormalmente
    if (embeddingsDenied) {
      console.warn('[ScopeFallback] embeddings denied; Ollama unavailable, using bundled local embedding model lazily');
    } else {
      console.log('[EmbeddingProviderResolver] No cloud/Ollama provider available; using bundled local embedding model lazily');
    }
    const local = new LocalEmbeddingProvider();
    console.log(`[EmbeddingProviderResolver] Selected provider: ${local.name} (${local.dimensions}d, lazy load)`);
    return local;
  }
}
