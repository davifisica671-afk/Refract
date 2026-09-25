// electron/llm/promptSystemV2.ts
//
// Build-recovery stub (Task 2): Prompt System v2 base-prompt resolver.
// Degraded defaults: null base (every call site falls through to the legacy
// CHAT_MODE_PROMPT / composed-string fallback inside its own try/catch),
// identity tier mapping, and inert no-action sentinel helpers (the sentinel
// hold degrades to "paint immediately"). No importer is modified.

export function resolveV2SystemPrompt(args: Record<string, unknown>): string | null {
  void args;
  return null;
}

export function v2TierForPromptTier<T>(t: T): T {
  return t;
}

export function couldBecomeNoActionSentinel(s: string): boolean {
  void s;
  return false;
}

export function stripLeadingNoActionSentinel(s: string): string {
  return s;
}

export function shouldSuppressModelOutput(s: string): boolean {
  void s;
  return false;
}
