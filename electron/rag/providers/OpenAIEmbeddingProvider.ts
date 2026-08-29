/**
 * @file OpenAIEmbeddingProvider.ts
 * @description Provedor de embedding usando a API da OpenAI.
 * Utiliza o modelo text-embedding-3-small com 1536 dimensões.
 * Suporta embeddings simétricos (documento e consulta usam o mesmo formato)
 * e processamento em lote (batch).
 */

import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

/** Provedor de embedding usando a API da OpenAI (text-embedding-3-small, 1536d) */
export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions = 1536;
  readonly model: string;
  readonly space: string;

  constructor(private apiKey: string, model = 'text-embedding-3-small') {
    this.model = model;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  /** Verifica disponibilidade fazendo um embed de teste */
  async isAvailable(): Promise<boolean> {
    // Fast verifica — apenas valida o chave formata e fazer a único testar embed
    try {
      await this.embed('test');
      return true;
    } catch { return false; }
  }

  /** Gera embedding de um documento */
  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: this.model, input: text })
    });
    if (!res.ok) throw new Error(`OpenAI embedding failed: ${res.statusText}`);
    const data = await res.json();
    return data.data[0].embedding;
  }

  /** Gera embedding de consulta (simétrico, mesmo formato que documento) */
  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text); // text-embedding-3-small é symmetric
  }

  /** Gera embeddings em lote para múltiplos textos */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: this.model, input: texts })
    });
    if (!res.ok) throw new Error(`OpenAI batch embedding failed: ${res.statusText}`);
    const data = await res.json();
    return data.data.map((d: any) => d.embedding);
  }
}
