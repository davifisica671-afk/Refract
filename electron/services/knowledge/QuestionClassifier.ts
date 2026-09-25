// Stub (build recovery): question classifier for OKF retrieval.
// Degraded: no target entities (call sites fall back to empty lists).
// SYNC — call sites use the return inline (`classifyQuestion(message)`,
// `classifyQuestion(message).targetEntities`).
export interface QuestionClassification {
  targetEntities: string[];
}

export function classifyQuestion(_message: string): QuestionClassification {
  return { targetEntities: [] };
}
