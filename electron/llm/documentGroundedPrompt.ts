// electron/llm/documentGroundedPrompt.ts
//
// Build-recovery stub (Task 2): document-grounded validation helpers.
// Degraded defaults never flag, never repair, never rewrite — the pipeline
// treats every answer as supported and skips all regen loops. The only
// pass-through is expandQueryWithHints / appendCustomModeSystemPromptLayer,
// which return their input unchanged. No importer is modified.
//
// ADAPTATION vs plan sketch: also exports detectUnsupportedDocumentAnswer —
// ipcHandlers.ts:5611 requires it (unsupported-named-entity check). Same
// honest-degraded shape (never flags).

export function isDocGroundedAnswerType(t: string): boolean {
  void t;
  return false;
}

export function isAssistantRefusal(t: string): boolean {
  void t;
  return false;
}

export const SYSTEM_REFUSAL_RE = /(?!)/;

export function detectIncompleteNumericAnswer(args: {
  question?: string;
  answer?: string;
  retrievedBlock?: string;
  answerIsRefusal?: boolean;
}): { missing: string[]; incomplete: boolean } {
  void args;
  return { missing: [], incomplete: false };
}

export function detectIncompleteSubQuestionAnswer(
  args: Record<string, unknown>,
): { missing: string[]; incomplete: boolean } {
  void args;
  return { missing: [], incomplete: false };
}

export function detectUnsupportedDocumentAnswer(args: {
  answer?: string;
  retrievedBlock?: string;
}): { unsupported: boolean; reason: string | null; unsupportedTokens: string[] } {
  void args;
  return { unsupported: false, reason: null, unsupportedTokens: [] };
}

export function completenessRegenFabricates(regen: unknown, block: unknown): boolean {
  void regen;
  void block;
  return false;
}

export function expandQueryWithHints(s: string): string {
  return s;
}

export function appendCustomModeSystemPromptLayer(args: {
  baseSystemPrompt: string;
  modePromptSuffix?: string;
  pinnedInstructions?: string;
  isActiveCustomMode?: boolean;
}): string {
  return args.baseSystemPrompt;
}

export function extractNumericUnitTokens(s: string): Set<string> {
  void s;
  return new Set();
}
