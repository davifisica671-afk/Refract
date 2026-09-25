// Stub (build recovery): V3 conversation-ring state store consumed by
// ipcHandlers.ts (:233, :2107, :2214, :14978, :16649).
// Degraded: all sinks noop — conversation continuity features (follow-up
// referent resolution, screenshot-description carry-forward) silently do
// nothing; every call site already wraps these in try/catch as
// continuity-only.
// Shape notes (READ-first adaptations vs the plan sketch):
// - resolveConversationSessionId(null, fallbackKey) with fallbackKey:
//   string | number (v3ConversationSessionId :230). Returns the key when
//   non-empty, else NO_CONVERSATION_SCOPE. Numbers are stringified (the
//   plan sketch typed key as string; sender ids arrive as numbers).
// - recordAnswerSummary is called with 3 args (sessionId, answer,
//   screenDescription?) AND 5 args (+ question, { anchor: true }) — the
//   trailing pair seeds/anchors state for turns that never went through
//   orchestrate() (:14983-14992).
// - clearConversationState is called WITH a session id (:2214) and with NO
//   args to clear everything (:16649) — the parameter is optional.
export const NO_CONVERSATION_SCOPE = 'none';

export function resolveConversationSessionId(
  _scope: unknown,
  key: string | number,
): string {
  if (typeof key === 'string' && key) return key;
  if (typeof key === 'number' && Number.isFinite(key)) return String(key);
  return NO_CONVERSATION_SCOPE;
}

export function recordAnswerSummary(
  _sessionId: unknown,
  _answer: unknown,
  _screenDescription?: unknown,
  _question?: unknown,
  _opts?: { anchor?: boolean; [key: string]: unknown },
): void {}

export function clearConversationState(_id?: unknown): void {}
