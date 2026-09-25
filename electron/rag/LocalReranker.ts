// Stub (build recovery): bundled local reranker handle.
// Degraded: present but unusable — not cached, not loaded, ranks nothing.
// isCached/isLoaded are METHODS (call sites invoke them); rerank is async
// (the activation path awaits rerank() and treats [] as a failed self-test,
// which is the honest outcome while no model ships).
export interface LocalRerankResult {
  index: number;
  score: number;
}

export interface LocalRerankerHandle {
  isCached: () => Promise<boolean> | boolean;
  isLoaded: () => boolean;
  rerank: (query: string, documents: string[]) => Promise<LocalRerankResult[]>;
}

export function getLocalReranker(): LocalRerankerHandle {
  return {
    isCached: async () => false,
    isLoaded: () => false,
    rerank: async () => [],
  };
}

export function reloadLocalReranker(reason: string): void {
  void reason;
}

export function clearLocalRerankerPoison(): void {}
