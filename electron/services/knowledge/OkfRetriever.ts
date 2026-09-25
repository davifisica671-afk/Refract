// Stub (build recovery): OKF card retriever.
// Degraded: scores nothing.
// Signature note: SYNC returning an array (the call site iterates the return
// directly — `for (const { card } of scored)` — with no await), not async.
export interface OkfScoredCard {
  card: { title: string; body: string };
  score?: number;
  [key: string]: unknown;
}

export interface OkfQueryOptions {
  topN?: number;
  fileId?: string;
}

export function queryOkfCards(
  _pack: unknown,
  _message: string,
  _classification: unknown,
  _opts?: OkfQueryOptions,
): OkfScoredCard[] {
  return [];
}
