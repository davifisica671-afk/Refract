// electron/llm/conversationHistoryPolicy.ts
//
// Build-recovery stub (Task 2): identity pass-through. Keeping history
// instead of stripping prior assistant turns is the safe direction —
// the model sees strictly more context, never less. No importer is modified.

export function stripPriorAssistantTurns(snap: string): string {
  return snap;
}
