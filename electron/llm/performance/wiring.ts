// electron/llm/performance/wiring.ts
//
// Build-recovery stub (Task 2): provider performance hooks for the manual,
// phone-mirror, and regen streaming surfaces. Degraded defaults: a no-op
// observer and a fixed stall budget; the adaptive TTFT helper is the
// identity (flag-off behavior). No importer is modified.
//
// ADAPTATION vs plan sketch: applyAdaptiveTtft accepts the second options
// argument — ipcHandlers.ts:4302,17879 call applyAdaptiveTtft(ms, { llmHelper,
// hasImages, inputTokens }). The identity return preserves flag-off behavior.
//
// ALIGNMENT (Task 5): interTokenStallMs is 8000, matching the live contract
// LIVE_INTER_TOKEN_STALL_MS = 8000 (llm/liveDeadlines.ts:75), which is also
// the default raceStreamWithDeadline applies (:138). The plan-sketch 5000
// would abort slow-but-healthy streams sooner than every other surface.

export function performanceHooks(args: {
  llmHelper?: unknown;
  hasImages?: boolean;
  inputTokens?: number;
  isUserCancelled?: () => boolean;
  onDiagnostics?: (d: unknown) => void;
}): { observe: () => void; interTokenStallMs: number } {
  void args;
  return { observe: () => undefined, interTokenStallMs: 8000 };
}

export function applyAdaptiveTtft(
  ms: number,
  opts?: { llmHelper?: unknown; hasImages?: boolean; inputTokens?: number },
): number {
  void opts;
  return ms;
}

export function secondaryStreamObserver(label: string): () => () => void {
  void label;
  return () => () => undefined;
}
