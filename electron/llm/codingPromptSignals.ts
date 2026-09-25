// electron/llm/codingPromptSignals.ts
//
// Build-recovery stub (Task 2): the rewritten IPC layer imports the coding
// prompt signal resolver, but the module has no on-disk implementation yet.
// Degraded default: no coding task, so every surface falls back to its
// legacy non-coding system prompt. No importer is modified.

export interface CodingPromptSignals {
  codingTask: boolean;
  codingTaskKind?: string;
  codingFormat?: string;
  suppliedTemplate?: string;
}

export function resolveCodingPromptSignals(args: {
  answerType?: string;
  question?: string;
  priorCodingTurnExists?: boolean;
  codingTurnPromoted?: boolean;
}): CodingPromptSignals {
  void args;
  return { codingTask: false };
}

export function isDeicticAsk(q: string): boolean {
  void q;
  return false;
}
