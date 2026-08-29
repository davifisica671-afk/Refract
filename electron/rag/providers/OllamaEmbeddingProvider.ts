/**
 * @file OllamaEmbeddingProvider.ts
 * @description Provedor de embedding usando o daemon Ollama local.
 * Utiliza o modelo nomic-embed-text com 768 dimensões.
 * Suporta embeddings assimétricos com prefixes diferentes para documentos
 * ("search_document:") e consultas ("search_query:").
 */

import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

/** Provedor de embedding usando o daemon Ollama local (nomic-embed-text, 768d) */
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions = 768; // nomic-embed-text outputs 768
  readonly model: string;
  readonly space: string;

  constructor(
    private baseUrl = 'http://localhost:11434',
    model = 'nomic-embed-text'
  ) {
    this.model = model;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  /** Verifica se Ollama está rodando e o modelo está disponível */
  async isAvailable(): Promise<boolean> {
    try {
      // Verifica se Ollama é executando AND o modelo é pulled
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.models?.some((m: any) => m.name.startsWith(this.model)) ?? false;
    } catch { return false; }
  }

  /** Gera embedding de documento (prefixo search_document: para modelo assimétrico) */
  async embed(text: string): Promise<number[]> {
    // nomic-embed-text é asymmetric — documents obtém a prefix
    const prefixed = `search_document: ${text}`;
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: prefixed })
    });
    if (!res.ok) throw new Error(`Ollama embedding failed: ${res.statusText}`);
    const data = await res.json();
    return data.embedding;
  }

  /** Gera embedding de consulta (prefixo search_query: para modelo assimétrico) */
  async embedQuery(text: string): Promise<number[]> {
    // nomic-embed-text é asymmetric — queries obtém a diferente prefix
    const prefixed = `search_query: ${text}`;
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: prefixed })
    });
    if (!res.ok) throw new Error(`Ollama query embedding failed: ${res.statusText}`);
    const data = await res.json();
    return data.embedding;
  }

  /** Gera embeddings em lote (via Promise.all de chamadas individuais) */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
