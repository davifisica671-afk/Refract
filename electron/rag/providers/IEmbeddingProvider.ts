/**
 * @file IEmbeddingProvider.ts
 * @description Interface base para provedores de embedding no pipeline RAG.
 * Define o contrato que todos os provedores (Gemini, OpenAI, Ollama, Local)
 * devem implementar: verificação de disponibilidade, geração de embeddings
 * para documentos e consultas, e metadados do espaço vetorial.
 */

/** Dicas opcionais passadas para chamadas de embed. Provedores que não suportam ignoram. */
export interface EmbedOptions {
  /** Título do documento (para modelos assimétricos que formatam `title: {title} | text: {content}`). */
  title?: string;
  /** Dica de tarefa para embeddings de consulta em modelos que incorporam tarefa no prompt. */
  taskHint?: 'retrieval' | 'code';
}

/** Interface base para todos os provedores de embedding */
export interface IEmbeddingProvider {
  /** Nome identificador do provedor (ex: 'openai', 'gemini', 'local') */
  readonly name: string;
  /** ID do modelo sem prefixo models/ (ex: 'gemini-embedding-2') */
  readonly model: string;
  /** Número de dimensões do vetor de embedding */
  readonly dimensions: number;
  /** Chave de identidade canônica do espaço de embedding: `${name}:${model}:${dims}` */
  readonly space: string;
  /** Verifica se o provedor está disponível e funcional */
  isAvailable(): Promise<boolean>;
  /** Gera embedding de um documento (para armazenamento) */
  embed(text: string, opts?: EmbedOptions): Promise<number[]>;
  /** Gera embedding de uma consulta (pode usar prefixo diferente em modelos assimétricos) */
  embedQuery(text: string, opts?: EmbedOptions): Promise<number[]>;
  /** Gera embeddings em lote para múltiplos textos */
  embedBatch(texts: string[], opts?: EmbedOptions): Promise<number[][]>;
}
