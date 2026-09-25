// Stub (build recovery): hosted (OpenRouter-compatible) reranker client.
// Degraded: construction succeeds, every rerank THROWS — the `reranker:test`
// handler catches into { success: false } and surfaces the message on the
// test-connection button (the thrown error is the honest "unavailable"
// signal, never a fake ranking).
// Constructor/method shapes match the call site: new OpenRouterReranker({
// baseUrl, providerId, allowAnonymousApiKey, wire, getApiKey, getModel })
// then `await reranker.rerankOrThrow(query, documents)` destructured as
// { order: [{ index, score }], stats: { requestLatencyMs, costUsd } }.
export interface OpenRouterRerankerOptions {
  baseUrl: string;
  providerId?: string;
  allowAnonymousApiKey?: boolean;
  wire?: string;
  getApiKey?: () => string | null | undefined;
  getModel?: () => string;
  [key: string]: unknown;
}

export interface RerankOrderEntry {
  index: number;
  score: number;
}

export interface RerankStats {
  requestLatencyMs: number;
  costUsd?: number | null;
}

export class OpenRouterReranker {
  constructor(_opts: OpenRouterRerankerOptions) {}

  async rerankOrThrow(
    _query: string,
    _documents: string[],
  ): Promise<{ order: RerankOrderEntry[]; stats: RerankStats }> {
    throw new Error('rerank unavailable');
  }
}
