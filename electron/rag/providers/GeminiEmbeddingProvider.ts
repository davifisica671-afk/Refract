/**
 * @file GeminiEmbeddingProvider.ts
 * @description Provedor de embedding usando a API v2 do Google Gemini.
 * Utiliza o modelo gemini-embedding-2 com 768 dimensões (configurável).
 * Suporta embeddings assimétricos com formatação de prompt específica para
 * v2 (tarefa embutida no texto, sem parâmetro task_type).
 * Implementa fallback serial para falhas de batch.
 */

import { IEmbeddingProvider, EmbedOptions } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

// Modelo padrão: gemini-embedding-2 (multimodal, abril 2026)
const DEFAULT_MODEL = 'gemini-embedding-2';
// 768 dimensões para manter compatibilidade com tabela vec_chunks_768 existente
const DEFAULT_DIMS = 768;

/** Provedor de embedding usando a API v2 do Google Gemini */
export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly dimensions: number;
  readonly space: string;

  constructor(
    private apiKey: string,
    model: string = DEFAULT_MODEL,
    dimensions: number = DEFAULT_DIMS,
  ) {
    // Accept a bare id ou a 'models/'-prefixed id; armazenamento bare para o space kchave
    // re-add o prefix em o wire.
    this.model = model.replace(/^models\//, '');
    this.dimensions = dimensions;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  /** Verifica disponibilidade fazendo um embed de teste */
  async isAvailable(): Promise<boolean> {
    try { await this.embed('test'); return true; } catch { return false; }
  }

  // ── Formatação de prompt v2 (tarefa embutida no texto) ──────────
  /** Formata texto de documento para o formato v2 do Gemini */
  private formatDocument(text: string, title?: string): string {
    return `title: ${title && title.trim() ? title.trim() : 'none'} | text: ${text}`;
  }
  /** Formata consulta para o formato v2 do Gemini com dica de tarefa */
  private formatQuery(text: string, hint: EmbedOptions['taskHint']): string {
    return hint === 'code'
      ? `task: code retrieval | query: ${text}`
      : `task: search result | query: ${text}`;
  }

  /** Cabeçalhos HTTP com chave de API (nunca na URL para evitar vazamento em logs) */
  private get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey };
  }
  /** Monta a URL da API para o método especificado */
  private url(method: 'embedContent' | 'batchEmbedContents'): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:${method}`;
  }

  /** Valida se o vetor retornado é um array de números finitos com o tamanho esperado */
  private validateVector(values: unknown, ctx: string): number[] {
    if (!Array.isArray(values) || values.length !== this.dimensions) {
      throw new Error(`Gemini v2 ${ctx}: expected ${this.dimensions}-dim array, got ${Array.isArray(values) ? values.length : typeof values}`);
    }
    return values as number[];
  }

  // ── Embedding de documento único ───────────────────────────────────────────────────
  /** Gera embedding de um documento */
  async embed(text: string, opts: EmbedOptions = {}): Promise<number[]> {
    const formatted = this.formatDocument(text, opts.title);
    const res = await fetch(this.url('embedContent'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        content: { parts: [{ text: formatted }] },
        outputDimensionality: this.dimensions, // v2 auto-normalizes truncated dims
      })
    });
    if (!res.ok) {
      throw new Error(`Gemini v2 embed failed: ${res.status} ${res.statusText} ${await res.text().catch(() => '')}`);
    }
    const data = await res.json();
    return this.validateVector(data?.embedding?.values, 'embed');
  }

  // ── Consulta de recuperação assimétrica ──────────────────────────────────────────────
  /** Gera embedding de consulta (usa formato assimétrico v2) */
  async embedQuery(text: string, opts: EmbedOptions = {}): Promise<number[]> {
    const formatted = this.formatQuery(text, opts.taskHint);
    const res = await fetch(this.url('embedContent'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        content: { parts: [{ text: formatted }] },
        outputDimensionality: this.dimensions,
      })
    });
    if (!res.ok) {
      throw new Error(`Gemini v2 query embed failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return this.validateVector(data?.embedding?.values, 'embedQuery');
  }

  // ── Batch: Content separados via batchEmbedContents ───────────────────
  /** Gera embeddings em lote (fallback serial em caso de falha) */
  async embedBatch(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
    if (texts.length === 0) return [];
    const requests = texts.map(t => ({
      model: `models/${this.model}`,
      content: { parts: [{ text: this.formatDocument(t, opts.title) }] },
      outputDimensionality: this.dimensions,
    }));
    let res: Response;
    try {
      res = await fetch(this.url('batchEmbedContents'), {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ requests })
      });
    } catch (e: any) {
      console.warn(`[GeminiEmbeddingProvider] batchEmbedContents network error, falling back to serial: ${e?.message || e}`);
      return this.embedSerial(texts, opts);
    }
    if (!res.ok) {
      // Resilient fallback: serial single-embed preserves ordenar e survives a
      // parcial batch-endpoint outage (re-index precisa ser error-tolerant). Registrar o
      // corpo então a schema/quota erro isn't silently masked como a "batch outage".
      console.warn(`[GeminiEmbeddingProvider] batchEmbedContents failed (${res.status} ${res.statusText}): ${await res.text().catch(() => '')}. Falling back to serial.`);
      return this.embedSerial(texts, opts);
    }
    const data = await res.json();
    const embeddings = data?.embeddings;
    // Proteger contra a short/misaligned batch resposta — positional mapping para chunk
    // ids significa a length mismatch silently corrupts que vector belongs para que chunk.
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      console.warn(`[GeminiEmbeddingProvider] batch returned ${Array.isArray(embeddings) ? embeddings.length : typeof embeddings} vectors for ${texts.length} inputs. Falling back to serial.`);
      return this.embedSerial(texts, opts);
    }
    return embeddings.map((e: { values: unknown }, i: number) => this.validateVector(e?.values, `embedBatch[${i}]`));
  }

  /** Gera embeddings sequencialmente (fallback para falha de batch) */
  private async embedSerial(texts: string[], opts: EmbedOptions): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embed(t, opts));
    return out;
  }
}
