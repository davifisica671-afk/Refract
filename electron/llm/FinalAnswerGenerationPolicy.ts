// electron/llm/FinalAnswerGenerationPolicy.ts
//
// Build-recovery stub (Task 2): session-write policy decider.
// Degraded default returns undefined, which every addAssistantMessage call
// site already passes through as "no policy override" (extra args are
// ignored by the session tracker at runtime). No importer is modified.

export type FinalGenerationMode = string;

export type SessionWriteDecision = unknown;

export function decideSessionWritePolicy(args: {
  finalGenerationMode?: FinalGenerationMode;
  validationOk?: boolean;
  sourceContractHonored?: boolean;
  criticalViolations?: unknown[];
}): SessionWriteDecision {
  void args;
  return undefined;
}
