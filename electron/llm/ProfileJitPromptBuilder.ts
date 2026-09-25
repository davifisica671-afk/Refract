// electron/llm/ProfileJitPromptBuilder.ts
//
// Build-recovery stub (Task 2): just-in-time profile prompt builder.
// Degraded default is empty strings — ipcHandlers.ts:3325 dereferences both
// fields, so they must exist but carry no profile grounding. The turn falls
// back to the non-JIT context path. No importer is modified.
//
// ADAPTATION vs plan sketch: the return type gains optional
// exactQuestionIncluded — ipcHandlers.ts:3355 reads
// profileJitPrompt.exactQuestionIncluded for evidence diagnostics. Absent
// (undefined) is falsy and handled by the diagnostics spread.

export function buildProfileJitPrompt(args: {
  question?: string;
  answerType?: string;
  answerShape?: string;
  sourceOwner?: string;
  sourceAuthority?: string;
  contract?: unknown;
  evidence?: unknown;
  styleInstructions?: string;
  maxAnswerWords?: number;
}): { systemPrompt: string; userPrompt: string; exactQuestionIncluded?: boolean } {
  void args;
  return { systemPrompt: '', userPrompt: '' };
}
