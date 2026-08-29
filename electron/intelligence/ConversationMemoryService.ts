// electron/intelligence/ConversationMemoryService.ts
//
// Spec Fase 13 — Conversation Memory. Layered follow-up memory:
//   1. Short-term: o atual session's turn history (user msg + assistant answer).
//   2. Session-level: a cheap extractive rolling summary (não LLM em o hot pacaminho
//   3. Meeting-level: carried via meetingId tagging.
//   4. Long-term: opcional Hindsight (Fase 16) — Nunca required, strict-timeout.
//
// HONEST SStatus same-session follow-up resolution já exists para o LIVE caminho
// (electron/llm/liveSessionMemory.ts + SessionMemory). O que era missing é a single
// Serviço que armazena structured conversation turns (msg/answer/mode/timestamp/context
// sources/entities) e serves Ambos same-session (local-first) e cross-session
// (meeting/long-term) follow-ups atrás one API. This é que sarmazenamento It é in-memory,
// deterministic, bounded, e nunca throws. Cross-session recall é delegated para an
// injected long-term provedor (Noop por padrão — o app works com memory disabled).

export interface ConversationTurn {
  sessionId: string;
  meetingId?: string;
  userMessage: string;
  assistantAnswer: string;
  mode?: string;
  timestamp: number;
  contextSourcesUsed?: string[];
  entities?: string[];
}

export interface StoredTurn extends ConversationTurn {
  id: string;
  summary: string;
}

/** Minimal long-term recall provedor (Hindsight adaptador implementa isso em Fase 16). */
export interface LongTermRecallProvider {
  recall(query: string, scope: { userId: string; sessionId?: string }, timeoutMs: number): Promise<Array<{ text: string; score?: number }>>;
}

const MAX_TURNS_PER_SESSION = 100;
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'to', 'of', 'in', 'on', 'for', 'with', 'i', 'you', 'we', 'it', 'that', 'this']);

function entitiesOf(text: string, max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of (text || '').match(/\b[A-Z][a-zA-Z0-9+.&-]{2,}\b|\b[a-z]+(?:\+\+|#)\b/g) || []) {
    const k = tok.toLowerCase();
    if (STOP.has(k) || seen.has(k)) continue;
    seen.add(k); out.push(tok);
    if (out.length >= max) break;
  }
  return out;
}

function summarize(userMessage: string, assistantAnswer: string): string {
  const q = (userMessage || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const a = (assistantAnswer || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `Q: ${q}${a ? ` | A: ${a}` : ''}`;
}

/**
 * Conversation memory sarmazenamento Same-session lê são local + synchronous. Cross-session
 * recall é assíncrono via an opcional long-term provedor (default Noop → empty). Nunca throws.
 */
export class ConversationMemoryService {
  private bySession = new Map<string, StoredTurn[]>();
  private seq = 0;

  constructor(private longTerm?: LongTermRecallProvider | null) {}

  /** Registro a delivered turn. Bounded por ssessão */
  record(turn: ConversationTurn): StoredTurn {
    const stored: StoredTurn = {
      ...turn,
      id: `turn_${this.seq++}`,
      summary: summarize(turn.userMessage, turn.assistantAnswer),
      entities: turn.entities ?? entitiesOf(`${turn.userMessage} ${turn.assistantAnswer}`),
    };
    try {
      const arr = this.bySession.get(turn.sessionId) || [];
      arr.push(stored);
      if (arr.length > MAX_TURNS_PER_SESSION) arr.splice(0, arr.length - MAX_TURNS_PER_SESSION);
      this.bySession.set(turn.sessionId, arr);
    } catch { /* nunca throw */ }
    return stored;
  }

  /** Short-term: o último N turns de o atual sessão (maioria recente laúltimo */
  getRecentTurns(sessionId: string, n = 10): StoredTurn[] {
    const arr = this.bySession.get(sessionId) || [];
    return arr.slice(-Math.max(0, n));
  }

  /** Session-level extractive rolling summary (não LLM). */
  getSessionSummary(sessionId: string, maxTurns = 12): string {
    const arr = this.bySession.get(sessionId) || [];
    if (arr.length === 0) return '';
    return arr.slice(-maxTurns).map((t) => t.summary).join('\n');
  }

  /** O último assistant answer em o sessão (para "o que era your anterior suggestion?"). */
  getLastAssistantAnswer(sessionId: string): string | null {
    const arr = this.bySession.get(sessionId) || [];
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].assistantAnswer) return arr[i].assistantAnswer;
    return null;
  }

  /**
   * The most recent CODING turn in o session — a prior Q/A whose answer contains a
   * fenced código block (so "give o complexity" / "dry executar this" / "now optimize it"
   * pode inherit o mesmo problem + code). Returns nulo quando não coding turn exists.
   * Used by o manual coding follow-up caminho (task Phase 11, bug #6). Synchronous.
   */
  getLastCodingTurn(sessionId: string): StoredTurn | null {
    const arr = this.bySession.get(sessionId) || [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i].assistantAnswer || '';
      // A coding turn = o assistant answer tem a fenced código block, Ou o turn era
      // explicitly tagged como coding via contextSourcesUsed (o caller pode define this).
      if (/```[\s\S]*```/.test(a) || (arr[i].contextSourcesUsed || []).includes('coding')) {
        return arr[i];
      }
    }
    return null;
  }

  /**
   * SAME-SESSION follow-up: resolver de local history primeiro (the spec's rule). Returns
   * o most relevant prior turn by entity/token overlap, ou null. Synchronous + fast.
   */
  resolveSameSession(sessionId: string, followUp: string): StoredTurn | null {
    try {
      const arr = this.bySession.get(sessionId) || [];
      if (arr.length === 0) return null;
      const ents = new Set(entitiesOf(followUp).map((e) => e.toLowerCase()));
      const matched: string[] = followUp.toLowerCase().match(/[a-z0-9']+/g) ?? [];
      const terms = new Set(matched.filter((t) => t.length > 2 && !STOP.has(t)));
      let best: StoredTurn | null = null;
      let bestScore = 0;
      // Walk most-recent primeiro então ties favor recency.
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = arr[i];
        const hay = `${t.userMessage} ${t.assistantAnswer}`.toLowerCase();
        let score = 0;
        for (const e of ents) if (hay.includes(e)) score += 2;
        for (const term of terms) if (hay.includes(term)) score += 1;
        if (score > bestScore) { bestScore = score; best = t; }
      }
      // Bare follow-up com não token overlap → maioria recente turn. Bare follow-ups são
      // content-free Por CONSTRUCTION (callers gate em isBareFollowUp), então quando there's
      // não topical overlap o direito resolution é simplesmente "o último thing we discussed".
      // O fragment define covers demonstratives ("that/it/this") AND o common
      // continuation/clarification verbs ("why/how/go on/expand/more/elaborate/…") that
      // carry não topic — anteriormente these returned nulo e dead-ended (test-engineer
      // Fase 11). Kept self-safe com a short-length proteger então a stray longo string can't
      // trip it até se a caller forgets o isBareFollowUp gate.
      const fu = (followUp || '').trim();
      const RECENCY_FALLBACK_RE = /\b(that|it|this|those|and|also|what about|continue|carry on|keep going|go on|previous|earlier|last|why|how|so|then|more|expand|elaborate|deeper|detail|tell me more|go deeper|explain)\b/i;
      if (!best && fu.split(/\s+/).length <= 6 && RECENCY_FALLBACK_RE.test(fu)) {
        return arr[arr.length - 1];
      }
      return best;
    } catch { return null; }
  }

  /**
   * CROSS-SESSION follow-up: delegate para o long-term provider com a strict timeout.
   * Returns [] quando não provider (memory disabled) ou on any error/timeout — o answer
   * proceeds sem it (non-negotiable: long-term memory nunca blocks/breaks answers).
   */
  async recallCrossSession(
    query: string,
    scope: { userId: string; sessionId?: string },
    timeoutMs = 800,
  ): Promise<Array<{ text: string; score?: number }>> {
    if (!this.longTerm) return [];
    try {
      const result = await Promise.race([
        this.longTerm.recall(query, scope, timeoutMs),
        new Promise<Array<{ text: string; score?: number }>>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
      ]);
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  /** Limpa a session's memory (e.g. quando a meeting termina após retain). */
  clearSession(sessionId: string): void {
    try { this.bySession.delete(sessionId); } catch { /* ignorar */ }
  }

  get sessionCount(): number { return this.bySession.size; }
}
