// Stub (build recovery): deterministic rerank self-test probe (TOP-level import).
// Degraded-but-real shape: the canonical 3-document probe with an obvious
// right answer (`expectedIndex: 0`), matching what production sends. The `n`
// parameter sizes parity with the live pool; the stub always returns the
// canonical probe because invented documents could not carry a meaningful
// expected ranking.
export interface RerankProbe {
  query: string;
  documents: string[];
  expectedIndex: number;
}

export function buildRerankProbe(_n?: number): RerankProbe {
  return { query: 'probe', documents: ['a', 'b', 'c'], expectedIndex: 0 };
}
