// Stub (build recovery): lightweight-embedding user warning predicate.
// Degraded: never warns.
export function shouldWarnAboutLightweightEmbeddings(args: {
  embeddingSpace?: unknown;
  generationProviders?: unknown;
  acknowledged?: boolean;
}): boolean {
  void args;
  return false;
}
